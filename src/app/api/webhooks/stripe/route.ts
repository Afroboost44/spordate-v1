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
} from './handler';

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
  const obj = (event.data as Record<string, unknown>).object as Record<string, unknown>;

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
