/**
 * LOT D — « OÙ POURRAIT-ON SE RETROUVER ? »
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX QUESTIONS QUI N'ONT JAMAIS ÉTÉ LA MÊME
 * ─────────────────────────────────────────────────────────────────────────
 * Le modal « Réserver une séance » posait une seule question : « quelles
 * activités possède la personne affichée ? ». Pour un profil ordinaire —
 * quelqu'un qui n'organise rien — la réponse est vide, et c'est JUSTE. C'est
 * exactement ce que le FIX ATTRIBUTION a rétabli : une carte ne vend pas les
 * activités de quelqu'un d'autre.
 *
 * Mais il en existe une seconde, que personne ne posait : « où pourrait-on se
 * retrouver, tous les deux ? ». Sa réponse n'a RIEN à voir avec la propriété
 * du profil affiché. Un cours Afroboost mis en avant est un lieu où deux
 * personnes peuvent se donner rendez-vous — il appartient à Afroboost, pas à
 * la personne qu'on invite.
 *
 * Ce module répond à la SECONDE question, et il est séparé du reste pour que
 * les deux réponses ne puissent jamais se mélanger. La première continue de
 * vivre dans `profileActivities.ts`, intacte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MÊME SOURCE QUE « OÙ PRATIQUER ? », PAS UNE SECONDE RÈGLE
 * ─────────────────────────────────────────────────────────────────────────
 * Les offres proposées ici sont EXACTEMENT celles que R3c admet : type
 * pratiquable, ville structurée, et une mise en avant vivante visant cette
 * offre précise (LOT C). On réutilise `elementsAfroboostAPratiquer` plutôt
 * que de réécrire la décision : deux règles pour une même question finissent
 * toujours par diverger — c'est la faute commise cinq fois avant le service
 * unifié des boosts.
 *
 * Conséquence directe et voulue : quand la mise en avant expire, l'offre
 * disparaît d'ici EN MÊME TEMPS que de « Où pratiquer ? ». Les deux écrans ne
 * peuvent pas se contredire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE TYPE EMPÊCHE LA CONFUSION QUE LES COMMENTAIRES NE SUFFISENT PAS À ÉVITER
 * ─────────────────────────────────────────────────────────────────────────
 * `ActiviteDeRencontre` est une union DISCRIMINÉE : une option native porte un
 * `activityId` et rien d'autre ; une option Afroboost porte un
 * `afroboostOfferId` et rien d'autre. TypeScript refuse de lire l'un là où
 * l'autre est attendu. C'est la même discipline que le contrat Boost de
 * R3b-2, appliquée à l'écran.
 *
 * PURE : aucune base, aucun réseau, aucune horloge.
 */

import type { OffrePublique } from '@/lib/afroboost/offers';
import {
  SOURCE_AFROBOOST,
  elementsAfroboostAPratiquer,
} from '@/lib/discovery/offresAfroboostAPratiquer';

/** Ce que porte une option, quelle que soit sa provenance. */
interface BaseRencontre {
  titre: string;
  lieu: string | null;
  ville: string | null;
  prix: number | null;
  image: string | null;
  /** À QUI est l'activité. Jamais le profil affiché — c'est tout l'enjeu. */
  organisateur: string;
}

/**
 * Une option de rendez-vous. Union DISCRIMINÉE sur `source` : il est
 * impossible de lire `activityId` sur une offre Afroboost, ou l'inverse, sans
 * que le compilateur ne l'interdise.
 */
export type ActiviteDeRencontre =
  | (BaseRencontre & { source: 'spordate'; activityId: string })
  | (BaseRencontre & { source: 'afroboost'; afroboostOfferId: string });

/** L'organisateur d'une offre du catalogue. Un nom, jamais un identifiant. */
export const ORGANISATEUR_AFROBOOST = 'Afroboost';

/**
 * Les offres Afroboost proposables comme lieu de rendez-vous.
 *
 * `misesEnAvant` est le jeu produit par `classerBoosts` (R3b-2) : il ne
 * contient que les mises en avant `active` et non expirées, rangées par
 * `afroboostOfferId`. Une offre A choisie n'ouvre donc jamais l'offre B, et un
 * boost « compte entier » n'en ouvre aucune.
 */
export function offresDeRencontre(
  offres: ReadonlyArray<OffrePublique> | null | undefined,
  misesEnAvant: ReadonlySet<string>,
): ActiviteDeRencontre[] {
  // Une seule décision d'éligibilité dans tout le projet : celle de R3c.
  const elements = elementsAfroboostAPratiquer(offres, misesEnAvant);
  return elements.map((e) => ({
    source: 'afroboost' as const,
    afroboostOfferId: e.offreId,
    titre: e.title || e.name || '',
    lieu: e.lieuTexte,
    ville: e.city ?? null,
    prix: e.prix,
    image: (e as { thumbnailUrl?: string }).thumbnailUrl ?? null,
    // L'ORGANISATEUR N'EST JAMAIS LE PROFIL AFFICHÉ. C'est la ligne qui
    // empêche la carte de Davelove de sembler vendre le cours de Bassi.
    organisateur: ORGANISATEUR_AFROBOOST,
  }));
}

/**
 * Les activités RÉELLEMENT possédées par le profil affiché, mises à la même
 * forme. Elles arrivent déjà filtrées par `activitesDuProfil` (FIX
 * ATTRIBUTION) : ce module ne relâche rien, il se contente de traduire.
 */
export function activitesDuProfilEnOptions(
  activites: ReadonlyArray<Record<string, unknown>> | null | undefined,
  nomDuProfil: string,
): ActiviteDeRencontre[] {
  if (!Array.isArray(activites)) return [];
  const options: ActiviteDeRencontre[] = [];
  for (const a of activites) {
    const id = String((a?.activityId ?? a?.id ?? '') as string).trim();
    if (!id) continue;
    options.push({
      source: 'spordate',
      activityId: id,
      titre: String((a?.title ?? a?.name ?? '') as string),
      lieu: (a?.locationName ?? null) as string | null,
      ville: (a?.city ?? null) as string | null,
      prix: typeof a?.price === 'number' ? (a.price as number) : null,
      image: null,
      // Celles-ci, oui : elles sont à la personne affichée.
      organisateur: nomDuProfil,
    });
  }
  return options;
}

/** Garde de type, pour que les appelants n'aient pas à comparer des chaînes. */
export function estOptionAfroboost(
  o: ActiviteDeRencontre | null | undefined,
): o is Extract<ActiviteDeRencontre, { source: 'afroboost' }> {
  return o?.source === SOURCE_AFROBOOST;
}

/**
 * La clé d'une option : sa source ET son identifiant. Jamais son titre — deux
 * offres peuvent parfaitement s'appeler pareil sans être la même.
 */
export function cleOption(o: ActiviteDeRencontre): string {
  return estOptionAfroboost(o) ? `afroboost:${o.afroboostOfferId}` : `spordate:${o.activityId}`;
}
