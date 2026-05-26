/**
 * Spordateur V2 — Webhook Stripe (route Next.js, thin wrapper)
 *
 * La logique métier est dans `./handler.ts`. Ce fichier route ne contient que
 * POST/GET (contrainte Next.js qui n'autorise que les exports HTTP standards).
 *
 * Phase 3 : `handlePaymentSuccess` dispatche sur metadata.mode='session' (cf. handler.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  handlePaymentSuccess,
  handleExpired,
  handleSubCancelled,
  handleSubUpdated,
  handleInvoicePaid,
  handleInvoiceFailed,
  handleChargeRefunded,
} from './handler';
import {
  claimWebhookEvent,
  markWebhookCompleted,
  markWebhookFailed,
} from '@/lib/stripe/webhookIdempotency';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Record<string, unknown>;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET) as unknown as Record<string, unknown>;
    } else {
      event = JSON.parse(body);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const type = event.type as string;
  const eventId = (event.id as string) || '';
  const obj = (event.data as Record<string, unknown>).object as Record<string, unknown>;

  // Idempotency gate — Stripe rejoue les webhooks (timeout réseau, retry). On
  // claim l'event.id dans Firestore via transaction atomique avant tout
  // traitement métier. Politique souple (cf. webhookIdempotency.ts) :
  //  - completed → skip définitif
  //  - processing → skip (concurrence)
  //  - failed < 10min → skip (cooldown anti-hammering)
  //  - failed >= 10min ET retryCount < MAX → re-processing
  //  - failed ET retryCount >= MAX → skip (blocage manuel requis)
  const claim = await claimWebhookEvent(eventId, type);
  if (claim.alreadyProcessed) {
    // Log différencié selon la raison pour faciliter le monitoring côté Bassi.
    switch (claim.skipReason) {
      case 'completed':
        console.log(
          `[stripe-webhook] event ${eventId} (${type}) skip (completed) — déjà traité avec succès, Stripe peut arrêter`,
        );
        break;
      case 'processing':
        console.log(
          `[stripe-webhook] event ${eventId} (${type}) skip (processing) — un autre worker traite actuellement`,
        );
        break;
      case 'failed_cooldown':
        console.log(
          `[stripe-webhook] event ${eventId} (${type}) skip (cooldown failed, retryCount=${claim.retryCount}) — Stripe retentera après cooldown`,
        );
        break;
      case 'failed_max_retries':
        console.error(
          `[stripe-webhook] event ${eventId} (${type}) skip (max retries atteint, retryCount=${claim.retryCount}) — INTERVENTION MANUELLE REQUISE`,
        );
        break;
      default:
        console.log(
          `[stripe-webhook] event ${eventId} (${type}) skip (status=${claim.existingStatus})`,
        );
    }
    return NextResponse.json({
      received: true,
      idempotent: true,
      status: claim.existingStatus,
      skipReason: claim.skipReason,
    });
  }

  if (claim.isRetry) {
    console.log(
      `[stripe-webhook] event ${eventId} (${type}) retry (failed) — tentative ${claim.retryCount}, cooldown écoulé, re-processing`,
    );
  }

  try {
    switch (type) {
      case 'checkout.session.completed':
        await handlePaymentSuccess(obj, stripe);
        break;
      case 'checkout.session.expired':
        await handleExpired(obj);
        break;
      case 'customer.subscription.deleted':
        await handleSubCancelled(obj);
        break;
      case 'customer.subscription.updated':
        await handleSubUpdated(obj);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(obj);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(obj);
        break;
      case 'charge.refunded':
        // Vague 2 — Stripe a remboursé tout ou partie d'une charge. On reverse
        // au prorata la commission partenaire / parrainage appliquée à
        // l'origine. L'idempotence event.id (vague 1) protège déjà des replays
        // au niveau webhook ; le helper a en plus son propre check par
        // (paymentIntentId, refundId) sur la collection commissionReversals.
        await handleChargeRefunded(obj);
        break;
      default:
        console.log(`[stripe-webhook] event ${eventId} type=${type} non géré (no-op)`);
    }

    await markWebhookCompleted(eventId);
  } catch (err) {
    await markWebhookFailed(eventId, err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] handler crash event=${eventId} type=${type}: ${msg}`);
    // 500 → Stripe retentera. À ce moment, claimWebhookEvent verra status=failed
    // et skip (politique conservatrice à confirmer avec Bassi, cf. helper docstring).
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    webhook: 'stripe-firestore-v2',
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    webhookSecretConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
}
