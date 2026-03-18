/**
 * Spordateur V2 — Checkout API
 * Session Stripe Checkout : TWINT + Card + Apple Pay (CHF)
 * Supports: credit packages + premium subscriptions + partner subscriptions
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Default packages (amounts in CHF centimes) — can be overridden by Firestore settings/pricing
const DEFAULT_PACKAGES: Record<string, {
  price: number;
  credits: number;
  label: string;
  description: string;
  type: 'one_time' | 'subscription';
  interval?: 'month' | 'year';
  isActive?: boolean;
}> = {
  'test_1chf': { price: 100, credits: 1, label: 'Test 1 CHF', description: 'Package de test — 1 CHF', type: 'one_time' },
  '1_date':   { price: 1000,  credits: 1,  label: 'Starter',  description: '1 crédit Sport Date', type: 'one_time' },
  '3_dates':  { price: 2500,  credits: 3,  label: 'Populaire', description: '3 crédits Sport Date', type: 'one_time' },
  '10_dates': { price: 6000,  credits: 10, label: 'Premium', description: '10 crédits Sport Date', type: 'one_time' },
  'premium_monthly': { price: 1990, credits: 5, label: 'Premium Mensuel', description: 'Abonnement Premium mensuel', type: 'subscription', interval: 'month' },
  'premium_yearly': { price: 14900, credits: 60, label: 'Premium Annuel', description: 'Abonnement Premium annuel', type: 'subscription', interval: 'year' },
  'partner_monthly': { price: 4900, credits: 0, label: 'Partenaire Pro', description: 'Abonnement partenaire mensuel', type: 'subscription', interval: 'month' },
};

/** Load packages from Firestore settings (admin-editable) or fall back to defaults */
async function loadPackages(): Promise<typeof DEFAULT_PACKAGES> {
  try {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (!getApps().length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        const { cert } = await import('firebase-admin/app');
        initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
      } else {
        initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
      }
    }
    const db = getFirestore();
    const snap = await db.collection('settings').doc('pricing').get();
    if (snap.exists) {
      const data = snap.data();
      if (data?.packages) {
        // Merge admin pricing into defaults
        const merged = { ...DEFAULT_PACKAGES };
        for (const [id, pkg] of Object.entries(data.packages as Record<string, any>)) {
          if (merged[id]) {
            merged[id] = { ...merged[id], ...pkg, description: merged[id].description };
            if (pkg.isActive === false) delete merged[id]; // Remove disabled packages
          }
        }
        return merged;
      }
    }
  } catch (err) {
    console.warn('[Checkout] Could not load Firestore pricing, using defaults:', err);
  }
  return DEFAULT_PACKAGES;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { packageId, userId, matchId, referralCode } = body;

    const PACKAGES = await loadPackages();

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

    // TWINT only works with one-time payments, not subscriptions
    const paymentMethodTypes: ('card' | 'twint')[] = isSubscription ? ['card'] : ['card', 'twint'];

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
  const PACKAGES = await loadPackages();
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
