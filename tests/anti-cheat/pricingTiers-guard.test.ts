/**
 * Tests Phase 6 chantier C — anti-cheat V9 pricingTiers freeze post-booking.
 *
 * Exécution :
 *   npm run test:anti-cheat:c
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/anti-cheat/pricingTiers-guard.test.ts")
 *
 * 8 cas couverts (cf. plan chantier C audit) :
 *
 * Service layer (updateSession() V9 guard) :
 *   C-T1 : currentP=0, modif pricingTiers → autorisé (avant 1er booking, modif libre)
 *   C-T2 : currentP=1, modif pricingTiers → throw V9 + err.cause vérifié
 *   C-T3 : currentP=5, sending SAME pricingTiers as before → throw V9 (présence simple, cf. C.Q1)
 *   C-T4 : currentP=5, title only (sans pricingTiers) → autorisé, garde n'intervient pas
 *   C-T5 : currentP=5, pricingTiers + title combinés → throw V9 + Firestore inchangé
 *
 * Rules layer (firestore.rules validPricingTiersUpdate helper) :
 *   C-T6 : currentP=5, partner SDK direct modif pricingTiers → permission-denied
 *   C-T7 : currentP=0, partner SDK direct modif pricingTiers → success (avant booking)
 *   C-T8 : currentP=5, partner SDK direct title only → success (pas de touche pricingTiers)
 *
 * Helpers shared : tests/anti-cheat/fixtures.ts.
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
import type { PricingTier, Session } from '../../src/types/firestore';

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
// Constantes test — pricingTiers variants
// =====================================================================

const ORIGINAL_TIERS: PricingTier[] = [
  { kind: 'early', price: 2500, activateMinutesBeforeStart: null, activateAtFillRate: null },
  { kind: 'standard', price: 3500, activateMinutesBeforeStart: 4320, activateAtFillRate: 0.5 },
  { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.8 },
];

const NEW_TIERS: PricingTier[] = [
  { kind: 'early', price: 1500, activateMinutesBeforeStart: null, activateAtFillRate: null },
  { kind: 'standard', price: 2500, activateMinutesBeforeStart: 4320, activateAtFillRate: 0.5 },
  { kind: 'last_minute', price: 3500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.8 },
];

// =====================================================================

async function main(): Promise<void> {
  resetCounts();

  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-anticheat-c',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  await setupActivityAlice(env);

  // =====================================================================
  // SERVICE LAYER TESTS (C-T1..C-T5)
  // =====================================================================

  section('C-T1..C-T5 : updateSession() V9 service layer');

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setSessionsDbForTesting(fbDb);

    // C-T1 : currentP=0, modif pricingTiers → autorisé
    {
      const sessionId = 'session-ct1';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          currentParticipants: 0,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
      await updateSession(sessionId, { pricingTiers: NEW_TIERS });
      const updated = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(
        updated.pricingTiers[0].price,
        1500,
        'C-T1 currentP=0 → modif pricingTiers acceptée (early 2500→1500)',
      );
    }

    // C-T2 : currentP=1, modif pricingTiers → throw V9 + err.cause
    {
      const sessionId = 'session-ct2';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          currentParticipants: 1,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
      const err = await assertThrows(
        () => updateSession(sessionId, { pricingTiers: NEW_TIERS }),
        'pricingTiers-frozen-after-first-booking',
        'C-T2 currentP=1 → throw V9',
      );
      const cause = (err?.cause ?? null) as
        | {
            sessionId: string;
            currentParticipants: number;
            attempted: PricingTier[];
          }
        | null;
      assertEq(cause?.sessionId, sessionId, 'C-T2 err.cause.sessionId === session-ct2');
      assertEq(cause?.currentParticipants, 1, 'C-T2 err.cause.currentParticipants === 1');
      assertEq(
        cause?.attempted?.[0]?.price,
        1500,
        'C-T2 err.cause.attempted contient les nouveaux tiers (early=1500)',
      );
      const after = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(
        after.pricingTiers[0].price,
        2500,
        'C-T2 pricingTiers inchangés Firestore après throw (toujours 2500)',
      );
    }

    // C-T3 : currentP=5, sending SAME tiers (présence simple bloque même si valeur identique)
    {
      const sessionId = 'session-ct3';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          currentParticipants: 5,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
      await assertThrows(
        () => updateSession(sessionId, { pricingTiers: ORIGINAL_TIERS }),
        'pricingTiers-frozen-after-first-booking',
        'C-T3 currentP=5 + same pricingTiers → throw V9 (présence simple)',
      );
    }

    // C-T4 : currentP=5, title only (sans pricingTiers) → autorisé
    {
      const sessionId = 'session-ct4';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          title: 'Original',
          currentParticipants: 5,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
      await updateSession(sessionId, { title: 'New Title' });
      const updated = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(updated.title, 'New Title', 'C-T4 title only update accepté (currentP=5)');
      assertEq(
        updated.pricingTiers[0].price,
        2500,
        'C-T4 pricingTiers préservés (pas dans updates)',
      );
    }

    // C-T5 : currentP=5, pricingTiers + title combinés → throw V9 + Firestore inchangé
    {
      const sessionId = 'session-ct5';
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          title: 'Original',
          currentParticipants: 5,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
      await assertThrows(
        () =>
          updateSession(sessionId, {
            pricingTiers: NEW_TIERS,
            title: 'New Title',
          }),
        'pricingTiers-frozen-after-first-booking',
        'C-T5 pricingTiers + title combinés → throw V9 (atomic guard)',
      );
      const after = (await getDoc(doc(fbDb, 'sessions', sessionId))).data() as Session;
      assertEq(
        after.title,
        'Original',
        'C-T5 title inchangé Firestore (write atomic abandonné par throw)',
      );
      assertEq(
        after.pricingTiers[0].price,
        2500,
        'C-T5 pricingTiers inchangés Firestore',
      );
    }
  });

  __setSessionsDbForTesting(null);

  // =====================================================================
  // RULES LAYER TESTS (C-T6..C-T8)
  // =====================================================================

  section('C-T6..C-T8 : firestore.rules partner direct');

  // C-T6 : currentP=5, partner modif pricingTiers SDK direct → permission-denied
  {
    const sessionId = 'session-ct6';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          currentParticipants: 5,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
    });
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const aliceDb = asFirestore(aliceCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(aliceDb, 'sessions', sessionId), { pricingTiers: NEW_TIERS }),
      );
      passManually('C-T6 partner modif pricingTiers SDK direct (currentP=5) → permission-denied');
    } catch {
      failManually('C-T6 (expected fail, got success)');
    }
  }

  // C-T7 : currentP=0, partner modif pricingTiers SDK direct → success
  {
    const sessionId = 'session-ct7';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          currentParticipants: 0,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
    });
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const aliceDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(aliceDb, 'sessions', sessionId), { pricingTiers: NEW_TIERS }),
      );
      passManually('C-T7 partner modif pricingTiers SDK direct (currentP=0) → success');
    } catch (e) {
      failManually('C-T7', e);
    }
  }

  // C-T8 : currentP=5, partner title only SDK direct → success
  {
    const sessionId = 'session-ct8';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', sessionId),
        makeTestSession({
          sessionId,
          title: 'Old',
          currentParticipants: 5,
          pricingTiers: ORIGINAL_TIERS,
        }),
      );
    });
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const aliceDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(aliceDb, 'sessions', sessionId), { title: 'New' }),
      );
      passManually('C-T8 partner title only SDK direct (currentP=5) → success');
    } catch (e) {
      failManually('C-T8', e);
    }
  }

  // =====================================================================
  // Cleanup
  // =====================================================================

  await env.cleanup();

  const { passes, failures } = getCounts();
  console.log('');
  console.log('====== Résumé Anti-Cheat C (pricingTiers freeze) ======');
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
