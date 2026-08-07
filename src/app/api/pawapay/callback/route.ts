/**
 * Mobile Money (pawaPay) — callback de fin de paiement.
 *
 * ⚠️ ARRIVE PAR AFROBOOST, PAS DIRECTEMENT DE PAWAPAY. pawaPay n'accepte qu'UNE
 * seule URL de callback par compte ; elle pointe sur
 * `https://afroboost.com/api/pawapay/callback`, qui répartit vers l'app
 * propriétaire du dépôt. Conséquence assumée : un incident sur afroboost coupe
 * la confirmation des paiements Mobile Money de spordateur.
 *
 * ⚠️ LE CORPS N'EST JAMAIS CRU SUR PAROLE. Il n'est pas signé : n'importe qui
 * connaissant un `depositId` pourrait prétendre qu'un paiement a réussi. On n'en
 * extrait QUE le `depositId`, puis on RE-INTERROGE pawaPay pour connaître le
 * statut réel. Même prudence que le webhook d'afroboost.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/payment/packages';
import { statutDepot } from '@/lib/payment/pawapay';
import { handlePaymentSuccess } from '@/app/api/webhooks/stripe/handler';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const depositId = String(
    (body as Record<string, unknown>)?.depositId ||
    ((body as Record<string, Record<string, unknown>>)?.data?.depositId) || '',
  );
  if (!depositId) {
    return NextResponse.json({ status: 'error', message: 'depositId manquant' }, { status: 400 });
  }

  const db = await getDb();
  const ref = db.collection('pawapay_deposits').doc(depositId);
  const snap = await ref.get();
  if (!snap.exists) {
    // Dépôt d'une AUTRE app : afroboost n'aurait pas dû nous l'envoyer, mais on
    // répond 200 — un 4xx ferait rejouer le callback indéfiniment chez pawaPay.
    return NextResponse.json({ status: 'ignored', reason: 'inconnu_ici' });
  }
  const dep = snap.data() as Record<string, unknown>;

  // Garde anti-double traitement : pawaPay rejoue ses callbacks.
  if (dep.status === 'completed') {
    return NextResponse.json({ status: 'ok', message: 'deja_traite' });
  }

  let statut: string;
  try {
    statut = await statutDepot(depositId);
  } catch (e) {
    // On ne marque RIEN : pawaPay réessaiera, et l'argent n'est pas perdu.
    return NextResponse.json({ status: 'retry', message: String(e).slice(0, 200) }, { status: 503 });
  }

  if (statut !== 'COMPLETED') {
    await ref.update({ status: statut.toLowerCase() || 'unknown', checkedAt: new Date().toISOString() });
    return NextResponse.json({ status: 'ok', message: `statut=${statut}` });
  }

  // ⚠️ ON RÉUTILISE L'ACTIVATION DU CHEMIN STRIPE, telle quelle. Elle sait
  // accorder les crédits, le Premium à durée fixe, la réservation de session,
  // l'invitation duo et le boost — chacun avec ses effets de bord (notifications,
  // transactions, compteurs). La réécrire pour le Mobile Money aurait garanti que
  // les deux chemins divergent au premier correctif appliqué à un seul.
  //
  // La « session » est SYNTHÉTIQUE : `handlePaymentSuccess` ne lit que
  // `id`, `metadata`, `amount_total` et `payment_method_types`. Le paramètre
  // `stripe` n'est utilisé que pour distinguer TWINT — sans `payment_method_types`
  // contenant « twint », il n'est jamais appelé : un stub suffit et ne peut pas
  // partir chez Stripe.
  const fausseSession = {
    id: `pawapay_${depositId}`,
    metadata: dep.metadata || {},
    amount_total: dep.priceChf || 0,
    currency: 'chf',
    payment_status: 'paid',
    payment_method_types: ['pawapay'],
  } as unknown as Record<string, unknown>;

  const stubStripe = {
    paymentIntents: { retrieve: async () => ({ payment_method_types: [] }) },
  } as unknown as InstanceType<typeof import('stripe').default>;

  try {
    await handlePaymentSuccess(fausseSession, stubStripe);
    await ref.update({
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    return NextResponse.json({ status: 'ok', message: 'accorde' });
  } catch (e) {
    // Le paiement est DÉJÀ encaissé : on journalise et on demande un rejeu plutôt
    // que d'avaler l'erreur en silence — sinon le client paie sans rien recevoir.
    await ref.update({ status: 'grant_failed', error: String(e).slice(0, 300) });
    return NextResponse.json({ status: 'retry', message: 'activation_echouee' }, { status: 500 });
  }
}
