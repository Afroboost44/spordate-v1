/**
 * R3b-2 — LA CIBLE D'UN BOOST : « QU'EST-CE QUE CE BOOST REND VISIBLE ? »
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EXISTAIT, ET POURQUOI IL FALLAIT LE NOMMER
 * ─────────────────────────────────────────────────────────────────────────
 * Un document `boosts` répondait à cette question par un seul champ,
 * `activityId`, et par son ABSENCE :
 *   • `activityId` présent → ce boost vise UNE activité Spordate ;
 *   • `activityId` absent  → boost historique, il vise TOUT le compte du
 *     partenaire (`partnerId`), donc toutes ses activités.
 *
 * Cette règle du « champ absent » est un piège dès qu'on ajoute une deuxième
 * sorte de cible : un boost qui viserait une offre Afroboost n'aurait pas
 * d'`activityId` non plus — et serait donc lu comme un boost historique,
 * rendant GRATUITEMENT visibles toutes les activités Spordate du compte.
 * C'est la fuite que ce module empêche, en rendant la lecture explicite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE CHOIX : DEUX CHAMPS DISTINCTS, PAS UN CHAMP « TYPE »
 * ─────────────────────────────────────────────────────────────────────────
 * On n'ajoute pas de `targetType` à côté d'un `targetId` partagé. Un
 * identifiant unique partagé par deux référentiels étrangers (un doc id
 * Firestore et un UUID Afroboost) ne demande qu'à être lu par le mauvais
 * consommateur le jour où le `targetType` manque, est mal écrit, ou est
 * oublié dans une requête. Deux champs SÉPARÉS rendent la collision
 * structurellement impossible :
 *   • `activityId`       → activité native Spordate ;
 *   • `afroboostOfferId` → offre du catalogue Afroboost (référence SEULE).
 *
 * Aucun titre, prix, lieu, image ni propriétaire de l'offre n'est recopié :
 * le catalogue Afroboost reste l'unique source de vérité. Ce module ne
 * transporte qu'un identifiant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RÉTROCOMPATIBILITÉ, TOTALE ET SANS MIGRATION
 * ─────────────────────────────────────────────────────────────────────────
 * Rien n'est réécrit dans les documents existants. Un boost d'hier porte
 * `activityId` (ou rien) et est lu exactement comme avant. Aucun index, aucun
 * script, aucune donnée de production n'est touchée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 * Il n'écrit rien, ne lit aucune base, ne connaît ni Stripe, ni crédits, ni
 * prix. Il ne décide PAS si un compte a le droit de booster une offre — cette
 * décision-là vit dans `./autorisationAfroboost`, séparément, parce qu'elle
 * garde de l'argent.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Le champ qui désigne une activité native Spordate. Inchangé depuis toujours. */
export const CHAMP_ACTIVITE = 'activityId';

/** Le champ ajouté par R3b-2. Jamais confondu avec le précédent. */
export const CHAMP_OFFRE_AFROBOOST = 'afroboostOfferId';

/**
 * Les quatre lectures possibles d'un document `boosts`.
 *
 * `partenaireLegacy` est un ÉTAT reconnu, pas un défaut : c'est le boost
 * d'avant BUG #69, qui vise le compte entier. `ambigu` est le document
 * malformé (les deux champs remplis) : il ne vaut rien nulle part, jamais.
 */
export type CibleBoost =
  | { genre: 'activite'; id: string }
  | { genre: 'offreAfroboost'; id: string }
  | { genre: 'partenaireLegacy' }
  | { genre: 'ambigu' };

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * CE QUE VISE CE DOCUMENT. Ne lève jamais, n'accède à rien.
 *
 * L'ordre des tests est délibéré : l'ambiguïté est détectée AVANT tout le
 * reste. Un document qui porterait les deux champs ne doit pas se voir
 * attribuer arbitrairement l'un des deux — il doit sortir du jeu.
 */
export function lireCibleBoost(doc: Record<string, any> | null | undefined): CibleBoost {
  const d = doc || {};
  const activite = texte(d[CHAMP_ACTIVITE]);
  const offre = texte(d[CHAMP_OFFRE_AFROBOOST]);
  if (activite && offre) return { genre: 'ambigu' };
  if (offre) return { genre: 'offreAfroboost', id: offre };
  if (activite) return { genre: 'activite', id: activite };
  return { genre: 'partenaireLegacy' };
}

/**
 * CE QUE DEMANDE UN APPELANT. Même grammaire, mais appliquée à un corps de
 * requête : `partenaireLegacy` y signifie « rien de demandé », ce que les
 * routes refusent (on n'ouvre pas de nouveau boost sans cible).
 */
export function cibleDemandee(entree: {
  activityId?: unknown;
  afroboostOfferId?: unknown;
}): CibleBoost {
  return lireCibleBoost({
    [CHAMP_ACTIVITE]: entree.activityId,
    [CHAMP_OFFRE_AFROBOOST]: entree.afroboostOfferId,
  });
}

/**
 * LES CHAMPS À ÉCRIRE sur le document `boosts`. Un seul champ, jamais deux.
 *
 * Un genre non écrivable (`partenaireLegacy`, `ambigu`) rend un objet VIDE :
 * on ne fabrique pas de cible par défaut au moment d'écrire.
 */
export function champsCibleBoost(cible: CibleBoost): Record<string, string> {
  if (cible.genre === 'activite') return { [CHAMP_ACTIVITE]: cible.id };
  if (cible.genre === 'offreAfroboost') return { [CHAMP_OFFRE_AFROBOOST]: cible.id };
  return {};
}

/**
 * « CE BOOST EXISTANT COUVRE-T-IL DÉJÀ CE QUE L'ON DEMANDE ? »
 *
 * Sert UNIQUEMENT à l'idempotence d'achat (un partenaire ne doit pas payer
 * deux fois la même visibilité). Deux règles héritées, conservées telles
 * quelles pour ne rien changer au comportement d'hier :
 *   • un boost historique (compte entier) couvre tout ce que le partenaire
 *     pourrait demander — il bloque donc un nouvel achat ;
 *   • deux cibles de genres différents ne se couvrent JAMAIS : un boost
 *     d'activité n'empêche pas de booster une offre Afroboost, et l'inverse
 *     est vrai aussi.
 *
 * Un document ambigu ne couvre rien : il ne rend rien visible (cf.
 * `getBoostedActivities`), il ne doit donc pas non plus bloquer un achat.
 */
export function memeCible(existante: CibleBoost, demandee: CibleBoost): boolean {
  if (existante.genre === 'ambigu' || demandee.genre === 'ambigu') return false;
  if (existante.genre === 'partenaireLegacy') return true;
  if (demandee.genre === 'partenaireLegacy') return false;
  return existante.genre === demandee.genre && existante.id === demandee.id;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * LE CLASSEMENT DES BOOSTS ACTIFS — LA SEULE LECTURE AUTORISÉE
 * ─────────────────────────────────────────────────────────────────────────
 * Cinq fois (#146, #155, #186, #203, #204) une deuxième requête `boosts` a
 * été écrite ailleurs, avec son propre filtre, et a divergé. Le classement
 * vit donc ici, PUR : il ne connaît ni Firestore, ni l'horloge système —
 * l'instant lui est passé. C'est ce qui permet de prouver « ce boost a
 * expiré » sans attendre trois jours.
 *
 * LE FILTRE EST RÉAPPLIQUÉ, MÊME QUAND LA REQUÊTE L'A DÉJÀ FAIT. Ce n'est
 * pas une redondance décorative : le cron d'expiration peut avoir du retard,
 * et un boost mort ne doit jamais redevenir visible parce qu'un `active`
 * n'a pas encore été retourné à `false`. La date fait foi, pas le drapeau.
 */
export interface ClassementBoosts {
  /** Activités natives Spordate explicitement boostées. */
  activites: Set<string>;
  /** Offres du catalogue Afroboost boostées — RÉFÉRENCES, pas des copies. */
  offresAfroboost: Set<string>;
  /**
   * Comptes couverts par un boost historique (sans cible). Ce jeu rend
   * visibles TOUTES les activités du compte : il ne doit jamais recevoir un
   * partenaire dont le boost visait une offre Afroboost.
   */
  partenairesLegacy: Set<string>;
}

/** Millisecondes d'une valeur d'expiration, quelle que soit sa forme. 0 = illisible. */
export function instantExpiration(valeur: unknown): number {
  if (valeur == null) return 0;
  const v = valeur as any;
  if (typeof v.toMillis === 'function') {
    const ms = v.toMillis();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : 0;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

/** Ce boost est-il encore vivant à cet instant ? `active` ET la date. */
export function boostEstActif(doc: Record<string, any> | null | undefined, maintenantMs: number): boolean {
  const d = doc || {};
  if (d.active !== true) return false;
  return instantExpiration(d.expiresAt) > maintenantMs;
}

/**
 * Classe une collection de documents `boosts` en trois jeux disjoints.
 *
 * Un document expiré, inactif, ambigu, ou sans `partnerId` pour un boost
 * historique, n'entre dans AUCUN jeu. Le défaut est l'invisibilité.
 */
export function classerBoosts(
  docs: ReadonlyArray<Record<string, any> | null | undefined>,
  maintenantMs: number,
): ClassementBoosts {
  const classement: ClassementBoosts = {
    activites: new Set<string>(),
    offresAfroboost: new Set<string>(),
    partenairesLegacy: new Set<string>(),
  };
  for (const doc of docs) {
    if (!boostEstActif(doc, maintenantMs)) continue;
    const cible = lireCibleBoost(doc);
    if (cible.genre === 'activite') {
      classement.activites.add(cible.id);
    } else if (cible.genre === 'offreAfroboost') {
      classement.offresAfroboost.add(cible.id);
    } else if (cible.genre === 'partenaireLegacy') {
      const partenaire = texte((doc || {}).partnerId);
      if (partenaire) classement.partenairesLegacy.add(partenaire);
    }
    // `ambigu` : nulle part.
  }
  return classement;
}
