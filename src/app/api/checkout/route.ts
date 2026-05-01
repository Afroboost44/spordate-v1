/**
 * Spordateur V2 — Checkout API (optimized)
 * Static imports + package caching for fast cold starts
 *
 * Phase 3 : ajout du mode 'session' à côté du mode 'package' existant.
 * Le mode 'session' achète une session datée (paiement direct CHF + bundle crédits chat).
 * Le mode 'package' (défaut, rétrocompatible) reste inchangé pour l'achat de crédits génériques.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { computePricingTier, isSessionBookable } from '@/services/firestore';
import type { Session, Activity, PricingTierKind } from '@/types/firestore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Static Stripe init (loaded once at module level — no dynamic import)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Lazy Firebase Admin + package cache
let _db: FirebaseFirestore.Firestore | null = null;
let _cachedPackages: typeof DEFAULT_PACKAGES | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

const DEFAULT_PACKAGES: Record<string, {
  price: number; credits: number; label: string;
  description: string; type: 'one_time' | 'subscription';
  interval?: 'month' | 'year'; isActive?: boolean;
}> = {
  'test_1chf': { price: 100, credits: 1, label: 'Test 1 CHF', description: 'Package de test — 1 CHF', type: 'one_time' },
  '1_date':    { price: 1000, credits: 1, label: 'Starter', description: '1 crédit Sport Date', type: 'one_time' },
  '3_dates':   { price: 2500, credits: 3, label: 'Populaire', description: '3 crédits Sport Date', type: 'one_time' },
  '10_dates':  { price: 6000, credits: 10, label: 'Premium', description: '10 crédits Sport Date', type: 'one_time' },
  'premium_monthly': { price: 1990, credits: 5, label: 'Premium Mensuel', description: 'Abonnement Premium mensuel', type: 'subscription', interval: 'month' },
  'premium_yearly':  { price: 14900, credits: 60, label: 'Premium Annuel', description: 'Abonnement Premium annuel', type: 'subscription', interval: 'year' },
  'partner_monthly': { price: 4900, credits: 0, label: 'Partenaire Pro', description: 'Abonnement partenaire mensuel', type: 'subscription', interval: 'month' },
};

async function getDb() {
  if (_db) return _db;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
    }
  }
  _db = getFirestore();
  return _db;
}

async function loadPackages(): Promise<typeof DEFAULT_PACKAGES> {
  // Return cached if fresh
  if (_cachedPackages && Date.now() - _cacheTs < CACHE_TTL) return _cachedPackages;
  try {
    const db = await getDb();
    const snap = await db.collection('settings').doc('pricing').get();
    if (snap.exists) {
      const data = snap.data();
      if (data?.packages) {
        const merged = { ...DEFAULT_PACKAGES };
        for (const [id, pkg] of Object.entries(data.packages as Record<string, any>)) {
          if (merged[id]) {
            const priceCentimes = pkg.priceCHF ? Math.round(pkg.priceCHF * 100) : (pkg.price || merged[id].price);
            merged[id] = { ...merged[id], price: priceCentimes, credits: pkg.credits ?? merged[id].credits, label: pkg.label || merged[id].label };
            if (pkg.isActive === false) delete merged[id];
          }
        }
        _cachedPackages = merged;
        _cacheTs = Date.now();
        return merged;
      }
    }
  } catch (err) {
    console.warn('[Checkout] Firestore pricing error, using defaults:', err);
  }
  _cachedPackages = DEFAULT_PACKAGES;
  _cacheTs = Date.now();
  return DEFAULT_PACKAGES;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Phase 3 : dispatch sur body.mode. Si 'session' → flow nouveau.
    // Sinon (défaut, rétrocompatible) → flow 'package' existant.
    if (body?.mode === 'session') {
      return handleSessionMode(body);
    }

    const { packageId, userId, matchId, referralCode, partnerId } = body;

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
    }

    const PACKAGES = await loadPackages();

    if (!packageId || !PACKAGES[packageId]) {
      return NextResponse.json({ error: 'Package invalide' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'userId requis' }, { status: 400 });
    }

    const pkg = PACKAGES[packageId];
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    const isSubscription = pkg.type === 'subscription';
    const isPremium = packageId.startsWith('premium_');
    const isPartner = packageId === 'partner_monthly';
    const hasMatch = matchId && matchId.length > 0;

    const successUrl = isPartner
      ? `${baseUrl}/partner/login?status=success&session_id={CHECKOUT_SESSION_ID}`
      : isPremium
      ? `${baseUrl}/premium?status=success&session_id={CHECKOUT_SESSION_ID}`
      : hasMatch
      ? `${baseUrl}/chat?payment=success&match=${matchId}&session_id={CHECKOUT_SESSION_ID}`
      : `${baseUrl}/payment?status=success&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl = isPartner
      ? `${baseUrl}/partner/login?status=cancel`
      : isPremium
      ? `${baseUrl}/premium?status=cancel`
      : hasMatch
      ? `${baseUrl}/discovery?payment=cancelled`
      : `${baseUrl}/payment?status=cancel`;

    const paymentMethodTypes: ('card' | 'twint')[] = isSubscription ? ['card'] : ['card', 'twint'];

    const sessionParams: Record<string, unknown> = {
      payment_method_types: paymentMethodTypes,
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId, packageId,
        creditsToGrant: String(pkg.credits),
        matchId: matchId || '',
        referralCode: referralCode || '',
        isPremium: isPremium ? 'true' : 'false',
        partnerId: partnerId || '',
      },
    };

    if (isSubscription) {
      sessionParams.line_items = [{
        price_data: {
          currency: 'chf',
          product_data: { name: pkg.label, description: pkg.description },
          unit_amount: pkg.price,
          recurring: { interval: pkg.interval || 'month' },
        },
        quantity: 1,
      }];
      sessionParams.subscription_data = {
        metadata: { userId, packageId, isPremium: isPremium ? 'true' : 'false', partnerId: partnerId || '' },
      };
    } else {
      sessionParams.line_items = [{
        price_data: {
          currency: 'chf',
          product_data: { name: pkg.label, description: pkg.description, images: ['https://spordateur.com/logo.png'] },
          unit_amount: pkg.price,
        },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams as never);
    return NextResponse.json({ sessionId: session.id, url: session.url });
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
      id, price: `${(pkg.price / 100).toFixed(2)} CHF`, credits: pkg.credits, label: pkg.label, type: pkg.type, interval: pkg.interval,
    })),
    paymentMethods: ['card', 'twint', 'apple_pay'],
    currency: 'CHF',
  });
}

// =============================================================
// Phase 3 — Mode 'session' : achat direct d'une session datée
// =============================================================

/** Body POST attendu pour mode='session'. */
interface SessionCheckoutBody {
  mode: 'session';
  sessionId: string;
  userId: string;
  matchId?: string;
  referralCode?: string;
}

/**
 * Handler du mode 'session' :
 * 1. Lit la session via Admin SDK
 * 2. Recompute tier + price server-side (anti-cheat)
 * 3. Vérifie la session bookable
 * 4. Lit l'activity pour title + chatCreditsBundle
 * 5. Crée la Stripe Checkout session avec metadata enrichie
 *
 * Erreurs renvoyées :
 * - 400 si body invalide
 * - 404 si session/activity introuvable
 * - 409 si session non réservable (pleine, completed, cancelled, passée)
 * - 503 si Stripe non configuré
 * - 500 sur erreur inattendue
 */
async function handleSessionMode(body: Partial<SessionCheckoutBody>): Promise<NextResponse> {
  // 1. Validation
  if (!body.sessionId || !body.userId) {
    return NextResponse.json({ error: 'sessionId et userId requis' }, { status: 400 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
  }

  try {
    const db = await getDb();

    // 2. Lire la session
    const sessionSnap = await db.collection('sessions').doc(body.sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'Session introuvable' }, { status: 404 });
    }
    const session = sessionSnap.data() as unknown as Session;

    // 3. Recompute tier server-side (anti-cheat — on ignore tout amount/tier envoyé par le client)
    const now = new Date();
    if (!isSessionBookable(session, now)) {
      return NextResponse.json(
        {
          error: `Session non réservable (status=${session.status}, ${session.currentParticipants}/${session.maxParticipants})`,
        },
        { status: 409 },
      );
    }
    const { tier, price } = computePricingTier(session, now);

    // 4. Lire l'activity pour title + chatCreditsBundle
    const activitySnap = await db.collection('activities').doc(session.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'Activity introuvable' }, { status: 404 });
    }
    const activity = activitySnap.data() as unknown as Activity;
    const bundleCredits = activity.chatCreditsBundle ?? 50;

    // 5. Construire la session Stripe
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    // TODO Phase 5: change success_url to `/sessions/${body.sessionId}?status=success&session_id={CHECKOUT_SESSION_ID}` once page exists
    const successUrl = `${baseUrl}/dashboard?status=success&sessionId=${body.sessionId}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/dashboard?status=cancel&sessionId=${body.sessionId}`;

    const tierLabel: Record<PricingTierKind, string> = {
      early: 'Early Bird',
      standard: 'Standard',
      last_minute: 'Last Minute',
    };

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'twint'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: 'chf',
            product_data: {
              name: session.title,
              description: `${tierLabel[tier]} • Inclut ${bundleCredits} crédits chat`,
              images: ['https://spordateur.com/logo.png'],
            },
            unit_amount: price, // SERVER-recomputed (centimes CHF)
          },
          quantity: 1,
        },
      ],
      metadata: {
        mode: 'session',
        sessionId: body.sessionId,
        userId: body.userId,
        matchId: body.matchId || '',
        referralCode: body.referralCode || '',
        tier,
        amount: String(price),
        activityId: session.activityId,
        partnerId: session.partnerId,
        bundleCredits: String(bundleCredits),
      },
    });

    return NextResponse.json({ sessionId: stripeSession.id, url: stripeSession.url });
  } catch (error: unknown) {
    console.error('[Checkout session] Erreur:', error);
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
