/**
 * Tests Phase 9.5 c8 BUG 2 — booking redirect flow + activity.title fallback.
 *
 * Exécution :
 *   npm run test:integration:booking-redirect
 *
 * Pattern : emulator Firestore + appel direct POST /api/checkout mode=session-free
 * + lecture getBooking() helper SSR + verify creditTransactions description fallback.
 *
 * Couverture (4 cas BR1-BR4) :
 *   BR1. POST /api/checkout mode='session-free' → 200 { bookingId } (utilisé par
 *        ReserveButtonListing pour redirect /sessions/{bookingId}?status=success)
 *   BR2. getBooking(bookingId) renvoie le doc créé (activityId, status='confirmed', amount=0)
 *   BR3. activity.title undefined → activity.name fallback dans description
 *        creditTransactions ("Free booking bundle — {name}", pas "undefined")
 *   BR4. activity ni title ni name → fallback "Activité gratuite" (no undefined)
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-br';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-br';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

import { POST as POSTCheckout } from '../../src/app/api/checkout/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callPost(payload: unknown, authBearer?: string): Promise<MockResponse> {
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

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-br' });
  }
  const db = getFirestore();

  const ALICE = 'user_alice_br';
  const ACTIVITY_TITLE = 'activity_title_br';
  const ACTIVITY_NAME_ONLY = 'activity_name_br';
  const ACTIVITY_NAMELESS = 'activity_nameless_br';

  async function seedActivity(
    activityId: string,
    overrides: Record<string, unknown>,
  ) {
    await db.collection('activities').doc(activityId).set({
      activityId,
      partnerId: 'partner_test',
      partnerName: 'Test Partner',
      sport: 'tennis',
      description: 'desc',
      price: 0,
      duration: 60,
      schedule: 'lun 18h',
      city: 'Geneva',
      audienceType: 'all',
      createdAt: Timestamp.now(),
      ...overrides,
    });
  }

  async function seedUser(uid: string) {
    await db.collection('users').doc(uid).set({
      userId: uid,
      email: `${uid}@test.local`,
      displayName: 'Alice',
      credits: 0,
      gender: 'female',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  async function clearAll() {
    for (const col of ['bookings', 'creditTransactions', 'activities', 'users']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // BR1 + BR2 happy path → bookingId returned + getBooking
  // ===================================================================
  section('BR1+BR2 mode=session-free → 200 { bookingId } + booking persisté');
  {
    await clearAll();
    await seedActivity(ACTIVITY_TITLE, { title: 'Cours Afroboost gratuit' });
    await seedUser(ALICE);
    _mockUid = ALICE;

    const res = await callPost(
      { mode: 'session-free', activityId: ACTIVITY_TITLE, userId: ALICE },
      'mock_alice',
    );

    if (res.status === 200 && typeof res.body.bookingId === 'string') {
      pass('BR1 status 200 + bookingId returned (utilisé pour redirect /sessions/{id})');
    } else {
      fail('BR1', res);
    }

    const bookingId = res.body.bookingId as string;
    const bookingSnap = await db.collection('bookings').doc(bookingId).get();
    if (
      bookingSnap.exists &&
      bookingSnap.data()?.activityId === ACTIVITY_TITLE &&
      bookingSnap.data()?.status === 'confirmed' &&
      bookingSnap.data()?.amount === 0
    ) {
      pass('BR2 getBooking(bookingId) renvoie doc {activityId, status=confirmed, amount=0}');
    } else {
      fail('BR2 booking missing/wrong', bookingSnap.data());
    }
  }

  // ===================================================================
  // BR3 activity.title undefined → name fallback
  // ===================================================================
  section('BR3 activity sans title (legacy field name) → description fallback name');
  {
    await clearAll();
    await seedActivity(ACTIVITY_NAME_ONLY, {
      // title intentionally absent — only name (legacy)
      name: 'Afro Cours Legacy',
    });
    await seedUser(ALICE);
    _mockUid = ALICE;

    const res = await callPost(
      { mode: 'session-free', activityId: ACTIVITY_NAME_ONLY, userId: ALICE },
      'mock_alice',
    );
    if (res.status !== 200) {
      fail('BR3 setup call failed', res);
      return;
    }

    const ctSnap = await db
      .collection('creditTransactions')
      .where('userId', '==', ALICE)
      .where('source', '==', 'free_booking_bundle')
      .get();
    const desc = ctSnap.docs[0]?.data()?.description as string | undefined;
    if (desc === 'Free booking bundle — Afro Cours Legacy') {
      pass('BR3 description utilise activity.name fallback (pas "undefined")');
    } else {
      fail('BR3 description', desc);
    }
  }

  // ===================================================================
  // BR4 activity sans title ni name → "Activité gratuite" fallback
  // ===================================================================
  section('BR4 activity sans title ni name → "Activité gratuite" final fallback');
  {
    await clearAll();
    await seedActivity(ACTIVITY_NAMELESS, {
      // ni title ni name
    });
    await seedUser(ALICE);
    _mockUid = ALICE;

    const res = await callPost(
      { mode: 'session-free', activityId: ACTIVITY_NAMELESS, userId: ALICE },
      'mock_alice',
    );
    if (res.status !== 200) {
      fail('BR4 setup call failed', res);
      return;
    }

    const ctSnap = await db
      .collection('creditTransactions')
      .where('userId', '==', ALICE)
      .where('source', '==', 'free_booking_bundle')
      .get();
    const desc = ctSnap.docs[0]?.data()?.description as string | undefined;
    if (desc === 'Free booking bundle — Activité gratuite') {
      pass('BR4 final fallback "Activité gratuite" appliqué');
    } else {
      fail('BR4 description', desc);
    }
  }

  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Booking Redirect (BR1-BR4) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
