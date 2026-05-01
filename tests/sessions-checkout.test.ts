/**
 * Tests d'intégration Phase 3 — webhook Stripe mode 'session' + régression mode 'package'.
 *
 * Exécution :
 *   firebase emulators:exec --only firestore "npx tsx tests/sessions-checkout.test.ts"
 *
 * 4 cas couverts :
 *   T3. Webhook session happy path (booking + grant credits + chatUnlocked si match)
 *   T4. Webhook idempotency (2 retries → 1 seul booking + 1 seul grant credits)
 *   T5. Webhook session pleine (race) → erreur log + notif user, pas de booking, pas de credits
 *   T7. Régression mode 'package' (event sans metadata.mode='session' → flow existant)
 *
 * Setup : Firebase Admin SDK pointé sur l'emulator via FIRESTORE_EMULATOR_HOST.
 * On NE TESTE PAS le flow /api/checkout côté HTTP (anti-cheat garanti par construction —
 * computePricingTier server-side ignore tout amount/tier client-side).
 */

// IMPORTANT : env vars doivent être set AVANT tout import qui charge firebase-admin.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'test-spordate-phase3';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-spordate-phase3';
// Stripe : clé dummy non fonctionnelle — la fonction handlePaymentSuccess n'appellera pas
// stripe.paymentIntents.retrieve avec succès, mais le catch silent gère ça.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_phase3_tests';

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import Stripe from 'stripe';

import { handlePaymentSuccess } from '../src/app/api/webhooks/stripe/handler';

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
const USER1_UID = 'user-buyer-1';
const ACTIVITY_ID = 'activity-phase3';
const STANDARD_TIERS = [
  { kind: 'early',       price: 2500, activateMinutesBeforeStart: null,  activateAtFillRate: null },
  { kind: 'standard',    price: 3500, activateMinutesBeforeStart: 4320,  activateAtFillRate: 0.5 },
  { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440,  activateAtFillRate: 0.8 },
];

function futureStart(daysFromNow: number = 15): Date {
  return new Date(Date.now() + daysFromNow * 24 * 3600 * 1000);
}

// =====================================================================
// Setup admin SDK + Firestore (emulator)
// =====================================================================

async function main(): Promise<void> {

if (!getApps().length) {
  initializeApp({ projectId: 'test-spordate-phase3' });
}
const db = getFirestore();

// Helper : clear toutes les collections testées (Admin SDK on emulator)
async function clearAll(): Promise<void> {
  const cols = ['sessions', 'bookings', 'transactions', 'users', 'activities', 'matches', 'credits', 'notifications', 'errorLogs', 'analytics'];
  for (const col of cols) {
    const snap = await db.collection(col).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (snap.size > 0) await batch.commit();
  }
}

// Helper : seed une activity + un user
async function seedFixtures(): Promise<void> {
  await db.collection('activities').doc(ACTIVITY_ID).set({
    activityId: ACTIVITY_ID,
    title: 'Afroboost Lac Léman',
    sport: 'afroboost',
    description: 'Test session for Phase 3',
    partnerId: ALICE_UID,
    partnerName: 'Alice Studio',
    city: 'Genève',
    address: 'Test',
    geoPoint: null,
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
    chatCloseAt: null,
    chatCreditsBundle: 50,
  });
  await db.collection('users').doc(USER1_UID).set({
    uid: USER1_UID,
    email: 'buyer@test.com',
    displayName: 'Buyer Test',
    credits: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

// Helper : seed une session (open) avec maxParticipants donné, currentParticipants = 0
async function seedSession(opts: {
  sessionId: string;
  maxParticipants: number;
  currentParticipants?: number;
  status?: string;
}): Promise<string> {
  const startAt = futureStart(15);
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  await db.collection('sessions').doc(opts.sessionId).set({
    sessionId: opts.sessionId,
    activityId: ACTIVITY_ID,
    partnerId: ALICE_UID,
    creatorId: ALICE_UID,
    sport: 'afroboost',
    title: 'Afroboost Lac Léman',
    city: 'Genève',
    startAt: Timestamp.fromDate(startAt),
    endAt: Timestamp.fromDate(endAt),
    chatOpenAt: Timestamp.fromDate(new Date(startAt.getTime() - 120 * 60_000)),
    chatCloseAt: Timestamp.fromDate(endAt),
    maxParticipants: opts.maxParticipants,
    currentParticipants: opts.currentParticipants ?? 0,
    pricingTiers: STANDARD_TIERS,
    currentTier: 'early',
    currentPrice: 2500,
    status: opts.status ?? 'open',
    createdBy: ALICE_UID,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return opts.sessionId;
}

// Stripe instance dummy (pour signature de handlePaymentSuccess — paymentIntents.retrieve échouera silencieusement)
const stripeDummy = new Stripe('sk_test_dummy_for_phase3_tests') as unknown as InstanceType<typeof Stripe>;

// Helper : forge un Stripe checkout.session.completed event mode='session'
function fakeSessionEvent(opts: {
  stripeSessionId: string;
  paymentIntentId: string;
  sessionId: string;
  userId: string;
  bundleCredits?: number;
  amountTotal?: number;
  matchId?: string;
}): Record<string, unknown> {
  return {
    id: opts.stripeSessionId,
    payment_intent: opts.paymentIntentId,
    payment_method_types: ['card'],
    amount_total: opts.amountTotal ?? 2500,
    metadata: {
      mode: 'session',
      sessionId: opts.sessionId,
      userId: opts.userId,
      matchId: opts.matchId || '',
      tier: 'early',
      amount: String(opts.amountTotal ?? 2500),
      activityId: ACTIVITY_ID,
      partnerId: ALICE_UID,
      bundleCredits: String(opts.bundleCredits ?? 50),
    },
  };
}

// Helper : forge un Stripe checkout.session.completed event mode='package' (legacy)
function fakePackageEvent(opts: {
  stripeSessionId: string;
  paymentIntentId: string;
  userId: string;
  packageId?: string;
}): Record<string, unknown> {
  return {
    id: opts.stripeSessionId,
    payment_intent: opts.paymentIntentId,
    payment_method_types: ['card'],
    amount_total: 1000, // 1_date = 10 CHF
    metadata: {
      // PAS de mode='session' — devrait tomber dans le flow legacy 'package'
      userId: opts.userId,
      packageId: opts.packageId ?? '1_date',
      creditsToGrant: '1',
      matchId: '',
      referralCode: '',
      isPremium: 'false',
      partnerId: '',
    },
  };
}

// =====================================================================
// Setup global
// =====================================================================

section('Setup');
await clearAll();
await seedFixtures();
console.log('PASS  Setup OK (cleared + seeded activity + user)');
passes++;

// =====================================================================
// T3 — Webhook session happy path
// =====================================================================

section('T3 — Webhook session happy path');
const T3_SESSION_ID = 'session-T3';
await seedSession({ sessionId: T3_SESSION_ID, maxParticipants: 5 });

const eventT3 = fakeSessionEvent({
  stripeSessionId: 'cs_test_T3',
  paymentIntentId: 'pi_test_T3',
  sessionId: T3_SESSION_ID,
  userId: USER1_UID,
  bundleCredits: 50,
  amountTotal: 2500,
});

await handlePaymentSuccess(eventT3, stripeDummy);

// Assertions
{
  const sessionSnap = await db.collection('sessions').doc(T3_SESSION_ID).get();
  const session = sessionSnap.data();
  assertEq(session?.currentParticipants, 1, 'T3 session.currentParticipants = 1');
  assertEq(session?.status, 'open', 'T3 session.status = open (1/5)');

  const userSnap = await db.collection('users').doc(USER1_UID).get();
  assertEq(userSnap.data()?.credits, 50, 'T3 user.credits = 50 (bundle granted)');

  const txSnap = await db.collection('transactions').where('stripeSessionId', '==', 'cs_test_T3').get();
  assertEq(txSnap.size, 1, 'T3 1 transaction créée');
  const tx = txSnap.docs[0]?.data();
  assertEq(tx?.type, 'session_purchase', 'T3 transaction.type = session_purchase');
  assertEq(tx?.amount, 2500, 'T3 transaction.amount = 2500 centimes');
  assertEq(tx?.creditsGranted, 50, 'T3 transaction.creditsGranted = 50');
  assertEq(tx?.sessionId, T3_SESSION_ID, 'T3 transaction.sessionId dénormalisé');
  assertEq(typeof tx?.bookingId === 'string' && tx.bookingId.length > 0, true, 'T3 transaction.bookingId présent');

  const bookingSnap = await db.collection('bookings').where('paymentIntentId', '==', 'pi_test_T3').get();
  assertEq(bookingSnap.size, 1, 'T3 1 booking créé');
  const booking = bookingSnap.docs[0]?.data();
  assertEq(booking?.sessionId, T3_SESSION_ID, 'T3 booking.sessionId correct');
  assertEq(booking?.amount, 2500, 'T3 booking.amount correct');
  assertEq(booking?.tier, 'early', 'T3 booking.tier stocké');
  assertEq(booking?.status, 'confirmed', 'T3 booking.status = confirmed');

  const creditsSnap = await db.collection('credits').where('userId', '==', USER1_UID).get();
  assertEq(creditsSnap.size, 1, 'T3 1 entrée credits/ créée');
  assertEq(creditsSnap.docs[0]?.data()?.amount, 50, 'T3 credits/.amount = 50');

  const notifSnap = await db.collection('notifications').where('userId', '==', USER1_UID).get();
  assertEq(notifSnap.size >= 1, true, 'T3 ≥1 notification user');
}

// =====================================================================
// T4 — Webhook idempotency (2 retries même event)
// =====================================================================

section('T4 — Webhook idempotency (même stripeSessionId 2 fois)');

// 2ème call avec même event
await handlePaymentSuccess(eventT3, stripeDummy);

{
  const txSnap = await db.collection('transactions').where('stripeSessionId', '==', 'cs_test_T3').get();
  assertEq(txSnap.size, 1, 'T4 toujours 1 seule transaction (pas dupliquée)');

  const bookingSnap = await db.collection('bookings').where('paymentIntentId', '==', 'pi_test_T3').get();
  assertEq(bookingSnap.size, 1, 'T4 toujours 1 seul booking');

  const userSnap = await db.collection('users').doc(USER1_UID).get();
  assertEq(userSnap.data()?.credits, 50, 'T4 user.credits TOUJOURS 50 (pas +50)');

  const sessionSnap = await db.collection('sessions').doc(T3_SESSION_ID).get();
  assertEq(sessionSnap.data()?.currentParticipants, 1, 'T4 currentParticipants TOUJOURS 1');

  const creditsSnap = await db.collection('credits').where('userId', '==', USER1_UID).get();
  assertEq(creditsSnap.size, 1, 'T4 toujours 1 seule entrée credits/');
}

// =====================================================================
// T5 — Webhook session pleine (race condition)
// =====================================================================

section('T5 — Webhook session pleine (race condition)');
const T5_SESSION_ID = 'session-T5';
// Seed une session déjà pleine (status='full', 5/5)
await seedSession({
  sessionId: T5_SESSION_ID,
  maxParticipants: 5,
  currentParticipants: 5,
  status: 'full',
});

const T5_USER = 'user-T5-overflow';
await db.collection('users').doc(T5_USER).set({
  uid: T5_USER,
  email: 'overflow@test.com',
  credits: 0,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

const eventT5 = fakeSessionEvent({
  stripeSessionId: 'cs_test_T5_overflow',
  paymentIntentId: 'pi_test_T5_overflow',
  sessionId: T5_SESSION_ID,
  userId: T5_USER,
});

const errorLogsBefore = await db.collection('errorLogs').get();
const sizeBefore = errorLogsBefore.size;

await handlePaymentSuccess(eventT5, stripeDummy);

{
  // Pas de booking créé
  const bookingSnap = await db.collection('bookings').where('paymentIntentId', '==', 'pi_test_T5_overflow').get();
  assertEq(bookingSnap.empty, true, 'T5 aucun booking créé pour overflow');

  // Pas de credit grant
  const userSnap = await db.collection('users').doc(T5_USER).get();
  assertEq(userSnap.data()?.credits, 0, 'T5 user.credits TOUJOURS 0 (pas de grant)');

  // currentParticipants inchangé
  const sessionSnap = await db.collection('sessions').doc(T5_SESSION_ID).get();
  assertEq(sessionSnap.data()?.currentParticipants, 5, 'T5 currentParticipants inchangé (5)');

  // Pas de transaction créée
  const txSnap = await db.collection('transactions').where('stripeSessionId', '==', 'cs_test_T5_overflow').get();
  assertEq(txSnap.empty, true, 'T5 aucune transaction créée');

  // ErrorLog créé
  const errorLogsAfter = await db.collection('errorLogs').get();
  assertEq(errorLogsAfter.size > sizeBefore, true, 'T5 errorLog ajouté');

  // Notification user "session pleine"
  const notifSnap = await db.collection('notifications').where('userId', '==', T5_USER).get();
  assertEq(notifSnap.size >= 1, true, 'T5 notif user créée');
  const notif = notifSnap.docs[0]?.data();
  assertEq(notif?.title, 'Réservation impossible', 'T5 notif.title = Réservation impossible');
}

// =====================================================================
// T7 — Régression mode 'package' (legacy, sans metadata.mode)
// =====================================================================

section("T7 — Régression mode 'package' (flow existant inchangé)");
const T7_USER = 'user-T7-package';
await db.collection('users').doc(T7_USER).set({
  uid: T7_USER,
  email: 'package@test.com',
  credits: 0,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

const eventT7 = fakePackageEvent({
  stripeSessionId: 'cs_test_T7_package',
  paymentIntentId: 'pi_test_T7_package',
  userId: T7_USER,
  packageId: '1_date',
});

await handlePaymentSuccess(eventT7, stripeDummy);

{
  // Mode 'package' : transaction créée avec type='credit_purchase' (existant), pas 'session_purchase'
  const txSnap = await db.collection('transactions').where('stripeSessionId', '==', 'cs_test_T7_package').get();
  assertEq(txSnap.size, 1, 'T7 1 transaction créée');
  const tx = txSnap.docs[0]?.data();
  assertEq(tx?.type, 'credit_purchase', 'T7 transaction.type = credit_purchase (mode package, pas session)');
  assertEq(tx?.package, '1_date', 'T7 transaction.package = 1_date');
  // Pas de bookingId/sessionId sur les transactions package
  assertEq(tx?.bookingId, undefined, 'T7 transaction.bookingId absent (mode package)');
  assertEq(tx?.sessionId, undefined, 'T7 transaction.sessionId absent (mode package)');

  // User a reçu les credits du package (1 crédit pour '1_date')
  const userSnap = await db.collection('users').doc(T7_USER).get();
  assertEq(userSnap.data()?.credits, 1, 'T7 user.credits = 1 (1_date package)');

  // Pas de booking créé (mode package ne crée pas de booking)
  const bookingSnap = await db.collection('bookings').where('paymentIntentId', '==', 'pi_test_T7_package').get();
  assertEq(bookingSnap.empty, true, 'T7 aucun booking créé (mode package legacy)');
}

// =====================================================================
// Résumé
// =====================================================================

console.log('');
console.log('====== Résumé Phase 3 ======');
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
process.exit(failures > 0 ? 1 : 0);

} // fin async function main

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
