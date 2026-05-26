/**
 * Hardening sécurité crédits — POST /api/credits/grant.
 *
 * FILET DE SÉCURITÉ post-paiement Stripe. Le webhook
 * /api/webhooks/stripe (handlePaymentSuccess) crédite normalement le user
 * dès qu'il reçoit l'event checkout.session.completed. Si le webhook a
 * tardé ou échoué (network blip, retry Stripe), la page /payment?status=success
 * peut appeler cet endpoint avec le sessionId pour forcer un grant manuel.
 *
 * Remplace l'écriture client-side qui existait dans src/app/payment/page.tsx
 * (updateDoc users/{uid}.credits direct côté navigateur). Avec les Firestore
 * rules qui bloquent l'écriture client de `credits`, ce flow passe désormais
 * obligatoirement par cet endpoint server-side.
 *
 * Idempotence : cohérent avec handlePaymentSuccess (handler.ts) — on
 * vérifie qu'aucun doc transactions n'existe déjà avec stripeSessionId.
 * Si oui → on retourne alreadyGranted: true sans recréditer (le webhook
 * a déjà fait le boulot, ou un précédent appel à cet endpoint).
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid
 *   2. Body { sessionId }
 *   3. Stripe.checkout.sessions.retrieve(sessionId)
 *      → payment_status === 'paid'
 *      → metadata.userId === uid (anti-cross-user grant)
 *   4. Compute creditsToGrant via metadata.creditsToGrant ||
 *      PACKAGE_CREDITS[packageId]
 *   5. runTransaction :
 *      a. Check idempotence : transactions.where('stripeSessionId', '==', sessionId)
 *      b. Si existant → return { alreadyGranted: true, balance }
 *      c. Increment users/{uid}.credits + create transaction + credit log
 *   6. Retourne { ok: true, granted, newBalance } ou { alreadyGranted, balance }
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Lazy-init Stripe (cohérent /api/verify-payment + /api/checkout/status).
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  return _stripe;
}

// Cohérent /api/verify-payment et handler.ts PACKAGES const.
const PACKAGE_CREDITS: Record<string, number> = {
  test_1chf: 1,
  '1_date': 1,
  '3_dates': 3,
  '10_dates': 10,
  premium_monthly: 5,
  premium_yearly: 60,
  partner_monthly: 0,
  // Phase 4 packs crédits standards (PRICING-PROPOSAL.md §3).
  pack_starter: 50,
  pack_confort: 150,
  pack_pro: 500,
  pack_vip: 1500,
};

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'sessionId required' },
        { status: 400 },
      );
    }

    // 1. Verify session Stripe — paid + userId match.
    let stripeSession: Stripe.Checkout.Session;
    try {
      stripeSession = await getStripe().checkout.sessions.retrieve(sessionId);
    } catch (err) {
      console.warn('[/api/credits/grant] stripe.retrieve failed:', err);
      return NextResponse.json(
        { error: 'session-not-found', detail: 'Unknown Stripe session' },
        { status: 404 },
      );
    }

    if (stripeSession.payment_status !== 'paid') {
      return NextResponse.json(
        { error: 'payment-not-paid', detail: `payment_status=${stripeSession.payment_status}` },
        { status: 400 },
      );
    }

    const meta = (stripeSession.metadata || {}) as Record<string, string>;
    const metaUserId = meta.userId || meta.user_id || '';
    if (metaUserId && metaUserId !== uid) {
      return NextResponse.json(
        { error: 'session-not-owned', detail: 'Session does not belong to authenticated user' },
        { status: 403 },
      );
    }

    // 2. Determine credits to grant (priorité metadata, sinon mapping packageId).
    const packageId = meta.packageId || meta.package_id || '';
    const metaCredits = parseInt(meta.creditsToGrant || meta.credits || '0', 10);
    const creditsToGrant =
      Number.isFinite(metaCredits) && metaCredits > 0
        ? metaCredits
        : PACKAGE_CREDITS[packageId] || 0;

    if (creditsToGrant <= 0) {
      return NextResponse.json(
        { error: 'no-credits-to-grant', detail: `package=${packageId}` },
        { status: 400 },
      );
    }

    // 3. Atomic : idempotence + grant + log.
    const db = await getAdminDb();
    const { FieldValue } = await import('firebase-admin/firestore');

    const userRef = db.collection('users').doc(uid);
    const txnsCol = db.collection('transactions');
    const creditsCol = db.collection('credits');

    // PRE-CHECK idempotence hors-tx (read-only query, économise l'écriture
    // dans 99% des cas où le webhook a déjà fait le boulot). On refait le
    // check dans la TX pour gérer la race condition fine.
    const preExisting = await txnsCol.where('stripeSessionId', '==', sessionId).limit(1).get();
    if (!preExisting.empty) {
      const userSnap = await userRef.get();
      const balance = userSnap.exists ? ((userSnap.data()?.credits as number | undefined) ?? 0) : 0;
      return NextResponse.json(
        { ok: true, alreadyGranted: true, balance },
        { status: 200 },
      );
    }

    const paymentIntentId =
      typeof stripeSession.payment_intent === 'string'
        ? stripeSession.payment_intent
        : stripeSession.payment_intent?.id || '';
    const amountTotal = stripeSession.amount_total || 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await db.runTransaction(async (tx: any) => {
      // Idempotence intra-TX (Firestore query inside TX requires read-only set).
      const existing = await tx.get(
        txnsCol.where('stripeSessionId', '==', sessionId).limit(1),
      );
      if (!existing.empty) {
        const userSnap = await tx.get(userRef);
        const bal = userSnap.exists ? ((userSnap.data()?.credits as number | undefined) ?? 0) : 0;
        return { alreadyGranted: true as const, balance: bal };
      }

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { error: 'user-not-found', status: 404 } as const;
      }
      const current = (userSnap.data()?.credits as number | undefined) ?? 0;

      // Grant credits.
      tx.update(userRef, {
        credits: FieldValue.increment(creditsToGrant),
        lastPaymentId: paymentIntentId || sessionId,
        lastPaymentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Transaction record (cohérent handlePaymentSuccess — schéma identique
      // pour qu'un éventuel webhook tardif détecte l'idempotence et skip).
      const txRef = txnsCol.doc();
      tx.set(txRef, {
        transactionId: txRef.id,
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
        userId: uid,
        type: packageId === 'partner_monthly' ? 'partner_subscription' : 'credit_purchase',
        amount: amountTotal,
        currency: 'CHF',
        paymentMethod: 'card',
        status: 'succeeded',
        metadata: meta,
        package: packageId,
        creditsGranted: creditsToGrant,
        source: 'client-fallback', // distingue webhook vs filet de sécurité client
        createdAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
      });

      // Credit log (cohérent handlePaymentSuccess).
      const creditRef = creditsCol.doc();
      tx.set(creditRef, {
        creditId: creditRef.id,
        userId: uid,
        type: 'purchase',
        amount: creditsToGrant,
        balance: current + creditsToGrant,
        description: `Achat ${creditsToGrant} crédit(s)`,
        relatedId: txRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true as const,
        granted: creditsToGrant,
        newBalance: current + creditsToGrant,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if ('alreadyGranted' in result) {
      return NextResponse.json(
        { ok: true, alreadyGranted: true, balance: result.balance },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        alreadyGranted: false,
        granted: result.granted,
        newBalance: result.newBalance,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/credits/grant] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
