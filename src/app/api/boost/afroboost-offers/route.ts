/**
 * LOT B — GET /api/boost/afroboost-offers
 *
 * LES OFFRES QUE **CE COMPTE** PEUT METTRE EN AVANT. Rien d'autre.
 *
 * POURQUOI UNE ROUTE, ET PAS UN FILTRE DANS LE NAVIGATEUR. Le catalogue public
 * est déjà servi par `/api/afroboost/offers` — mais décider « lesquelles sont à
 * toi » demande deux preuves qui n'existent QUE sur le serveur : la preuve
 * d'administration du LOT A (annuaire d'identité + liste d'autorisation) et la
 * liaison d'identité signée de R3b-ID. Aucune des deux ne peut être calculée,
 * ni même consultée, depuis le navigateur.
 *
 * CETTE ROUTE NE FAIT PAS AUTORITÉ. Elle sert à peupler un écran. La même
 * vérification est REFAITE à l'activation (`/api/boost/admin` et les deux
 * chemins d'achat) : un filtrage d'interface est un confort, il n'a jamais
 * protégé personne.
 *
 * LECTURE SEULE. Aucune écriture, aucun boost, aucun paiement. Et aucune
 * donnée privée ne sort : ni e-mail, ni identifiant de propriétaire, ni jeton.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { estAdminAfroboostAutorise } from '@/lib/afroboost/adminAfroboost';
import { resoudreProprietaireAfroboost } from '@/lib/afroboost/ownership';
import { offresSelectionnablesPour } from '@/lib/boost/offresSelectionnables';
import { getAdminDb } from '@/lib/firebase/admin';
import { lireOffres } from '@/app/api/afroboost/offers/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // Les deux preuves, chacune par son propre chemin. Elles ne se remplacent
    // jamais l'une l'autre : être administrateur ne rend propriétaire d'aucune
    // offre partenaire, et l'inverse est vrai aussi.
    const adminProuve = await estAdminAfroboostAutorise(uid);
    const db = await getAdminDb();
    const proprietaireAfroboost = await resoudreProprietaireAfroboost(db, uid);

    const { offres, etat, motif } = await lireOffres();
    if (etat !== 'ok') {
      // Le catalogue est indisponible : on le DIT, plutôt que de rendre une
      // liste vide qu'on prendrait pour « tu ne possèdes rien ».
      return NextResponse.json(
        { offres: [], etat, motif, admin: adminProuve },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }

    const selectionnables = offresSelectionnablesPour(offres, {
      adminProuve,
      proprietaireAfroboost,
    });

    return NextResponse.json(
      {
        offres: selectionnables,
        etat: 'ok',
        motif: '',
        // L'écran a besoin de savoir s'il doit proposer un paiement ou non.
        // C'est un FAIT sur le compte courant, pas une autorisation : la route
        // d'activation ne croira jamais ce drapeau sur parole.
        admin: adminProuve,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[GET /api/boost/afroboost-offers]', err);
    return NextResponse.json({ error: 'internal-error' }, { status: 500 });
  }
}
