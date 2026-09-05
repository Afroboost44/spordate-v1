/**
 * LOT R2 — LIRE LES OFFRES AFROBOOST, SANS RIEN AFFICHER.
 *
 * CE MODULE N'AFFICHE RIEN ET N'ÉCRIT RIEN. Il ne touche ni à la pile de
 * profils, ni à `discovery/page.tsx`, ni à Firestore. Il prépare le socle que
 * R3c (« Où pratiquer ? ») et R5 (intercalation) consommeront plus tard.
 *
 * POURQUOI UNE LISTE BLANCHE, ET JAMAIS UNE LISTE NOIRE.
 * `GET /api/offers` d'Afroboost est PUBLIC et renvoie `coach_id` — qui EST
 * l'adresse e-mail du coach. Retirer les champs connus comme sensibles
 * laisserait passer le suivant : le jour où Afroboost ajoute `phone`,
 * `stripe_account` ou n'importe quel champ interne, un filtre par exclusion le
 * transmettrait au navigateur sans que personne ne l'ait décidé. On énumère
 * donc ce qui SORT, et rien d'autre ne peut sortir.
 *
 * CE QU'ON NE DEVINE PAS, ET C'EST DÉLIBÉRÉ.
 * Il n'existe aujourd'hui AUCUN champ fiable pour dire si une offre est un
 * cours à l'unité, un événement, un abonnement ou une carte membre : `category`
 * ne vaut que « service » ou « tshirt ». Et les 9 offres de production ont
 * `coach_id = null` — le propriétaire est donc indéterminable.
 * Déduire un type depuis `duration_value` ou depuis le NOM produirait une règle
 * de visibilité fausse et invisible : un abonnement affiché comme un lieu de
 * pratique, ou une offre facturée au mauvais propriétaire. Ce module transporte
 * donc les valeurs brutes utiles et s'arrête là. Le typage métier est R2c.
 */

/** Ce qu'Afroboost peut renvoyer. Volontairement permissif : on ne contrôle
 *  pas ce dépôt, et un champ inattendu ne doit pas faire échouer la lecture. */
export interface OffreAfroboostBrute {
  [cle: string]: unknown;
}

/**
 * La représentation PUBLIQUE d'une offre, seule autorisée à quitter le serveur.
 *
 * Aucun champ d'identité ici. `coachId` n'y figure pas : c'est un e-mail.
 */
export interface OffrePublique {
  id: string;
  nom: string;
  description: string;
  /** Prix affiché par Afroboost, en CHF. Jamais recalculé ici. */
  prix: number | null;
  image: string | null;
  /** Texte libre saisi par le coach. Ce n'est PAS une ville structurée. */
  lieuTexte: string | null;
  /** Capacité déclarée sur l'offre — pas les places restantes, qui ne sont
   *  pas calculables aujourd'hui (la place est occupée sur la séance). */
  participantsMax: number | null;
  /** Bruts, transportés sans interprétation — R2c décidera de leur sens. */
  categorieBrute: string | null;
  estProduit: boolean;
  nombreCoursLies: number;
  aUneDuree: boolean;
}

export interface LectureOffres {
  offres: OffrePublique[];
  /** `ok` : Afroboost a répondu et la réponse était lisible.
   *  `repli` : indisponible, trop lent, illisible — la découverte continue. */
  etat: 'ok' | 'repli';
  motif: string;
}

/** Le repli. Une liste vide, jamais une erreur qui remonte à l'écran. */
export function repli(motif: string): LectureOffres {
  return { offres: [], etat: 'repli', motif };
}

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

function nombreOuNull(valeur: unknown): number | null {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur;
  if (typeof valeur === 'string' && valeur.trim() !== '') {
    const n = Number(valeur);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Une offre brute → sa forme publique, ou `null` si elle n'est pas exploitable.
 *
 * ELLE FILTRE AUSSI SUR `visible`. Une offre masquée par son coach dans
 * Afroboost n'a aucune raison d'apparaître ailleurs : la masquer d'un côté et
 * la montrer de l'autre serait pire que ne rien montrer.
 *
 * FONCTION PURE : aucun réseau, aucune horloge, aucun accès disque. C'est ce
 * qui permet de l'éprouver sur des cas fabriqués, sans toucher la production.
 */
export function versOffrePublique(brute: OffreAfroboostBrute | null | undefined): OffrePublique | null {
  if (!brute || typeof brute !== 'object') return null;
  const id = texte(brute.id);
  const nom = texte(brute.name);
  if (!id || !nom) return null;
  // `visible` absent = visible (c'est le défaut du modèle Afroboost).
  if (brute.visible === false) return null;

  const images = Array.isArray(brute.images) ? brute.images : [];
  const image = texte(brute.thumbnail) || texte(images[0]) || null;
  const cours = Array.isArray(brute.linked_course_ids) ? brute.linked_course_ids : [];

  return {
    id,
    nom,
    description: texte(brute.description),
    prix: nombreOuNull(brute.price),
    image,
    lieuTexte: texte(brute.location) || null,
    participantsMax: nombreOuNull(brute.max_participants),
    categorieBrute: texte(brute.category) || null,
    estProduit: brute.isProduct === true,
    nombreCoursLies: cours.length,
    // Transporté comme un FAIT, pas comme un type : « cette offre porte une
    // durée ». En déduire « c'est un abonnement » appartient à R2c.
    aUneDuree: nombreOuNull(brute.duration_value) !== null,
  };
}

/**
 * La charge utile d'Afroboost → une lecture publique.
 *
 * TOUT CE QUI N'EST PAS UN TABLEAU EST UN REPLI. Une réponse `{}` , `null`, une
 * page d'erreur HTML mal typée : rien de tout cela ne doit produire une liste
 * partielle qu'on croirait complète.
 */
export function adapterOffres(charge: unknown): LectureOffres {
  if (!Array.isArray(charge)) {
    return repli('reponse inattendue : un tableau etait attendu');
  }
  const offres = charge
    .map((o) => versOffrePublique(o as OffreAfroboostBrute))
    .filter((o): o is OffrePublique => o !== null);
  return { offres, etat: 'ok', motif: '' };
}

/** Les seules clés qu'une offre publique peut porter. Le banc s'en sert pour
 *  prouver qu'aucun champ inconnu ne traverse — y compris ceux qu'Afroboost
 *  ajouterait demain. */
export const CLES_PUBLIQUES: ReadonlyArray<keyof OffrePublique> = [
  'id', 'nom', 'description', 'prix', 'image', 'lieuTexte',
  'participantsMax', 'categorieBrute', 'estProduit', 'nombreCoursLies', 'aUneDuree',
];
