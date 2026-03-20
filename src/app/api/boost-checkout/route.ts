/**
 * Boost Checkout API — Create Stripe Checkout session for partner boosts
 * POST: Creates a one-time payment session for a boost
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BOOST_PRICES: Record<string, { price: number; label: string; description: string }> = {
  '24h': { price: 1500, label: 'Boost 24h', description: 'Visibilité boostée pendant 24 heures' },
  '3d':  { price: 3500, label: 'Boost 3 jours', description: 'Visibilité boostée pendant 3 jours' },
  '7d':  { price: 5000, label: 'Boost 1 semaine', description: 'Visibilité boostée pendant 1 semaine' },
};

export async function POST(request: NextRequest) {
  try {
    const { duration, city, country, partnerId, userId } = await request.json();

    if (!duration || !BOOST_PRICES[duration]) {
      return NextResponse.json({ error: 'Durée invalide' }, { status: 400 });
    }
    if (!city) {
      return NextResponse.json({ error: 'Ville requise' }, { status: 400 });
    }
    if (!partnerId && !userId) {
      return NextResponse.json({ error: 'partnerId ou userId requis' }, { status: 400 });
    }

    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(apiKey);

    const boost = BOOST_PRICES[duration];
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    const locationLabel = country ? `${city}, ${country}` : city;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'twint'],
      mode: 'payment',
      success_url: `${baseUrl}/partner/boost?status=success&session_id={CHECKOUT_SESSION_ID}&duration=${duration}&city=${encodeURIComponent(city)}`,
      cancel_url: `${baseUrl}/partner/boost?status=cancel`,
      line_items: [{
        price_data: {
          currency: 'chf',
          product_data: {
            name: `${boost.label} — ${locationLabel}`,
            description: boost.description,
          },
          unit_amount: boost.price,
        },
        quantity: 1,
      }],
      metadata: {
        type: 'boost',
        partnerId: partnerId || userId || '',
        duration,
        city,
        country: country || 'Suisse',
        locationLabel,
      },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error('[Boost Checkout]', err);
    return NextResponse.json(
      { error: err.message || 'Erreur lors de la création du paiement' },
      { status: 500 }
    );
  }
}
