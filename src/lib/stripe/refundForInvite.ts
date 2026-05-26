/**
 * Phase 9 sub-chantier 2 commit 5/6 — Stripe refund auto si decline/expire invite.
 *
 * Comble doctrine §E.Q1 Phase 9 (Q6=A) : inviter peut cancel l'invite avant accept
 * → refund auto 100% (cohérent retain-not-trap).
 *
 * Utilisé par :
 *  - declineInvite() service : si invite.mode in ['split','gift'] AND inviterPaymentIntentId set
 *  - cron expireInvitesCron : si invite.mode in ['split','gift'] AND inviterPaymentIntentId set
 *
 * Pattern cohérent SC5 c4/5 refundForSanction.ts :
 *  - idempotencyKey Stripe = `refund-invite-${inviteId}` (Q8=A pattern)
 *  - Idempotency Firestore-side : skip si invite.inviterRefundedAt déjà set
 *  - Audit log adminAction type='auto_refund_invite' adminId='system'
 *
 * Errors : best-effort silent (log + return ok=false). Caller (cron / decline) ne doit
 * pas fail si refund échoue (expire / decline reste valide).
 */

import { getSharedStripe } from './sharedStripe';
import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbOverride: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbReal: any = null;

/** @internal — DI seam tests (cohérent connectHelpers + refundForSanction). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setRefundInviteDbForTesting(mockDb: any): void {
  _dbOverride = mockDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDb(): Promise<any> {
  if (_dbOverride) return _dbOverride;
  if (_dbReal) return _dbReal;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _dbReal = getFirestore();
  return _dbReal;
}

export interface RefundForInviteResult {
  ok: boolean;
  refundId?: string;
  amount?: number;
  reason?: string;
}

/** Nombre maximum de tentatives avant escalation vers manual-review. */
export const REFUND_MAX_ATTEMPTS = 5;

/**
 * Refund Stripe pour invite annulé (decline / expire).
 *
 * Conditions silent skip (return ok=true, reason='...') :
 *  - invite-not-found
 *  - mode === 'individual' (rien à rembourser, B paye sa part directement)
 *  - inviterPaymentIntentId absent (A pas encore payé)
 *  - refundState.status === 'succeeded' OU inviterRefundedAt déjà set
 *    (idempotency Firestore-side — garde-fou explicite contre double-call)
 */
export async function refundForInvite(opts: {
  inviteId: string;
}): Promise<RefundForInviteResult> {
  if (!opts.inviteId) {
    return { ok: false, reason: 'invalid-input' };
  }

  const db = await getDb();
  const { FieldValue } = await import('firebase-admin/firestore');
  const inviteRef = db.collection('invites').doc(opts.inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    return { ok: false, reason: 'invite-not-found' };
  }
  const invite = inviteSnap.data();
  if (!invite) {
    return { ok: false, reason: 'invite-empty' };
  }

  const mode = (invite.mode as string) || 'individual';
  if (mode === 'individual') {
    // Best-effort upsert state si manquant
    if (!invite.refundState) {
      try {
        await inviteRef.update({
          refundState: { attempted: false, status: 'not-applicable', attempts: 0 },
        });
      } catch (_e) { /* silent */ }
    }
    return { ok: true, reason: 'mode-individual-no-refund' };
  }
  if (!invite.inviterPaymentIntentId) {
    return { ok: true, reason: 'no-payment-intent' };
  }
  // Idempotency garde-fou : si déjà succeeded OU legacy inviterRefundedAt set, skip.
  const currentRefundStatus = invite.refundState?.status as string | undefined;
  if (currentRefundStatus === 'succeeded' || invite.inviterRefundedAt) {
    return { ok: true, reason: 'already-refunded' };
  }

  const currentAttempts = Number(invite.refundState?.attempts ?? 0);
  const nextAttempts = currentAttempts + 1;

  // Transition vers in-progress (lock court — pas de transaction stricte car
  // Stripe idempotency_key garantit l'unicité du refund même en cas de double run).
  try {
    await inviteRef.update({
      refundState: {
        attempted: true,
        status: 'in-progress',
        attempts: nextAttempts,
        lastAttemptAt: FieldValue.serverTimestamp(),
        ...(invite.refundState?.stripeRefundId
          ? { stripeRefundId: invite.refundState.stripeRefundId }
          : {}),
        ...(invite.refundState?.refundedAt
          ? { refundedAt: invite.refundState.refundedAt }
          : {}),
      },
    });
  } catch (err) {
    console.warn('[refundForInvite] refundState in-progress write failed (continue best-effort)', {
      inviteId: opts.inviteId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Stripe refund avec idempotency_key (Q8=A pattern cohérent SC5 c4/5)
  const idempotencyKey = `refund-invite-${opts.inviteId}`;
  const stripe = await getSharedStripe();

  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: invite.inviterPaymentIntentId,
        metadata: {
          inviteId: opts.inviteId,
          inviteMode: mode,
          source: 'auto_refund_invite',
        },
      },
      { idempotencyKey },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[refundForInvite] Stripe refunds.create failed', {
      inviteId: opts.inviteId,
      error: errorMessage,
      attempts: nextAttempts,
    });

    // Escalation manual-review si 5 tentatives KO + log refundIncident
    const escalate = nextAttempts >= REFUND_MAX_ATTEMPTS;
    const failureStatus = escalate ? 'manual-review' : 'failed';

    try {
      await inviteRef.update({
        refundState: {
          attempted: true,
          status: failureStatus,
          attempts: nextAttempts,
          lastAttemptAt: FieldValue.serverTimestamp(),
          lastError: errorMessage.slice(0, 500),
        },
      });
    } catch (writeErr) {
      console.warn('[refundForInvite] refundState failed-write failed', {
        inviteId: opts.inviteId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }

    if (escalate) {
      try {
        const incidentRef = db.collection('refundIncidents').doc();
        await incidentRef.set({
          incidentId: incidentRef.id,
          inviteId: opts.inviteId,
          inviteMode: mode,
          inviterPaymentIntentId: invite.inviterPaymentIntentId,
          attempts: nextAttempts,
          lastError: errorMessage.slice(0, 500),
          createdAt: FieldValue.serverTimestamp(),
          status: 'open',
        });
      } catch (incidentErr) {
        console.warn('[refundForInvite] refundIncidents log failed', {
          inviteId: opts.inviteId,
          error: incidentErr instanceof Error ? incidentErr.message : String(incidentErr),
        });
      }
    }

    return { ok: false, reason: 'stripe-error' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amount = ((refund as any)?.amount as number | undefined) ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refundId = ((refund as any)?.id as string | undefined) ?? '';

  // Update invite + audit log (best-effort)
  try {
    await inviteRef.update({
      inviterRefundedAt: FieldValue.serverTimestamp(),
      inviterRefundedAmount: amount,
      refundState: {
        attempted: true,
        status: 'succeeded',
        attempts: nextAttempts,
        lastAttemptAt: FieldValue.serverTimestamp(),
        refundedAt: FieldValue.serverTimestamp(),
        stripeRefundId: refundId,
      },
    });
  } catch (err) {
    console.warn('[refundForInvite] invite update failed (Stripe refund déjà créé)', {
      inviteId: opts.inviteId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const auditRef = db.collection('adminActions').doc();
    await auditRef.set({
      actionId: auditRef.id,
      adminId: 'system',
      actionType: 'auto_refund_invite',
      targetType: 'invite',
      targetId: opts.inviteId,
      metadata: {
        inviteMode: mode,
        refundId,
        amount,
        idempotencyKey,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[refundForInvite] audit log failed (silent)', {
      inviteId: opts.inviteId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, refundId, amount };
}
