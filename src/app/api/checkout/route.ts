/**
 * Spordateur V2 — Checkout API
 * Session Stripe Checkout : TWINT + Card + Apple Pay (CHF)
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Packages de crédits (montants en centimes CHF)
const PACKAGES: Record<string, { price: number; credits: number; label: string; description: string }> = {
  '1_date':   { price: 1000,  credits: 1,  label: '1 Sport Date',  description: '1 crédit Sport Date' },
  '3_dates':  { price: 2500,  credits: 3,  label: '3 Sport Dates', description: '3 crédits Sport Date — le plus populaire' },
  '10_dates': { price: 6000,  credits: 10, label: '10 Sport Dates', description: '10 crédits Sport Date — meilleur rapport' },
  'partner_monthly': { price: 4900, credits: 0, label: 'Partenaire Pro', description: 'Abonnement partenaire mensuel' },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { packageId, userId, matchId, referralCode } = body;

    if (!packageId || !PACKAGES[packageId]) {
      return NextResponse.json({ error: 'Package invalide' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'userId requis' }, { status: 400 });
    }

    const pkg = PACKAGES[packageId];
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';

    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(apiKey);

    const isSubscription = packageId === 'partner_monthly';

    // TWINT + Card nativement supportés pour CHF
    // Apple Pay est activé automatiquement quand 'card' est dans la liste
    const paymentMethodTypes: ('card' | 'twint')[] = ['card', 'twint'];

    const sessionParams: Record<string, unknown> = {
      payment_method_types: paymentMethodTypes,
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: `${baseUrl}/payment?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payment?status=cancel`,
      metadata: {
        userId,
        packageId,
        creditsToGrant: String(pkg.credits),
        matchId: matchId || '',
        referralCode: referralCode || '',
      },
    };

    if (isSubscription) {
      sessionParams.line_items = [{
        price_data: {
          currency: 'chf',
          product_data: {
            name: pkg.label,
            description: pkg.description,
          },
          unit_amount: pkg.price,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }];
    } else {
      sessionParams.line_items = [{
        price_data: {
          currency: 'chf',
          product_data: {
            name: pkg.label,
            description: pkg.description,
            images: ['https://spordateur.com/logo.png'],
          },
          unit_amount: pkg.price,
        },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams as never);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error: unknown) {
    console.error('[Checkout] Erreur:', error);
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    packages: Object.entries(PACKAGES).map(([id, pkg]) => ({
      id,
      price: `${(pkg.price / 100).toFixed(2)} CHF`,
      credits: pkg.credits,
      label: pkg.label,
    })),
    paymentMethods: ['card', 'twint', 'apple_pay'],
    currency: 'CHF',
  });
}
