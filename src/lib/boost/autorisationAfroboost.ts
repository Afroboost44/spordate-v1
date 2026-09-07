/**
 * R3b-2 — « CE COMPTE A-T-IL LE DROIT DE BOOSTER CETTE OFFRE AFROBOOST ? »
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE DÉCISION EST SÉPARÉE, PURE, ET COURTE
 * ─────────────────────────────────────────────────────────────────────────
 * C'est la garde qui précède un paiement. Elle doit se lire d'un coup d'œil
 * et s'éprouver sans base, sans réseau, sans émulateur. Elle ne prend donc
 * que deux arguments : l'offre telle que l'adaptateur R3b-1 la rend, et
 * l'identifiant de partenaire Afroboost DÉJÀ résolu par R3b-ID à partir d'un
 * `uid` authentifié côté serveur. Rien ne vient du navigateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUATRE REFUS, DANS CET ORDRE, ET L'ORDRE EST LE MESSAGE
 * ─────────────────────────────────────────────────────────────────────────
 * 1. `offre-introuvable` — l'offre n'est pas dans le catalogue servi. On ne
 *    boost pas un identifiant qu'on ne sait pas relire.
 * 2. `offre-admin` — une offre de la plateforme n'a RIEN à acheter : sa
 *    visibilité future dans « Où pratiquer ? » est gratuite. Ce refus passe
 *    AVANT le test de type pour qu'un cours admin ne reçoive jamais le motif
 *    « mauvais type » alors que le vrai motif est « tu n'as rien à payer ».
 * 3. `offre-non-boostable` — seuls un cours à l'unité et un événement se
 *    pratiquent quelque part. Un abonnement, un pack, une adhésion, un
 *    produit, `other` et `unknown` ne sont pas des lieux de pratique ; les
 *    booster n'aurait aucun sens et ouvrirait une porte que R3c devrait
 *    refermer.
 * 4. `offre-non-possedee` — le dernier verrou, celui de R3b-ID. La propriété
 *    est PROUVÉE par la liaison d'identité signée, jamais devinée par un
 *    e-mail, un nom ou une ville.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ÉTAT RÉEL, ASSUMÉ
 * ─────────────────────────────────────────────────────────────────────────
 * Aucune liaison partenaire n'existe en production (mesure du 06/09 : 0
 * offre `partner`, 0 correspondance prouvable). `estProprietaireDeLOffre`
 * rend donc `false` pour tout le monde, et cette porte est FERMÉE. C'est le
 * bon défaut, et ce n'est pas une raison pour inventer une correspondance
 * afin de la voir s'ouvrir.
 */

import type { OffrePublique } from '@/lib/afroboost/offers';
import { estProprietaireDeLOffre } from '@/lib/afroboost/ownership';

/**
 * Les seuls types d'offre qui désignent un endroit où l'on pratique.
 * Recopie de la règle déjà arrêtée pour « Où pratiquer ? » — R3b-2 ne
 * l'élargit pas et ne la rétrécit pas.
 */
export const TYPES_OFFRE_BOOSTABLES: ReadonlySet<string> = new Set([
  'single_class',
  'event',
]);

export type RefusBoostOffre =
  | 'offre-introuvable'
  | 'offre-admin'
  | 'offre-non-boostable'
  | 'offre-non-possedee';

export type VerdictBoostOffre =
  | { ok: true }
  | { ok: false; refus: RefusBoostOffre };

/** Le type de l'offre se pratique-t-il quelque part ? Pure, sans propriété. */
export function estTypeBoostable(
  offre: Pick<OffrePublique, 'typeOffre'> | null | undefined,
): boolean {
  if (!offre) return false;
  return TYPES_OFFRE_BOOSTABLES.has(offre.typeOffre);
}

/**
 * LA DÉCISION. Ne lève jamais, ne touche à rien, ne rend jamais `ok` par
 * défaut : tout chemin non explicitement autorisé est un refus.
 */
export function autoriserBoostSurOffre(
  offre: Pick<OffrePublique, 'proprietaire' | 'proprietaireId' | 'typeOffre'> | null | undefined,
  proprietaireAfroboost: string | null | undefined,
): VerdictBoostOffre {
  if (!offre) return { ok: false, refus: 'offre-introuvable' };
  if (offre.proprietaire === 'admin') return { ok: false, refus: 'offre-admin' };
  if (!estTypeBoostable(offre)) return { ok: false, refus: 'offre-non-boostable' };
  if (!estProprietaireDeLOffre(proprietaireAfroboost, offre)) {
    return { ok: false, refus: 'offre-non-possedee' };
  }
  return { ok: true };
}

/**
 * Le code HTTP qui correspond à chaque refus. Isolé ici pour que les deux
 * chemins d'achat (Stripe et crédits) répondent EXACTEMENT la même chose au
 * même refus — une divergence entre les deux serait invisible et durable.
 */
export function statutHttpDuRefus(refus: RefusBoostOffre): number {
  return refus === 'offre-introuvable' ? 404 : 403;
}

/** Le message rendu au partenaire. Aucune donnée privée, aucun e-mail. */
export function messageDuRefus(refus: RefusBoostOffre): string {
  switch (refus) {
    case 'offre-introuvable':
      return 'Cette offre est introuvable dans le catalogue Afroboost.';
    case 'offre-admin':
      return "Une offre de la plateforme n'a pas besoin d'un boost.";
    case 'offre-non-boostable':
      return "Ce type d'offre ne peut pas être boosté.";
    case 'offre-non-possedee':
      return "Cette offre ne t'appartient pas.";
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * LOT A — LA MISE EN AVANT : DEUX VOIES, DEUX PREUVES, UNE SEULE PORTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `autoriserBoostSurOffre`, au-dessus, N'A PAS BOUGÉ D'UN OCTET — et c'est
 * délibéré. C'est elle que les deux chemins d'achat interrogent, et elle
 * continue donc de refuser toute offre `admin` avec le motif `offre-admin`.
 * Un administrateur ne peut toujours PAS déclencher un achat : il n'a rien à
 * payer, et lui ouvrir un règlement à somme nulle serait la mauvaise réponse
 * à la bonne question.
 *
 * Ce qui suit prépare la décision du lot B sans l'exécuter. La différence
 * entre les deux voies n'est pas « qui a le droit d'apparaître » — les deux
 * doivent choisir explicitement — mais CE QUE ÇA COÛTE et PAR QUELLE PREUVE :
 *
 *   ADMINISTRATEUR  preuve serveur (annuaire d'identité + liste
 *                   d'autorisation + interrupteur), voie gratuite ;
 *   PARTENAIRE      preuve R3b-ID (liaison d'identité signée) + une mise en
 *                   avant achetée, active et non expirée.
 *
 * Les deux preuves ne se remplacent jamais l'une l'autre : un partenaire ne
 * devient pas administrateur en payant, un administrateur ne devient pas
 * propriétaire d'une offre partenaire en étant administrateur.
 */

export type VoieMiseEnAvant = 'admin-gratuit' | 'partenaire-achete';

export type RefusMiseEnAvant = RefusBoostOffre | 'admin-non-prouve';

export type VerdictMiseEnAvant =
  | { ok: true; voie: VoieMiseEnAvant }
  | { ok: false; refus: RefusMiseEnAvant };

/**
 * « Ce compte peut-il mettre CETTE offre en avant, et à quel titre ? »
 *
 * PURE, et volontairement séparée du chemin d'achat : elle ne rend jamais un
 * verdict qu'une route de règlement pourrait consommer par accident.
 *
 * L'ordre des refus reprend celui du chemin d'achat, à une exception près :
 * une offre `admin` n'est plus rejetée d'emblée, elle attend sa preuve. Le
 * type, lui, reste jugé AVANT tout — être administrateur n'a jamais permis de
 * mettre un pack en avant, et ne le permettra pas.
 */
export function autoriserMiseEnAvantOffre(
  offre: Pick<OffrePublique, 'proprietaire' | 'proprietaireId' | 'typeOffre'> | null | undefined,
  preuves: {
    /** Résultat de `estAdminAfroboostAutorise`. Jamais une valeur du navigateur. */
    adminProuve?: boolean;
    /** Résultat de `resoudreProprietaireAfroboost` (R3b-ID). */
    proprietaireAfroboost?: string | null;
  },
): VerdictMiseEnAvant {
  if (!offre) return { ok: false, refus: 'offre-introuvable' };
  if (!estTypeBoostable(offre)) return { ok: false, refus: 'offre-non-boostable' };

  if (offre.proprietaire === 'admin') {
    // La plateforme ne paie pas — mais elle doit prouver que c'est bien elle.
    return preuves?.adminProuve === true
      ? { ok: true, voie: 'admin-gratuit' }
      : { ok: false, refus: 'admin-non-prouve' };
  }

  if (offre.proprietaire === 'partner') {
    return estProprietaireDeLOffre(preuves?.proprietaireAfroboost, offre)
      ? { ok: true, voie: 'partenaire-achete' }
      : { ok: false, refus: 'offre-non-possedee' };
  }

  // `unknown` : une propriété qu'on ne sait pas nommer n'ouvre aucune voie.
  return { ok: false, refus: 'offre-non-possedee' };
}
