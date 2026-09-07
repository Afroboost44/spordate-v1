/**
 * R3c — LES OFFRES AFROBOOST DANS « OÙ PRATIQUER ? ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE FAIT, ET CE QU'IL REFUSE DE FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 * Il décide quelles offres du catalogue Afroboost ont le droit d'apparaître
 * dans « Où pratiquer ? », puis les met à la forme que ce modal sait déjà
 * afficher. RIEN N'EST PERSISTÉ : pas de document `activities`, pas de
 * collection miroir, pas de cache Firestore. La normalisation vit le temps
 * d'un rendu et meurt avec lui. Le catalogue Afroboost reste la seule source
 * de vérité — c'est la règle qui a survécu à R2, R3b-1 et R3b-2, et la
 * violer ici créerait le catalogue parallèle qu'on évite depuis le début.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOT C — UNE SEULE PORTE : AVOIR ÉTÉ CHOISIE
 * ─────────────────────────────────────────────────────────────────────────
 * La règle précédente admettait AUTOMATIQUEMENT toute offre `admin` publique
 * et pratiquable. Personne ne l'avait choisie : il suffisait de la publier sur
 * la vitrine Afroboost pour qu'elle apparaisse ici. Le jour où « Cours à
 * l'unité » est passée visible, elle est arrivée toute seule à côté du cours
 * d'essai — et rien ne permettait de dire laquelle mettre en avant.
 *
 * Désormais, UNE OFFRE N'ENTRE QUE SI UNE MISE EN AVANT VIVANTE LA VISE,
 * précisément, par son identifiant. Cela vaut pour tout le monde.
 *
 * La différence entre l'administrateur et un partenaire ne se joue plus ici :
 * elle a lieu au moment de l'ACTIVATION (LOT B). L'administrateur active
 * gratuitement (`POST /api/boost/admin`), le partenaire paie. Une fois le
 * document écrit, ce module ne sait plus — et n'a pas à savoir — lequel des
 * deux a payé. Il lit une seule chose : « cette offre a-t-elle été choisie,
 * et ce choix est-il encore vivant ? »
 *
 * `unknown` n'entre toujours pas : une propriété qu'on ne sait pas nommer ne
 * s'affiche pas juste avant un écran qui fait réserver.
 *
 * LE POINT QUI COMPTE LE PLUS : la propriété d'une offre partenaire n'est PAS
 * revérifiée ici, et ce n'est pas un oubli. Un boost portant
 * `afroboostOfferId = X` ne peut EXISTER que si son acheteur a prouvé, côté
 * serveur, par la liaison d'identité signée de R3b-ID, qu'il possède X (cf.
 * `autoriserBoostSurOffre`). La présence du boost EST la preuve. Refaire la
 * vérification ici demanderait de lire `bridge_identity_links` depuis le
 * navigateur d'un visiteur quelconque — ce qui n'est ni possible, ni
 * souhaitable. En revanche une offre `partner` sans `proprietaireId` est
 * rejetée : aucun boost n'aurait pu être créé pour elle, la trouver boostée
 * signalerait une donnée corrompue, et le doute se ferme.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE BOOST LEGACY NE DÉBORDE JAMAIS ICI
 * ─────────────────────────────────────────────────────────────────────────
 * Le boost historique « compte entier » (`boostedPartnerIds`) ne rend visible
 * que des activités natives. Ce module ne le consulte même pas : il ne reçoit
 * que le jeu `offresAfroboost` produit par `classerBoosts` (R3b-2), qui est
 * disjoint des deux autres par construction.
 */

import type { OffrePublique } from '@/lib/afroboost/offers';
import { TYPES_OFFRE_BOOSTABLES } from '@/lib/boost/autorisationAfroboost';
import { isImageUrl } from '@/lib/activities/mediaParser';
import type { ActivityLike } from '@/lib/discovery/whereToPractice';

/**
 * L'origine du catalogue. Les médias d'une offre arrivent en chemin RELATIF
 * (`/api/files/…`) : servis tels quels, ils pointeraient vers le domaine qui
 * affiche la page. Sur afroboost.com/rencontre ce serait un hasard heureux ;
 * sur spordateur.com, une image morte. On absolutise donc toujours.
 */
export const ORIGINE_AFROBOOST = (
  process.env.NEXT_PUBLIC_AFROBOOST_ORIGIN || 'https://afroboost.com'
).replace(/\/+$/, '');

/** La marque que porte tout élément venu du catalogue. Clé de déduplication. */
export const SOURCE_AFROBOOST = 'afroboost';

/**
 * Les raisons d'un refus. Nommées parce qu'un banc doit pouvoir distinguer
 * « exclue parce que c'est un pack » de « exclue parce qu'elle n'est pas
 * boostée » — deux bugs très différents à réparer.
 */
export type MotifExclusion =
  | 'type-non-pratiquable'
  | 'proprietaire-inconnu'
  | 'partenaire-sans-identifiant'
  /**
   * LOT C — l'offre n'a pas été choisie, ou son choix a expiré.
   *
   * Remplace `partenaire-sans-boost-actif`, dont le nom disait que seuls les
   * partenaires avaient à être choisis. Ce n'est plus vrai : l'administrateur
   * aussi doit sélectionner ce qu'il met en avant.
   */
  | 'sans-mise-en-avant'
  | 'sans-ville';

export type VerdictAffichage =
  | { affichee: true }
  | { affichee: false; motif: MotifExclusion };

/**
 * LA DÉCISION, PURE. Aucune base, aucun réseau, aucune horloge : la fraîcheur
 * des boosts a déjà été tranchée par `classerBoosts`, qui reçoit l'instant.
 *
 * L'ordre des refus est délibéré — le type d'abord, parce qu'un pack ne doit
 * jamais pouvoir devenir éligible, même muni d'un boost. Le boost ne rend
 * jamais éligible un type interdit ; il ne fait que débloquer un type qui
 * l'était déjà.
 */
export function verdictAffichageOffre(
  offre: OffrePublique | null | undefined,
  offresBoostees: ReadonlySet<string>,
): VerdictAffichage {
  if (!offre) return { affichee: false, motif: 'proprietaire-inconnu' };

  if (!TYPES_OFFRE_BOOSTABLES.has(offre.typeOffre)) {
    return { affichee: false, motif: 'type-non-pratiquable' };
  }

  if (offre.proprietaire === 'partner') {
    // Une offre partenaire sans identifiant de propriétaire n'a pas pu être
    // mise en avant légitimement : aucun boost n'aurait franchi R3b-ID. La
    // trouver choisie signalerait une donnée corrompue, et le doute se ferme.
    if (!String(offre.proprietaireId || '').trim()) {
      return { affichee: false, motif: 'partenaire-sans-identifiant' };
    }
  } else if (offre.proprietaire !== 'admin') {
    return { affichee: false, motif: 'proprietaire-inconnu' };
  }

  // LOT C — LA CONDITION QUI VAUT POUR TOUT LE MONDE : avoir été choisie.
  //
  // `offresBoostees` vient de `classerBoosts` (R3b-2), qui n'y met QUE les
  // mises en avant `active === true` dont la date n'est pas passée, et qui les
  // range par `afroboostOfferId` — jamais par `activityId`, jamais par
  // propriétaire. Une offre A choisie ne peut donc pas faire entrer l'offre B,
  // et un boost « compte entier » n'en fait entrer aucune.
  //
  // Rien n'est refait ici sur QUI avait le droit de choisir : cette preuve a
  // été exigée à l'écriture du document (LOT A pour l'administrateur, R3b-ID
  // pour un partenaire). La présence du document EST la preuve.
  if (!offresBoostees.has(offre.id)) {
    return { affichee: false, motif: 'sans-mise-en-avant' };
  }

  // La ville STRUCTURÉE est la seule clé de regroupement. `lieuTexte` sert à
  // afficher, jamais à deviner une ville : « Bord du Lac, Auvernier » n'est
  // pas une ville, et en extraire une inventerait un groupe.
  if (!String(offre.ville || '').trim()) {
    return { affichee: false, motif: 'sans-ville' };
  }

  return { affichee: true };
}

/** Un média du catalogue, rendu utilisable depuis n'importe quel domaine. */
export function absolutiserMedia(url: string | null | undefined): string | null {
  const brut = String(url || '').trim();
  if (!brut) return null;
  if (/^https?:\/\//i.test(brut)) return brut;
  if (brut.startsWith('/')) return `${ORIGINE_AFROBOOST}${brut}`;
  return `${ORIGINE_AFROBOOST}/${brut}`;
}

/**
 * L'élément tel que « Où pratiquer ? » sait déjà le rendre.
 *
 * Il n'invente aucun champ d'affichage : il REMPLIT ceux que le modal lit
 * déjà. `partnerName` reçoit le lieu — c'est la seconde ligne de la carte,
 * et pour une offre Afroboost le lieu est ce que le visiteur veut y lire.
 * Aucun badge « source Afroboost » n'est ajouté : l'offre doit se présenter
 * comme une option parmi les autres.
 *
 * `activityId` est VOLONTAIREMENT absent. C'est ce qui empêche le préchargement
 * des séances Firestore (`prefetchSessionsForActivities` filtre dessus) de
 * partir chercher des séances qui n'existent pas — et ce qui interdit à quoi
 * que ce soit de prendre cet objet pour un document `activities`.
 */
export interface ElementAfroboostAPratiquer extends ActivityLike {
  source: typeof SOURCE_AFROBOOST;
  offreId: string;
  /** L'éligibilité est DÉJÀ tranchée : le regroupement ne doit pas la refaire. */
  estDejaEligible: true;
  typeOffre: OffrePublique['typeOffre'];
  proprietaire: OffrePublique['proprietaire'];
  /**
   * R4 — le prix SOUS SON NOM D'ORIGINE, en plus de `price` que lit le modal.
   *
   * Ce n'est pas une redondance décorative : `destinationReservationOffre`
   * reçoit cet élément et lit `prix`. Sans ce champ, une offre gratuite était
   * lue comme payante — et le lien profond perdait `&reserver=1`, donc le
   * formulaire ne s'ouvrait plus. Le banc R4 (cas P4) a attrapé exactement ça.
   */
  prix: number | null;
  lieuTexte: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function versElementAPratiquer(offre: OffrePublique): ElementAfroboostAPratiquer {
  const media = absolutiserMedia(offre.image);
  const lieu = offre.lieuTexte || offre.adresse || null;

  const element: ElementAfroboostAPratiquer = {
    id: offre.id,
    // ActivityLike exige `activityId` : on y remet l'identifiant de l'offre
    // pour satisfaire le type, mais le rendu utilise `id` — et le
    // préchargement des séances est neutralisé par `source === 'afroboost'`.
    activityId: offre.id,
    offreId: offre.id,
    source: SOURCE_AFROBOOST,
    estDejaEligible: true,
    isActive: true,
    // Aucun partenaire Spordate ne possède cette offre : le champ existe pour
    // le type, il ne doit JAMAIS servir à rapprocher quoi que ce soit.
    partnerId: '',
    city: offre.ville || undefined,
    title: offre.nom,
    name: offre.nom,
    // Seconde ligne de la carte : le lieu, pas une marque.
    partnerName: lieu || '',
    price: offre.prix ?? undefined,
    prix: offre.prix,
    typeOffre: offre.typeOffre,
    proprietaire: offre.proprietaire,
    lieuTexte: lieu,
    latitude: offre.latitude,
    longitude: offre.longitude,
  };

  // La miniature passe par la chaîne existante (`getActivityThumbnailMedia`) :
  // une image devient `thumbnailUrl`, une vidéo un `mediaItems` que le modal
  // sait déjà rendre en première frame. Rien de nouveau n'est inventé.
  if (media) {
    if (isImageUrl(media)) {
      (element as ActivityLike).thumbnailUrl = media;
    } else {
      (element as ActivityLike).mediaItems = [
        { type: 'video', url: media, source: 'upload' },
      ];
    }
  }

  return element;
}

/** Les offres qui entrent, mises à la forme du modal. Ordre du catalogue préservé. */
export function elementsAfroboostAPratiquer(
  offres: ReadonlyArray<OffrePublique> | null | undefined,
  offresBoostees: ReadonlySet<string>,
): ElementAfroboostAPratiquer[] {
  if (!Array.isArray(offres)) return [];
  const retenus: ElementAfroboostAPratiquer[] = [];
  for (const offre of offres) {
    if (verdictAffichageOffre(offre, offresBoostees).affichee) {
      retenus.push(versElementAPratiquer(offre));
    }
  }
  return retenus;
}

/**
 * LA CLÉ DE DÉDUPLICATION : la source ET l'identifiant, jamais le titre.
 *
 * Deux objets peuvent parfaitement s'appeler « Cours d'essai » sans être le
 * même : une activité native et une offre Afroboost sont des choses
 * distinctes, et les confondre en ferait disparaître une.
 */
export function cleDeduplication(element: ActivityLike & { source?: unknown }): string {
  const source = String(element.source || 'spordate');
  const id = String(element.id || element.activityId || '');
  return `${source}:${id}`;
}

/**
 * Les natives d'abord, les offres ensuite, sans doublon.
 *
 * L'ordre est conservé : le regroupement par ville qui suit choisit la casse
 * d'affichage d'une ville sur le PREMIER élément rencontré, et faire passer
 * les offres devant changerait l'affichage existant sans raison.
 */
export function fusionnerSansDoublon<T extends ActivityLike & { source?: unknown }>(
  natives: ReadonlyArray<T>,
  offres: ReadonlyArray<T>,
): T[] {
  const vus = new Set<string>();
  const fusion: T[] = [];
  for (const element of [...(natives || []), ...(offres || [])]) {
    if (!element) continue;
    const cle = cleDeduplication(element);
    if (vus.has(cle)) continue;
    vus.add(cle);
    fusion.push(element);
  }
  return fusion;
}
