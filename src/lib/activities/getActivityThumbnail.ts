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
 * Fix #205 (Silent Afroboost rose modal) — ajout `getActivityThumbnailMedia()`.
 * Cause racine : une activité dont SEUL média est une vidéo Firebase Storage
 * uploadée (mp4 sans VideoThumbnailPicker custom) retournait `null` ici :
 *  - pas de `thumbnailUrl` direct
 *  - pas de `images[]`
 *  - boucle `mediaItems` skip (item type='video', pas d'image)
 *  - `getVideoThumbnailChain` retourne [] pour Storage (provider 'direct' non
 *    supporté, seul YouTube/Vimeo/Drive ont des chains thumbnail auto)
 *  - pas de `imageUrl`/`thumbnailMedia`
 *  - scan top-level n'inspecte que les champs string (mediaUrls est un array)
 *  → chain vide → null → placeholder rose dans les modals.
 * La page liste /activities ne voyait pas le bug : elle rend la VIDEO direct
 * via `<video preload="metadata">`, montrant la 1ère frame.
 * Fix : nouveau helper qui renvoie `{kind:'video', url}` quand seule une vidéo
 * upload est disponible, permettant aux modals de rendre `<video>` au lieu de
 * `<img>` (1ère frame visible identique à la page listing).
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

  // 1bis. Fix #153 — champ legacy `images[]` utilisé par certaines activités
  // créées avant le pivot mediaItems[]. Bug récurrent Bassi 28/05 (épisode 2) :
  // on PUSH TOUS les candidats dans la chain (au lieu de break après le 1er)
  // pour que `<img onError>` puisse walk vers les suivants si le 1er 404.
  // Supporte aussi `images[]` contenant des objets `{url, ...}` (cas legacy
  // jamais migré → certains seed scripts mettent des objets, pas des strings).
  if (Array.isArray(activity.images)) {
    for (const item of activity.images) {
      let url: string | undefined;
      if (typeof item === 'string') url = item;
      else if (item && typeof item === 'object' && typeof (item as AnyActivity).url === 'string') {
        url = (item as AnyActivity).url as string;
      }
      if (url && url.length > 0 && !chain.includes(url)) {
        chain.push(url);
      }
    }
  }

  // 2. mediaItems[] — premier image OU video.thumbnail
  const mediaItems = Array.isArray(activity.mediaItems)
    ? activity.mediaItems
    : Array.isArray(activity.mediaUrls)
      ? activity.mediaUrls
      : [];

  // Fix #183 + #186 — Cherche une image. Match généreux :
  //  - type='image' explicite → match
  //  - string directe (legacy mediaUrls: ['url1', 'url2']) → match si pas vidéo
  //  - objet sans type → match si URL pas vidéo (Firebase Storage URLs n'ont
  //    pas toujours d'extension claire → on présume image par défaut)
  // Heuristique vidéo : URL contient .mp4/.webm/.mov/.m4v (encoded ou pas).
  const looksLikeVideo = (u: string): boolean => {
    const s = u.toLowerCase();
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(s)
      || /(%2[fF])?[^/]*\.(mp4|webm|mov|m4v)/i.test(s);
  };
  for (const m of mediaItems) {
    if (!m) continue;
    const url = typeof m === 'string' ? m : (m as AnyActivity).url;
    const type = typeof m === 'object' ? (m as AnyActivity).type : undefined;
    if (typeof url !== 'string' || !url) continue;
    // Match large : type='image' OU pas de type vidéo + pas vidéo-like
    if (type === 'image') {
      if (!chain.includes(url)) chain.push(url);
      break;
    }
    if ((!type || type !== 'video') && !looksLikeVideo(url)) {
      // Considère image par défaut (couvre Firebase Storage sans extension)
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

  // 3bis. Fix #204 — `thumbnailMedia` (Phase 2 / Sessions UI). Champ nested
  // explicitement défini dans le type Activity (cf. types/firestore.ts) :
  //   thumbnailMedia?: { type: 'image' | 'video'; url: string; posterUrl?: string }
  // Sans ce parsing, une activité boostée qui n'a QUE thumbnailMedia (cas
  // partenaire qui choisit une vidéo en miniature de session) retombait sur
  // le filet ultime générique — bug visuel intermittent sur les modals
  // "Où pratiquer" / "Choisir une activité". On le push ici en priorité 3bis
  // pour qu'il batte le scan brute force, et seulement si pas déjà dans la
  // chain (anti-doublon idempotent).
  const thumbMedia = activity.thumbnailMedia as
    | { type?: string; url?: string; posterUrl?: string }
    | undefined;
  if (thumbMedia && typeof thumbMedia === 'object') {
    if (
      typeof thumbMedia.posterUrl === 'string' &&
      thumbMedia.posterUrl.length > 0 &&
      !chain.includes(thumbMedia.posterUrl)
    ) {
      chain.push(thumbMedia.posterUrl);
    }
    if (
      typeof thumbMedia.url === 'string' &&
      thumbMedia.url.length > 0 &&
      thumbMedia.type === 'image' &&
      !chain.includes(thumbMedia.url)
    ) {
      chain.push(thumbMedia.url);
    }
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
  const tryPushImageUrl = (value: string, key: string) => {
    if (typeof value !== 'string' || value.length < 8) return;
    if (chain.includes(value)) return;
    if (['thumbnailUrl', 'imageUrl'].includes(key)) return;
    const isImageHost = KNOWN_HOSTS.some((host) => value.includes(host));
    if (isImageUrl(value) || (isImageHost && /\.(jpg|jpeg|png|webp|gif|svg)/i.test(value))) {
      chain.push(value);
    }
  };
  for (const [key, value] of Object.entries(activity)) {
    if (typeof value === 'string') {
      tryPushImageUrl(value, key);
    } else if (Array.isArray(value)) {
      // Bug récurrent Bassi 28/05 (épisode 2) — scan exhaustif des arrays de
      // strings (cas activités legacy avec champs custom non standardisés type
      // `photos: ['url1', 'url2']` ou objets `{url}` dans un champ inattendu).
      for (const item of value) {
        if (typeof item === 'string') {
          tryPushImageUrl(item, key);
        } else if (item && typeof item === 'object' && typeof (item as AnyActivity).url === 'string') {
          tryPushImageUrl((item as AnyActivity).url as string, key);
        }
      }
    }
  }

  return chain;
}

/**
 * Fix #205 — Variante "vidéo-aware" du helper.
 *
 * Retourne un descriptor `{kind, url}` au lieu d'une simple URL string. Permet
 * aux call sites (modals "Où pratiquer", "Choisir une activité"...) de rendre
 * `<video preload="metadata" muted>` quand SEUL média disponible est une vidéo
 * Firebase Storage uploadée — qui n'a aucune chain thumbnail auto-générable.
 *
 * Sans ce helper, ces activités tombaient sur le placeholder rose. La page
 * liste /activities masquait le bug en rendant la vidéo direct (1ère frame
 * visible via `<video preload="metadata">`).
 *
 * Priorité :
 *  1. Image trouvée par `getActivityThumbnail()` → {kind:'image', url}
 *  2. Première vidéo upload (Firebase Storage / mp4 direct) → {kind:'video', url}
 *  3. null
 *
 * Le caller utilise `kind` pour brancher `<img>` ou `<video>`. Idempotent côté
 * scan : on réutilise getActivityThumbnail pour les images (mêmes règles).
 */
export function getActivityThumbnailMedia(
  activity: AnyActivity | null | undefined,
): { kind: 'image' | 'video'; url: string } | null {
  if (!activity) return null;

  // 1. Tentative image standard (chain complète : thumbnailUrl → mediaItems
  //    image → video thumb auto → imageUrl → thumbnailMedia → scan exhaustif).
  const imageUrl = getActivityThumbnail(activity);
  if (imageUrl) {
    return { kind: 'image', url: imageUrl };
  }

  // 2. Filet ultime "vidéo upload" — cherche dans mediaItems / mediaUrls une
  //    première vidéo uploadée (Firebase Storage). Le composant peut alors
  //    rendre `<video preload="metadata" muted>` pour montrer la 1ère frame.
  //    NE TENTE PAS YouTube/Vimeo/Drive ici : ces providers ont déjà des
  //    chains thumbnail traitées par getActivityThumbnail (étape 1). Si on
  //    arrive ici, c'est qu'il n'y a aucune image résolvable du tout.
  const mediaItems = Array.isArray(activity.mediaItems)
    ? activity.mediaItems
    : Array.isArray(activity.mediaUrls)
      ? activity.mediaUrls
      : [];
  for (const m of mediaItems) {
    if (!m || typeof m !== 'object') continue;
    const url = (m as AnyActivity).url;
    const type = (m as AnyActivity).type;
    const source = (m as AnyActivity).source;
    if (type !== 'video' || typeof url !== 'string' || !url) continue;
    // Upload Storage OU URL .mp4/.webm/.mov direct → rendu video possible.
    const looksUploaded =
      source === 'upload' ||
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url.toLowerCase()) ||
      /firebasestorage\.googleapis\.com/.test(url);
    if (looksUploaded) {
      return { kind: 'video', url };
    }
  }

  // 3. thumbnailMedia type='video' avec url Storage (cas Phase 2 Sessions UI)
  const thumbMedia = activity.thumbnailMedia as
    | { type?: string; url?: string; posterUrl?: string }
    | undefined;
  if (
    thumbMedia &&
    typeof thumbMedia === 'object' &&
    thumbMedia.type === 'video' &&
    typeof thumbMedia.url === 'string' &&
    thumbMedia.url.length > 0
  ) {
    return { kind: 'video', url: thumbMedia.url };
  }

  return null;
}
