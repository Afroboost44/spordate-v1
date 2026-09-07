/**
 * LOT B — POST /api/boost/admin
 *
 * LA MISE EN AVANT GRATUITE D'UNE OFFRE DE LA PLATEFORME.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE ROUTE À PART, ET PAS UN RÈGLEMENT À ZÉRO FRANC
 * ─────────────────────────────────────────────────────────────────────────
 * L'administrateur n'a rien à payer. Le faire passer par Stripe pour une somme
 * nulle serait la mauvaise réponse à la bonne question : Stripe refuse un
 * montant nul, et un « achat gratuit » n'est pas un achat. `autoriserBoostSurOffre`
 * continue donc de refuser toute offre `admin` sur les deux chemins d'achat
 * (motif `offre-admin`), et cette route-ci est le SEUL endroit où une mise en
 * avant naît sans transaction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ, ET DANS QUEL ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *  1. le jeton (`verifyAuth`) ;
 *  2. la preuve d'administration du LOT A — annuaire d'identité + liste
 *     d'autorisation + rôle. Jamais un drapeau venu du navigateur ;
 *  3. la durée, contre la grille existante ;
 *  4. l'offre : elle doit être, À CET INSTANT, dans le catalogue servi, du bon
 *     type, et sélectionnable par CE compte. La vérification faite par l'écran
 *     est REFAITE ici — un filtrage d'interface n'a jamais protégé personne ;
 *  5. l'anti-doublon, avec la règle des chemins d'achat.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RIEN DE CE QUE DIT LE CLIENT NE FAIT AUTORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 * Le corps de la requête ne porte que deux choses : QUELLE offre et POUR
 * COMBIEN DE TEMPS. Le prix, la ville, le propriétaire et le type sont relus
 * dans le catalogue Afroboost. La ville, en particulier, est celle de l'offre —
 * pas celle que le navigateur aurait choisie : c'est elle qui rangera la carte
 * dans « Où pratiquer ? », et deux sources pour un même fait finissent
 * toujours par diverger.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { estAdminAfroboostAutorise } from '@/lib/afroboost/adminAfroboost';
import { resoudreProprietaireAfroboost } from '@/lib/afroboost/ownership';
import { offreSelectionnablePar } from '@/lib/boost/offresSelectionnables';
import { cibleDemandee, champsCibleBoost, lireCibleBoost, memeCible } from '@/lib/boost/cible';
import { BOOST_DURATION_HOURS } from '@/lib/billing/boostCredits';
import { getAdminDb } from '@/lib/firebase/admin';
import { lireOffres } from '@/app/api/afroboost/offers/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // La preuve d'administration. Elle seule ouvre la voie gratuite.
    if (!(await estAdminAfroboostAutorise(uid))) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'admin role required' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const duration = String(body?.duration || '');
    if (!BOOST_DURATION_HOURS[duration]) {
      return NextResponse.json(
        { error: 'invalid-input', detail: `duration must be one of: ${Object.keys(BOOST_DURATION_HOURS).join(', ')}` },
        { status: 400 },
      );
    }

    // Une cible, et une seule — même grammaire que les chemins d'achat. Cette
    // route ne met en avant QUE des offres Afroboost : une activité native
    // passe par le chemin habituel, payant, inchangé.
    const cible = cibleDemandee({ afroboostOfferId: body?.afroboostOfferId });
    if (cible.genre !== 'offreAfroboost') {
      return NextResponse.json(
        { error: 'offer-required', detail: 'afroboostOfferId requis' },
        { status: 400 },
      );
    }

    // L'offre, relue dans le catalogue À CET INSTANT. Une offre retirée ou
    // masquée entre l'affichage et le clic n'y est plus, et rien ne se crée.
    const { offres, etat } = await lireOffres();
    if (etat !== 'ok') {
      return NextResponse.json(
        { error: 'catalogue-indisponible', detail: 'Le catalogue Afroboost est momentanément injoignable.' },
        { status: 503 },
      );
    }

    const db = await getAdminDb();
    const proprietaireAfroboost = await resoudreProprietaireAfroboost(db, uid);
    const offre = offreSelectionnablePar(
      offres,
      { adminProuve: true, proprietaireAfroboost },
      cible.id,
    );
    if (!offre) {
      // Un seul motif pour trois cas — absente, mauvais type, pas à ce compte.
      // Les distinguer renseignerait un appelant qui tâtonne sur ce qui existe
      // dans le catalogue et à qui c'est.
      return NextResponse.json(
        { error: 'offre-non-selectionnable', detail: 'Cette offre ne peut pas être mise en avant par ce compte.' },
        { status: 403 },
      );
    }
    if (offre.voie !== 'admin-gratuit') {
      // Une offre partenaire ne se met pas en avant gratuitement, même par un
      // administrateur : elle appartient à quelqu'un, et elle se paie.
      return NextResponse.json(
        { error: 'offre-non-gratuite', detail: 'Cette offre relève du chemin payant.' },
        { status: 403 },
      );
    }

    // La ville vient de l'OFFRE. C'est elle qui rangera la carte dans
    // « Où pratiquer ? » ; la faire venir d'ailleurs créerait un second fait.
    const city = String(offre.ville || '').trim();

    const boostsCol = db.collection('boosts');
    const maintenant = Date.now();
    const heures = BOOST_DURATION_HOURS[duration];
    const expiresAt = new Date(maintenant + heures * 60 * 60 * 1000);

    // Anti-doublon, avec la règle EXACTE des chemins d'achat : on ne bloque que
    // si une mise en avant vivante couvre déjà cette cible précise.
    const existants = await boostsCol
      .where('partnerId', '==', uid)
      .where('active', '==', true)
      .get();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dejaEnAvant = existants.docs.some((d: any) => {
      const data = d.data();
      if (!memeCible(lireCibleBoost(data), cible)) return false;
      const exp = data.expiresAt;
      const ms =
        typeof exp?.toMillis === 'function' ? exp.toMillis()
          : exp instanceof Date ? exp.getTime()
            : 0;
      return ms > maintenant;
    });
    if (dejaEnAvant) {
      return NextResponse.json(
        { error: 'already-boosted', detail: 'Cette offre est déjà mise en avant.' },
        { status: 409 },
      );
    }

    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    const ref = boostsCol.doc();
    await ref.set({
      boostId: ref.id,
      partnerId: uid,
      // La cible sous SON champ — jamais un identifiant partagé (R3b-2).
      ...champsCibleBoost(cible),
      city,
      country: '',
      duration,
      active: true,
      // Le marqueur qui dit d'où vient cette mise en avant. `paidWith` existe
      // déjà dans le modèle (`'credits'` côté crédits) : on l'étend plutôt que
      // d'inventer un second champ qui dirait la même chose autrement.
      paidWith: 'admin',
      amountChf: 0,
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`[Boost admin] offre=${cible.id} ville=${city || '(sans ville)'} duree=${duration} doc=${ref.id}`);

    return NextResponse.json(
      {
        success: true,
        boostId: ref.id,
        afroboostOfferId: cible.id,
        city,
        duration,
        amountChf: 0,
        expiresAt: expiresAt.toISOString(),
        // Une offre sans ville structurée est sélectionnable, mais R3c ne
        // saura pas où la ranger. On le DIT, plutôt que de la laisser
        // disparaître sans explication.
        avertissement: city ? null : 'sans-ville-structuree',
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/boost/admin]', err);
    return NextResponse.json({ error: 'internal-error' }, { status: 500 });
  }
}
