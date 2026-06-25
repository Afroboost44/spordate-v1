/**
 * Boost Checkout API — Create Stripe Checkout session for partner boosts
 * POST: Creates a one-time payment session for a boost
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';
import { safeStripeProductName } from '@/lib/stripe/safeProductName';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BOOST_PRICES: Record<string, { price: number; label: string; description: string }> = {
  '24h': { price: 1500, label: 'Boost 24h', description: 'Visibilité boostée pendant 24 heures' },
  '3d':  { price: 3500, label: 'Boost 3 jours', description: 'Visibilité boostée pendant 3 jours' },
  '7d':  { price: 5000, label: 'Boost 1 semaine', description: 'Visibilité boostée pendant 1 semaine' },
};

export async function POST(request: NextRequest) {
  try {
    // Phase 9.5 c33 BUG#4 — Bearer auth + forcer partnerId = uid (cohérent
    // Activity.partnerId = user.uid côté partner/offers, et empêche un partner
    // d'acheter un boost pour un autre partner).
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const { duration, city, country, activityId } = await request.json();

    if (!duration || !BOOST_PRICES[duration]) {
      return NextResponse.json({ error: 'Durée invalide' }, { status: 400 });
    }
    if (!city) {
      return NextResponse.json({ error: 'Ville requise' }, { status: 400 });
    }
    // BUG #69 — activityId obligatoire désormais (boost par activité). Si absent,
    // refus côté API pour forcer le client à passer la valeur (le form l'envoie déjà).
    if (!activityId || typeof activityId !== 'string') {
      return NextResponse.json(
        { error: 'activity-required', detail: 'Choisis l\'activité à booster.' },
        { status: 400 },
      );
    }

    const partnerId = uid;

    // Phase 9.5 c35 BUG5 — Idempotence métier AVANT redirect Stripe : 1 seul
    // boost actif par (partnerId, city). Évite que le partner paie avant
    // d'être refusé côté webhook. Symétrique au check dans /api/boost-credits.
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
    const adminDb = getFirestore();

    // BUG #69 — Validation : l'activity doit exister + appartenir au partner.
    // Empêche un partner de booster une activité d'un autre compte.
    const activitySnap = await adminDb.collection('activities').doc(activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json(
        { error: 'activity-not-found', detail: 'Activité introuvable.' },
        { status: 404 },
      );
    }
    const activityData = activitySnap.data();
    if (activityData?.partnerId !== partnerId) {
      return NextResponse.json(
        { error: 'activity-not-owned', detail: 'Cette activité ne t\'appartient pas.' },
        { status: 403 },
      );
    }

    // BUG #69 — Idempotence métier : 1 seul boost actif par
    // (partnerId, activityId, city). Permet désormais de booster plusieurs
    // activités dans la même ville (avant : 1 par city pour tout le compte).
    const activeBoostsSnap = await adminDb
      .collection('boosts')
      .where('partnerId', '==', partnerId)
      .where('active', '==', true)
      .where('city', '==', city)
      .get();
    const nowMs = Date.now();
    const hasActive = activeBoostsSnap.docs.some((d) => {
      const data = d.data();
      // Si le boost existant cible une AUTRE activity (ou n'a pas d'activityId =
      // legacy), on autorise un nouveau boost pour activityId courant.
      if (data.activityId && data.activityId !== activityId) return false;
      const exp = data.expiresAt;
      const expMs =
        typeof exp?.toMillis === 'function'
          ? exp.toMillis()
          : exp instanceof Date
            ? exp.getTime()
            : 0;
      return expMs > nowMs;
    });
    if (hasActive) {
      return NextResponse.json(
        {
          error: 'already-boosted',
          detail: `Cette activité est déjà boostée pour ${city}. Attends son expiration ou choisis une autre activité/ville.`,
        },
        { status: 409 },
      );
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
      // TODO(twint): réactiver TWINT quand l'éligibilité Stripe du compte est OK
      // (restaurer ['card', 'twint']). 'card' inclut Apple Pay / Google Pay.
      payment_method_types: ['card'],
      mode: 'payment',
      success_url: `${baseUrl}/partner/boost?status=success&session_id={CHECKOUT_SESSION_ID}&duration=${duration}&city=${encodeURIComponent(city)}`,
      cancel_url: `${baseUrl}/partner/boost?status=cancel`,
      line_items: [{
        price_data: {
          currency: 'chf',
          product_data: {
            // Anti-régression Stripe "product_data[name] cannot be empty".
            // boost.label vient d'un dict statique BOOST_PRICES donc non-vide
            // en pratique, mais on passe par le helper pour rester cohérent
            // et survivre à une future refonte du dict (ex. chargé Firestore).
            name: safeStripeProductName({
              title: `${boost.label} — ${locationLabel}`,
              fallback: 'Boost Spordateur',
            }),
            description: boost.description,
          },
          unit_amount: boost.price,
        },
        quantity: 1,
      }],
      metadata: {
        type: 'boost',
        partnerId,
        // BUG #69 — activityId persisté dans metadata. Lu par le webhook
        // handleBoostPayment qui l'écrit dans le doc boosts/{id} après payment.
        activityId,
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
