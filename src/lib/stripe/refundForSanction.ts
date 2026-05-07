/**
 * Phase 8 sub-chantier 5 commit 4/5 — Stripe refund auto level 3 partner no-show.
 *
 * Comble Différé Phase 8 ligne 886 architecture.md :
 *   « ⏳ Stripe API automatisation refund partner no-show level 3 »
 *
 * Doctrine §D.5 niveau 3 : 3 no-show → suspension_30d + refundDue=true.
 * Phase 7 = flag manuel admin via Stripe dashboard. Phase 8 SC5 = auto + idempotency
 * + fallback admin manual endpoint.
 *
 * Helpers exposés :
 *   - refundForSanction({sanctionId, bookingId}) → 1 refund Stripe + audit log
 *   - refundAllForSanction(sanctionId) → orchestrator multi-bookings
 *
 * Q2=C : auto immédiat dans triggerAutoSanction (best-effort, sanction créée même
 * si refund fail) + admin fallback endpoint si auto fail (Q8=A idempotency_key).
 *
 * Q8=A idempotency_key shape : `refund-${sanctionId}-${bookingId}` — collision-safe
 * multi-bookings, traçabilité audit doc-level Booking.refundedAt.
 *
 * Architecture :
 *   triggerAutoSanction (lib/reports)
 *     ↓ post-create best-effort si refundDue=true
 *   refundAllForSanction(sanctionId)  → for each eligible booking :
 *     ↓ refundForSanction({sanctionId, bookingId})
 *     ↓ Stripe API refunds.create({payment_intent}, {idempotencyKey})
 *     ↓ Booking.update({refundedAt, refundedAmount})
 *     ↓ adminActions add({adminId='system', actionType='auto_refund_partner_no_show'})
 *
 * DI seams pour tests :
 *   __setStripeForTesting(mock) — inject mock Stripe SDK
 *   __setRefundDbForTesting(mockDb) — inject Admin SDK Firestore (emulator pointer)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _stripeOverride: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _stripeReal: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbOverride: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbReal: any = null;

/** @internal — DI seam tests/stripe/refund-sanction.test.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setStripeForTesting(mock: any): void {
  _stripeOverride = mock;
}

/** @internal — DI seam tests pour Admin SDK Firestore. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setRefundDbForTesting(mockDb: any): void {
  _dbOverride = mockDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStripe(): Promise<any> {
  if (_stripeOverride) return _stripeOverride;
  if (_stripeReal) return _stripeReal;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  const Stripe = (await import('stripe')).default;
  _stripeReal = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  return _stripeReal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDb(): Promise<any> {
  if (_dbOverride) return _dbOverride;
  if (_dbReal) return _dbReal;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
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

// =====================================================================
// refundForSanction — refund 1 booking via Stripe + Firestore writes
// =====================================================================

export interface RefundForSanctionInput {
  sanctionId: string;
  bookingId: string;
}

export interface RefundForSanctionResult {
  /** True si Stripe refund créé (ou idempotency hit). */
  ok: boolean;
  /** ID du refund Stripe (re_xxx). */
  refundId?: string;
  /** Montant remboursé (CHF centimes, cohérent Booking.amount). */
  amount?: number;
  /** Raison skip ou échec. */
  reason?: string;
}

export async function refundForSanction(
  input: RefundForSanctionInput,
): Promise<RefundForSanctionResult> {
  if (!input.sanctionId || !input.bookingId) {
    return { ok: false, reason: 'invalid-input' };
  }

  const db = await getDb();
  const bookingRef = db.collection('bookings').doc(input.bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    return { ok: false, reason: 'booking-not-found' };
  }
  const booking = bookingSnap.data();
  if (booking?.refundedAt) {
    // Déjà refund (idempotency Firestore-side)
    return { ok: true, reason: 'already-refunded', refundId: undefined };
  }
  const paymentIntentId = booking?.paymentIntentId as string | undefined;
  if (!paymentIntentId) {
    return { ok: false, reason: 'no-payment-intent' };
  }

  // Stripe refund avec idempotency_key (Q8=A shape)
  const idempotencyKey = `refund-${input.sanctionId}-${input.bookingId}`;
  const stripe = await getStripe();

  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        metadata: {
          sanctionId: input.sanctionId,
          bookingId: input.bookingId,
          source: 'auto_refund_partner_no_show',
        },
      },
      { idempotencyKey },
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'stripe-error',
    };
  }

  const amount = (refund?.amount as number | undefined) ?? booking?.amount ?? 0;
  const refundId = refund?.id as string | undefined;

  // Update Booking + audit log Admin SDK (best-effort)
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await bookingRef.update({
      refundedAt: FieldValue.serverTimestamp(),
      refundedAmount: amount,
    });
  } catch (err) {
    console.warn('[refundForSanction] Booking update failed (Stripe refund déjà créé)', {
      bookingId: input.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    const auditRef = db.collection('adminActions').doc();
    await auditRef.set({
      actionId: auditRef.id,
      adminId: 'system',
      actionType: 'auto_refund_partner_no_show',
      targetType: 'sanction',
      targetId: input.sanctionId,
      metadata: {
        bookingId: input.bookingId,
        refundId,
        amount,
        idempotencyKey,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[refundForSanction] adminActions audit log failed (silent)', {
      sanctionId: input.sanctionId,
      bookingId: input.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, refundId, amount };
}

// =====================================================================
// refundAllForSanction — orchestrator multi-bookings
// =====================================================================

export interface RefundAllResult {
  processedCount: number;
  errorCount: number;
  reason?: string;
}

/** Fenêtre de bookings éligibles : 30 jours rolling avant now. */
const ELIGIBLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function refundAllForSanction(sanctionId: string): Promise<RefundAllResult> {
  if (!sanctionId) return { processedCount: 0, errorCount: 0, reason: 'invalid-input' };

  const db = await getDb();
  const sanctionSnap = await db.collection('userSanctions').doc(sanctionId).get();
  if (!sanctionSnap.exists) {
    return { processedCount: 0, errorCount: 0, reason: 'sanction-not-found' };
  }
  const sanction = sanctionSnap.data();
  if (sanction?.refundDue !== true) {
    return { processedCount: 0, errorCount: 0, reason: 'refund-not-due' };
  }

  // Find triggering partner via first triggeringReportId.reporterId
  const triggeringReportIds = (sanction.triggeringReportIds ?? []) as string[];
  if (triggeringReportIds.length === 0) {
    return { processedCount: 0, errorCount: 0, reason: 'no-triggering-reports' };
  }
  let triggeringPartner: string | undefined;
  try {
    const reportSnap = await db.collection('reports').doc(triggeringReportIds[0]).get();
    triggeringPartner = reportSnap.data()?.reporterId as string | undefined;
  } catch (err) {
    return { processedCount: 0, errorCount: 0, reason: 'triggering-report-read-failed' };
  }
  if (!triggeringPartner) {
    return { processedCount: 0, errorCount: 0, reason: 'no-triggering-partner' };
  }

  // Query bookings userId == sanction.userId (single field index auto)
  // Filter partnerId + status + sessionDate window client-side (KISS Phase 8 launch volume).
  const bookingsSnap = await db
    .collection('bookings')
    .where('userId', '==', sanction.userId)
    .get();

  const cutoffMs = Date.now() - ELIGIBLE_WINDOW_MS;
  let processedCount = 0;
  let errorCount = 0;

  for (const bdoc of bookingsSnap.docs) {
    const data = bdoc.data();
    if (data.partnerId !== triggeringPartner) continue;
    if (data.status !== 'confirmed') continue;
    if (data.refundedAt) continue; // already refunded
    const sessionDateMs = data.sessionDate?.toMillis?.() ?? 0;
    if (sessionDateMs < cutoffMs) continue;
    if (!data.paymentIntentId) continue; // no Stripe ref → skip silently

    try {
      const result = await refundForSanction({
        sanctionId,
        bookingId: bdoc.id,
      });
      if (result.ok) {
        processedCount++;
      } else {
        errorCount++;
        console.warn('[refundAllForSanction] per-booking refund non-ok', {
          bookingId: bdoc.id,
          reason: result.reason,
        });
      }
    } catch (err) {
      errorCount++;
      console.warn('[refundAllForSanction] per-booking refund threw', {
        bookingId: bdoc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processedCount, errorCount };
}
