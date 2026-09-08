/**
 * F2 — LE PROFIL SOCIAL PARTAGÉ, RÉDUIT À CE QUI PEUT ÊTRE VU.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE EST, ET CE QU'IL PROTÈGE
 * ─────────────────────────────────────────────────────────────────────────
 * Le document `users/{uid}` de Spordateur mêle, dans un seul objet, ce qui est
 * public (photo, bio, ville, sports) et ce qui ne doit JAMAIS sortir : crédits,
 * rôle, `fcmToken`, sanctions, `referralCode`, commission, drapeaux de
 * modération. Renvoyer ce document — même « en lecture seule » — exposerait
 * tout cela à afroboost.
 *
 * La défense n'est PAS une liste de champs à retirer : une telle liste oublie
 * le champ sensible ajouté demain. C'est une LISTE BLANCHE — on ne recopie que
 * les champs nommés ici, un par un, et rien d'autre ne peut traverser. Un
 * nouveau champ dans `users`, sensible ou non, est invisible par défaut tant
 * que personne ne l'a explicitement ajouté ici. C'est l'inverse du réflexe
 * habituel, et c'est voulu : le défaut sûr est « rien ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PUR. AUCUNE BASE, AUCUN RÉSEAU, AUCUNE HORLOGE.
 * ─────────────────────────────────────────────────────────────────────────
 * Ce fichier ne lit rien et n'écrit rien. Il TRANSFORME un objet en un autre.
 * C'est ce qui permet d'éprouver la liste blanche exhaustivement, sans
 * émulateur : on lui donne un `users` truffé de champs sensibles et on vérifie
 * qu'aucun ne ressort. Toute l'IO (auth, bridge, lecture Firestore) vit dans la
 * route, jamais ici.
 */

/** Un sport pratiqué. `name` et `level` sont publics — ils décrivent, ils
 *  n'identifient pas. Toute autre clé d'un `SportEntry` est ignorée. */
export type SportPublic = { name: string; level: string };

/**
 * LE CONTRAT DE SORTIE. C'est le SEUL objet qu'afroboost reçoit. Tout champ
 * absent d'ici n'existe pas pour afroboost — c'est la définition de la liste
 * blanche, écrite en un type.
 */
export type UnifiedSocialProfile = {
  displayName: string;
  photoURL: string | null;
  photos: string[];
  bio: string;
  city: string;
  canton: string;
  sports: SportPublic[];
};

/**
 * LES SEULS CHAMPS QUI TRAVERSENT. Écrit comme un tableau `const` pour qu'un
 * test puisse le lire et refuser toute divergence entre l'intention déclarée
 * ici et ce que la fonction copie réellement.
 *
 * ⚠️ `gender` et `birthDate` NE SONT PAS ici, et c'est délibéré : aucun écran
 * afroboost ne les utilise aujourd'hui. Le jour où l'un d'eux en aura besoin,
 * on l'ajoutera ICI, ligne à ligne, en connaissance de cause — pas « au cas
 * où ».
 */
export const CHAMPS_SOCIAUX = [
  'displayName', 'photoURL', 'photos', 'bio', 'city', 'canton', 'sports',
] as const;

/**
 * Les champs de `users` dont la seule PRÉSENCE dans une sortie serait un
 * incident. Ce tableau ne sert PAS au filtrage — la liste blanche s'en charge
 * — il sert de FILET AU TEST : le banc vérifie qu'un `users` contenant chacun
 * d'eux produit un DTO qui n'en porte aucun. Deux barrières, une seule suffit,
 * mais on veut être prévenu si l'une cède.
 */
export const CHAMPS_INTERDITS = [
  'credits', 'isPremium', 'role', 'referralCode', 'referredBy', 'commission',
  'fcmToken', 'language', 'email', 'uid', 'activeSanctionId', 'activeSanctionLevel',
  'activeSanctionEndsAt', 'leakFlagged', 'pushNotificationsEnabled', 'isCreator',
  'onboardingComplete', 'createdAt', 'updatedAt', 'lastActive', 'birthDate', 'gender',
] as const;

function texte(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Une liste de chaînes, nettoyée : on jette tout ce qui n'est pas une chaîne
 *  non vide. Une URL de photo malformée en base ne doit pas devenir un trou. */
function listeDeTextes(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === 'string' ? x.trim() : '';
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Les sports, réduits à `{name, level}`. Toute autre propriété d'une entrée —
 *  y compris une qui aurait été ajoutée par erreur — est écartée. */
function sportsPublics(v: unknown): SportPublic[] {
  if (!Array.isArray(v)) return [];
  const out: SportPublic[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') continue;
    const name = texte((s as Record<string, unknown>).name).trim();
    if (!name) continue;
    const level = texte((s as Record<string, unknown>).level).trim();
    out.push({ name, level });
    if (out.length >= 30) break;
  }
  return out;
}

/**
 * LE FILTRE. Un `users` brut entre, un `UnifiedSocialProfile` sort — et il ne
 * peut contenir QUE les sept champs du contrat, chacun recopié explicitement.
 *
 * `photos[]` prend le pas sur `photoURL` (BUG #35 : les docs récents portent le
 * tableau, les anciens le singulier) ; `photoURL` complète en tête si le
 * tableau est vide. On ne fabrique aucune URL : on recopie celles de la base,
 * qui pointent sur Firebase Storage et restent valables telles quelles.
 */
export function versProfilSocial(brut: unknown): UnifiedSocialProfile {
  const u = (brut && typeof brut === 'object') ? (brut as Record<string, unknown>) : {};
  const photoURL = texte(u.photoURL).trim() || null;
  let photos = listeDeTextes(u.photos, 5);
  if (photos.length === 0 && photoURL) photos = [photoURL];
  return {
    displayName: texte(u.displayName).trim(),
    photoURL,
    photos,
    bio: texte(u.bio),
    city: texte(u.city).trim(),
    canton: texte(u.canton).trim(),
    sports: sportsPublics(u.sports),
  };
}

/**
 * LA RÉPONSE DE LA ROUTE. Union discriminée : ou bien le compte est lié et on
 * a un profil, ou bien il ne l'est pas — et « non lié » n'est PAS une erreur.
 * afroboost affiche alors « relie ton profil », pas une page cassée.
 */
export type ReponseProfilUnifie =
  | { lie: true; profil: UnifiedSocialProfile }
  | { lie: false; motif: 'non_lie' | 'introuvable' };
