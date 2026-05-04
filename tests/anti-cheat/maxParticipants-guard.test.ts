/**
 * Tests Phase 6 chantier B — anti-cheat V7 maxParticipants guard.
 *
 * Exécution :
 *   npm run test:anti-cheat:b
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/anti-cheat/maxParticipants-guard.test.ts")
 *
 * 8 cas couverts (cf. plan chantier B audit) :
 *
 * Service layer (updateSession() service helper) :
 *   B-T1 : upgrade maxP autorisé (5 → 10 avec currentP=5)
 *   B-T2 : égalité autorisée (5 → 5 = ferme aux nouvelles bookings)
 *   B-T3 : downgrade strict bloqué (5 → 3 avec currentP=5) → throw V7 + err.cause vérifié
 *   B-T4 : currentP=0, maxP=1 → autorisé
 *   B-T5 : title only (sans maxP) → autorisé, garde n'intervient pas
 *
 * Rules layer (firestore.rules validMaxParticipantsUpdate helper) :
 *   B-T6 : partner SDK direct downgrade maxP → permission-denied
 *   B-T7 : partner SDK direct upgrade maxP → success
 *   B-T8 : partner SDK direct title only → success (pas de touche maxP)
 *
 * Helpers shared : tests/anti-cheat/fixtures.ts (constantes, runner, makeTestSession, setupActivityAlice).
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setSessionsDbForTesting,
  updateSession,
} from '../../src/services/firestore';
import type { Session } from '../../src/types/firestore';

import {
  ALICE_UID,
  asFirestore,
  assertEq,
  assertThrows,
  failManually,
  getCounts,
  makeTestSession,
  passManually,
  resetCounts,
  section,
  setupActivityAlice,
} from './fixtures';

// =====================================================================

async function main(): Promise<void> {
  resetCounts();

  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-anticheat-b',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  await setupActivityAlice(env);

  // =====================================================================
  // SERVICE LAYER TESTS (B-T1..B-T5)
  // =====================================================================

  section('B-T1..B-T5 : updateSession() service layer');

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setSessionsDbForTesting(fbDb);

    // B-T1 : upgrade maxP autorisé
    {
      const sessionId = 'session-bt1';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({ sessionId, maxParticipants: 5, currentParticipants: 5 }),
      );
      await updateSession(sessionId, { maxParticipants: 10 });
      const updated = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(updated.maxParticipants, 10, 'B-T1 upgrade maxP 5→10 (currentP=5)');
    }

    // B-T2 : égalité autorisée
    {
      const sessionId = 'session-bt2';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({ sessionId, maxParticipants: 5, currentParticipants: 5 }),
      );
      await updateSession(sessionId, { maxParticipants: 5 });
      const updated = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(updated.maxParticipants, 5, 'B-T2 égalité maxP 5→5 (currentP=5)');
    }

    // B-T3 : downgrade strict bloqué + err.cause vérifié
    {
      const sessionId = 'session-bt3';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({ sessionId, maxParticipants: 5, currentParticipants: 5 }),
      );
      const err = await assertThrows(
        () => updateSession(sessionId, { maxParticipants: 3 }),
        'maxParticipants-cannot-be-below-currentParticipants',
        'B-T3 downgrade strict 5→3 (currentP=5) throws V7',
      );
      const cause = (err?.cause ?? null) as
        | { attempted: number; current: number; sessionId: string }
        | null;
      assertEq(cause?.attempted, 3, 'B-T3 err.cause.attempted === 3');
      assertEq(cause?.current, 5, 'B-T3 err.cause.current === 5');
      assertEq(cause?.sessionId, sessionId, 'B-T3 err.cause.sessionId === session-bt3');
      const after = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(after.maxParticipants, 5, 'B-T3 maxP inchangé Firestore après throw');
    }

    // B-T4 : currentP=0, maxP=1 OK
    {
      const sessionId = 'session-bt4';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({ sessionId, maxParticipants: 10, currentParticipants: 0 }),
      );
      await updateSession(sessionId, { maxParticipants: 1 });
      const updated = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(updated.maxParticipants, 1, 'B-T4 currentP=0, maxP 10→1');
    }

    // B-T5 : title only (sans maxP) → autorisé + maxP préservé
    {
      const sessionId = 'session-bt5';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          title: 'Original',
          maxParticipants: 10,
          currentParticipants: 5,
        }),
      );
      await updateSession(sessionId, { title: 'New Title' });
      const updated = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(updated.title, 'New Title', 'B-T5 title only update');
      assertEq(updated.maxParticipants, 10, 'B-T5 maxP préservé (pas dans updates)');
    }
  });

  __setSessionsDbForTesting(null);

  // =====================================================================
  // RULES LAYER TESTS (B-T6..B-T8)
  // =====================================================================

  section('B-T6..B-T8 : firestore.rules partner direct');

  // B-T6 : downgrade strict via SDK partner → permission-denied
  {
    const sessionId = 'session-bt6';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({ sessionId, maxParticipants: 5, currentParticipants: 5 }),
      );
    });
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const aliceDb = asFirestore(aliceCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(aliceDb, 'sessions', sessionId), { maxParticipants: 3 }),
      );
      passManually('B-T6 partner downgrade SDK direct → permission-denied');
    } catch {
      failManually('B-T6 (expected fail, got success)');
    }
  }

  // B-T7 : upgrade via SDK partner → success
  {
    const sessionId = 'session-bt7';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({ sessionId, maxParticipants: 5, currentParticipants: 5 }),
      );
    });
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const aliceDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(aliceDb, 'sessions', sessionId), { maxParticipants: 20 }),
      );
      passManually('B-T7 partner upgrade SDK direct → success');
    } catch (e) {
      failManually('B-T7', e);
    }
  }

  // B-T8 : title only via SDK partner → success
  {
    const sessionId = 'session-bt8';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          title: 'Old',
          maxParticipants: 5,
          currentParticipants: 5,
        }),
      );
    });
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const aliceDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(aliceDb, 'sessions', sessionId), { title: 'New' }),
      );
      passManually('B-T8 partner title only SDK direct → success');
    } catch (e) {
      failManually('B-T8', e);
    }
  }

  // =====================================================================
  // Cleanup
  // =====================================================================

  await env.cleanup();

  const { passes, failures } = getCounts();
  console.log('');
  console.log('====== Résumé Anti-Cheat B (maxParticipants guard) ======');
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
