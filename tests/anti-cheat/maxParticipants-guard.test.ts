/**
 * Tests Phase 6 chantier B — anti-cheat V7 maxParticipants guard.
 *
 * Exécution :
 *   firebase emulators:exec --only firestore "npx tsx tests/anti-cheat/maxParticipants-guard.test.ts"
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
 * Setup : @firebase/rules-unit-testing v4 pilote l'emulator.
 *   - Service tests utilisent withSecurityRulesDisabled pour bypass rules + injecter le test seam
 *     (__setSessionsDbForTesting) dans le service.
 *   - Rules tests utilisent authenticatedContext(ALICE_UID) comme partner légitime owner d'activity.
 *
 * Pattern test runner : mini-runner cohérent sessions-integration.test.ts (assertEq/assertThrows
 * + section + main() async function pour CommonJS top-level await compat).
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setSessionsDbForTesting,
  updateSession,
} from '../../src/services/firestore';
import type { Session, PricingTier } from '../../src/types/firestore';

/**
 * @firebase/rules-unit-testing v4 retourne une Firestore "compat" (legacy namespace) qui est
 * runtime-compatible avec la modular SDK mais déclarée différemment côté types.
 */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner (cohérent sessions-integration.test.ts)
// =====================================================================

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string): void {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson === eJson) {
    console.log(`PASS  ${label}`);
    passes++;
  } else {
    console.log(`FAIL  ${label}`);
    console.log(`        actual  : ${aJson}`);
    console.log(`        expected: ${eJson}`);
    failures++;
  }
}

async function assertThrows(
  fn: () => Promise<unknown>,
  expectedMessage: string,
  label: string,
): Promise<Error | null> {
  try {
    await fn();
    console.log(`FAIL  ${label} (expected throw "${expectedMessage}", got success)`);
    failures++;
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === expectedMessage) {
      console.log(`PASS  ${label}`);
      passes++;
      return err instanceof Error ? err : null;
    }
    console.log(`FAIL  ${label} (expected throw "${expectedMessage}", got "${msg}")`);
    failures++;
    return null;
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================

async function main(): Promise<void> {
  const ALICE_UID = 'alice_partner';
  const ACTIVITY_ID_ALICE = 'activity_alice';

  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-anticheat',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  /**
   * Crée une Session test complète avec defaults sains. Override les champs nécessaires
   * pour chaque test case.
   */
  function makeTestSession(overrides: Partial<Session>): Session {
    const nowMs = Date.now();
    const startAt = Timestamp.fromMillis(nowMs + 7 * 24 * 60 * 60 * 1000); // J+7
    const endAt = Timestamp.fromMillis(nowMs + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const chatOpenAt = Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60 * 1000);
    const chatCloseAt = endAt;
    const tiers: PricingTier[] = [
      { kind: 'early', price: 2500, activateMinutesBeforeStart: null, activateAtFillRate: null },
      { kind: 'standard', price: 3500, activateMinutesBeforeStart: 4320, activateAtFillRate: 0.5 },
      { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.8 },
    ];
    return {
      sessionId: 'will-be-overridden',
      activityId: ACTIVITY_ID_ALICE,
      partnerId: ALICE_UID,
      creatorId: ALICE_UID,
      sport: 'Afroboost',
      title: 'Test Session',
      city: 'Genève',
      startAt,
      endAt,
      chatOpenAt,
      chatCloseAt,
      maxParticipants: 10,
      currentParticipants: 0,
      pricingTiers: tiers,
      currentTier: 'early',
      currentPrice: 2500,
      status: 'open',
      createdBy: ALICE_UID,
      createdAt: Timestamp.fromMillis(nowMs),
      updatedAt: Timestamp.fromMillis(nowMs),
      ...overrides,
    };
  }

  /**
   * Crée activities/{ACTIVITY_ID_ALICE} avec partnerId=ALICE_UID.
   * Nécessaire pour que les rules sessions/{id} valident qu'ALICE est partner-owner.
   * Setup minimum (juste partnerId) — autres champs Activity non requis par rules.
   */
  async function setupActivityAlice(): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(doc(fbDb, 'activities', ACTIVITY_ID_ALICE), {
        activityId: ACTIVITY_ID_ALICE,
        partnerId: ALICE_UID,
        title: 'Test Activity Alice',
      });
    });
  }

  await setupActivityAlice();

  // =====================================================================
  // SERVICE LAYER TESTS (B-T1..B-T5)
  // Utilisent withSecurityRulesDisabled (bypass rules) + test seam injection
  // =====================================================================

  section('B-T1..B-T5 : updateSession() service layer');

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setSessionsDbForTesting(fbDb);

    // B-T1 : upgrade maxP autorisé (5 → 10 avec currentP=5)
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

    // B-T2 : égalité autorisée (5 → 5 avec currentP=5)
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

    // B-T3 : downgrade strict bloqué + err.cause vérifié (B3.Q4)
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
      // Sub-assertion : err.cause contient bien { attempted, current, sessionId }
      const cause = (err?.cause ?? null) as
        | { attempted: number; current: number; sessionId: string }
        | null;
      assertEq(cause?.attempted, 3, 'B-T3 err.cause.attempted === 3');
      assertEq(cause?.current, 5, 'B-T3 err.cause.current === 5');
      assertEq(cause?.sessionId, sessionId, 'B-T3 err.cause.sessionId === session-bt3');
      // Vérifier que Firestore n'a pas été modifié (write doit être abandonné avant updateDoc)
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

  // Reset test seam (le service revient sur le client SDK normal)
  __setSessionsDbForTesting(null);

  // =====================================================================
  // RULES LAYER TESTS (B-T6..B-T8)
  // Utilisent authenticatedContext(ALICE) — partner SDK direct, rules appliquent
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
      console.log('PASS  B-T6 partner downgrade SDK direct → permission-denied');
      passes++;
    } catch {
      console.log('FAIL  B-T6 (expected fail, got success)');
      failures++;
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
      console.log('PASS  B-T7 partner upgrade SDK direct → success');
      passes++;
    } catch (e) {
      console.log('FAIL  B-T7', e);
      failures++;
    }
  }

  // B-T8 : title only via SDK partner → success (pas de touche maxP)
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
      console.log('PASS  B-T8 partner title only SDK direct → success');
      passes++;
    } catch (e) {
      console.log('FAIL  B-T8', e);
      failures++;
    }
  }

  // =====================================================================
  // Cleanup
  // =====================================================================

  await env.cleanup();

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
