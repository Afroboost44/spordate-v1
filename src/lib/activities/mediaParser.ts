/**
 * Phase 9.5 c4 — Media URL parser (YouTube / Vimeo / Google Drive).
 *
 * Pure helpers (no Firestore, no fetch) :
 *   - parseVideoUrl(url) : detect provider + videoId/fileId + embedUrl iframe-ready
 *   - isImageUrl(url) : extension-based heuristique (best-effort, no HEAD probe)
 *
 * Patterns YouTube supportés :
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://m.youtube.com/watch?v=VIDEO_ID
 *   - https://www.youtube.com/shorts/VIDEO_ID (Phase 9.5 c10.A — short-form support)
 *   - URLs avec query params multiples (t=120, list=PL..., si=...) → ignorés
 *   - URLs avec spaces leading/trailing → trim() dès l'entrée
 *
 * Patterns Vimeo supportés :
 *   - https://vimeo.com/VIDEO_ID
 *   - https://player.vimeo.com/video/VIDEO_ID
 *
 * Patterns Google Drive supportés :
 *   - https://drive.google.com/file/d/FILE_ID/view
 *   - https://drive.google.com/file/d/FILE_ID/preview
 *   - https://drive.google.com/open?id=FILE_ID
 *
 * Extensions images détectées : jpg/jpeg/png/gif/webp/svg/bmp/avif (case insensitive).
 *
 * @module
 */

export type VideoProvider = 'youtube' | 'vimeo' | 'drive';

export interface ParsedVideoUrl {
  provider: VideoProvider;
  /** ID extrait : YouTube videoId, Vimeo videoId, Drive fileId. */
  videoId: string;
  /** URL iframe `src` ready-to-use (ex: https://www.youtube.com/embed/{id}). */
  embedUrl: string;
}

/**
 * Parse a video URL and return provider + videoId + embedUrl.
 * Returns `null` si URL ne match aucun pattern connu.
 */
export function parseVideoUrl(url: string | null | undefined): ParsedVideoUrl | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  // YouTube — watch?v= / youtu.be/ / embed/ / shorts/ (Phase 9.5 c10.A)
  // Match groups: 1 = videoId (11 chars exact alphanum + - _ — spec officielle YouTube)
  const ytWatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (ytWatch) {
    const videoId = ytWatch[1];
    return {
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
    };
  }

  // Vimeo — vimeo.com/{id} OR player.vimeo.com/video/{id}
  const vimeo = trimmed.match(
    /(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/,
  );
  if (vimeo) {
    const videoId = vimeo[1];
    return {
      provider: 'vimeo',
      videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}`,
    };
  }

  // Google Drive — file/d/{id}/view OR open?id={id}
  const driveFile = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFile) {
    const fileId = driveFile[1];
    return {
      provider: 'drive',
      videoId: fileId,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    };
  }
  const driveOpen = trimmed.match(/drive\.google\.com\/open\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (driveOpen) {
    const fileId = driveOpen[1];
    return {
      provider: 'drive',
      videoId: fileId,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    };
  }

  return null;
}

/**
 * Phase 9.5 c6 — embed URL avec opts autoplay/muted/loop pour preview cards listing.
 *
 * Behaviors :
 *  - YouTube : autoplay=1 nécessite mute=1 (browser policy). loop=1 nécessite playlist={videoId}.
 *    controls=0 + modestbranding=1 + rel=0 → embed minimaliste sans branding.
 *    playsinline=1 → iOS Safari respecte autoplay sur mobile.
 *  - Vimeo : autoplay=1 nécessite muted=1. background=1 → pas de controls, autoplay+loop+muted activés
 *    par défaut (idéal preview hero card). dnt=1 → no tracking.
 *  - Drive : embed via /preview (la share URL /view?usp=sharing n'est PAS embeddable).
 *    Drive ne supporte que le param autoplay (BUG #5).
 *
 * Charte UX : opts.autoplay=true par défaut listing card, false sur detail page (MediaCarousel
 * où user voit player full controls).
 *
 * @param item MediaItem (must be type='video')
 * @param opts.autoplay default true
 * @param opts.muted default true (browser policy autoplay requires muted)
 * @param opts.loop default true (replay automatique listing card)
 * @returns iframe src URL, ou null si type!=='video' / provider inconnu
 */
export function getVideoEmbedUrl(
  item: { type: string; url?: string; provider?: string; videoId?: string; embedUrl?: string },
  opts: { autoplay?: boolean; muted?: boolean; loop?: boolean } = {},
): string | null {
  if (item.type !== 'video') return null;
  const autoplay = opts.autoplay !== false; // default true
  const muted = opts.muted !== false;
  const loop = opts.loop !== false;

  // Récupère provider + videoId (re-parse si pas stocké, cohérent getVideoThumbnail c5)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stored = (item as any).videoId as string | undefined;
  let provider = item.provider;
  let videoId: string | undefined = stored;
  if (!videoId && item.url) {
    const parsed = parseVideoUrl(item.url);
    if (parsed) {
      provider = parsed.provider;
      videoId = parsed.videoId;
    }
  }
  if (!videoId) return null;

  if (provider === 'youtube') {
    const params = new URLSearchParams();
    if (autoplay) params.set('autoplay', '1');
    if (muted) params.set('mute', '1');
    if (loop) {
      params.set('loop', '1');
      params.set('playlist', videoId); // YouTube requires playlist=videoId pour loop
    }
    params.set('controls', '0');
    params.set('modestbranding', '1');
    params.set('rel', '0');
    params.set('playsinline', '1');
    params.set('enablejsapi', '1'); // postMessage API (mute/unmute toggle c6)
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }
  if (provider === 'vimeo') {
    const params = new URLSearchParams();
    if (autoplay) params.set('autoplay', '1');
    if (muted) params.set('muted', '1');
    if (loop) params.set('loop', '1');
    params.set('background', autoplay && muted && loop ? '1' : '0');
    params.set('dnt', '1');
    params.set('playsinline', '1');
    return `https://player.vimeo.com/video/${videoId}?${params.toString()}`;
  }
  if (provider === 'drive') {
    // BUG #5 — embed Drive via /preview (la share URL /view?usp=sharing n'est
    // PAS embeddable : Drive refuse l'iframe sans /preview). Drive ne supporte
    // que le param autoplay (pas muted/loop).
    const qs = autoplay ? '?autoplay=1' : '';
    return `https://drive.google.com/file/d/${videoId}/preview${qs}`;
  }
  // Provider inconnu → pas d'embed
  return null;
}

/**
 * Phase 9.5 c5 + c10.A — extract video thumbnail URL pour preview cards listing.
 *
 * Behaviors :
 *  - YouTube : retourne `hqdefault.jpg` (toujours dispo même vidéos privées/non-listées)
 *  - Vimeo : retourne null (oEmbed API requise → defer)
 *  - Drive : retourne le thumbnail non-officiel `drive.google.com/thumbnail?id=` (BUG #5)
 *
 * Pour gérer les vidéos rares où hqdefault retourne le 120x90 grey placeholder
 * de YouTube (vidéos supprimées/privées), utiliser `getVideoThumbnailChain()`
 * qui retourne [hq, mq, default] — le caller chaîne via onError.
 *
 * @param item MediaItem (must be type='video')
 * @returns primary thumbnail URL ou null si non disponible
 */
export function getVideoThumbnail(item: { type: string; url?: string; provider?: string; videoId?: string }): string | null {
  const chain = getVideoThumbnailChain(item);
  return chain.length > 0 ? chain[0] : null;
}

/**
 * Phase 9.5 c10.A — Fallback chain de thumbnails YouTube.
 *
 * Returns [hqdefault, mqdefault, default] — le caller chain via onError handler :
 *   ```tsx
 *   const [idx, setIdx] = useState(0);
 *   <img src={chain[idx]} onError={() => setIdx(i => i+1 < chain.length ? i+1 : i)} />
 *   ```
 *
 * Si la chaine est épuisée → null caller doit fallback placeholder Video icon.
 *
 * @param item MediaItem
 * @returns Array of URLs en ordre de qualité (YouTube hq→mq→default ; Drive w800→w400),
 *          empty si Vimeo / provider inconnu
 */
export function getVideoThumbnailChain(
  item: { type: string; url?: string; provider?: string; videoId?: string },
): string[] {
  if (item.type !== 'video') return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stored = (item as any).videoId as string | undefined;
  let provider = item.provider;
  let videoId: string | undefined = stored;
  if (!videoId && item.url) {
    const parsed = parseVideoUrl(item.url);
    if (parsed) {
      provider = parsed.provider;
      videoId = parsed.videoId;
    }
  }
  if (!videoId) return [];
  if (provider === 'youtube') {
    return [
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      `https://img.youtube.com/vi/${videoId}/default.jpg`,
    ];
  }
  if (provider === 'drive') {
    // BUG #5 — thumbnail Drive non-officiel : fonctionne pour les fichiers
    // partagés "anyone with link". Le caller walk w800 → w400 via onError,
    // puis fallback logo Spordateur si tout échoue.
    return [
      `https://drive.google.com/thumbnail?id=${videoId}&sz=w800`,
      `https://drive.google.com/thumbnail?id=${videoId}&sz=w400`,
    ];
  }
  return [];
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif'];

/**
 * Heuristique extension-based : true si URL semble pointer une image.
 * Ne fait PAS de HEAD probe (best-effort client-side).
 *
 * Edge cases :
 *  - Firebase Storage URLs (`firebasestorage.googleapis.com/...?alt=media`) : matched via path extension
 *  - URLs sans extension visible (CDN dynamiques) : retourne false (caller peut force type='image')
 */
export function isImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  // Strip query string + fragment pour matcher l'extension
  const pathOnly = lower.split('?')[0].split('#')[0];
  return IMAGE_EXTENSIONS.some((ext) => pathOnly.endsWith(ext));
}
