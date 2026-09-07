/**
 * R4 — RÉSERVER UNE OFFRE AFROBOOST DEPUIS « OÙ PRATIQUER ? ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE FAIT : IL CALCULE UNE ADRESSE. RIEN D'AUTRE.
 * ─────────────────────────────────────────────────────────────────────────
 * Il ne réserve pas, ne paie pas, n'interroge aucune disponibilité, ne crée
 * aucune séance et ne connaît aucun prix faisant autorité. Il rend l'URL du
 * VRAI parcours de réservation d'Afroboost, et laisse Afroboost faire tout le
 * reste — car tout le reste lui appartient : le prix réel, la capacité, la
 * séance, le paiement, la confirmation, le QR, l'e-mail, l'historique.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE LIEN PROFOND EXISTE DÉJÀ, ET IL A ÉTÉ PROUVÉ DANS LE CODE QUI S'EXÉCUTE
 * ─────────────────────────────────────────────────────────────────────────
 * Afroboost sert, depuis la V371, `afroboost.com/?offre=<id>` : la page fait
 * défiler jusqu'à la carte de l'offre et la met en évidence. Vérifié le 07/09
 * dans le paquet réellement servi (`static/js/main.4810ad83.js`) — pas sur la
 * foi d'un code HTTP 200, qui ne prouve rien sur ce SPA puisqu'il rend
 * `index.html` pour n'importe quelle adresse.
 *
 * Ce qu'on y a lu, littéralement :
 *   `if (!offres.some(o => o && o.id === cible)) return;`
 * Une offre inconnue, retirée du catalogue ou masquée entre l'affichage et le
 * clic ne déclenche donc RIEN : le visiteur arrive simplement sur la vitrine.
 * Le repli sûr est tenu par Afroboost lui-même, à l'instant du clic, sur son
 * catalogue à lui — c'est-à-dire au seul endroit où il peut être juste.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `&reserver=1` : POURQUOI SEULEMENT QUAND C'EST GRATUIT
 * ─────────────────────────────────────────────────────────────────────────
 * Le second paramètre ouvre le formulaire de réservation au lieu de se
 * contenter du défilement. La V371 pose une règle que ce module respecte à la
 * lettre : « un lien ne doit jamais ouvrir un paiement tout seul ».
 *
 * Or, côté Afroboost, l'aiguillage d'une offre PAYANTE part en achat direct —
 * une session Stripe s'ouvre immédiatement. Poser `reserver=1` sur une offre
 * payante reviendrait donc à ouvrir un paiement depuis un lien : exactement ce
 * que la règle interdit. Une offre à 0 CHF, elle, ne peut pas partir en achat
 * direct (Stripe refuse un montant nul) : elle ouvre le formulaire, avec sa
 * case de conditions que la personne doit encore valider elle-même.
 *
 * D'où la règle, simple et vérifiable : `reserver=1` UNIQUEMENT à prix nul.
 * Une offre payante reçoit `?offre=<id>` seul — le visiteur atterrit sur sa
 * carte, mise en évidence, et déclenche lui-même la réservation.
 *
 * Le prix ne sert ICI qu'à choisir entre deux adresses. Il ne fait autorité
 * sur RIEN : ce que le visiteur paiera est résolu par Afroboost, sur son
 * propre catalogue, au moment du paiement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PAS DE REDIRECTION OUVERTE
 * ─────────────────────────────────────────────────────────────────────────
 * L'origine est une constante du dépôt — jamais une valeur venue du catalogue,
 * du navigateur ou d'une URL. La SEULE donnée distante qui entre dans
 * l'adresse est l'identifiant de l'offre, dont la forme est vérifiée puis qui
 * est encodé. Aucun `//`, aucun `:` , aucun point d'interrogation ne peut donc
 * s'y glisser pour détourner la destination.
 */

import type { OffrePublique } from '@/lib/afroboost/offers';
import { TYPES_OFFRE_BOOSTABLES } from '@/lib/boost/autorisationAfroboost';
import { ORIGINE_AFROBOOST } from '@/lib/discovery/offresAfroboostAPratiquer';

/**
 * La forme d'un identifiant d'offre : un UUID Afroboost, et rien d'autre.
 *
 * La garde n'est pas décorative. Sans elle, un identifiant contenant `?`, `#`
 * ou `//` — venu d'un catalogue compromis ou d'un champ mal nettoyé —
 * réécrirait la fin de l'URL, voire son hôte. L'encodage seul suffirait
 * probablement ; la vérification de forme le prouve, et un refus vaut mieux
 * qu'une adresse qu'on ne sait pas relire.
 */
const FORME_IDENTIFIANT = /^[A-Za-z0-9._~-]{1,128}$/;

export type RefusReservation = 'identifiant-invalide' | 'type-non-reservable';

export type DestinationReservation =
  | { ok: true; url: string; ouvreLeFormulaire: boolean }
  | { ok: false; refus: RefusReservation };

/**
 * L'adresse du vrai parcours de réservation, ou un refus.
 *
 * PURE : aucune base, aucun réseau, aucune horloge. On peut donc l'éprouver
 * sur des cas fabriqués, y compris hostiles, sans toucher à rien.
 *
 * Ce module NE DÉCIDE PAS si l'offre est réservable aujourd'hui. Il ne le peut
 * pas : la disponibilité, la capacité et les séances vivent chez Afroboost et
 * changent sans prévenir. Trancher ici, depuis un catalogue mis en cache cinq
 * minutes, ce serait promettre une place qui n'existe peut-être plus. La
 * question est donc posée à l'arrivée, à celui qui connaît la réponse.
 */
export function destinationReservationOffre(
  offre: Pick<OffrePublique, 'id' | 'typeOffre' | 'prix'> | null | undefined,
): DestinationReservation {
  const id = String(offre?.id || '').trim();
  if (!id || !FORME_IDENTIFIANT.test(id)) {
    return { ok: false, refus: 'identifiant-invalide' };
  }
  // Les mêmes deux types que « Où pratiquer ? » admet (R3c). R4 n'élargit
  // rien : un pack ou un produit n'a jamais atteint ce modal, et ne doit pas
  // pouvoir y entrer par une URL fabriquée à la main.
  if (!TYPES_OFFRE_BOOSTABLES.has(String(offre?.typeOffre || ''))) {
    return { ok: false, refus: 'type-non-reservable' };
  }

  const gratuite = offre?.prix === 0;
  const url =
    `${ORIGINE_AFROBOOST}/?offre=${encodeURIComponent(id)}` +
    (gratuite ? '&reserver=1' : '');

  return { ok: true, url, ouvreLeFormulaire: gratuite };
}
