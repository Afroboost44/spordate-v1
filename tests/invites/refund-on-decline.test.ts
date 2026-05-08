/**
 * Tests Phase 9 sub-chantier 2 commit 5/6 — refund auto on decline + expire (Q6=A).
 *
 * Exécution :
 *   npm run test:invites:refund-on-decline
 *
 * Pattern : Admin SDK direct + DI seam mock sharedStripe (cohérent SC2 c3/6 + SC5 c4/5).
 * Tests testent service-level declineInvite + endpoint /api/cron/expire-invites.
 *
 * Couverture (SP-RF1-SP-RF4 + 2 bonus) :
 *   SP-RF1 declineInvite mode='split' avec inviterPaymentIntentId → refund Stripe + invite.inviterRefundedAt set + audit log
 *   SP-RF2 declineInvite mode='individual' → no refund (skip silent)
 *   SP-RF3 expire-invites mode='gift' avec inviterPaymentIntentId → batch refund auto
 *   SP-RF4 idempotency : refundForInvite 2× même inviteId → 1 seul Stripe call (Firestore guard + Stripe idempotencyKey)
 *   Bonus declineInvite mode='split' sans inviterPaymentIntentId → no refund (rien à rembourser)
 *   Bonus refundForInvite invite-not-found → ok=false reason='invite-not-found'
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-refund-decline';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-refund-decline';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
process.env.CRON_SECRET = 'test-cron-secret-rf';

import {
  __setInvitesDbForTesting,
  declineInvite,
  makeInviteDocId,
} from '../../src/lib/invites/service';
import {
  refundForInvite,
  __setRefundInviteDbForTesting,
} from '../../src/lib/stripe/refundForInvite';
import { __setSharedStripeForTesting } from '../../src/lib/stripe/sharedStripe';
import { POST as POSTExpireInvites } from '../../src/app/api/cron/expire-invites/route';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import type { Firestore } from 'firebase/firestore';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

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

interface MockRefundCall {
  payment_intent: string;
  idempotencyKey?: string;
}

class MockStripe {
  public refundCalls: MockRefundCall[] = [];
  public idempotencyMap = new Map<
    string,
    { id: string; amount: number; payment_intent: string }
  >();
  public failOnPaymentIntent = new Set<string>();
  private _counter = 0;

  reset() {
    this.refundCalls = [];
    this.idempotencyMap.clear();
    this.failOnPaymentIntent.clear();
    this._counter = 0;
  }

  refunds = {
    create: async (
      params: { payment_intent: string; metadata?: Record<string, unknown> },
      opts?: { idempotencyKey?: string },
    ) => {
      const key = opts?.idempotencyKey;
      this.refundCalls.push({
        payment_intent: params.payment_intent,
        idempotencyKey: key,
      });
      if (key && this.idempotencyMap.has(key)) {
        return this.idempotencyMap.get(key);
      }
      if (this.failOnPaymentIntent.has(params.payment_intent)) {
        throw new Error(`Mock Stripe error PI ${params.payment_intent}`);
      }
      this._counter++;
      const refund = {
        id: `re_inv_${this._counter}`,
        amount: 1250,
        payment_intent: params.payment_intent,
      };
      if (key) this.idempotencyMap.set(key, refund);
      return refund;
    },
  };
}

const mockStripe = new MockStripe();

// =====================================================================

async function callExpireCron(): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-cron-secret-rf',
  };
  const req = new Request('http://localhost/api/cron/expire-invites', {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTExpireInvites(req);
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
    initializeApp({ projectId: 'demo-spordate-refund-decline' });
  }
  const db = getFirestore();

  // Wire DI seams
  __setSharedStripeForTesting(mockStripe);
  __setRefundInviteDbForTesting(db);

  // Pour declineInvite (client SDK via getInvitesDb), on utilise rules-unit-testing
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-refund-decline',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  const ALICE = 'user_alice_rf';
  const BOB = 'user_bob_rf';
  const ACTIVITY_ID = 'activity_rf';
  const SESSION_ID = 'session_rf';

  async function clearAll(): Promise<void> {
    for (const col of ['invites', 'sessions', 'activities', 'adminActions']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    mockStripe.reset();
  }

  async function seedSession(): Promise<void> {
    await db
      .collection('sessions')
      .doc(SESSION_ID)
      .set({
        sessionId: SESSION_ID,
        activityId: ACTIVITY_ID,
        partnerId: 'partner_rf',
        creatorId: 'partner_rf',
        sport: 'tennis',
        title: 'Test Session RF',
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

  async function seedInvite(opts: {
    fromUserId: string;
    toUserId: string;
    mode: 'individual' | 'split' | 'gift';
    inviterPaymentIntentId?: string;
    inviterRefundedAt?: number;
    expiresAtMs?: number;
  }): Promise<string> {
    const inviteId = makeInviteDocId(opts.fromUserId, opts.toUserId, SESSION_ID);
    const nowMs = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      inviteId,
      fromUserId: opts.fromUserId,
      toUserId: opts.toUserId,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_ID,
      status: 'pending',
      mode: opts.mode,
      expiresAt: Timestamp.fromMillis(opts.expiresAtMs ?? nowMs + 4 * 24 * 60 * 60_000),
      createdAt: Timestamp.now(),
    };
    if (opts.mode === 'split') {
      payload.splitInviterAmountCents = 1250;
      payload.splitInviteeAmountCents = 1250;
    }
    if (opts.mode === 'gift') {
      payload.splitInviterAmountCents = 2500;
      payload.splitInviteeAmountCents = 0;
    }
    if (opts.inviterPaymentIntentId) {
      payload.inviterPaymentIntentId = opts.inviterPaymentIntentId;
    }
    if (opts.inviterRefundedAt) {
      payload.inviterRefundedAt = Timestamp.fromMillis(opts.inviterRefundedAt);
    }
    await db.collection('invites').doc(inviteId).set(payload);
    return inviteId;
  }

  // ===================================================================
  // SP-RF1 declineInvite mode='split' + inviterPaymentIntentId → refund + audit
  // ===================================================================
  section('SP-RF1 declineInvite mode=split + inviterPaymentIntentId → refund Stripe + audit log');
  {
    await clearAll();
    await seedSession();
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      inviterPaymentIntentId: 'pi_rf1_split',
    });

    // Bob declines via service helper (client SDK via withSecurityRulesDisabled)
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      __setInvitesDbForTesting(fbDb);
      try {
        await declineInvite(inviteId, BOB);
      } finally {
        __setInvitesDbForTesting(null);
      }
    });

    // Wait for async refund (it's awaited inside declineInvite, but post-decline awaits is mostly
    // synchronous in our test path)
    if (mockStripe.refundCalls.length === 1) {
      pass('SP-RF1 Stripe.refunds.create called 1× (refund auto)');
    } else {
      fail('SP-RF1 Stripe call count', mockStripe.refundCalls);
    }
    if (mockStripe.refundCalls[0]?.payment_intent === 'pi_rf1_split') {
      pass('SP-RF1 Stripe call payment_intent=pi_rf1_split');
    } else {
      fail('SP-RF1 PI', mockStripe.refundCalls[0]);
    }
    if (mockStripe.refundCalls[0]?.idempotencyKey === `refund-invite-${inviteId}`) {
      pass('SP-RF1 idempotencyKey shape `refund-invite-{inviteId}` (Q8=A pattern)');
    } else {
      fail('SP-RF1 idempotencyKey', mockStripe.refundCalls[0]);
    }
    const inviteData = (await db.collection('invites').doc(inviteId).get()).data();
    if (inviteData?.inviterRefundedAt && inviteData?.inviterRefundedAmount === 1250) {
      pass('SP-RF1 invite.inviterRefundedAt set + inviterRefundedAmount=1250');
    } else {
      fail('SP-RF1 refund flags', inviteData);
    }
    if (inviteData?.status === 'declined') {
      pass('SP-RF1 invite.status=declined (decline reste valide)');
    } else {
      fail('SP-RF1 status', inviteData?.status);
    }
    const auditSnap = await db
      .collection('adminActions')
      .where('actionType', '==', 'auto_refund_invite')
      .get();
    if (auditSnap.size === 1) {
      pass('SP-RF1 adminAction audit log auto_refund_invite');
    } else {
      fail('SP-RF1 audit count', auditSnap.size);
    }
  }

  // ===================================================================
  // SP-RF2 declineInvite mode='individual' → no refund
  // ===================================================================
  section('SP-RF2 declineInvite mode=individual → no refund (skip silent)');
  {
    await clearAll();
    await seedSession();
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'individual',
    });

    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      __setInvitesDbForTesting(fbDb);
      try {
        await declineInvite(inviteId, BOB);
      } finally {
        __setInvitesDbForTesting(null);
      }
    });

    if (mockStripe.refundCalls.length === 0) {
      pass('SP-RF2 zéro Stripe call (mode=individual skip silent)');
    } else {
      fail('SP-RF2 unexpected Stripe call', mockStripe.refundCalls);
    }
    const inviteData = (await db.collection('invites').doc(inviteId).get()).data();
    if (inviteData?.status === 'declined' && !inviteData?.inviterRefundedAt) {
      pass('SP-RF2 invite.status=declined sans inviterRefundedAt (mode individual)');
    } else {
      fail('SP-RF2 invite state', inviteData);
    }
  }

  // ===================================================================
  // SP-RF3 expire-invites mode='gift' avec inviterPaymentIntentId → batch refund
  // ===================================================================
  section('SP-RF3 expire-invites mode=gift avec inviterPaymentIntentId → batch refund auto');
  {
    await clearAll();
    await seedSession();
    const giftInviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'gift',
      inviterPaymentIntentId: 'pi_rf3_gift',
      expiresAtMs: Date.now() - 60_000, // expired
    });
    // Plus un invite individual expiré (no refund expected)
    const indivInviteId = await seedInvite({
      fromUserId: 'user_charlie_rf',
      toUserId: 'user_dave_rf',
      mode: 'individual',
      expiresAtMs: Date.now() - 60_000,
    });

    const res = await callExpireCron();
    if (res.status === 200 && (res.body.processed as number) === 2) {
      pass('SP-RF3 cron processed=2 (gift + individual expired)');
    } else {
      fail('SP-RF3 cron result', res.body);
    }
    if ((res.body.refundCandidates as number) === 1) {
      pass('SP-RF3 refundCandidates=1 (gift only)');
    } else {
      fail('SP-RF3 refundCandidates', res.body);
    }
    if (mockStripe.refundCalls.length === 1) {
      pass('SP-RF3 Stripe.refunds.create called 1× (gift auto refund)');
    } else {
      fail('SP-RF3 Stripe calls', mockStripe.refundCalls);
    }
    if (mockStripe.refundCalls[0]?.payment_intent === 'pi_rf3_gift') {
      pass('SP-RF3 Stripe payment_intent=pi_rf3_gift');
    } else {
      fail('SP-RF3 PI', mockStripe.refundCalls[0]);
    }
    const giftData = (await db.collection('invites').doc(giftInviteId).get()).data();
    if (giftData?.inviterRefundedAt && giftData?.status === 'expired') {
      pass('SP-RF3 invite gift status=expired + inviterRefundedAt set');
    } else {
      fail('SP-RF3 gift invite state', giftData);
    }
    const indivData = (await db.collection('invites').doc(indivInviteId).get()).data();
    if (indivData?.status === 'expired' && !indivData?.inviterRefundedAt) {
      pass('SP-RF3 invite individual status=expired sans refund (skip silent)');
    } else {
      fail('SP-RF3 individual invite state', indivData);
    }
  }

  // ===================================================================
  // SP-RF4 idempotency 2× refundForInvite
  // ===================================================================
  section('SP-RF4 idempotency : refundForInvite 2× même inviteId → 1 seul Stripe call');
  {
    await clearAll();
    await seedSession();
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      inviterPaymentIntentId: 'pi_rf4_idem',
    });

    // Call 1
    const r1 = await refundForInvite({ inviteId });
    if (r1.ok && r1.refundId) {
      pass('SP-RF4 call 1 ok + refundId returned');
    } else {
      fail('SP-RF4 call 1', r1);
    }

    // Call 2 — invite.inviterRefundedAt set → should skip Firestore-side
    const r2 = await refundForInvite({ inviteId });
    if (r2.ok && r2.reason === 'already-refunded') {
      pass('SP-RF4 call 2 → already-refunded (Firestore-side guard)');
    } else {
      fail('SP-RF4 call 2', r2);
    }
    if (mockStripe.refundCalls.length === 1) {
      pass('SP-RF4 Stripe.refunds.create called 1× (Firestore guard avant Stripe)');
    } else {
      fail('SP-RF4 Stripe calls', mockStripe.refundCalls.length);
    }
  }

  // ===================================================================
  // Bonus declineInvite mode='split' sans inviterPaymentIntentId → no refund
  // ===================================================================
  section('Bonus declineInvite mode=split sans inviterPaymentIntentId → no refund');
  {
    await clearAll();
    await seedSession();
    const inviteId = await seedInvite({
      fromUserId: ALICE,
      toUserId: BOB,
      mode: 'split',
      // inviterPaymentIntentId NOT set (A pas encore prepay)
    });

    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      __setInvitesDbForTesting(fbDb);
      try {
        await declineInvite(inviteId, BOB);
      } finally {
        __setInvitesDbForTesting(null);
      }
    });

    if (mockStripe.refundCalls.length === 0) {
      pass('Bonus zéro Stripe call (no payment yet)');
    } else {
      fail('Bonus unexpected Stripe call', mockStripe.refundCalls);
    }
  }

  // ===================================================================
  // Bonus refundForInvite invite-not-found
  // ===================================================================
  section('Bonus refundForInvite invite-not-found → ok=false reason=invite-not-found');
  {
    await clearAll();
    const r = await refundForInvite({ inviteId: 'invite_does_not_exist' });
    if (!r.ok && r.reason === 'invite-not-found') {
      pass('Bonus invite-not-found → ok=false reason=invite-not-found');
    } else {
      fail('Bonus result', r);
    }
  }

  // Cleanup
  __setSharedStripeForTesting(null);
  __setRefundInviteDbForTesting(null);
  await clearAll();
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Refund on Decline/Expire (SP-RF1-SP-RF4 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
