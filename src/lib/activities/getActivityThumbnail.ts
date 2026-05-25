/**
 * Fix #146 — Helper unique pour résoudre la miniature d'une activité.
 *
 * Pourquoi ce fichier ?
 * ---------------------
 * Avant, chaque endroit qui devait afficher la miniature d'une activité (cards
 * discovery, modal "Où pratiquer", modal ActivitySelector chat, /partner/offers,
 * page session) ré-écrivait la chaîne de fallback à la main. À chaque nouveau
 * call site, le développeur :
 *  - oubliait un fallback (ex: thumbnailUrl custom du VideoThumbnailPicker)
 *  - inversait l'ordre de priorité
 *  - remplaçait par un placeholder générique en mode "TODO"
 *
 * Résultat : la miniature qui marchait quelque part disparaissait ailleurs
 * (ex: bug récurrent #126, #140, miniature Zap rose dans "Où pratiquer").
 *
 * Solution : UN SEUL helper que tous les call sites doivent utiliser.
 *
 * Chaîne de priorité (du plus spécifique au plus générique) :
 *  1. activity.thumbnailUrl                      — explicite, défini par le partner
 *  2. activity.mediaItems[0] type='image'        — première image upload (#126)
 *  3. activity.mediaItems[0] type='video'.thumb  — miniature custom video (#122)
 *  4. activity.mediaItems[0] type='video' chain  — auto YouTube/Drive thumbnail
 *  5. activity.imageUrl (legacy, si image-like)  — backward compat
 *  6. null → caller doit afficher fallback (logo Spordateur, icône, etc.)
 *
 * @module
 */

import { getVideoThumbnailChain, isImageUrl } from './mediaParser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyActivity = Record<string, any>;

/**
 * Retourne l'URL de la première miniature résolvable pour cette activité,
 * ou `null` si aucune image trouvable (caller affiche fallback générique).
 *
 * Le caller peut aussi utiliser `<img onError>` pour walk vers une autre URL —
 * ce helper retourne la PREMIÈRE priorité ; pour le walk multi-fallback complet
 * (ex: YouTube hq → mq → default), utiliser `getActivityThumbnailChain()`.
 */
export function getActivityThumbnail(activity: AnyActivity | null | undefined): string | null {
  if (!activity) return null;
  const chain = getActivityThumbnailChain(activity);
  return chain[0] || null;
}

/**
 * Retourne la chaîne complète de fallbacks (utiliser avec `<img onError>` qui
 * walk vers index+1 quand une URL renvoie 404).
 */
export function getActivityThumbnailChain(activity: AnyActivity | null | undefined): string[] {
  if (!activity) return [];

  const chain: string[] = [];

  // 1. thumbnailUrl explicite (le plus prioritaire — partner choix)
  if (typeof activity.thumbnailUrl === 'string' && activity.thumbnailUrl.length > 0) {
    chain.push(activity.thumbnailUrl);
  }

  // 1bis. Fix #153 — champ legacy `images[]` (string[]) utilisé par certaines
  // activités créées avant le pivot mediaItems[]. Premier élément valide gagne.
  if (Array.isArray(activity.images)) {
    for (const url of activity.images) {
      if (typeof url === 'string' && url.length > 0 && !chain.includes(url)) {
        chain.push(url);
        break;
      }
    }
  }

  // 2. mediaItems[] — premier image OU video.thumbnail
  const mediaItems = Array.isArray(activity.mediaItems)
    ? activity.mediaItems
    : Array.isArray(activity.mediaUrls)
      ? activity.mediaUrls
      : [];

  // Fix #183 — Cherche une image. Avant : exigeait strict `m.type === 'image'`,
  // ce qui ratait les mediaUrls legacy qui sont des strings simples ou des
  // objets sans `type`. Maintenant : on accepte aussi un string direct OU un
  // objet sans type si l'URL est image-like (isImageUrl du mediaParser).
  for (const m of mediaItems) {
    if (!m) continue;
    const url = typeof m === 'string' ? m : (m as AnyActivity).url;
    const type = typeof m === 'object' ? (m as AnyActivity).type : undefined;
    if (typeof url !== 'string' || !url) continue;
    // Match : type explicite 'image' OU type absent + URL image-like
    if (type === 'image' || (!type && isImageUrl(url))) {
      if (!chain.includes(url)) chain.push(url);
      break;
    }
  }

  // Puis les vidéos (custom thumb d'abord, puis chaîne auto)
  const firstVideo = mediaItems.find((m: AnyActivity) => m && typeof m === 'object' && m.type === 'video');
  if (firstVideo) {
    const videoChain = getVideoThumbnailChain(firstVideo);
    for (const url of videoChain) {
      if (url && !chain.includes(url)) chain.push(url);
    }
  }

  // 3. imageUrl legacy (backward compat, uniquement si image-like)
  if (
    typeof activity.imageUrl === 'string' &&
    activity.imageUrl.length > 0 &&
    isImageUrl(activity.imageUrl) &&
    !chain.includes(activity.imageUrl)
  ) {
    chain.push(activity.imageUrl);
  }

  // 4. Fix #155 — Filet ultime : on scanne TOUS les champs string de l'activité
  // pour récupérer toute URL qui ressemble à une image (Firebase Storage, CDN
  // classique, etc.). Couvre les cas où l'image est stockée dans un champ
  // legacy/custom non standardisé (`coverImage`, `posterUrl`, `photo`, etc.).
  // Cette pass n'écrase RIEN — elle ajoute juste des candidats à la fin de la
  // chaîne, donc seul un caller qui itère sur les fallbacks les utilisera.
  const KNOWN_HOSTS = [
    'firebasestorage.googleapis.com',
    'images.unsplash.com',
    'i.imgur.com',
    'cdn',
  ];
  for (const [key, value] of Object.entries(activity)) {
    if (typeof value !== 'string' || value.length < 8) continue;
    if (chain.includes(value)) continue;
    // Skip les clés qu'on a déjà traité explicitement pour éviter doublons.
    if (['thumbnailUrl', 'imageUrl'].includes(key)) continue;
    // Image probable si extension image OU host connu.
    const isImageHost = KNOWN_HOSTS.some((host) => value.includes(host));
    if (isImageUrl(value) || (isImageHost && /\.(jpg|jpeg|png|webp|gif|svg)/i.test(value))) {
      chain.push(value);
    }
  }

  return chain;
}
