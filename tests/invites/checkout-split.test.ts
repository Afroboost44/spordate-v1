/**
 * Tests Phase 9 sub-chantier 2 commit 3/6 — /api/checkout extension Split/Gift.
 *
 * Exécution :
 *   npm run test:invites:checkout-split
 *
 * Pattern : Admin SDK direct + DI seam mock auth + mock Stripe (cohérent SC5 c4/5
 * refundForSanction.test.ts pattern).
 *
 * Couverture (SP-CHK1-SP-CHK4 + bonus) :
 *   SP-CHK1 mode='invite-prepay' valide → Stripe checkout créée + metadata + idempotencyKey
 *   SP-CHK2 mode='invite-prepay' caller ≠ invite.fromUserId → 403 forbidden
 *   SP-CHK3 mode='invite-prepay' invite.mode='individual' → 400 invalid-mode-for-prepay
 *   SP-CHK4 mode='invite-accept' invite.mode='split' → checkout B avec amount=splitInviteeAmountCents
 *   Bonus : charges_enabled=false → 412 partner-not-onboarded
 *   Bonus : mode='invite-accept' invite.mode='gift' → 409 use-accept-gift-endpoint
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-checkout-split';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-checkout-split';
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
// Mock Stripe (controllable for tests)
// =====================================================================

interface CheckoutSessionCall {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  idempotencyKey?: string;
}

class MockStripe {
  public checkoutCalls: CheckoutSessionCall[] = [];
  public accountsRetrieveCalls: string[] = [];
  public chargesEnabledByAccount: Record<string, boolean> = {};
  public idempotencyMap = new Map<string, { id: string; url: string }>();
  private _counter = 0;

  reset() {
    this.checkoutCalls = [];
    this.accountsRetrieveCalls = [];
    this.chargesEnabledByAccount = {};
    this.idempotencyMap.clear();
    this._counter = 0;
  }

  checkout = {
    sessions: {
      create: async (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: any,
        opts?: { idempotencyKey?: string },
      ) => {
        const key = opts?.idempotencyKey;
        this.checkoutCalls.push({ params, idempotencyKey: key });
        if (key && this.idempotencyMap.has(key)) {
          return this.idempotencyMap.get(key);
        }
        this._counter++;
        const result = {
          id: `cs_mock_${this._counter}`,
          url: `https://checkout.stripe.com/mock_${this._counter}`,
        };
        if (key) this.idempotencyMap.set(key, result);
        return result;
      },
    },
  };

  accounts = {
    retrieve: async (accountId: string) => {
      this.accountsRetrieveCalls.push(accountId);
      const enabled = this.chargesEnabledByAccount[accountId] ?? true;
      return {
        id: accountId,
        charges_enabled: enabled,
        payouts_enabled: enabled,
      };
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
    initializeApp({ projectId: 'demo-spordate-checkout-split' });
  }
  const db = getFirestore();

  // Wire DI seams Phase 9 SC2 c3/6 (sharedStripe + connectHelpers)
  __setSharedStripeForTesting(mockStripe);
  __setConnectDbForTesting(db);

  const ALICE = 'user_alice_chk';
  const BOB = 'user_bob_chk';
  const CHARLIE = 'user_charlie_chk';
  const PARTNER = 'partner_chk';
  const PARTNER_ACCT = 'acct_test_chk';
  const ACTIVITY_ID = 'activity_chk';
  const SESSION_ID = 'session_chk';

  async function seedSession(): Promise<void> {
    await db.collection('sessions').doc(SESSION_ID).set({
      sessionId: SESSION_ID,
      activityId: ACTIVITY_ID,
      partnerId: PARTNER,
      creatorId: PARTNER,
      sport: 'tennis',
      title: 'Test Session CHK',
      city: 'Geneva',
      startAt: Timestamp.fromMillis(Date.now() + 5 * 24 * 60 * 60_000),
      endAt: Timestamp.fromMillis(Date.now() + 5 * 24 * 60 * 60_000 + 60 * 60_000),
      maxParticipants: 8,
      currentParticipants: 0,
      pricingTiers: [],
      currentTier: 'early',
      currentPrice: 2500,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function seedActivity(): Promise<void> {
    await db.collection('activities').doc(ACTIVITY_ID).set({
      activityId: ACTIVITY_ID,
      partnerId: PARTNER,
      partnerName: 'Test Partner',
      title: 'Tennis Lausanne',
      sport: 'tennis',
      city: 'Geneva',
      isActive: true,
      chatCreditsBundle: 50,
    });
  }

  async function seedPartner(stripeAccountId: string | undefined): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      partnerId: PARTNER,
      name: 'Partner Test',
      email: 'partner@test.local',
      city: 'Geneva',
    };
    if (stripeAccountId) payload.stripeAccountId = stripeAccountId;
    await db.collection('partners').doc(PARTNER).set(payload);
  }

  async function seedInvite(opts: {
    fromUserId: string;
    toUserId: string;
    mode?: 'individual' | 'split' | 'gift';
    splitInviterAmountCents?: number;
    splitInviteeAmountCents?: number;
    status?: 'pending' | 'accepted' | 'declined' | 'expired';
  }): Promise<string> {
    const inviteId = `${opts.fromUserId}_${opts.toUserId}_${SESSION_ID}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      inviteId,
      fromUserId: opts.fromUserId,
      toUserId: opts.toUserId,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_ID,
      status: opts.status ?? 'pending',
      expiresAt: Timestamp.fromMillis(Date.now() + 5 * 24 * 60 * 60_000),
      createdAt: FieldValue.serverTimestamp(),
    };
    if (opts.mode) payload.mode = opts.mode;
    if (opts.splitInviterAmountCents !== undefined) payload.splitInviterAmountCents = opts.splitInviterAmountCents;
    if (opts.splitInviteeAmountCents !== undefined) payload.splitInviteeAmountCents = opts.splitInviteeAmountCents;
    await db.collection('invites').doc(inviteId).set(payload);
    return inviteId;
  }

  async function clearAll(): Promise<void> {
    for (const col of ['sessions', 'activities', 'partners', 'invites']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    mockStripe.reset();
    mockStripe.chargesEnabledByAccount[PARTNER_ACCT] = true;
  }

  // Default mock auth
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // SP-CHK1 mode='invite-prepay' valide → checkout créée + metadata + idempotencyKey
  // ===================================================================
  section('SP-CHK1 invite-prepay valide → checkout créée + metadata + idempotencyKey');
  {
    await clearAll();
    await seedSession();
    await seedActivity();
    await seedPartner(PARTNER_ACCT);
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
    });

    _mockUid = ALICE;
    const res = await callCheckout({ mode: 'invite-prepay', inviteId });
    if (res.status === 200 && typeof res.body.sessionId === 'string') {
      pass('SP-CHK1 status 200 + sessionId returned');
    } else {
      fail('SP-CHK1 status', res);
    }
    if (res.body.idempotencyKey === `invite-prepay-${inviteId}`) {
      pass('SP-CHK1 idempotencyKey shape `invite-prepay-{inviteId}` (Q8=A pattern)');
    } else {
      fail('SP-CHK1 idempotencyKey', res.body);
    }
    if (mockStripe.checkoutCalls.length === 1) {
      pass('SP-CHK1 Stripe.checkout.sessions.create appelé 1×');
    } else {
      fail('SP-CHK1 Stripe calls', mockStripe.checkoutCalls.length);
    }
    const call = mockStripe.checkoutCalls[0];
    if (call?.params?.payment_intent_data?.transfer_data?.destination === PARTNER_ACCT) {
      pass('SP-CHK1 transfer_data.destination = partner.stripeAccountId');
    } else {
      fail('SP-CHK1 transfer_data missing', call?.params?.payment_intent_data);
    }
    const expectedFee = Math.round((1250 * 5) / 100); // 5% Phase 9 SC2 c2/6
    if (call?.params?.payment_intent_data?.application_fee_amount === expectedFee) {
      pass(`SP-CHK1 application_fee_amount=${expectedFee} (5% of 1250)`);
    } else {
      fail('SP-CHK1 app_fee', call?.params?.payment_intent_data);
    }
    if (call?.params?.metadata?.mode === 'invite-prepay' && call?.params?.metadata?.inviteId === inviteId) {
      pass('SP-CHK1 metadata.mode=invite-prepay + inviteId set');
    } else {
      fail('SP-CHK1 metadata', call?.params?.metadata);
    }
  }

  // ===================================================================
  // SP-CHK2 caller ≠ invite.fromUserId → 403 forbidden
  // ===================================================================
  section('SP-CHK2 caller ≠ fromUserId → 403 forbidden');
  {
    await clearAll();
    await seedSession();
    await seedActivity();
    await seedPartner(PARTNER_ACCT);
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
    });

    _mockUid = CHARLIE; // not fromUserId
    const res = await callCheckout({ mode: 'invite-prepay', inviteId });
    if (res.status === 403 && res.body.error === 'forbidden') {
      pass('SP-CHK2 caller≠fromUserId → 403 forbidden');
    } else {
      fail('SP-CHK2', res);
    }
  }

  // ===================================================================
  // SP-CHK3 mode='individual' → 400 invalid-mode-for-prepay
  // ===================================================================
  section("SP-CHK3 mode='individual' → 400 invalid-mode-for-prepay");
  {
    await clearAll();
    await seedSession();
    await seedActivity();
    await seedPartner(PARTNER_ACCT);
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'individual',
    });

    _mockUid = ALICE;
    const res = await callCheckout({ mode: 'invite-prepay', inviteId });
    if (res.status === 400 && res.body.error === 'invalid-mode-for-prepay') {
      pass('SP-CHK3 individual → 400 invalid-mode-for-prepay');
    } else {
      fail('SP-CHK3', res);
    }
  }

  // ===================================================================
  // SP-CHK4 invite-accept invite.mode='split' → checkout B amount=splitInviteeAmountCents
  // ===================================================================
  section("SP-CHK4 invite-accept mode='split' → checkout B amount=splitInviteeAmountCents");
  {
    await clearAll();
    await seedSession();
    await seedActivity();
    await seedPartner(PARTNER_ACCT);
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1750,
      splitInviteeAmountCents: 750,
    });

    _mockUid = BOB;
    const res = await callCheckout({ mode: 'invite-accept', inviteId });
    if (res.status === 200) {
      pass('SP-CHK4 invite-accept split → 200');
    } else {
      fail('SP-CHK4 status', res);
    }
    const call = mockStripe.checkoutCalls[mockStripe.checkoutCalls.length - 1];
    if (call?.params?.line_items?.[0]?.price_data?.unit_amount === 750) {
      pass('SP-CHK4 unit_amount=750 (splitInviteeAmountCents)');
    } else {
      fail('SP-CHK4 amount', call?.params?.line_items);
    }
    if (call?.params?.metadata?.inviteMode === 'split') {
      pass('SP-CHK4 metadata.inviteMode=split');
    } else {
      fail('SP-CHK4 inviteMode', call?.params?.metadata);
    }
  }

  // ===================================================================
  // Bonus : charges_enabled=false → 412 partner-not-onboarded
  // ===================================================================
  section('Bonus : charges_enabled=false → 412 partner-not-onboarded');
  {
    await clearAll();
    await seedSession();
    await seedActivity();
    await seedPartner(PARTNER_ACCT);
    mockStripe.chargesEnabledByAccount[PARTNER_ACCT] = false; // Stripe Connect not ready

    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
    });
    _mockUid = ALICE;
    const res = await callCheckout({ mode: 'invite-prepay', inviteId });
    if (res.status === 412 && res.body.error === 'partner-not-onboarded') {
      pass('Bonus charges_enabled=false → 412 partner-not-onboarded');
    } else {
      fail('Bonus partner-not-onboarded', res);
    }
  }

  // ===================================================================
  // Bonus : invite-accept gift → 409 use-accept-gift-endpoint
  // ===================================================================
  section("Bonus : invite-accept mode='gift' → 409 use-accept-gift-endpoint");
  {
    await clearAll();
    await seedSession();
    await seedActivity();
    await seedPartner(PARTNER_ACCT);
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'gift',
      splitInviterAmountCents: 2500,
      splitInviteeAmountCents: 0,
    });

    _mockUid = BOB;
    const res = await callCheckout({ mode: 'invite-accept', inviteId });
    if (res.status === 409 && res.body.error === 'use-accept-gift-endpoint') {
      pass('Bonus gift → 409 use-accept-gift-endpoint');
    } else {
      fail('Bonus gift', res);
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
  console.log('====== Résumé Checkout Split/Gift (SP-CHK1-SP-CHK4 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
