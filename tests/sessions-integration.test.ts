/**
 * Tests d'intégration Phase 2 — services Sessions avec emulator Firestore.
 *
 * Exécution :
 *   firebase emulators:exec --only firestore "npx tsx tests/sessions-integration.test.ts"
 *
 * 8 cas couverts (cf. plan Phase 2) :
 *   1. createSession happy path
 *   2. createSession rejet par rules (user normal sur activity d'un autre partner)
 *   3. getSession + subscribeToSession
 *   4. getUpcomingSessions filtré par city
 *   5. bookSession happy path
 *   6. bookSession idempotency
 *   7. bookSession session pleine
 *   8. bookSession concurrent (race sur la dernière place)
 *
 * Setup : utilise @firebase/rules-unit-testing pour piloter l'emulator.
 * Le test seam __setSessionsDbForTesting injecte le Firestore du test env dans les services.
 */

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp, doc, getDoc, setDoc, collection, getDocs, query, where,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/**
 * @firebase/rules-unit-testing v4 retourne une Firestore "compat" (legacy namespace) qui est
 * runtime-compatible avec la modular SDK mais déclarée différemment côté types. Cast en `unknown`
 * puis `Firestore` pour réconcilier — strictement type-only, aucun impact runtime.
 */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

import {
  __setSessionsDbForTesting,
  createSession,
  getSession,
  subscribeToSession,
  getUpcomingSessions,
  bookSession,
} from '../src/services/firestore';
import type { Session, PricingTier } from '../src/types/firestore';

// =====================================================================
// Mini test runner
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

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Fixtures
// =====================================================================

const ALICE_UID = 'alice-partner';
const BOB_UID = 'bob-partner';
const USER1_UID = 'user1';

const ACTIVITY_ID = 'a1';     // owned by alice, Genève
const ACTIVITY_LSN = 'a2';    // owned by alice, Lausanne (test 4)

const STANDARD_TIERS: PricingTier[] = [
  { kind: 'early',       price: 2500, activateMinutesBeforeStart: null,  activateAtFillRate: null },
  { kind: 'standard',    price: 3500, activateMinutesBeforeStart: 4320,  activateAtFillRate: 0.5 },
  { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440,  activateAtFillRate: 0.8 },
];

function futureStart(daysFromNow: number = 15): Date {
  return new Date(Date.now() + daysFromNow * 24 * 3600 * 1000);
}

async function seedActivities(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = ctx.firestore();
    const baseActivity = {
      sport: 'afroboost',
      description: 'Test activity',
      partnerName: 'Alice Studio',
      address: 'Test address',
      price: 0,
      currency: 'CHF',
      duration: 60,
      maxParticipants: 20,
      currentParticipants: 0,
      schedule: [],
      images: [],
      tags: [],
      isActive: true,
      rating: 0,
      reviewCount: 0,
      createdBy: ALICE_UID,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      defaultPricingTiers: STANDARD_TIERS,
      chatOpenOffsetMinutes: 120,
    };
    await setDoc(doc(fbDb, 'activities', ACTIVITY_ID), {
      ...baseActivity,
      activityId: ACTIVITY_ID,
      title: 'Afroboost Genève',
      partnerId: ALICE_UID,
      city: 'Genève',
    });
    await setDoc(doc(fbDb, 'activities', ACTIVITY_LSN), {
      ...baseActivity,
      activityId: ACTIVITY_LSN,
      title: 'Afroboost Lausanne',
      partnerId: ALICE_UID,
      city: 'Lausanne',
    });
  });
}

// =====================================================================
// Setup environment
// =====================================================================

const RULES = readFileSync('firestore.rules', 'utf8');

// Wrapper IIFE async pour permettre l'usage de await dans tsx (qui compile en CJS).
async function main(): Promise<void> {

const env: RulesTestEnvironment = await initializeTestEnvironment({
  projectId: 'test-spordate',
  firestore: {
    rules: RULES,
    host: '127.0.0.1',
    port: 8080,
  },
});

await seedActivities(env);
section('Setup');
console.log('PASS  Seed activities (a1 Genève, a2 Lausanne)');
passes++;

// =====================================================================
// Test 1 — createSession happy path
// =====================================================================

section('Test 1 — createSession happy path');
let test1SessionId = '';
{
  const aliceCtx = env.authenticatedContext(ALICE_UID);
  __setSessionsDbForTesting(asFirestore(aliceCtx.firestore()));

  const startAt = futureStart(15);
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  test1SessionId = await createSession({
    activityId: ACTIVITY_ID,
    startAt,
    endAt,
    maxParticipants: 10,
  });
  assertEq(typeof test1SessionId === 'string' && test1SessionId.length > 0, true, 'T1 sessionId returned');

  // Verify (admin bypass)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = ctx.firestore();
    const snap = await getDoc(doc(fbDb, 'sessions', test1SessionId));
    assertEq(snap.exists(), true, 'T1 session doc exists');
    const data = snap.data() as Session;
    assertEq(data.partnerId, ALICE_UID, 'T1 partnerId = alice');
    assertEq(data.activityId, ACTIVITY_ID, 'T1 activityId correct');
    assertEq(data.maxParticipants, 10, 'T1 maxParticipants = 10');
    assertEq(data.currentParticipants, 0, 'T1 currentParticipants = 0');
    assertEq(data.currentTier, 'early', 'T1 currentTier = early');
    assertEq(data.currentPrice, 2500, 'T1 currentPrice = 2500 (early)');
    assertEq(data.status, 'scheduled', 'T1 status = scheduled');
    assertEq(data.city, 'Genève', 'T1 city dénormalisé OK');
  });
}

// =====================================================================
// Test 2 — createSession rejet par rules (Bob sur activity d'Alice)
// =====================================================================

section("Test 2 — createSession rejet par rules");
{
  const bobCtx = env.authenticatedContext(BOB_UID);
  __setSessionsDbForTesting(asFirestore(bobCtx.firestore()));

  let threw = false;
  let errMessage = '';
  try {
    await createSession({
      activityId: ACTIVITY_ID, // owned by alice, bob shouldn't be allowed
      startAt: futureStart(20),
      endAt: new Date(futureStart(20).getTime() + 60 * 60_000),
      maxParticipants: 10,
    });
  } catch (err: unknown) {
    threw = true;
    errMessage = err instanceof Error ? err.message : String(err);
  }
  assertEq(threw, true, 'T2 bob (autre partenaire) rejeté par les rules');
  // Le message peut varier selon l'erreur Firestore, on log juste pour vérif
  console.log(`        error: ${errMessage.substring(0, 100)}...`);
}

// =====================================================================
// Test 3 — getSession + subscribeToSession
// =====================================================================

section('Test 3 — getSession + subscribeToSession');
{
  const aliceCtx = env.authenticatedContext(ALICE_UID);
  __setSessionsDbForTesting(asFirestore(aliceCtx.firestore()));

  // getSession
  const session = await getSession(test1SessionId);
  assertEq(session !== null, true, 'T3 getSession returns non-null');
  assertEq(session?.sessionId, test1SessionId, 'T3 sessionId matches');

  // subscribeToSession — on attend juste le premier snapshot puis on unsubscribe
  const received: Array<Session | null> = [];
  const unsub = subscribeToSession(test1SessionId, (s) => {
    received.push(s);
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  unsub();
  assertEq(received.length >= 1, true, 'T3 subscribeToSession reçu au moins 1 snapshot');
  assertEq(received[0]?.sessionId === test1SessionId, true, 'T3 snapshot a le bon sessionId');
}

// =====================================================================
// Test 4 — getUpcomingSessions filtré par city
// =====================================================================

section('Test 4 — getUpcomingSessions filtré par city');
{
  const aliceCtx = env.authenticatedContext(ALICE_UID);
  __setSessionsDbForTesting(asFirestore(aliceCtx.firestore()));

  // Créer une session à Lausanne
  const startAtLsn = futureStart(20);
  const endAtLsn = new Date(startAtLsn.getTime() + 60 * 60_000);
  const lsnSessionId = await createSession({
    activityId: ACTIVITY_LSN,
    startAt: startAtLsn,
    endAt: endAtLsn,
    maxParticipants: 10,
  });

  // Note : createSession met status='scheduled' qui est inclus dans l'IN clause de getUpcomingSessions

  await new Promise((resolve) => setTimeout(resolve, 200));

  const lausanne = await getUpcomingSessions({ city: 'Lausanne' });
  assertEq(lausanne.length >= 1, true, 'T4 ≥1 session à Lausanne');
  const allLausanne = lausanne.every((s) => s.city === 'Lausanne');
  assertEq(allLausanne, true, 'T4 toutes les sessions retournées sont à Lausanne');

  const geneve = await getUpcomingSessions({ city: 'Genève' });
  assertEq(geneve.length >= 1, true, 'T4 ≥1 session à Genève');
  const allGeneve = geneve.every((s) => s.city === 'Genève');
  assertEq(allGeneve, true, 'T4 toutes les sessions retournées sont à Genève');

  void lsnSessionId; // marqueur pour le linter
}

// =====================================================================
// Tests 5-8 — bookSession (rules désactivées car bookSession écrit currentParticipants)
//
// IMPORTANT : @firebase/rules-unit-testing termine le Firestore d'un context
// withSecurityRulesDisabled à la fin du callback. On enveloppe donc TOUS les
// tests 5-8 dans UN SEUL callback pour garder le client vivant.
// =====================================================================

await env.withSecurityRulesDisabled(async (ctx) => {
  const fbDb = ctx.firestore();
  __setSessionsDbForTesting(asFirestore(fbDb));

  // Helper interne : seed une session "open" dans le fbDb partagé
  async function seedOpenSession(maxParticipants: number): Promise<string> {
    const ref = doc(collection(fbDb, 'sessions'));
    const startAt = futureStart(10);
    const endAt = new Date(startAt.getTime() + 60 * 60_000);
    await setDoc(ref, {
      sessionId: ref.id,
      activityId: ACTIVITY_ID,
      partnerId: ALICE_UID,
      creatorId: ALICE_UID,
      sport: 'afroboost',
      title: 'Test booking',
      city: 'Genève',
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      chatOpenAt: Timestamp.fromDate(new Date(startAt.getTime() - 120 * 60_000)),
      chatCloseAt: Timestamp.fromDate(endAt),
      maxParticipants,
      currentParticipants: 0,
      pricingTiers: STANDARD_TIERS,
      currentTier: 'early',
      currentPrice: 2500,
      status: 'open',
      createdBy: ALICE_UID,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return ref.id;
  }

  // ---------------------------------------------------------------------
  // Test 5 — bookSession happy path
  // ---------------------------------------------------------------------
  section('Test 5 — bookSession happy path');
  const session5Id = await seedOpenSession(5);
  const booking5Id = await bookSession({
    sessionId: session5Id,
    userId: USER1_UID,
    amount: 2500,
    tier: 'early',
    paymentIntentId: 'pi_test_5',
  });
  assertEq(typeof booking5Id === 'string' && booking5Id.length > 0, true, 'T5 bookingId returned');

  {
    const sessSnap = await getDoc(doc(fbDb, 'sessions', session5Id));
    const data = sessSnap.data() as Session;
    assertEq(data.currentParticipants, 1, 'T5 currentParticipants incrémenté à 1');
    assertEq(data.status, 'open', 'T5 status reste open (1/5)');

    const bSnap = await getDoc(doc(fbDb, 'bookings', booking5Id));
    assertEq(bSnap.exists(), true, 'T5 booking créé');
    const b = bSnap.data();
    assertEq(b?.sessionId, session5Id, 'T5 booking.sessionId correct');
    assertEq(b?.amount, 2500, 'T5 booking.amount correct');
    assertEq(b?.paymentIntentId, 'pi_test_5', 'T5 booking.paymentIntentId stocké');
    assertEq(b?.tier, 'early', 'T5 booking.tier stocké');
    assertEq(b?.status, 'confirmed', 'T5 booking.status = confirmed');
  }

  // ---------------------------------------------------------------------
  // Test 6 — bookSession idempotency (même paymentIntentId)
  // ---------------------------------------------------------------------
  section('Test 6 — bookSession idempotency');
  const booking6Id = await bookSession({
    sessionId: session5Id,
    userId: USER1_UID,
    amount: 2500,
    tier: 'early',
    paymentIntentId: 'pi_test_5', // SAME as T5
  });
  assertEq(booking6Id, booking5Id, 'T6 même bookingId retourné (idempotency)');

  {
    const bookings = await getDocs(
      query(collection(fbDb, 'bookings'), where('paymentIntentId', '==', 'pi_test_5')),
    );
    assertEq(bookings.size, 1, 'T6 toujours 1 seul booking pour pi_test_5');

    const sessSnap = await getDoc(doc(fbDb, 'sessions', session5Id));
    const data = sessSnap.data() as Session;
    assertEq(data.currentParticipants, 1, 'T6 currentParticipants inchangé (toujours 1)');
  }

  // ---------------------------------------------------------------------
  // Test 7 — bookSession session pleine
  // ---------------------------------------------------------------------
  section('Test 7 — bookSession session pleine');
  // Remplir jusqu'à max (4 places restantes après T5)
  await bookSession({ sessionId: session5Id, userId: 'u_fill_2', amount: 2500, tier: 'early', paymentIntentId: 'pi_fill_2' });
  await bookSession({ sessionId: session5Id, userId: 'u_fill_3', amount: 2500, tier: 'early', paymentIntentId: 'pi_fill_3' });
  await bookSession({ sessionId: session5Id, userId: 'u_fill_4', amount: 2500, tier: 'early', paymentIntentId: 'pi_fill_4' });
  await bookSession({ sessionId: session5Id, userId: 'u_fill_5', amount: 2500, tier: 'early', paymentIntentId: 'pi_fill_5' });

  {
    const sessSnap = await getDoc(doc(fbDb, 'sessions', session5Id));
    const data = sessSnap.data() as Session;
    assertEq(data.currentParticipants, 5, 'T7 setup — 5/5 atteint');
    assertEq(data.status, 'full', 'T7 setup — status = full');
  }

  let threw = false;
  let errMsg = '';
  try {
    await bookSession({
      sessionId: session5Id,
      userId: 'u_overflow',
      amount: 2500,
      tier: 'early',
      paymentIntentId: 'pi_overflow',
    });
  } catch (err: unknown) {
    threw = true;
    errMsg = err instanceof Error ? err.message : String(err);
  }
  assertEq(threw, true, 'T7 bookSession throw quand session pleine');
  assertEq(errMsg.length > 0, true, 'T7 message d\'erreur non vide');

  {
    const sessSnap = await getDoc(doc(fbDb, 'sessions', session5Id));
    const data = sessSnap.data() as Session;
    assertEq(data.currentParticipants, 5, 'T7 currentParticipants inchangé (5)');
    const overflow = await getDocs(
      query(collection(fbDb, 'bookings'), where('paymentIntentId', '==', 'pi_overflow')),
    );
    assertEq(overflow.empty, true, 'T7 aucun booking créé pour overflow');
  }

  // ---------------------------------------------------------------------
  // Test 8 — bookSession concurrent (race sur la dernière place)
  // ---------------------------------------------------------------------
  section('Test 8 — bookSession concurrent (race last seat)');
  const session8Id = await seedOpenSession(1);
  const results = await Promise.allSettled([
    bookSession({
      sessionId: session8Id,
      userId: 'race_u1',
      amount: 2500,
      tier: 'early',
      paymentIntentId: 'pi_race_1',
    }),
    bookSession({
      sessionId: session8Id,
      userId: 'race_u2',
      amount: 2500,
      tier: 'early',
      paymentIntentId: 'pi_race_2',
    }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  assertEq(fulfilled, 1, 'T8 exactement 1 transaction succeed');
  assertEq(rejected, 1, 'T8 exactement 1 transaction rejected');

  {
    const sessSnap = await getDoc(doc(fbDb, 'sessions', session8Id));
    const data = sessSnap.data() as Session;
    assertEq(data.currentParticipants, 1, 'T8 final currentParticipants = 1 (atomique)');
    assertEq(data.status, 'full', 'T8 status = full');
  }
});

// =====================================================================
// Cleanup
// =====================================================================

await env.cleanup();

console.log('');
console.log('====== Résumé Integration ======');
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
process.exit(failures > 0 ? 1 : 0);

} // fin async function main

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
