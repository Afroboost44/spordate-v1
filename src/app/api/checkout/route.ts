/**
 * Spordateur V2 — Checkout API (optimized)
 * Static imports + package caching for fast cold starts
 *
 * Phase 3 : ajout du mode 'session' à côté du mode 'package' existant.
 * Le mode 'session' achète une session datée (paiement direct CHF + bundle crédits chat).
 * Le mode 'package' (défaut, rétrocompatible) reste inchangé pour l'achat de crédits génériques.
 */
import { NextRequest, NextResponse } from 'next/server';
import { computePricingTier, isSessionBookable } from '@/services/firestore';
import type { Session, Activity, PricingTierKind, Invite } from '@/types/firestore';
import { verifyAuth, parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';
import { getSharedStripe } from '@/lib/stripe/sharedStripe';
import { resolvePaymentMethodTypes } from '@/lib/payment/methodResolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Phase 9 SC2 c3/6 — Stripe via getSharedStripe() (DI seam pour tests, cohérent SC5 c4/5
// refundForSanction + SC2 connectHelpers). Lazy-init préservé.
async function getStripe() {
  return getSharedStripe();
}

// Lazy Firebase Admin + package cache
let _db: FirebaseFirestore.Firestore | null = null;
let _cachedPackages: typeof DEFAULT_PACKAGES | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// BUG #93 — `durationHours` permet aux plans Premium one_time (24h, 1 semaine)
// de transporter une durée d'activation jusqu'au webhook qui calcule
// `premiumExpiresAt = now + durationHours * 3600 * 1000`. Pour les subscriptions
// mensuel/annuel : Stripe gère le cycle via customer.subscription.* events,
// donc `durationHours` reste absent (-> isPremium tant que subscription active).
const DEFAULT_PACKAGES: Record<string, {
  price: number; credits: number; label: string;
  description: string; type: 'one_time' | 'subscription';
  interval?: 'month' | 'year'; isActive?: boolean;
  durationHours?: number;
}> = {
  'test_1chf': { price: 100, credits: 1, label: 'Test 1 CHF', description: 'Package de test — 1 CHF', type: 'one_time' },
  // ----- Legacy packs (conservés pour rétro-compat, désactivables via admin) -----
  '1_date':    { price: 1000, credits: 1, label: 'Starter (legacy)', description: '1 crédit Sport Date', type: 'one_time' },
  '3_dates':   { price: 2500, credits: 3, label: 'Populaire (legacy)', description: '3 crédits Sport Date', type: 'one_time' },
  '10_dates':  { price: 6000, credits: 10, label: 'Premium (legacy)', description: '10 crédits Sport Date', type: 'one_time' },
  'premium_monthly': { price: 1990, credits: 5, label: 'Premium Mensuel (legacy)', description: 'Abonnement Premium mensuel', type: 'subscription', interval: 'month' },
  'premium_yearly':  { price: 14900, credits: 60, label: 'Premium Annuel (legacy)', description: 'Abonnement Premium annuel', type: 'subscription', interval: 'year' },
  'partner_monthly': { price: 4900, credits: 0, label: 'Partenaire Pro', description: 'Abonnement partenaire mensuel', type: 'subscription', interval: 'month' },

  // ----- BUG #93 — Nouveaux packs crédits (PRICING-PROPOSAL.md §3) -----
  // Coûts intra-app : likes premium + boost user + messages chat. JAMAIS pour réserver
  // une activité (qui se paye en Stripe direct via mode='session').
  'pack_starter': { price: 490,  credits: 50,   label: 'Starter',  description: '50 crédits Spordateur',   type: 'one_time' },
  'pack_confort': { price: 1190, credits: 150,  label: 'Confort',  description: '150 crédits Spordateur — économise 20%',  type: 'one_time' },
  'pack_pro':     { price: 2990, credits: 500,  label: 'Pro',      description: '500 crédits Spordateur — économise 40%',  type: 'one_time' },
  'pack_vip':     { price: 6990, credits: 1500, label: 'VIP',      description: '1500 crédits Spordateur — économise 52%', type: 'one_time' },

  // ----- BUG #93 — Abonnements Premium (PRICING-PROPOSAL.md §5) -----
  // 24h + semaine = one_time avec `durationHours` ; mois + an = Stripe subscription.
  'premium_24h':   { price: 490,   credits: 50,  label: 'Premium Flash 24h',        description: 'Accès Premium 24h + 50 crédits offerts',  type: 'one_time', durationHours: 24 },
  'premium_week':  { price: 1490,  credits: 100, label: 'Premium Découverte 1 semaine', description: 'Accès Premium 7 jours + 100 crédits',    type: 'one_time', durationHours: 24 * 7 },
  'premium_month': { price: 2990,  credits: 200, label: 'Premium Standard 1 mois',  description: 'Premium mensuel + 200 crédits / mois',   type: 'subscription', interval: 'month' },
  'premium_year':  { price: 19990, credits: 250, label: 'Premium Fidélité 1 an',    description: 'Premium annuel + 250 crédits / mois (16.65 CHF/mois)', type: 'subscription', interval: 'year' },
};

async function getDb() {
  if (_db) return _db;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
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

    // Phase 9.5 c7 : session-free flow (activité gratuite, skip Stripe + grant freeActivityBundle)
    if (body?.mode === 'session-free') {
      return handleSessionFreeMode(request, body);
    }

    // Phase 8 SC4 commit 3/6 : invite-accept flow (B accepte invitation A → Stripe checkout B)
    if (body?.mode === 'invite-accept') {
      return handleInviteAcceptMode(request, body);
    }

    // Phase 9 SC2 commit 3/6 : invite-prepay flow (A pré-paye sa part Split/Gift)
    if (body?.mode === 'invite-prepay') {
      return handleInvitePrepayMode(request, body);
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
      ? `${baseUrl}/activities?payment=cancelled`
      : `${baseUrl}/payment?status=cancel`;

    const paymentMethodTypes: ('card' | 'twint')[] = isSubscription ? ['card'] : ['card', 'twint'];

    // BUG #93 — `durationHours` propagé jusqu'au webhook pour les Premium
    // one_time (24h, 1 semaine). Le webhook calcule
    // `users/{uid}.premiumExpiresAt = now + durationHours * 3600_000` et active
    // isPremium=true. Pour les subscriptions month/year : Stripe gère le cycle.
    const durationHours = (pkg as { durationHours?: number }).durationHours;

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
        // BUG #93 — durée d'activation Premium (one_time uniquement)
        premiumDurationHours: durationHours ? String(durationHours) : '',
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

    const session = await (await getStripe()).checkout.sessions.create(sessionParams as never);
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
  /** Phase 9.5 c45 — flag Duo (×2 unit_amount + ×2 seats). */
  isDuoTicket?: boolean;
  /** Phase 9.5 c47 BUG B — uid invité Duo (match Tinder). Passé en metadata
   *  Stripe → webhook handleSessionPayment crée 2e booking + notification. */
  inviteeUid?: string;
  /** BUG #15 — préférence UI : 'card' force Stripe à n'afficher que Carte,
   *  'twint' force TWINT only, absent/'all' = legacy ['card','twint']. */
  paymentMethodPreference?: 'card' | 'twint' | 'all';
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

    // Phase 9.5 c29a CH3 — Guard sécurité : refuser paiement si pricingTiers vide.
    // Sans ce filet, computePricingTier renverrait price=0 (silently "free booking"),
    // ce qui contredit l'attente partner (Activity.price > 0). La migration script
    // CH2 doit avoir purgé les sessions legacy, mais on garde le guard en filet.
    if (!session.pricingTiers || session.pricingTiers.length === 0) {
      console.error(`[Checkout] Session ${body.sessionId} has empty pricingTiers — refusing payment`);
      return NextResponse.json(
        { error: 'Session has no pricing configured. Please contact support.' },
        { status: 400 },
      );
    }

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

    // Phase 9 SC6 c2/4 — Audience enforcement defense-in-depth (Q3=A + Q4=A).
    // Server-side double-check pour bypass client tentative (cohérent /api/anti-leak SC2 hotfix).
    // 412 precondition-failed pour gender-required / gender-mismatch.
    if (activity.audienceType && activity.audienceType !== 'all') {
      const userSnap = await db.collection('users').doc(body.userId).get();
      const userProfile = userSnap.exists ? (userSnap.data() as { gender?: string }) : null;
      try {
        const { assertCanBookActivity, AudienceError } = await import('@/lib/audience');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assertCanBookActivity(userProfile?.gender as any, activity.audienceType);
        void AudienceError;
      } catch (err) {
        const { AudienceError } = await import('@/lib/audience');
        if (err instanceof AudienceError) {
          return NextResponse.json(
            { error: err.code, audienceType: activity.audienceType },
            { status: 412 },
          );
        }
        throw err;
      }
    }

    // 5. Construire la session Stripe
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    // BUG #83 — Retour Stripe (success ET cancel) → /sessions/{id} (la page
    // compte à rebours de la séance réservée). Avant : redirigeait vers
    // /dashboard qui est une page mock "Find Your Match" avec activités
    // fictives, ne devrait pas exister en prod. Désormais le user revient
    // sur la séance elle-même avec le status query param.
    const successUrl = `${baseUrl}/sessions/${body.sessionId}?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/activities?status=cancel`;

    const tierLabel: Record<PricingTierKind, string> = {
      early: 'Early Bird',
      standard: 'Standard',
      last_minute: 'Last Minute',
    };

    // Fix #144 — Modèle in-house wallet (lieu de Stripe Connect).
    // Tous les paiements vont sur le compte plateforme Spordateur.
    // La commission + le crédit partner sont calculés et persistés via
    // le webhook checkout.session.completed (cf. handler.ts) qui :
    //   - incrémente partner.balance de (unitAmount - commission)
    //   - incrémente partner.totalRevenue de unitAmount
    //   - incrémente platform.commissionEarned de commission
    // Le partner demande un virement via /partner/wallet → l'admin
    // exécute manuellement le SEPA depuis sa banque.
    //
    // On garde quand même le lookup partnerStripeAccount pour vérifier
    // que le partner existe en Firestore (sinon 412 partner-not-found).
    // L'assertConnectChargesEnabled est SKIPPED — pas besoin de KYC Connect.
    const { getPartnerStripeAccount, ConnectError } = await import(
      '@/lib/stripe/connectHelpers'
    );
    let partnerStripeAccount: string | null = null;
    try {
      partnerStripeAccount = await getPartnerStripeAccount(session.partnerId);
    } catch (err) {
      if (err instanceof ConnectError && err.code === 'partner-not-found') {
        return NextResponse.json(
          { error: err.code, partnerId: session.partnerId },
          { status: 412 },
        );
      }
      // 'partner-not-onboarded' (stripeAccountId absent) est OK en mode in-house.
      console.log('[checkout] in-house wallet mode — partner sans Stripe Connect, OK');
    }
    // Phase 9.5 c45 BUG 1 — flag Duo multiplie unit_amount + bundleCredits ×2.
    // Le Stripe checkout affiche un seul line_item avec amount = price × seats.
    const isDuo = body.isDuoTicket === true;
    const seats = isDuo ? 2 : 1;
    const unitAmount = price * seats;
    const grantedCredits = bundleCredits * seats;

    const { getApplicationFeePct } = await import('@/lib/invites/splitMath');
    const feePct = getApplicationFeePct();
    const applicationFeeAmount = Math.round((unitAmount * feePct) / 100);

    // Fix #144 — En mode in-house wallet, on ne split PLUS via transfer_data.
    // L'argent reste sur la plateforme. Le webhook handler crédite manuellement
    // partner.balance avec (unitAmount - applicationFeeAmount).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paymentIntentData: Record<string, any> = {};

    // BUG #15 — la préférence UI (onglet Carte vs TWINT) détermine quel
    // paymentMethod Stripe Checkout affiche à l'utilisateur. Absent/'all'
    // → legacy ['card','twint'] (rétrocompat avec call sites qui n'envoient
    // pas encore de préférence).
    const paymentMethodTypes = resolvePaymentMethodTypes(body.paymentMethodPreference);

    const stripeSession = await (await getStripe()).checkout.sessions.create({
      mode: 'payment',
      payment_method_types: paymentMethodTypes,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: 'chf',
            product_data: {
              name: isDuo ? `${session.title} (Duo — 2 places)` : session.title,
              description: `${tierLabel[tier]} • ${seats} place${seats > 1 ? 's' : ''} • ${grantedCredits} crédits chat inclus`,
              images: ['https://spordateur.com/logo.png'],
            },
            unit_amount: unitAmount, // SERVER-recomputed (centimes CHF) × seats Duo
          },
          quantity: 1,
        },
      ],
      payment_intent_data: paymentIntentData,
      metadata: {
        mode: 'session',
        sessionId: body.sessionId,
        userId: body.userId,
        matchId: body.matchId || '',
        referralCode: body.referralCode || '',
        tier,
        amount: String(unitAmount),
        seats: String(seats),
        isDuoTicket: isDuo ? 'true' : 'false',
        // Phase 9.5 c47 BUG B — uid invité Duo lu par webhook pour créer 2e booking + notif
        inviteeUid: body.inviteeUid || '',
        activityId: session.activityId,
        partnerId: session.partnerId,
        bundleCredits: String(grantedCredits),
        applicationFeeAmount: String(applicationFeeAmount),
        // Fix #144 — partnerStripeAccount peut être null en mode in-house wallet
        // (partner sans Connect onboarding). On stocke '' pour Stripe metadata.
        partnerStripeAccount: partnerStripeAccount || '',
        paymentMethodPreference: body.paymentMethodPreference || 'all',
      },
    });

    return NextResponse.json({ sessionId: stripeSession.id, url: stripeSession.url });
  } catch (error: unknown) {
    console.error('[Checkout session] Erreur:', error);
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// =====================================================================
// Phase 9.5 c7 — handleSessionFreeMode (activité gratuite, skip Stripe)
// =====================================================================

interface SessionFreeBody {
  activityId: string;
  sessionId?: string;
  userId: string;
}

/**
 * Phase 9.5 c7 — Reservation activité gratuite (price === 0).
 *
 * Pipeline :
 *   1. Verify Bearer auth → uid (must equal body.userId)
 *   2. Load activity → assert price === 0 (sinon 400 ; reroute vers mode='session')
 *   3. Anti-abus 24h cooldown : query bookings where userId+activityId+createdAt within 24h → 429
 *   4. Audience check (cohérent mode='session' Q3=A + Q4=A SC6)
 *   5. runTransaction Admin SDK : create Booking (status='confirmed', amount=0, paymentIntentId='free-{ts}')
 *      + grant freeActivityBundle credits
 *      + log creditTransactions {source:'free_booking_bundle'}
 *   6. Best-effort sendEmail bookingConfirmation
 *   7. Return { bookingId, sessionId? }
 *
 * Anti-abus : 1 réservation gratuite / activity / user / 24h (Q1 vote).
 *
 * @returns 200 { ok:true, bookingId } / 400 invalid / 401 unauth / 404 activity / 412 audience / 429 cooldown
 */
async function handleSessionFreeMode(
  request: NextRequest,
  body: Partial<SessionFreeBody>,
): Promise<NextResponse> {
  if (!body.activityId || !body.userId) {
    return NextResponse.json(
      { error: 'invalid-input', detail: 'activityId + userId required' },
      { status: 400 },
    );
  }

  // Verify Bearer ID token (cohérent invite-accept)
  const authedUid = await verifyAuth(request);
  if (!authedUid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (authedUid !== body.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const db = await getDb();
    const activitySnap = await db.collection('activities').doc(body.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() as unknown as Activity;

    // Assert free
    if (typeof activity.price !== 'number' || activity.price !== 0) {
      return NextResponse.json(
        { error: 'not-free-activity', detail: 'use mode=session for paid activities' },
        { status: 400 },
      );
    }

    // Anti-abus 24h cooldown : same user + activity within last 24h
    // Composite index requis : bookings(userId ASC, activityId ASC, createdAt DESC)
    // → cf firestore.indexes.json. Si manquant en prod (live deploy gap), Admin SDK throw
    // FAILED_PRECONDITION code 9 → on map en 503 'index-not-ready' UX gracieuse.
    //
    // ⚠️ orderBy('createdAt','desc') OBLIGATOIRE : sans cet orderBy explicite,
    // Firestore applique implicit orderBy ASC sur le champ inequality (createdAt) →
    // mismatch avec l'index DESC déployé → FAILED_PRECONDITION même quand l'index existe.
    // Ref Firestore docs : "Range and array filters require composite index" §
    // Limit 1 + orderBy desc = on récupère le booking le plus récent (suffisant pour cooldown).
    const { Timestamp } = await import('firebase-admin/firestore');
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    let recentBookings;
    try {
      recentBookings = await db
        .collection('bookings')
        .where('userId', '==', body.userId)
        .where('activityId', '==', body.activityId)
        .where('createdAt', '>=', Timestamp.fromMillis(cutoffMs))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
    } catch (queryErr) {
      const msg = queryErr instanceof Error ? queryErr.message : String(queryErr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (queryErr as any)?.code;
      if (
        code === 9 ||
        code === 'failed-precondition' ||
        msg.includes('FAILED_PRECONDITION') ||
        msg.includes('requires an index')
      ) {
        console.warn('[handleSessionFreeMode] Firestore composite index manquant', { msg });
        return NextResponse.json(
          {
            error: 'index-not-ready',
            detail: 'Système en cours de mise à jour, réessaie dans 1 minute.',
          },
          { status: 503 },
        );
      }
      throw queryErr;
    }
    if (!recentBookings.empty) {
      // Phase 9.5 c15 BUG A — retourne existingBookingId pour redirect UX direct
      // (au lieu d'un toast destructif qui perd l'accès à la réservation existante).
      const existingBookingId = recentBookings.docs[0].id;
      return NextResponse.json(
        {
          error: 'cooldown-active',
          detail: '1 réservation gratuite par activité par 24h',
          existingBookingId,
        },
        { status: 429 },
      );
    }

    // Audience check (cohérent mode='session' SC6)
    if (activity.audienceType && activity.audienceType !== 'all') {
      const userSnap = await db.collection('users').doc(body.userId).get();
      const userProfile = userSnap.exists ? (userSnap.data() as { gender?: string }) : null;
      try {
        const { assertCanBookActivity, AudienceError } = await import('@/lib/audience');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assertCanBookActivity(userProfile?.gender as any, activity.audienceType);
        void AudienceError;
      } catch (err) {
        const { AudienceError } = await import('@/lib/audience');
        if (err instanceof AudienceError) {
          return NextResponse.json(
            { error: err.code, audienceType: activity.audienceType },
            { status: 412 },
          );
        }
        throw err;
      }
    }

    // Compute bundled credits (per-activity override OR central rules freeActivityBundle)
    const { computeBundledCredits } = await import('@/lib/billing/creditRules');
    const bundleCredits = computeBundledCredits(activity);

    // Phase 9.5 c8 BUG 2 — activity.title peut être undefined (legacy: champ name).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activityLabel = activity.title || (activity as any).name || 'Activité gratuite';

    // runTransaction : create booking + grant credits + creditTransaction log
    const { FieldValue } = await import('firebase-admin/firestore');
    const bookingRef = db.collection('bookings').doc();
    const bookingId = bookingRef.id;
    const paymentIntentId = `free-${Date.now()}-${bookingId}`;

    // Phase 9.5 c11 — si activity.scheduledAt défini, créer ALSO une Session
    // avec id = bookingId pour que /sessions/{bookingId} affiche countdown +
    // SessionHero au lieu du fallback BookingPendingHero.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduledAtRaw = (activity as any).scheduledAt as
      | FirebaseFirestore.Timestamp
      | null
      | undefined;
    let scheduledAtTs: FirebaseFirestore.Timestamp | null = null;
    if (scheduledAtRaw) {
      // Defensive : Firestore peut renvoyer un Timestamp OU un objet Date OU null.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = scheduledAtRaw as any;
      if (typeof raw.toMillis === 'function') {
        scheduledAtTs = raw as FirebaseFirestore.Timestamp;
      } else if (raw instanceof Date) {
        scheduledAtTs = Timestamp.fromDate(raw);
      }
    }
    const willCreateSession = scheduledAtTs !== null;
    const durationMinutes = typeof activity.duration === 'number' && activity.duration > 0
      ? activity.duration
      : 60;
    const chatOpenOffsetMinutes = activity.chatOpenOffsetMinutes ?? 120;

    const sessionId = willCreateSession ? bookingId : (body.sessionId || '');
    const sessionRef = willCreateSession
      ? db.collection('sessions').doc(bookingId)
      : null;

    await db.runTransaction(async (tx) => {
      // Booking doc
      tx.set(bookingRef, {
        bookingId,
        userId: body.userId,
        userName: '',
        matchId: '',
        activityId: body.activityId,
        partnerId: activity.partnerId,
        sport: activity.sport,
        ticketType: 'solo',
        sessionDate: scheduledAtTs ?? activity.createdAt ?? Timestamp.now(),
        status: 'confirmed',
        transactionId: '',
        amount: 0,
        currency: 'CHF',
        creditsUsed: 0,
        sessionId,
        paymentIntentId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Grant credits
      tx.update(db.collection('users').doc(body.userId!), {
        credits: FieldValue.increment(bundleCredits),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Audit log creditTransactions
      const ctRef = db.collection('creditTransactions').doc();
      tx.set(ctRef, {
        creditId: ctRef.id,
        userId: body.userId,
        type: 'purchase',
        amount: bundleCredits,
        description: `Free booking bundle — ${activityLabel}`,
        relatedId: bookingId,
        source: 'free_booking_bundle',
        activityId: body.activityId,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Phase 9.5 c11 — Session auto-créée pour countdown si scheduledAt défini
      if (sessionRef && scheduledAtTs) {
        const startMs = scheduledAtTs.toMillis();
        const endMs = startMs + durationMinutes * 60_000;
        const chatOpenMs = startMs - chatOpenOffsetMinutes * 60_000;
        const chatCloseMs = endMs + 30 * 60_000;
        tx.set(sessionRef, {
          sessionId: bookingId,
          activityId: body.activityId,
          partnerId: activity.partnerId,
          creatorId: activity.partnerId,
          sport: activity.sport,
          title: activityLabel,
          city: activity.city || '',
          startAt: scheduledAtTs,
          endAt: Timestamp.fromMillis(endMs),
          chatOpenAt: Timestamp.fromMillis(chatOpenMs),
          chatCloseAt: Timestamp.fromMillis(chatCloseMs),
          maxParticipants: activity.maxParticipants || 10,
          currentParticipants: 1,
          pricingTiers: [],
          currentTier: 'early',
          currentPrice: 0,
          status: 'open',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    // Best-effort email confirmation (Fix #156/#157 i18n — propagate user.language)
    try {
      const { sendEmail } = await import('@/lib/email/sendEmail');
      const { pickUserLang } = await import('@/lib/i18n/getUserLang');
      const userSnap = await db.collection('users').doc(body.userId).get();
      const userData = userSnap.data();
      const userEmail = userData?.email as string | undefined;
      const userName = (userData?.displayName as string | undefined) || 'Hello';
      const lang = pickUserLang(userData ?? null);
      if (userEmail) {
        await sendEmail({
          to: userEmail,
          templateName: 'bookingConfirmation',
          templateData: {
            customerName: userName,
            sessionTitle: activityLabel,
            sessionDate: '',
            partnerName: activity.partnerName || '',
            amount: 0,
            bookingId,
          },
          lang,
        });
      }
    } catch (err) {
      console.warn('[handleSessionFreeMode] sendEmail failed (non-blocking)', err);
    }

    return NextResponse.json(
      { ok: true, bookingId, creditsGranted: bundleCredits },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error('[handleSessionFreeMode] Erreur:', error);
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Phase 8 SC4 commit 3/6 — handleInviteAcceptMode.
 *
 * Pipeline : verify Bearer ID token → load invite via Admin SDK → verify status='pending'
 * + auth.uid==invite.toUserId + not expired → load session pour pricing → recompute tier
 * server-side (anti-cheat cohérent handleSessionMode) → Stripe checkout avec metadata
 * mode='invite-accept' (webhook commit 4/6 consume → update Invite.status='accepted'
 * + create Booking + notify fromUserId).
 *
 * Errors HTTP :
 *   - missing Bearer → 401
 *   - invalid input → 400
 *   - invite not found → 404
 *   - status != pending → 409 (idempotency)
 *   - forbidden (auth ≠ toUserId) → 403
 *   - expired → 410
 *   - session-too-soon / session not bookable → 409
 */
async function handleInviteAcceptMode(
  request: NextRequest,
  body: { mode: string; inviteId?: unknown },
): Promise<NextResponse> {
  // Verify Bearer
  const callerUid = await verifyAuth(request);
  if (!callerUid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Validate body
  if (typeof body.inviteId !== 'string' || body.inviteId.length === 0) {
    return NextResponse.json(
      { error: 'invalid-input', detail: 'inviteId required' },
      { status: 400 },
    );
  }
  const inviteId = body.inviteId;

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
  }

  try {
    const db = await getDb();

    // Load invite
    const inviteSnap = await db.collection('invites').doc(inviteId).get();
    if (!inviteSnap.exists) {
      return NextResponse.json({ error: 'invite-not-found' }, { status: 404 });
    }
    const invite = inviteSnap.data() as unknown as Invite;

    // Status check (idempotency)
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'invalid-status', detail: `Invite status='${invite.status}', expected 'pending'` },
        { status: 409 },
      );
    }

    // Auth match check
    if (invite.toUserId !== callerUid) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'Only toUserId can accept this invite' },
        { status: 403 },
      );
    }

    // Expiration check
    const expiresAtMs = invite.expiresAt.toMillis();
    if (expiresAtMs <= Date.now()) {
      return NextResponse.json({ error: 'expired' }, { status: 410 });
    }

    // Load session pour pricing (anti-cheat recompute)
    if (!invite.sessionId) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'Invite has no sessionId' },
        { status: 400 },
      );
    }
    const sessionSnap = await db.collection('sessions').doc(invite.sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const session = sessionSnap.data() as unknown as Session;

    // Phase 9.5 c29a CH3 — Guard pricingTiers vide (cf. branche session ci-dessus).
    if (!session.pricingTiers || session.pricingTiers.length === 0) {
      console.error(`[Checkout/invite-accept] Session ${invite.sessionId} has empty pricingTiers — refusing payment`);
      return NextResponse.json(
        { error: 'session-no-pricing', detail: 'Session has no pricing configured' },
        { status: 400 },
      );
    }

    const now = new Date();
    if (!isSessionBookable(session, now)) {
      return NextResponse.json(
        {
          error: 'session-not-bookable',
          detail: `status=${session.status}, ${session.currentParticipants}/${session.maxParticipants}`,
        },
        { status: 409 },
      );
    }
    const { tier, price } = computePricingTier(session, now);

    // Load activity pour title + chatCreditsBundle
    const activitySnap = await db.collection('activities').doc(invite.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() as unknown as Activity;
    const bundleCredits = activity.chatCreditsBundle ?? 50;

    // Build Stripe checkout
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    const successUrl = `${baseUrl}/dashboard?status=success&inviteId=${inviteId}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/invite/${inviteId}?status=cancel`;

    const tierLabel: Record<PricingTierKind, string> = {
      early: 'Early Bird',
      standard: 'Standard',
      last_minute: 'Last Minute',
    };

    // Phase 9 SC2 c3/6 — split mode : B paye splitInviteeAmountCents
    // Phase 9 SC2 c3/6 — gift mode : B ne paye rien (bypass checkout)
    const inviteMode = (invite.mode ?? 'individual') as 'individual' | 'split' | 'gift';

    if (inviteMode === 'gift') {
      // B accept gift : pas de Stripe checkout. Délégué à /api/invites/[id]/accept-gift (commit 4/6).
      return NextResponse.json(
        {
          error: 'use-accept-gift-endpoint',
          detail: 'Mode=gift — B doit POST /api/invites/[id]/accept-gift (no Stripe checkout)',
          inviteId,
          mode: 'gift',
        },
        { status: 409 },
      );
    }

    // Compute amount selon mode
    // Fix #144 (extension) — Mode in-house wallet : pas de transfer_data /
    // destination charge Stripe Connect. Le paiement reste sur le compte
    // plateforme Spordateur. Le webhook handler crédite manuellement
    // partner.balance avec (amount - applicationFeeAmount).
    let unitAmount: number = price;
    let descriptionExtra = `Invite de ${invite.fromUserId.slice(0, 8)}`;
    let applicationFeeAmountForMeta = 0;

    if (inviteMode === 'split') {
      const splitInviteeCents = invite.splitInviteeAmountCents ?? 0;
      if (splitInviteeCents <= 0) {
        return NextResponse.json(
          { error: 'invalid-split-amount', detail: 'Invite mode=split mais splitInviteeAmountCents missing' },
          { status: 500 },
        );
      }
      unitAmount = splitInviteeCents;
      descriptionExtra = `Ta part Split (${(splitInviteeCents / 100).toFixed(2)} CHF) • Invite de ${invite.fromUserId.slice(0, 8)}`;

      // Commission Spordateur sur la part B (crédit partner.balance via webhook)
      const { getApplicationFeePct } = await import('@/lib/invites/splitMath');
      const feePct = getApplicationFeePct();
      applicationFeeAmountForMeta = Math.round((unitAmount * feePct) / 100);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkoutParams: any = {
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
              description: `${tierLabel[tier]} • ${descriptionExtra} • Inclut ${bundleCredits} crédits chat`,
              images: ['https://spordateur.com/logo.png'],
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        mode: 'invite-accept',
        inviteId,
        toUserId: invite.toUserId,
        fromUserId: invite.fromUserId,
        sessionId: invite.sessionId,
        activityId: invite.activityId,
        partnerId: session.partnerId,
        tier,
        amount: String(unitAmount),
        bundleCredits: String(bundleCredits),
        inviteMode,
        applicationFeeAmount: String(applicationFeeAmountForMeta),
      },
    };

    const stripeSession = await (await getStripe()).checkout.sessions.create(checkoutParams);

    return NextResponse.json({ sessionId: stripeSession.id, url: stripeSession.url });
  } catch (err) {
    console.error('[Checkout invite-accept] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: 'internal-error', detail: message }, { status: 500 });
  }
}

// =============================================================
// Phase 9 SC2 commit 3/6 — Mode 'invite-prepay' : A pré-paye Split/Gift
// =============================================================

/**
 * Pipeline mode='invite-prepay' :
 *  1. verifyAuth → uid (must equal invite.fromUserId)
 *  2. Load invite Admin SDK + verify status='pending' + invite.mode in ['split', 'gift']
 *  3. Load session + activity + getPartnerStripeAccount + assertConnectChargesEnabled
 *  4. Stripe checkout session avec destination charge + app_fee + idempotencyKey
 *
 * Errors HTTP :
 *  - missing Bearer → 401
 *  - invalid input → 400
 *  - invite not found → 404
 *  - status != pending → 409
 *  - forbidden (auth ≠ fromUserId) → 403
 *  - mode not split/gift (e.g. individual) → 400 invalid-mode-for-prepay
 *  - partner not onboarded → 412
 */
async function handleInvitePrepayMode(
  request: NextRequest,
  body: { mode: string; inviteId?: unknown },
): Promise<NextResponse> {
  const callerUid = await verifyAuth(request);
  if (!callerUid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (typeof body.inviteId !== 'string' || body.inviteId.length === 0) {
    return NextResponse.json(
      { error: 'invalid-input', detail: 'inviteId required' },
      { status: 400 },
    );
  }
  const inviteId = body.inviteId;
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
  }

  try {
    const db = await getDb();
    const inviteSnap = await db.collection('invites').doc(inviteId).get();
    if (!inviteSnap.exists) {
      return NextResponse.json({ error: 'invite-not-found' }, { status: 404 });
    }
    const invite = inviteSnap.data() as unknown as Invite;

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'invalid-status', detail: `Invite status='${invite.status}', expected 'pending'` },
        { status: 409 },
      );
    }
    if (invite.fromUserId !== callerUid) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'Only fromUserId can prepay' },
        { status: 403 },
      );
    }

    const inviteMode = (invite.mode ?? 'individual') as 'individual' | 'split' | 'gift';
    if (inviteMode === 'individual') {
      return NextResponse.json(
        {
          error: 'invalid-mode-for-prepay',
          detail: `Invite mode='individual' n'a pas de prepay (B paye sa part directement)`,
        },
        { status: 400 },
      );
    }

    const inviterCents = invite.splitInviterAmountCents ?? 0;
    if (inviterCents <= 0) {
      return NextResponse.json(
        { error: 'invalid-split-amount', detail: 'splitInviterAmountCents missing or <=0' },
        { status: 500 },
      );
    }

    if (!invite.sessionId) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'Invite has no sessionId' },
        { status: 400 },
      );
    }
    const sessionSnap = await db.collection('sessions').doc(invite.sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const session = sessionSnap.data() as unknown as Session;

    const activitySnap = await db.collection('activities').doc(invite.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() as unknown as Activity;

    // Fix #144 (extension) — Mode in-house wallet : on supprime tout flow
    // Stripe Connect (destination charge + charges_enabled assert). Le paiement
    // de A va sur le compte plateforme Spordateur. Le webhook handler crédite
    // partner.balance avec (inviterCents - applicationFeeAmount) lors du
    // succès. Bassi vire ensuite manuellement via sa banque (workflow temporaire).

    // Application fee Spordateur (Q4=B 5% Phase 9)
    const { getApplicationFeePct } = await import('@/lib/invites/splitMath');
    const feePct = getApplicationFeePct();
    const applicationFeeAmount = Math.round((inviterCents * feePct) / 100);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    const successUrl = `${baseUrl}/invite/${inviteId}?status=prepay-success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/invite/${inviteId}?status=prepay-cancel`;

    const productLabel =
      inviteMode === 'gift'
        ? `Cadeau pour ${invite.toUserId.slice(0, 8)}`
        : `Ma part Split (${(inviterCents / 100).toFixed(2)} CHF)`;

    // Idempotency key Stripe (Q8=A pattern cohérent SC5 c4/5)
    const idempotencyKey = `invite-prepay-${inviteId}`;

    const stripeSession = await (await getStripe()).checkout.sessions.create(
      {
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
                description: `${productLabel} • ${activity.title || 'Spordateur'}`,
                images: ['https://spordateur.com/logo.png'],
              },
              unit_amount: inviterCents,
            },
            quantity: 1,
          },
        ],
        // Fix #144 (extension) — Pas de payment_intent_data.transfer_data
        // (in-house wallet model, pas de Stripe Connect partner onboarding).
        metadata: {
          mode: 'invite-prepay',
          inviteId,
          fromUserId: invite.fromUserId,
          toUserId: invite.toUserId,
          sessionId: invite.sessionId,
          activityId: invite.activityId,
          partnerId: session.partnerId,
          inviteMode,
          amount: String(inviterCents),
          applicationFeeAmount: String(applicationFeeAmount),
        },
      },
      { idempotencyKey },
    );

    return NextResponse.json(
      {
        sessionId: stripeSession.id,
        url: stripeSession.url,
        idempotencyKey,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[Checkout invite-prepay] Erreur:', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: 'internal-error', detail: message }, { status: 500 });
  }
}
