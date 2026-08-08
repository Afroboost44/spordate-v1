/**
 * Mobile Money (pawaPay) — ouverture d'un paiement.
 *
 * ⚠️ ACHATS PONCTUELS UNIQUEMENT. pawaPay encaisse un montant, il ne PRÉLÈVE pas
 * de façon récurrente : aucun mandat, aucun débit automatique. Un forfait
 * `type: 'subscription'` est donc refusé ICI, explicitement, plutôt que d'être
 * encaissé une fois et de laisser croire à une reconduction qui n'arrivera jamais.
 *
 * ⚠️ LE MONTANT EST CALCULÉ CÔTÉ SERVEUR, jamais reçu du navigateur — même règle
 * que le chemin Stripe. Le catalogue est la source unique `@/lib/payment/packages`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { loadPackages, getDb, BOOST_PRICES } from '@/lib/payment/packages';
import { computePricingTier, isSessionBookable } from '@/services/firestore';
import type { Session } from '@/types/firestore';
import {
  pawapayConfigured, paysDisponibles, montantLocal, ouvrirPagePaiement,
} from '@/lib/payment/pawapay';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Les pays réellement ouverts sur le compte — pour peupler le sélecteur. */
export async function GET() {
  if (!pawapayConfigured()) {
    return NextResponse.json({ configured: false, countries: [] });
  }
  try {
    return NextResponse.json({ configured: true, countries: await paysDisponibles() });
  } catch {
    // Un incident chez pawaPay ne doit pas casser la page de paiement : le
    // sélecteur reste vide et la carte continue de fonctionner.
    return NextResponse.json({ configured: true, countries: [] });
  }
}

/**
 * Le DEVIS d'un achat, par mode — montant en centimes CHF + métadonnées.
 *
 * ⚠️ LE PRIX N'EST JAMAIS CELUI DES CRÉDITS. Chaque mode a sa propre
 * tarification : une session se tarife par PALIER (`computePricingTier`, qui
 * dépend de la date et du remplissage) et se multiplie par le nombre de places
 * (Duo = 2) ; un boost suit sa grille de durée. Réutiliser le prix d'un pack de
 * crédits aurait facturé n'importe quoi.
 *
 * ⚠️ ET C'EST LE SERVEUR QUI CALCULE, jamais le navigateur — même règle que le
 * chemin Stripe, dont on reprend ici les MÊMES primitives (`computePricingTier`,
 * `BOOST_PRICES`) pour que les deux moyens ne puissent pas diverger.
 *
 * Les métadonnées produites sont IDENTIQUES à celles que Stripe envoie : c'est
 * `handlePaymentSuccess` qui les relit, et il ne sait lire que cette forme-là.
 */
async function devis(
  db: FirebaseFirestore.Firestore,
  uid: string,
  body: Record<string, unknown>,
): Promise<{ montantChf: number; motif: string; metadata: Record<string, string> } | { erreur: string; code: number }> {
  const mode = String(body.mode || 'package');

  // ---- Réservation de session ----
  if (mode === 'session') {
    const sessionId = String(body.sessionId || '');
    if (!sessionId) return { erreur: 'sessionId requis', code: 400 };
    const snap = await db.collection('sessions').doc(sessionId).get();
    if (!snap.exists) return { erreur: 'Session introuvable', code: 404 };
    const session = snap.data() as unknown as Session;
    const now = new Date();
    if (!isSessionBookable(session, now)) {
      return { erreur: 'Session non réservable', code: 409 };
    }
    const { tier, price } = computePricingTier(session, now);
    if (!price || price <= 0) return { erreur: 'Prix de session indisponible', code: 409 };

    const activitySnap = await db.collection('activities').doc(session.activityId).get();
    const bundleCredits = (activitySnap.data()?.chatCreditsBundle as number | undefined) ?? 50;
    const isDuo = body.isDuoTicket === true;
    const seats = isDuo ? 2 : 1;

    return {
      montantChf: price * seats,
      motif: 'Reservation session',
      metadata: {
        mode: 'session',
        sessionId,
        userId: uid,
        tier: String(tier),
        seats: String(seats),
        isDuoTicket: isDuo ? 'true' : 'false',
        activityId: String(session.activityId || ''),
        partnerId: String(session.partnerId || ''),
        bundleCredits: String(bundleCredits * seats),
        amount: String(price * seats),
      },
    };
  }

  // ---- Acceptation d'une invitation duo ----
  if (mode === 'invite-accept') {
    const inviteId = String(body.inviteId || '');
    if (!inviteId) return { erreur: 'inviteId requis', code: 400 };
    const invSnap = await db.collection('invites').doc(inviteId).get();
    if (!invSnap.exists) return { erreur: 'Invitation introuvable', code: 404 };
    const inv = invSnap.data() as Record<string, unknown>;
    if (inv.status !== 'pending') return { erreur: `Invitation ${String(inv.status)}`, code: 409 };

    const sessionId = String(inv.sessionId || '');
    const sSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sSnap.exists) return { erreur: 'Session de l\'invitation introuvable', code: 404 };
    const session = sSnap.data() as unknown as Session;
    const { tier, price } = computePricingTier(session, new Date());
    if (!price || price <= 0) return { erreur: 'Prix indisponible', code: 409 };

    return {
      montantChf: price,
      motif: 'Invitation duo',
      metadata: {
        mode: 'invite-accept',
        inviteId,
        sessionId,
        userId: uid,
        tier: String(tier),
        amount: String(price),
        partnerId: String(session.partnerId || ''),
        activityId: String(session.activityId || ''),
      },
    };
  }

  // ---- Boost partenaire ----
  if (mode === 'boost') {
    const duration = String(body.duration || '');
    const boost = BOOST_PRICES[duration];
    if (!boost) return { erreur: 'Durée de boost invalide', code: 400 };
    const activityId = String(body.activityId || '');
    if (!activityId) return { erreur: 'activityId requis', code: 400 };
    const city = String(body.city || '');
    if (!city) return { erreur: 'Ville requise', code: 400 };

    return {
      montantChf: boost.price,
      motif: boost.label,
      metadata: {
        type: 'boost',
        partnerId: uid,
        activityId,
        duration,
        city,
        country: String(body.country || 'Suisse'),
        locationLabel: String(body.locationLabel || city),
      },
    };
  }

  return { erreur: 'Mode inconnu', code: 400 };
}

export async function POST(request: NextRequest) {
  if (!pawapayConfigured()) {
    return NextResponse.json({ error: 'Mobile Money non configuré' }, { status: 503 });
  }

  const uid = await verifyAuth(request);
  if (!uid) {
    return NextResponse.json({ error: 'Connexion requise' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { packageId, country, phone, matchId, referralCode, partnerId } = body || {};
  const mode = String((body as Record<string, unknown>)?.mode || 'package');

  const db0 = await getDb();

  // V408 : quatre origines d'achat, un seul chemin de paiement. Le montant et
  // les métadonnées sont produits par `devis()` pour les trois modes non-pack —
  // chacun avec SA tarification, jamais celle des crédits.
  let montantChf: number;
  let motif: string;
  let metadata: Record<string, string>;

  if (mode === 'package') {
    const PACKAGES = await loadPackages();
    const pkg = packageId ? PACKAGES[packageId] : undefined;
    if (!pkg) {
      return NextResponse.json({ error: 'Package invalide' }, { status: 400 });
    }
    // Le refus explicite décrit plus haut.
    if (pkg.type === 'subscription') {
      return NextResponse.json({
        error: "Ce forfait est un abonnement reconduit : le Mobile Money ne peut pas prélever automatiquement. Choisis la carte, ou une formule à durée fixe.",
      }, { status: 400 });
    }
    const isPrem = String(packageId).startsWith('premium_');
    const dh = (pkg as { durationHours?: number }).durationHours;
    montantChf = pkg.price;
    motif = pkg.label || 'Spordateur';
    metadata = {
      userId: uid,
      packageId: String(packageId),
      creditsToGrant: String(pkg.credits),
      matchId: matchId || '',
      referralCode: referralCode || '',
      isPremium: isPrem ? 'true' : 'false',
      partnerId: partnerId || '',
      premiumDurationHours: dh ? String(dh) : '',
    };
  } else {
    const d = await devis(db0, uid, (body || {}) as Record<string, unknown>);
    if ('erreur' in d) {
      return NextResponse.json({ error: d.erreur }, { status: d.code });
    }
    montantChf = d.montantChf;
    motif = d.motif;
    metadata = d.metadata;
  }

  if (!country || typeof country !== 'string') {
    return NextResponse.json({ error: 'Pays requis' }, { status: 400 });
  }
  const pays = (await paysDisponibles()).find((p) => p.code === country.toUpperCase());
  if (!pays) {
    return NextResponse.json({ error: 'Pays non desservi par Mobile Money' }, { status: 400 });
  }

  let montant: number;
  try {
    montant = montantLocal(montantChf, pays.currency);
  } catch {
    return NextResponse.json({ error: `Devise non gérée (${pays.currency})` }, { status: 400 });
  }

  const depositId = randomUUID();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
  // ⚠️ ÉCRIT AVANT L'APPEL RÉSEAU. Si la connexion lâche après l'envoi, ce
  // document est la SEULE référence permettant de retrouver le dépôt côté
  // pawaPay et d'honorer un paiement bel et bien encaissé.
  const db = db0;
  await db.collection('pawapay_deposits').doc(depositId).set({
    depositId,
    status: 'pending',
    provider: 'pawapay',
    app: 'spordate',
    userId: uid,
    packageId: packageId || null,
    mode,
    priceChf: montantChf,
    amountLocal: montant,
    currency: pays.currency,
    country: pays.code,
    // La MÊME forme de métadonnées que le chemin Stripe : le callback rejouera
    // `handlePaymentSuccess`, qui ne sait lire que celle-là.
    metadata,
    createdAt: new Date().toISOString(),
  });

  try {
    const url = await ouvrirPagePaiement({
      depositId,
      montant,
      devise: pays.currency,
      pays: pays.code,
      motif,
      urlRetour: `${baseUrl}/payment?status=pending&provider=pawapay&deposit=${depositId}`,
      telephone: typeof phone === 'string' ? phone : '',
    });
    return NextResponse.json({
      url, depositId, amountLocal: montant, currency: pays.currency, country: pays.code,
    });
  } catch (e) {
    await db.collection('pawapay_deposits').doc(depositId).update({
      status: 'failed_to_open',
      error: String(e).slice(0, 300),
    });
    return NextResponse.json({ error: `Mobile Money indisponible : ${String(e).slice(0, 160)}` }, { status: 502 });
  }
}
