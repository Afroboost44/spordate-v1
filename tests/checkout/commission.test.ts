/**
 * Tests Phase 9.5 c7 — COMMISSION FIX /api/checkout mode='session' (solo).
 *
 * Exécution :
 *   npm run test:checkout:commission
 *
 * Pattern : Admin SDK direct + DI seam mock auth + mock Stripe (cohérent SC2 c3/6
 * checkout-split.test.ts pattern).
 *
 * Couverture (5 cas COMM1-COMM5) :
 *   COMM1. mode='session' solo : transfer_data.destination = partner.stripeAccountId ✅
 *   COMM2. mode='session' solo : application_fee_amount = 5% of price (server-computed)
 *   COMM3. mode='session' solo : metadata.applicationFeeAmount + partnerStripeAccount set
 *   COMM4. partner not onboarded (charges_enabled=false) → 412 partner-not-onboarded
 *   COMM5. partner not found → 412 partner-not-found
 *
 * Audit context : avant Phase 9.5 c7, mode='session' solo créait checkout sans transfer_data
 * → 100% du prix au compte plateforme, 0% au partner. CONFIRMED REAL BUG.
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-comm';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-comm';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

import { POST as POSTCheckout } from '../../src/app/api/checkout/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { __setConnectDbForTesting } from '../../src/lib/stripe/connectHelpers';
import { __setSharedStripeForTesting } from '../../src/lib/stripe/sharedStripe';

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
// Mock Stripe
// =====================================================================

interface CheckoutSessionCall {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
}

class MockStripe {
  public checkoutCalls: CheckoutSessionCall[] = [];
  public chargesEnabledByAccount: Record<string, boolean> = {};
  private _counter = 0;

  reset() {
    this.checkoutCalls = [];
    this.chargesEnabledByAccount = {};
    this._counter = 0;
  }

  checkout = {
    sessions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async (params: any) => {
        this.checkoutCalls.push({ params });
        this._counter++;
        return {
          id: `cs_mock_${this._counter}`,
          url: `https://checkout.stripe.com/mock_${this._counter}`,
        };
      },
    },
  };

  accounts = {
    retrieve: async (accountId: string) => {
      const enabled = this.chargesEnabledByAccount[accountId] ?? true;
      return { id: accountId, charges_enabled: enabled, payouts_enabled: enabled };
    },
  };
}

const mockStripe = new MockStripe();

// =====================================================================

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callCheckout(payload: Record<string, unknown>): Promise<MockResponse> {
  const req = new Request('http://localhost/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-comm' });
  }
  const db = getFirestore();

  // Wire DI seams
  __setSharedStripeForTesting(mockStripe);
  __setConnectDbForTesting(db);

  const ALICE = 'user_alice_comm';
  const PARTNER = 'partner_comm';
  const PARTNER_ACCT = 'acct_test_comm';
  const PARTNER_NO_ONBOARD = 'partner_no_onboard';
  const PARTNER_404 = 'partner_404';
  const ACTIVITY_ID = 'activity_comm';
  const SESSION_ID = 'session_comm';
  const PRICE_CENTS = 3000; // 30 CHF

  async function seedSession(partnerId: string): Promise<void> {
    const startAt = Date.now() + 5 * 24 * 60 * 60_000;
    await db.collection('sessions').doc(SESSION_ID).set({
      sessionId: SESSION_ID,
      activityId: ACTIVITY_ID,
      partnerId,
      creatorId: partnerId,
      sport: 'tennis',
      title: 'Test Session COMM',
      city: 'Geneva',
      startAt: Timestamp.fromMillis(startAt),
      endAt: Timestamp.fromMillis(startAt + 60 * 60_000),
      maxParticipants: 8,
      currentParticipants: 0,
      pricingTiers: [
        {
          kind: 'early',
          price: PRICE_CENTS,
          activateMinutesBeforeStart: null,
          activateAtFillRate: null,
        },
      ],
      currentTier: 'early',
      currentPrice: PRICE_CENTS,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function seedActivity(): Promise<void> {
    await db.collection('activities').doc(ACTIVITY_ID).set({
      activityId: ACTIVITY_ID,
      partnerId: PARTNER,
      partnerName: 'Test Partner COMM',
      title: 'Tennis Geneva COMM',
      sport: 'tennis',
      city: 'Geneva',
      isActive: true,
      audienceType: 'all',
      chatCreditsBundle: 50,
    });
  }

  async function seedPartner(partnerId: string, stripeAccountId?: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      partnerId,
      name: 'Partner COMM',
      email: 'partner@comm.local',
      city: 'Geneva',
    };
    if (stripeAccountId) payload.stripeAccountId = stripeAccountId;
    await db.collection('partners').doc(partnerId).set(payload);
  }

  async function seedUser(): Promise<void> {
    await db.collection('users').doc(ALICE).set({
      userId: ALICE,
      email: 'alice@comm.local',
      displayName: 'Alice',
      credits: 0,
      gender: 'female',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['sessions', 'activities', 'partners', 'users']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    mockStripe.reset();
    mockStripe.chargesEnabledByAccount[PARTNER_ACCT] = true;
  }

  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // COMM1 + COMM2 + COMM3 happy path
  // ===================================================================
  section('COMM1+2+3 mode=session solo : transfer_data + app_fee + metadata');
  {
    await clearAll();
    await seedActivity();
    await seedSession(PARTNER);
    await seedPartner(PARTNER, PARTNER_ACCT);
    await seedUser();
    _mockUid = ALICE;

    const res = await callCheckout({
      mode: 'session',
      sessionId: SESSION_ID,
      userId: ALICE,
    });

    if (res.status === 200 && typeof res.body.sessionId === 'string') {
      pass('COMM1.a status 200 + sessionId returned');
    } else {
      fail('COMM1.a status', res);
    }

    const call = mockStripe.checkoutCalls[0];
    if (call?.params?.payment_intent_data?.transfer_data?.destination === PARTNER_ACCT) {
      pass('COMM1.b transfer_data.destination = partner.stripeAccountId (commission fix)');
    } else {
      fail('COMM1.b transfer_data missing — REGRESSION', call?.params?.payment_intent_data);
    }

    const expectedFee = Math.round((PRICE_CENTS * 5) / 100); // 5% Phase 9 SC2 default
    if (call?.params?.payment_intent_data?.application_fee_amount === expectedFee) {
      pass(`COMM2 application_fee_amount=${expectedFee} (5% of ${PRICE_CENTS})`);
    } else {
      fail('COMM2 app_fee', call?.params?.payment_intent_data);
    }

    if (
      call?.params?.metadata?.applicationFeeAmount === String(expectedFee) &&
      call?.params?.metadata?.partnerStripeAccount === PARTNER_ACCT
    ) {
      pass('COMM3 metadata.applicationFeeAmount + partnerStripeAccount set');
    } else {
      fail('COMM3 metadata', call?.params?.metadata);
    }
  }

  // ===================================================================
  // COMM4 partner not onboarded
  // ===================================================================
  section('COMM4 partner not onboarded (charges_enabled=false) → 412');
  {
    await clearAll();
    await seedActivity();
    await seedSession(PARTNER);
    await seedPartner(PARTNER, PARTNER_ACCT);
    mockStripe.chargesEnabledByAccount[PARTNER_ACCT] = false; // override after clearAll
    await seedUser();
    _mockUid = ALICE;

    const res = await callCheckout({
      mode: 'session',
      sessionId: SESSION_ID,
      userId: ALICE,
    });

    if (res.status === 412 && res.body.error === 'partner-not-onboarded') {
      pass('COMM4 charges_enabled=false → 412 partner-not-onboarded');
    } else {
      fail('COMM4', res);
    }
    if (mockStripe.checkoutCalls.length === 0) {
      pass('COMM4 Stripe.checkout.sessions.create NOT called (early reject)');
    } else {
      fail('COMM4 should not call Stripe', mockStripe.checkoutCalls.length);
    }
  }

  // ===================================================================
  // COMM5 partner not found
  // ===================================================================
  section('COMM5 partner doc absent → 412 partner-not-found');
  {
    await clearAll();
    await seedActivity();
    await seedSession(PARTNER_404); // session points à partner sans doc
    // No seedPartner() — partners/PARTNER_404 not created
    await seedUser();
    _mockUid = ALICE;

    const res = await callCheckout({
      mode: 'session',
      sessionId: SESSION_ID,
      userId: ALICE,
    });

    if (res.status === 412 && res.body.error === 'partner-not-found') {
      pass('COMM5 partner doc absent → 412 partner-not-found');
    } else {
      fail('COMM5', res);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setVerifyAuthForTesting(null);
  __setSharedStripeForTesting(null);
  __setConnectDbForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Commission (COMM1-COMM5) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
