/**
 * Tests Phase 9.5 c7 — POST /api/checkout mode='session-free' (free booking).
 *
 * Exécution :
 *   npm run test:checkout:free-booking
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/checkout/free-booking.test.ts")
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC4 invites api.test.ts).
 *
 * Couverture (5 cas FB1-FB5) :
 *   FB1. Happy path → 200 + booking créé (status='confirmed', amount=0) + credits +5 + creditTransactions log
 *   FB2. Anti-abus 24h cooldown → 429 cooldown-active si réservation < 24h
 *   FB3. Activity payante (price>0) → 400 not-free-activity (force route via mode='session')
 *   FB4. Activity not found → 404 activity-not-found
 *   FB5. authedUid != userId → 403 forbidden
 *   FB6. Per-activity chatCreditsBundle override → grant cette valeur (10) au lieu freeActivityBundle (5)
 *   FB7. Firestore composite index manquant (FAILED_PRECONDITION) → 503 index-not-ready
 *   FB8. orderBy('createdAt','desc')+limit(1) détecte booking récent parmi old + recent → 429
 *   FB9. (c11) activity.scheduledAt défini → Session ALSO créée avec id=bookingId + timestamps
 *   FB10. (c11) activity.scheduledAt absent → Booking seul (pas de Session)
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-fb';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-fb';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

import { POST as POSTCheckout } from '../../src/app/api/checkout/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Constants + helpers
// =====================================================================

const ALICE_UID = 'user_alice_fb';
const BOB_UID = 'user_bob_fb';
const FREE_ACTIVITY_ID = 'activity_free_fb';
const PAID_ACTIVITY_ID = 'activity_paid_fb';
const OVERRIDE_ACTIVITY_ID = 'activity_override_fb';

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callPost(
  payload: Record<string, unknown>,
  authBearer?: string,
): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = `Bearer ${authBearer}`;
  const req = new Request('http://localhost/api/checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTCheckout(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  // Init Admin SDK pointing à l'emulator
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-fb' });
  }
  const db = getFirestore();

  async function seedActivity(
    activityId: string,
    price: number,
    chatCreditsBundle?: number,
  ) {
    const data: Record<string, unknown> = {
      activityId,
      partnerId: 'partner_test',
      partnerName: 'Test Partner',
      sport: 'tennis',
      title: 'Test Free Activity',
      description: 'desc',
      price,
      duration: 60,
      schedule: 'lun 18h',
      city: 'Geneva',
      audienceType: 'all',
      createdAt: Timestamp.now(),
    };
    if (typeof chatCreditsBundle === 'number') data.chatCreditsBundle = chatCreditsBundle;
    await db.collection('activities').doc(activityId).set(data);
  }

  async function seedUser(uid: string) {
    await db.collection('users').doc(uid).set({
      userId: uid,
      email: `${uid}@test.local`,
      displayName: 'Alice',
      credits: 0,
      gender: 'female',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function clearAll() {
    const collections = ['bookings', 'creditTransactions', 'activities', 'users'];
    for (const col of collections) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  // Default mock auth
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // FB1 happy path
  // ===================================================================
  section('FB1 happy path → 200 booking + credits +5 + creditTransactions log');
  {
    await clearAll();
    await seedActivity(FREE_ACTIVITY_ID, 0);
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    const res = await callPost(
      { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_alice',
    );

    if (res.status === 200 && res.body.ok === true && res.body.creditsGranted === 5) {
      pass('FB1.a status 200 + creditsGranted=5');
    } else {
      fail('FB1.a', res);
    }

    const userSnap = await db.collection('users').doc(ALICE_UID).get();
    if (userSnap.data()?.credits === 5) {
      pass('FB1.b user.credits incremented to 5');
    } else {
      fail('FB1.b user.credits != 5', userSnap.data()?.credits);
    }

    const bookingsSnap = await db
      .collection('bookings')
      .where('userId', '==', ALICE_UID)
      .where('activityId', '==', FREE_ACTIVITY_ID)
      .get();
    const booking = bookingsSnap.docs[0]?.data();
    if (booking?.status === 'confirmed' && booking?.amount === 0) {
      pass('FB1.c booking persisted (status=confirmed, amount=0)');
    } else {
      fail('FB1.c booking missing or wrong fields', booking);
    }

    const ctSnap = await db
      .collection('creditTransactions')
      .where('userId', '==', ALICE_UID)
      .where('source', '==', 'free_booking_bundle')
      .get();
    if (ctSnap.size === 1 && ctSnap.docs[0].data().amount === 5) {
      pass('FB1.d creditTransactions log entry source=free_booking_bundle, amount=5');
    } else {
      fail('FB1.d ct log missing/wrong', { size: ctSnap.size, doc: ctSnap.docs[0]?.data() });
    }
  }

  // ===================================================================
  // FB2 anti-abus 24h cooldown
  // ===================================================================
  section('FB2 cooldown 24h → 429 cooldown-active');
  {
    await clearAll();
    await seedActivity(FREE_ACTIVITY_ID, 0);
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    // First call ok
    const r1 = await callPost(
      { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_alice',
    );
    if (r1.status !== 200) {
      fail('FB2 first call should be 200', r1);
    }

    // Second call within 24h → 429
    const r2 = await callPost(
      { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_alice',
    );
    if (r2.status === 429 && r2.body.error === 'cooldown-active') {
      pass('FB2 second call within 24h → 429 cooldown-active');
    } else {
      fail('FB2', r2);
    }
  }

  // ===================================================================
  // FB3 activity payante → 400 not-free-activity
  // ===================================================================
  section('FB3 paid activity (price>0) → 400 not-free-activity');
  {
    await clearAll();
    await seedActivity(PAID_ACTIVITY_ID, 25);
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    const res = await callPost(
      { mode: 'session-free', activityId: PAID_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_alice',
    );

    if (res.status === 400 && res.body.error === 'not-free-activity') {
      pass('FB3 paid activity → 400 not-free-activity');
    } else {
      fail('FB3', res);
    }
  }

  // ===================================================================
  // FB4 activity not found → 404
  // ===================================================================
  section('FB4 activity not found → 404');
  {
    await clearAll();
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    const res = await callPost(
      { mode: 'session-free', activityId: 'does-not-exist', userId: ALICE_UID },
      'mock_token_alice',
    );

    if (res.status === 404 && res.body.error === 'activity-not-found') {
      pass('FB4 → 404 activity-not-found');
    } else {
      fail('FB4', res);
    }
  }

  // ===================================================================
  // FB5 authedUid != userId → 403
  // ===================================================================
  section('FB5 spoof userId (authedUid != body.userId) → 403 forbidden');
  {
    await clearAll();
    await seedActivity(FREE_ACTIVITY_ID, 0);
    await seedUser(ALICE_UID);
    await seedUser(BOB_UID);
    _mockUid = BOB_UID; // Bob authed but tries to book as Alice

    const res = await callPost(
      { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_bob',
    );

    if (res.status === 403 && res.body.error === 'forbidden') {
      pass('FB5 spoof → 403 forbidden');
    } else {
      fail('FB5', res);
    }
  }

  // ===================================================================
  // FB6 chatCreditsBundle override
  // ===================================================================
  section('FB6 per-activity chatCreditsBundle=10 → grant 10 (not 5)');
  {
    await clearAll();
    await seedActivity(OVERRIDE_ACTIVITY_ID, 0, 10); // override 10
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    const res = await callPost(
      { mode: 'session-free', activityId: OVERRIDE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_alice',
    );

    if (res.status === 200 && res.body.creditsGranted === 10) {
      pass('FB6 override → creditsGranted=10');
    } else {
      fail('FB6', res);
    }

    const userSnap = await db.collection('users').doc(ALICE_UID).get();
    if (userSnap.data()?.credits === 10) {
      pass('FB6.b user.credits = 10');
    } else {
      fail('FB6.b', userSnap.data()?.credits);
    }
  }

  // ===================================================================
  // FB7 — Firestore composite index manquant → 503 index-not-ready
  // ===================================================================
  section('FB7 missing composite index (FAILED_PRECONDITION) → 503 index-not-ready');
  {
    await clearAll();
    await seedActivity(FREE_ACTIVITY_ID, 0);
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    // Monkey-patch Query.prototype.get pour throw FAILED_PRECONDITION
    // (simule l'erreur prod observée quand index composite bookings(userId+activityId+createdAt) manque)
    const { Query } = await import('@google-cloud/firestore');
    const originalGet = Query.prototype.get;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Query.prototype as any).get = async function () {
      const err = new Error('9 FAILED_PRECONDITION: The query requires an index.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).code = 9;
      throw err;
    };

    let routeRes: MockResponse;
    try {
      routeRes = await callPost(
        { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
        'mock_token_alice',
      );
    } finally {
      // Restore AVANT les orphan checks (qui sont aussi des Query.get)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Query.prototype as any).get = originalGet;
    }

    if (routeRes.status === 503 && routeRes.body.error === 'index-not-ready') {
      pass('FB7 missing index → 503 index-not-ready');
    } else {
      fail('FB7', routeRes);
    }

    // Verify aucun orphan : pas de booking, pas de creditTransactions, user.credits=0
    // (la query throw AVANT runTransaction → rollback automatique)
    const bookingsSnap = await db
      .collection('bookings')
      .where('userId', '==', ALICE_UID)
      .get();
    if (bookingsSnap.empty) {
      pass('FB7.b aucun booking orphelin (query throw avant runTransaction)');
    } else {
      fail('FB7.b booking orphelin', bookingsSnap.size);
    }
    const userSnap = await db.collection('users').doc(ALICE_UID).get();
    if ((userSnap.data()?.credits ?? 0) === 0) {
      pass('FB7.c user.credits=0 (pas de grant orphelin)');
    } else {
      fail('FB7.c credits orphelin', userSnap.data()?.credits);
    }
    const ctSnap = await db
      .collection('creditTransactions')
      .where('userId', '==', ALICE_UID)
      .get();
    if (ctSnap.empty) {
      pass('FB7.d aucun creditTransactions orphelin');
    } else {
      fail('FB7.d creditTransactions orphelin', ctSnap.size);
    }
  }

  // ===================================================================
  // FB8 — orderBy desc + limit 1 détecte booking récent parmi mix old + recent
  // ===================================================================
  section('FB8 mix old (>24h) + recent (<24h) bookings → 429 (orderBy desc validé)');
  {
    await clearAll();
    await seedActivity(FREE_ACTIVITY_ID, 0);
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    // Seed un booking OLD (créé 48h ago — hors fenêtre cooldown)
    const oldBookingRef = db.collection('bookings').doc();
    await oldBookingRef.set({
      bookingId: oldBookingRef.id,
      userId: ALICE_UID,
      activityId: FREE_ACTIVITY_ID,
      partnerId: 'partner_test',
      sport: 'tennis',
      status: 'confirmed',
      amount: 0,
      currency: 'CHF',
      creditsUsed: 0,
      sessionId: '',
      paymentIntentId: 'free-old-test',
      createdAt: Timestamp.fromMillis(Date.now() - 48 * 60 * 60 * 1000),
    });

    // Seed un booking RECENT (créé 1h ago — dans la fenêtre 24h cooldown)
    const recentBookingRef = db.collection('bookings').doc();
    await recentBookingRef.set({
      bookingId: recentBookingRef.id,
      userId: ALICE_UID,
      activityId: FREE_ACTIVITY_ID,
      partnerId: 'partner_test',
      sport: 'tennis',
      status: 'confirmed',
      amount: 0,
      currency: 'CHF',
      creditsUsed: 0,
      sessionId: '',
      paymentIntentId: 'free-recent-test',
      createdAt: Timestamp.fromMillis(Date.now() - 1 * 60 * 60 * 1000),
    });

    const res = await callPost(
      { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_token_alice',
    );

    if (res.status === 429 && res.body.error === 'cooldown-active') {
      pass('FB8 mix old+recent → 429 (orderBy desc + limit 1 picks recent)');
    } else {
      fail('FB8', res);
    }
  }

  // ===================================================================
  // FB9 — c11 : activity.scheduledAt défini → Session créée avec id=bookingId
  // ===================================================================
  section('FB9 (c11) activity.scheduledAt set → Session ALSO créée + timestamps');
  {
    await clearAll();
    const SCHEDULED_ACTIVITY_ID = 'activity_scheduled_fb';
    const startMs = Date.now() + 7 * 24 * 60 * 60 * 1000; // +7 jours
    await db.collection('activities').doc(SCHEDULED_ACTIVITY_ID).set({
      activityId: SCHEDULED_ACTIVITY_ID,
      partnerId: 'partner_test',
      partnerName: 'Test Partner',
      sport: 'tennis',
      title: 'Cours planifié',
      description: 'desc',
      price: 0,
      duration: 90, // 90 min pour valider endAt computation
      schedule: 'Mar 19h',
      city: 'Geneva',
      audienceType: 'all',
      maxParticipants: 12,
      scheduledAt: Timestamp.fromMillis(startMs),
      createdAt: Timestamp.now(),
    });
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    const res = await callPost(
      { mode: 'session-free', activityId: SCHEDULED_ACTIVITY_ID, userId: ALICE_UID },
      'mock_alice',
    );
    if (res.status === 200 && typeof res.body.bookingId === 'string') {
      pass('FB9.a status 200 + bookingId returned');
    } else {
      fail('FB9.a', res);
    }

    const bookingId = res.body.bookingId as string;

    // Session ALSO créée avec id = bookingId
    const sessionSnap = await db.collection('sessions').doc(bookingId).get();
    if (sessionSnap.exists) {
      pass('FB9.b session doc créée avec id = bookingId');
    } else {
      fail('FB9.b session missing');
      return;
    }

    const sessionData = sessionSnap.data()!;
    if (
      sessionData.status === 'open' &&
      sessionData.activityId === SCHEDULED_ACTIVITY_ID &&
      sessionData.partnerId === 'partner_test' &&
      sessionData.title === 'Cours planifié'
    ) {
      pass('FB9.c session shape (status, activityId, partnerId, title)');
    } else {
      fail('FB9.c', sessionData);
    }

    // Timestamps : startAt = scheduledAt, endAt = startAt+90min, chatOpen = startAt-2h
    const startAt = sessionData.startAt;
    const endAt = sessionData.endAt;
    const chatOpenAt = sessionData.chatOpenAt;
    if (
      startAt?.toMillis() === startMs &&
      endAt?.toMillis() === startMs + 90 * 60_000 &&
      chatOpenAt?.toMillis() === startMs - 120 * 60_000
    ) {
      pass('FB9.d timestamps (startAt + endAt = +90min + chatOpen = -2h)');
    } else {
      fail('FB9.d', {
        startAt: startAt?.toMillis(),
        endAt: endAt?.toMillis(),
        chatOpenAt: chatOpenAt?.toMillis(),
        expected: { startMs, endMs: startMs + 90 * 60_000, chatOpenMs: startMs - 120 * 60_000 },
      });
    }

    // Booking sessionId === bookingId (lien explicite)
    const bookingSnap = await db.collection('bookings').doc(bookingId).get();
    if (bookingSnap.data()?.sessionId === bookingId) {
      pass('FB9.e booking.sessionId === bookingId (countdown navigation)');
    } else {
      fail('FB9.e', bookingSnap.data()?.sessionId);
    }
  }

  // ===================================================================
  // FB10 — c11 : activity.scheduledAt absent → pas de Session
  // ===================================================================
  section('FB10 (c11) activity.scheduledAt absent → Booking only (no Session)');
  {
    await clearAll();
    await seedActivity(FREE_ACTIVITY_ID, 0); // pas de scheduledAt
    await seedUser(ALICE_UID);
    _mockUid = ALICE_UID;

    const res = await callPost(
      { mode: 'session-free', activityId: FREE_ACTIVITY_ID, userId: ALICE_UID },
      'mock_alice',
    );
    if (res.status !== 200) {
      fail('FB10 setup', res);
      return;
    }

    const bookingId = res.body.bookingId as string;
    const sessionSnap = await db.collection('sessions').doc(bookingId).get();
    if (!sessionSnap.exists) {
      pass('FB10 pas de session créée (BookingPendingHero fallback)');
    } else {
      fail('FB10 unexpected session', sessionSnap.data());
    }

    const bookingSnap = await db.collection('bookings').doc(bookingId).get();
    if (bookingSnap.data()?.sessionId === '') {
      pass('FB10.b booking.sessionId vide (pas de session liée)');
    } else {
      fail('FB10.b', bookingSnap.data()?.sessionId);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Free Booking (FB1-FB10) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
