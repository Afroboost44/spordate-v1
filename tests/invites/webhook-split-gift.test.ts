/**
 * Tests Phase 9 sub-chantier 2 commit 4/6 — webhook Stripe split/gift + accept-gift endpoint.
 *
 * Exécution :
 *   npm run test:invites:webhook-split-gift
 *
 * Pattern : Admin SDK direct seed + handlePaymentSuccess invocation directe (cohérent
 * SC4 c4/6 email-webhook.test.ts) + DI seam mock auth pour accept-gift POST endpoint.
 *
 * Couverture (SP-WH1-SP-WH6 + bonus) :
 *   SP-WH1 webhook mode='invite-prepay' valide → invite.inviterPaymentIntentId set + transaction
 *   SP-WH2 webhook mode='invite-accept' invite.mode='split' → 1 Booking userId=B + paidByUserId=B
 *   SP-WH3 webhook mode='invite-accept' replay 2× → 1 seule Booking (idempotency)
 *   SP-WH4 POST /api/invites/[id]/accept-gift valid → Booking userId=B + paidByUserId=A
 *   SP-WH5 accept-gift invite.mode!='gift' → 400 invalid-mode
 *   SP-WH6 accept-gift invite.inviterPaymentIntentId missing → 412 prepay-incomplete
 *   Bonus accept-gift caller!=toUserId → 403
 *   Bonus invite-prepay replay 2× → 1 seule transaction (idempotency dual)
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-wh-split';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-wh-split';

import { handlePaymentSuccess } from '../../src/app/api/webhooks/stripe/handler';
import { POST as POSTAcceptGift } from '../../src/app/api/invites/[id]/accept-gift/route';
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

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callAcceptGift(inviteId: string): Promise<MockResponse> {
  const req = new Request(`http://localhost/api/invites/${inviteId}/accept-gift`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTAcceptGift(req, { params: Promise.resolve({ id: inviteId }) });
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
    initializeApp({ projectId: 'demo-spordate-wh-split' });
  }
  const db = getFirestore();

  const ALICE = 'user_alice_whsp';
  const BOB = 'user_bob_whsp';
  const CHARLIE = 'user_charlie_whsp';
  const PARTNER = 'partner_whsp';
  const ACTIVITY_ID = 'activity_whsp';
  const SESSION_ID = 'session_whsp';

  async function clearAll() {
    for (const col of ['users', 'sessions', 'activities', 'invites', 'bookings', 'transactions', 'notifications', 'credits', 'errors']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  async function setupSeeds() {
    const nowMs = Date.now();
    const startAtMs = nowMs + 5 * 24 * 60 * 60_000;
    await db.collection('users').doc(ALICE).set({
      uid: ALICE, email: 'alice@test.local', displayName: 'Alice', credits: 0,
    });
    await db.collection('users').doc(BOB).set({
      uid: BOB, email: 'bob@test.local', displayName: 'Bob', credits: 0,
    });
    await db.collection('users').doc(CHARLIE).set({
      uid: CHARLIE, email: 'charlie@test.local', displayName: 'Charlie', credits: 0,
    });
    await db.collection('activities').doc(ACTIVITY_ID).set({
      activityId: ACTIVITY_ID,
      title: 'Yoga Geneva',
      sport: 'yoga',
      partnerId: PARTNER,
      city: 'Geneva',
      isActive: true,
      chatCreditsBundle: 50,
    });
    await db.collection('sessions').doc(SESSION_ID).set({
      sessionId: SESSION_ID,
      activityId: ACTIVITY_ID,
      partnerId: PARTNER,
      creatorId: PARTNER,
      sport: 'yoga',
      title: 'Yoga Geneva',
      city: 'Geneva',
      startAt: Timestamp.fromMillis(startAtMs),
      endAt: Timestamp.fromMillis(startAtMs + 60 * 60_000),
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

  async function seedInvite(opts: {
    inviteId: string;
    fromUserId: string;
    toUserId: string;
    mode: 'individual' | 'split' | 'gift';
    splitInviterAmountCents?: number;
    splitInviteeAmountCents?: number;
    inviterPaymentIntentId?: string;
    status?: 'pending' | 'accepted' | 'declined';
  }): Promise<void> {
    const nowMs = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      inviteId: opts.inviteId,
      fromUserId: opts.fromUserId,
      toUserId: opts.toUserId,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_ID,
      status: opts.status ?? 'pending',
      mode: opts.mode,
      expiresAt: Timestamp.fromMillis(nowMs + 4 * 24 * 60 * 60_000),
      createdAt: FieldValue.serverTimestamp(),
    };
    if (opts.splitInviterAmountCents !== undefined) payload.splitInviterAmountCents = opts.splitInviterAmountCents;
    if (opts.splitInviteeAmountCents !== undefined) payload.splitInviteeAmountCents = opts.splitInviteeAmountCents;
    if (opts.inviterPaymentIntentId) payload.inviterPaymentIntentId = opts.inviterPaymentIntentId;
    await db.collection('invites').doc(opts.inviteId).set(payload);
  }

  // Mock Stripe (paymentIntents.retrieve only invoked si twint)
  const mockStripe = {
    paymentIntents: {
      retrieve: async () => ({ payment_method_types: ['card'] }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // Default mock auth
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // SP-WH1 webhook invite-prepay valide
  // ===================================================================
  section('SP-WH1 webhook invite-prepay valide → invite.inviterPaymentIntentId set + transaction');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
    });

    const stripeCheckout = {
      id: 'cs_test_prepay_1',
      payment_intent: 'pi_test_prepay_1',
      amount_total: 1250,
      payment_method_types: ['card'],
      metadata: {
        mode: 'invite-prepay',
        inviteId,
        fromUserId: ALICE,
        toUserId: BOB,
        sessionId: SESSION_ID,
        activityId: ACTIVITY_ID,
        partnerId: PARTNER,
        inviteMode: 'split',
        amount: '1250',
      },
    };

    await handlePaymentSuccess(stripeCheckout, mockStripe);

    const inviteSnap = await db.collection('invites').doc(inviteId).get();
    if (inviteSnap.data()?.inviterPaymentIntentId === 'pi_test_prepay_1') {
      pass('SP-WH1 invite.inviterPaymentIntentId set');
    } else {
      fail('SP-WH1 inviterPaymentIntentId', inviteSnap.data());
    }
    if (inviteSnap.data()?.status === 'pending') {
      pass('SP-WH1 invite.status=pending preserved (B doit encore accepter)');
    } else {
      fail('SP-WH1 status pending');
    }
    const txSnap = await db.collection('transactions').where('type', '==', 'invite_prepay').get();
    if (txSnap.size === 1) {
      pass('SP-WH1 1 transaction type=invite_prepay créée');
    } else {
      fail('SP-WH1 transaction count', txSnap.size);
    }
  }

  // ===================================================================
  // SP-WH2 webhook invite-accept invite.mode='split' → Booking + paidByUserId=B
  // ===================================================================
  section('SP-WH2 webhook invite-accept mode=split → 1 Booking userId=B + paidByUserId=B');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
      inviterPaymentIntentId: 'pi_prepay_already', // A already prepaid
    });

    const stripeCheckout = {
      id: 'cs_test_accept_split',
      payment_intent: 'pi_test_accept_split',
      amount_total: 1250,
      payment_method_types: ['card'],
      metadata: {
        mode: 'invite-accept',
        inviteId,
        toUserId: BOB,
        fromUserId: ALICE,
        sessionId: SESSION_ID,
        activityId: ACTIVITY_ID,
        partnerId: PARTNER,
        tier: 'early',
        amount: '1250',
        bundleCredits: '50',
        inviteMode: 'split',
      },
    };

    await handlePaymentSuccess(stripeCheckout, mockStripe);

    const bookings = await db.collection('bookings').where('userId', '==', BOB).get();
    if (bookings.size === 1) {
      pass('SP-WH2 1 Booking créée userId=BOB');
    } else {
      fail('SP-WH2 booking count', bookings.size);
    }
    const bookingData = bookings.docs[0]?.data();
    if (bookingData?.paidByUserId === BOB) {
      pass('SP-WH2 paidByUserId=BOB (Q2=C split B paye sa part)');
    } else {
      fail('SP-WH2 paidByUserId', bookingData?.paidByUserId);
    }
    const inviteAfter = await db.collection('invites').doc(inviteId).get();
    if (inviteAfter.data()?.status === 'accepted') {
      pass('SP-WH2 invite.status=accepted');
    } else {
      fail('SP-WH2 invite status', inviteAfter.data()?.status);
    }
    const txSplit = await db.collection('transactions').where('type', '==', 'invite_accept_split').get();
    if (txSplit.size === 1) {
      pass('SP-WH2 transaction type=invite_accept_split');
    } else {
      fail('SP-WH2 transaction type', txSplit.size);
    }
  }

  // ===================================================================
  // SP-WH3 webhook idempotency replay 2×
  // ===================================================================
  section('SP-WH3 webhook invite-accept replay 2× → 1 seule Booking (idempotency)');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
      inviterPaymentIntentId: 'pi_prepay_x',
    });

    const stripeCheckout = {
      id: 'cs_test_replay',
      payment_intent: 'pi_test_replay',
      amount_total: 1250,
      payment_method_types: ['card'],
      metadata: {
        mode: 'invite-accept',
        inviteId,
        toUserId: BOB,
        fromUserId: ALICE,
        sessionId: SESSION_ID,
        activityId: ACTIVITY_ID,
        partnerId: PARTNER,
        tier: 'early',
        amount: '1250',
        bundleCredits: '50',
      },
    };

    // 2× event (cohérent Stripe webhook retry policy)
    await handlePaymentSuccess(stripeCheckout, mockStripe);
    await handlePaymentSuccess(stripeCheckout, mockStripe);

    const bookings = await db.collection('bookings').where('userId', '==', BOB).get();
    if (bookings.size === 1) {
      pass('SP-WH3 idempotency : 1 seule Booking (replay safe)');
    } else {
      fail('SP-WH3 booking count', bookings.size);
    }
  }

  // ===================================================================
  // SP-WH4 POST /api/invites/[id]/accept-gift valid
  // ===================================================================
  section('SP-WH4 POST /api/invites/[id]/accept-gift valid → Booking + paidByUserId=A');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'gift',
      splitInviterAmountCents: 2500,
      splitInviteeAmountCents: 0,
      inviterPaymentIntentId: 'pi_gift_prepay',
    });

    _mockUid = BOB;
    const res = await callAcceptGift(inviteId);
    if (res.status === 200 && res.body.status === 'accepted') {
      pass('SP-WH4 status 200 + status=accepted');
    } else {
      fail('SP-WH4 status', res);
    }
    const bookings = await db.collection('bookings').where('userId', '==', BOB).get();
    if (bookings.size === 1) {
      pass('SP-WH4 1 Booking userId=BOB');
    } else {
      fail('SP-WH4 booking count', bookings.size);
    }
    const bookingData = bookings.docs[0]?.data();
    if (bookingData?.paidByUserId === ALICE) {
      pass('SP-WH4 paidByUserId=ALICE (Q2=C gift A paye pour B)');
    } else {
      fail('SP-WH4 paidByUserId', bookingData?.paidByUserId);
    }
    const inviteAfter = await db.collection('invites').doc(inviteId).get();
    if (inviteAfter.data()?.status === 'accepted') {
      pass('SP-WH4 invite.status=accepted');
    } else {
      fail('SP-WH4 invite status', inviteAfter.data()?.status);
    }
    const txGift = await db.collection('transactions').where('type', '==', 'invite_accept_gift').get();
    if (txGift.size === 1) {
      pass('SP-WH4 transaction type=invite_accept_gift');
    } else {
      fail('SP-WH4 tx count', txGift.size);
    }
  }

  // ===================================================================
  // SP-WH5 accept-gift invite.mode != 'gift' → 400
  // ===================================================================
  section('SP-WH5 accept-gift invite.mode!=gift → 400 invalid-mode');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split', // not gift
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
      inviterPaymentIntentId: 'pi_test_x',
    });

    _mockUid = BOB;
    const res = await callAcceptGift(inviteId);
    if (res.status === 400 && res.body.error === 'invalid-mode') {
      pass('SP-WH5 mode=split → 400 invalid-mode');
    } else {
      fail('SP-WH5', res);
    }
  }

  // ===================================================================
  // SP-WH6 accept-gift inviterPaymentIntentId missing → 412
  // ===================================================================
  section('SP-WH6 accept-gift inviterPaymentIntentId missing → 412 prepay-incomplete');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'gift',
      splitInviterAmountCents: 2500,
      splitInviteeAmountCents: 0,
      // inviterPaymentIntentId NOT set (A pas encore prepay)
    });

    _mockUid = BOB;
    const res = await callAcceptGift(inviteId);
    if (res.status === 412 && res.body.error === 'prepay-incomplete') {
      pass('SP-WH6 inviterPaymentIntentId missing → 412 prepay-incomplete');
    } else {
      fail('SP-WH6', res);
    }
  }

  // ===================================================================
  // Bonus accept-gift caller != toUserId → 403
  // ===================================================================
  section('Bonus accept-gift caller!=toUserId → 403 forbidden');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'gift',
      splitInviterAmountCents: 2500,
      splitInviteeAmountCents: 0,
      inviterPaymentIntentId: 'pi_gift_x',
    });

    _mockUid = CHARLIE; // not toUserId
    const res = await callAcceptGift(inviteId);
    if (res.status === 403 && res.body.error === 'forbidden') {
      pass('Bonus caller!=toUserId → 403 forbidden');
    } else {
      fail('Bonus 403', res);
    }
  }

  // ===================================================================
  // Bonus invite-prepay replay 2× → 1 seule transaction
  // ===================================================================
  section('Bonus invite-prepay replay 2× → 1 transaction (idempotency dual)');
  {
    await clearAll();
    await setupSeeds();
    const inviteId = `${ALICE}_${BOB}_${SESSION_ID}`;
    await seedInvite({
      inviteId,
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      splitInviterAmountCents: 1250,
      splitInviteeAmountCents: 1250,
    });

    const stripeCheckout = {
      id: 'cs_prepay_replay',
      payment_intent: 'pi_prepay_replay',
      amount_total: 1250,
      payment_method_types: ['card'],
      metadata: {
        mode: 'invite-prepay',
        inviteId,
        fromUserId: ALICE,
        toUserId: BOB,
        sessionId: SESSION_ID,
        activityId: ACTIVITY_ID,
        partnerId: PARTNER,
        inviteMode: 'split',
        amount: '1250',
      },
    };

    await handlePaymentSuccess(stripeCheckout, mockStripe);
    await handlePaymentSuccess(stripeCheckout, mockStripe);

    const txSnap = await db.collection('transactions').where('type', '==', 'invite_prepay').get();
    if (txSnap.size === 1) {
      pass('Bonus invite-prepay replay → 1 seule transaction (idempotency)');
    } else {
      fail('Bonus prepay replay', txSnap.size);
    }
  }

  // Cleanup
  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Webhook Split/Gift (SP-WH1-SP-WH6 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
