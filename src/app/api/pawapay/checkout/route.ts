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
import { loadPackages, getDb } from '@/lib/payment/packages';
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

  if (!country || typeof country !== 'string') {
    return NextResponse.json({ error: 'Pays requis' }, { status: 400 });
  }
  const pays = (await paysDisponibles()).find((p) => p.code === country.toUpperCase());
  if (!pays) {
    return NextResponse.json({ error: 'Pays non desservi par Mobile Money' }, { status: 400 });
  }

  let montant: number;
  try {
    montant = montantLocal(pkg.price, pays.currency);
  } catch {
    return NextResponse.json({ error: `Devise non gérée (${pays.currency})` }, { status: 400 });
  }

  const depositId = randomUUID();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
  const isPremium = String(packageId).startsWith('premium_');
  const durationHours = (pkg as { durationHours?: number }).durationHours;

  // ⚠️ ÉCRIT AVANT L'APPEL RÉSEAU. Si la connexion lâche après l'envoi, ce
  // document est la SEULE référence permettant de retrouver le dépôt côté
  // pawaPay et d'honorer un paiement bel et bien encaissé.
  const db = await getDb();
  await db.collection('pawapay_deposits').doc(depositId).set({
    depositId,
    status: 'pending',
    provider: 'pawapay',
    app: 'spordate',
    userId: uid,
    packageId,
    priceChf: pkg.price,
    amountLocal: montant,
    currency: pays.currency,
    country: pays.code,
    // La MÊME forme de métadonnées que le chemin Stripe : le callback rejouera
    // `handlePaymentSuccess`, qui ne sait lire que celle-là.
    metadata: {
      userId: uid,
      packageId,
      creditsToGrant: String(pkg.credits),
      matchId: matchId || '',
      referralCode: referralCode || '',
      isPremium: isPremium ? 'true' : 'false',
      partnerId: partnerId || '',
      premiumDurationHours: durationHours ? String(durationHours) : '',
    },
    createdAt: new Date().toISOString(),
  });

  try {
    const url = await ouvrirPagePaiement({
      depositId,
      montant,
      devise: pays.currency,
      pays: pays.code,
      motif: pkg.label || 'Spordateur',
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
