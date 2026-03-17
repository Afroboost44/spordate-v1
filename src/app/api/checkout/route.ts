/**
 * Spordateur V2 — Checkout API
 * Session Stripe Checkout : TWINT + Card + Apple Pay (CHF)
 * Supports: credit packages + premium subscriptions + partner subscriptions
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// All packages (amounts in CHF centimes)
const PACKAGES: Record<string, {
  price: number;
  credits: number;
  label: string;
  description: string;
  type: 'one_time' | 'subscription';
  interval?: 'month' | 'year';
  features?: string[];
}> = {
  // Test package (remove before production)
  'test_1chf': { price: 100, credits: 1, label: 'Test 1 CHF', description: 'Package de test — 1 CHF', type: 'one_time' },

  // Credit packages (one-time)
  '1_date':   { price: 1000,  credits: 1,  label: '1 Sport Date',  description: '1 crédit Sport Date', type: 'one_time' },
  '3_dates':  { price: 2500,  credits: 3,  label: '3 Sport Dates', description: '3 crédits Sport Date — le plus populaire', type: 'one_time' },
  '10_dates': { price: 6000,  credits: 10, label: '10 Sport Dates', description: '10 crédits Sport Date — meilleur rapport', type: 'one_time' },

  // Premium user subscriptions
  'premium_monthly': {
    price: 1990, credits: 5, label: 'Spordate Premium',
    description: 'Abonnement Premium mensuel — Matching illimité + 5 crédits/mois',
    type: 'subscription', interval: 'month',
    features: ['Matching illimité', '5 crédits/mois', 'Profil mis en avant', 'Chat illimité', 'Pas de pub'],
  },
  'premium_yearly': {
    price: 14900, credits: 60, label: 'Spordate Premium Annuel',
    description: 'Abonnement Premium annuel — Économisez 37% + 60 crédits',
    type: 'subscription', interval: 'year',
    features: ['Matching illimité', '60 crédits/an', 'Profil mis en avant', 'Chat illimité', 'Pas de pub', 'Badge exclusif'],
  },

  // Partner subscription
  'partner_monthly': {
    price: 4900, credits: 0, label: 'Partenaire Pro',
    description: 'Abonnement partenaire mensuel',
    type: 'subscription', interval: 'month',
  },
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

    const isSubscription = pkg.type === 'subscription';
    const isPremium = packageId.startsWith('premium_');

    // Determine success/cancel URLs based on package type
    const successUrl = isPremium
      ? `${baseUrl}/premium?status=success&session_id={CHECKOUT_SESSION_ID}`
      : `${baseUrl}/payment?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = isPremium
      ? `${baseUrl}/premium?status=cancel`
      : `${baseUrl}/payment?status=cancel`;

    // TWINT + Card natively supported for CHF
    const paymentMethodTypes: ('card' | 'twint')[] = ['card', 'twint'];

    const sessionParams: Record<string, unknown> = {
      payment_method_types: paymentMethodTypes,
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        packageId,
        creditsToGrant: String(pkg.credits),
        matchId: matchId || '',
        referralCode: referralCode || '',
        isPremium: isPremium ? 'true' : 'false',
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
          recurring: { interval: pkg.interval || 'month' },
        },
        quantity: 1,
      }];
      // Pass subscription metadata for renewal tracking
      sessionParams.subscription_data = {
        metadata: {
          userId,
          packageId,
          isPremium: isPremium ? 'true' : 'false',
        },
      };
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
      type: pkg.type,
      interval: pkg.interval,
    })),
    paymentMethods: ['card', 'twint', 'apple_pay'],
    currency: 'CHF',
  });
}
