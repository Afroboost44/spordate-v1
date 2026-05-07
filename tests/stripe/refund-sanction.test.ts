/**
 * Tests Phase 8 sub-chantier 5 commit 4/5 — Stripe refund auto level 3 partner no-show.
 *
 * Exécution :
 *   npm run test:stripe:refund
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/stripe/refund-sanction.test.ts")
 *
 * Pattern : Admin SDK + DI seam mock Stripe (cohérent SC4 verifyAuth + SC2 sendEmail mocks).
 *
 * Couverture (RF1-RF6 + auth admin endpoint) :
 *   RF1 happy path single booking → refund created + Booking.refundedAt set + audit log
 *   RF2 idempotency : 2 calls same sanctionId/bookingId → 1 seul refund (Stripe idempotency_key)
 *   RF3 multi-bookings (3 bookings) → 3 refunds créés
 *   RF4 Stripe API error 1/3 → 2 réussis + 1 errorCount
 *   RF5 sanction.refundDue=false → skip (processedCount=0, reason='refund-not-due')
 *   RF6 admin manual fallback : non-admin → 403, admin → 200
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-stripe-refund';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-stripe-refund';

import {
  __setRefundDbForTesting,
  __setStripeForTesting,
  refundAllForSanction,
  refundForSanction,
} from '../../src/lib/stripe/refundForSanction';
import { POST as POSTRefundAdmin } from '../../src/app/api/admin/refund-sanction/[sanctionId]/route';
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

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Stripe mock (controllable per-PI failure)
// =====================================================================

interface MockRefundCall {
  payment_intent: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

class MockStripe {
  public calls: MockRefundCall[] = [];
  public idempotencyMap = new Map<string, { id: string; amount: number; payment_intent: string }>();
  public failOnPaymentIntent = new Set<string>();
  private _counter = 0;

  reset() {
    this.calls = [];
    this.idempotencyMap.clear();
    this.failOnPaymentIntent.clear();
    this._counter = 0;
  }

  refunds = {
    create: async (
      params: { payment_intent: string; metadata?: Record<string, unknown>; amount?: number },
      opts?: { idempotencyKey?: string },
    ) => {
      const idempotencyKey = opts?.idempotencyKey;
      this.calls.push({
        payment_intent: params.payment_intent,
        idempotencyKey,
        metadata: params.metadata,
      });
      // Idempotency : same key → return cached
      if (idempotencyKey && this.idempotencyMap.has(idempotencyKey)) {
        return this.idempotencyMap.get(idempotencyKey);
      }
      // Failure injection
      if (this.failOnPaymentIntent.has(params.payment_intent)) {
        throw new Error(`Mock Stripe error on PI ${params.payment_intent}`);
      }
      this._counter++;
      const refund = {
        id: `re_mock_${this._counter}`,
        amount: params.amount ?? 2500,
        payment_intent: params.payment_intent,
        status: 'succeeded',
      };
      if (idempotencyKey) this.idempotencyMap.set(idempotencyKey, refund);
      return refund;
    },
  };
}

const mockStripe = new MockStripe();

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-stripe-refund' });
  }
  const db = getFirestore();

  // Wire DI seams
  __setStripeForTesting(mockStripe);
  __setRefundDbForTesting(db);

  const PARTNER_UID = 'partner_rf';
  const REPORTED_USER = 'user_rf_reported';
  const ADMIN_UID = 'admin_rf';

  // Helper seeders
  async function seedReport(reportId: string, reporterId: string, reportedId: string): Promise<void> {
    await db.collection('reports').doc(reportId).set({
      reportId,
      reporterId,
      reportedId,
      category: 'no_show',
      status: 'pending',
      source: 'partner_no_show',
      createdAt: Timestamp.now(),
    });
  }
  async function seedSanction(opts: {
    sanctionId: string;
    userId: string;
    triggeringReportIds: string[];
    refundDue?: boolean;
  }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      sanctionId: opts.sanctionId,
      userId: opts.userId,
      level: 'suspension_30d',
      reason: 'no_show_threshold',
      triggeringReportIds: opts.triggeringReportIds,
      startsAt: Timestamp.now(),
      appealable: true,
      isActive: true,
      createdAt: Timestamp.now(),
    };
    if (opts.refundDue !== undefined) payload.refundDue = opts.refundDue;
    await db.collection('userSanctions').doc(opts.sanctionId).set(payload);
  }
  async function seedBooking(opts: {
    bookingId: string;
    userId: string;
    partnerId: string;
    paymentIntentId: string;
    sessionDateMs?: number;
    status?: string;
  }): Promise<void> {
    await db.collection('bookings').doc(opts.bookingId).set({
      bookingId: opts.bookingId,
      userId: opts.userId,
      userName: 'TestUser',
      matchId: 'match_x',
      activityId: 'activity_x',
      partnerId: opts.partnerId,
      sport: 'tennis',
      ticketType: 'solo',
      sessionDate: Timestamp.fromMillis(opts.sessionDateMs ?? Date.now() - 5 * 24 * 60 * 60 * 1000),
      status: opts.status ?? 'confirmed',
      transactionId: 'tx_x',
      amount: 2500,
      currency: 'CHF',
      creditsUsed: 0,
      paymentIntentId: opts.paymentIntentId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['bookings', 'userSanctions', 'reports', 'adminActions', 'users']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    mockStripe.reset();
  }

  // ===================================================================
  // RF1 happy path single booking
  // ===================================================================
  section('RF1 happy path : single booking → refund + Booking.refundedAt + audit log');
  {
    await clearAll();
    await seedReport('report_rf1', PARTNER_UID, REPORTED_USER);
    await seedSanction({
      sanctionId: 'sanction_rf1',
      userId: REPORTED_USER,
      triggeringReportIds: ['report_rf1'],
      refundDue: true,
    });
    await seedBooking({
      bookingId: 'booking_rf1',
      userId: REPORTED_USER,
      partnerId: PARTNER_UID,
      paymentIntentId: 'pi_rf1',
    });

    const result = await refundAllForSanction('sanction_rf1');
    if (result.processedCount === 1 && result.errorCount === 0) {
      pass('RF1 processedCount=1 errorCount=0');
    } else {
      fail('RF1 result', result);
    }
    if (mockStripe.calls.length === 1 && mockStripe.calls[0].payment_intent === 'pi_rf1') {
      pass('RF1 Stripe.refunds.create called avec pi_rf1');
    } else {
      fail('RF1 Stripe calls', mockStripe.calls);
    }
    if (mockStripe.calls[0]?.idempotencyKey === 'refund-sanction_rf1-booking_rf1') {
      pass('RF1 idempotencyKey shape Q8=A `refund-{sanctionId}-{bookingId}`');
    } else {
      fail('RF1 idempotencyKey shape', mockStripe.calls[0]);
    }
    const bookingData = (await db.collection('bookings').doc('booking_rf1').get()).data();
    if (bookingData?.refundedAt && bookingData?.refundedAmount === 2500) {
      pass('RF1 Booking.refundedAt set + refundedAmount=2500');
    } else {
      fail('RF1 Booking flag not set', bookingData);
    }
    const auditSnap = await db
      .collection('adminActions')
      .where('actionType', '==', 'auto_refund_partner_no_show')
      .get();
    if (auditSnap.size === 1) {
      pass('RF1 adminAction audit log créé');
    } else {
      fail('RF1 audit count', auditSnap.size);
    }
  }

  // ===================================================================
  // RF2 idempotency 2 calls → 1 refund
  // ===================================================================
  section('RF2 idempotency : 2 calls same sanctionId/bookingId → 1 refund');
  {
    await clearAll();
    await seedReport('report_rf2', PARTNER_UID, REPORTED_USER);
    await seedSanction({
      sanctionId: 'sanction_rf2',
      userId: REPORTED_USER,
      triggeringReportIds: ['report_rf2'],
      refundDue: true,
    });
    await seedBooking({
      bookingId: 'booking_rf2',
      userId: REPORTED_USER,
      partnerId: PARTNER_UID,
      paymentIntentId: 'pi_rf2',
    });

    // Call 1
    const r1 = await refundForSanction({ sanctionId: 'sanction_rf2', bookingId: 'booking_rf2' });
    if (r1.ok) pass('RF2 call 1 ok');
    else fail('RF2 call 1', r1);

    // Call 2 — booking.refundedAt déjà set → return ok=true reason='already-refunded'
    const r2 = await refundForSanction({ sanctionId: 'sanction_rf2', bookingId: 'booking_rf2' });
    if (r2.ok && r2.reason === 'already-refunded') {
      pass('RF2 call 2 → already-refunded (Firestore-side idempotency)');
    } else {
      fail('RF2 call 2', r2);
    }

    // Stripe should be called only 1× (Firestore-side guard avant Stripe)
    if (mockStripe.calls.length === 1) {
      pass('RF2 Stripe.refunds.create appelé 1× (Firestore guard)');
    } else {
      fail('RF2 Stripe calls', mockStripe.calls.length);
    }
  }

  // ===================================================================
  // RF3 multi-bookings : 3 bookings → 3 refunds
  // ===================================================================
  section('RF3 multi-bookings : 3 bookings éligibles → 3 refunds');
  {
    await clearAll();
    await seedReport('report_rf3', PARTNER_UID, REPORTED_USER);
    await seedSanction({
      sanctionId: 'sanction_rf3',
      userId: REPORTED_USER,
      triggeringReportIds: ['report_rf3'],
      refundDue: true,
    });
    for (let i = 0; i < 3; i++) {
      await seedBooking({
        bookingId: `booking_rf3_${i}`,
        userId: REPORTED_USER,
        partnerId: PARTNER_UID,
        paymentIntentId: `pi_rf3_${i}`,
      });
    }

    const result = await refundAllForSanction('sanction_rf3');
    if (result.processedCount === 3 && result.errorCount === 0) {
      pass('RF3 processedCount=3 errorCount=0');
    } else {
      fail('RF3 result', result);
    }
    if (mockStripe.calls.length === 3) {
      pass('RF3 Stripe.refunds.create appelé 3×');
    } else {
      fail('RF3 Stripe calls', mockStripe.calls.length);
    }
  }

  // ===================================================================
  // RF4 Stripe API error 1/3 → 2 success + 1 errorCount
  // ===================================================================
  section('RF4 Stripe API error 1/3 → continue, 2 réussis + 1 errorCount');
  {
    await clearAll();
    await seedReport('report_rf4', PARTNER_UID, REPORTED_USER);
    await seedSanction({
      sanctionId: 'sanction_rf4',
      userId: REPORTED_USER,
      triggeringReportIds: ['report_rf4'],
      refundDue: true,
    });
    for (let i = 0; i < 3; i++) {
      await seedBooking({
        bookingId: `booking_rf4_${i}`,
        userId: REPORTED_USER,
        partnerId: PARTNER_UID,
        paymentIntentId: `pi_rf4_${i}`,
      });
    }
    // Inject failure on pi_rf4_1
    mockStripe.failOnPaymentIntent.add('pi_rf4_1');

    const result = await refundAllForSanction('sanction_rf4');
    if (result.processedCount === 2 && result.errorCount === 1) {
      pass('RF4 processedCount=2 errorCount=1 (continue on fail)');
    } else {
      fail('RF4 result', result);
    }
  }

  // ===================================================================
  // RF5 refundDue=false → skip
  // ===================================================================
  section('RF5 sanction.refundDue=false → skip (refund-not-due)');
  {
    await clearAll();
    await seedReport('report_rf5', PARTNER_UID, REPORTED_USER);
    await seedSanction({
      sanctionId: 'sanction_rf5',
      userId: REPORTED_USER,
      triggeringReportIds: ['report_rf5'],
      refundDue: false,
    });
    await seedBooking({
      bookingId: 'booking_rf5',
      userId: REPORTED_USER,
      partnerId: PARTNER_UID,
      paymentIntentId: 'pi_rf5',
    });

    const result = await refundAllForSanction('sanction_rf5');
    if (result.processedCount === 0 && result.reason === 'refund-not-due') {
      pass('RF5 processedCount=0 reason=refund-not-due');
    } else {
      fail('RF5 result', result);
    }
    if (mockStripe.calls.length === 0) {
      pass('RF5 zéro appel Stripe (skip avant boucle bookings)');
    } else {
      fail('RF5 Stripe calls expected 0', mockStripe.calls.length);
    }
  }

  // ===================================================================
  // RF6 admin manual fallback endpoint
  // ===================================================================
  section('RF6 admin manual fallback : non-admin → 403 / admin → 200');
  {
    await clearAll();
    await seedReport('report_rf6', PARTNER_UID, REPORTED_USER);
    await seedSanction({
      sanctionId: 'sanction_rf6',
      userId: REPORTED_USER,
      triggeringReportIds: ['report_rf6'],
      refundDue: true,
    });
    await seedBooking({
      bookingId: 'booking_rf6',
      userId: REPORTED_USER,
      partnerId: PARTNER_UID,
      paymentIntentId: 'pi_rf6',
    });
    // Seed admin user
    await db.collection('users').doc(ADMIN_UID).set({
      uid: ADMIN_UID,
      email: 'admin@test.local',
      displayName: 'Admin',
      role: 'admin',
    });
    // Seed regular user
    await db.collection('users').doc('regular_rf6').set({
      uid: 'regular_rf6',
      email: 'reg@test.local',
      role: 'user',
    });

    // Helper to call POST endpoint
    async function callRefundAdmin(uid: string | null, sanctionId: string): Promise<{ status: number; body: Record<string, unknown> }> {
      __setVerifyAuthForTesting(async () => uid);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (uid) headers.authorization = `Bearer mock_${uid}`;
      const req = new Request(`http://localhost/api/admin/refund-sanction/${sanctionId}`, {
        method: 'POST',
        headers,
        body: '{}',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      const res = await POSTRefundAdmin(req, { params: Promise.resolve({ sanctionId }) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }

    // Non-admin → 403
    const resNonAdmin = await callRefundAdmin('regular_rf6', 'sanction_rf6');
    if (resNonAdmin.status === 403) {
      pass('RF6 non-admin → 403');
    } else {
      fail('RF6 non-admin', resNonAdmin);
    }

    // No auth → 401
    const resNoAuth = await callRefundAdmin(null, 'sanction_rf6');
    if (resNoAuth.status === 401) {
      pass('RF6 no auth → 401');
    } else {
      fail('RF6 no auth', resNoAuth);
    }

    // Admin → 200
    const resAdmin = await callRefundAdmin(ADMIN_UID, 'sanction_rf6');
    if (resAdmin.status === 200 && resAdmin.body.processedCount === 1) {
      pass('RF6 admin → 200 + processedCount=1');
    } else {
      fail('RF6 admin', resAdmin);
    }

    __setVerifyAuthForTesting(null);
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setStripeForTesting(null);
  __setRefundDbForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Stripe refund-sanction (RF1-RF6) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
