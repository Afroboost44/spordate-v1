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
