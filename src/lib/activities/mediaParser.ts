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

  // YouTube — watch?v= / youtu.be/ / embed/
  // Match groups: 1 = videoId
  const ytWatch = trimmed.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
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
 *  - Drive : pas d'autoplay fiable côté Google Drive embed → return null (caller fallback thumbnail c5).
 *
 * Charte UX : opts.autoplay=true par défaut listing card, false sur detail page (MediaCarousel
 * où user voit player full controls).
 *
 * @param item MediaItem (must be type='video')
 * @param opts.autoplay default true
 * @param opts.muted default true (browser policy autoplay requires muted)
 * @param opts.loop default true (replay automatique listing card)
 * @returns iframe src URL ou null si non embeddable autoplay (Drive)
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
  // Drive : pas d'autoplay fiable → null (caller fallback thumbnail static c5)
  return null;
}

/**
 * Phase 9.5 c5 — extract video thumbnail URL pour preview cards listing.
 *
 * Behaviors :
 *  - YouTube : retourne `https://img.youtube.com/vi/{videoId}/hqdefault.jpg` (toujours dispo, même vidéos privées)
 *  - Vimeo : retourne null (oEmbed API requise → fetch async, defer Phase 10) → caller fallback placeholder
 *  - Drive : retourne null (pas de thumb stable Google) → caller fallback placeholder
 *
 * @param item MediaItem (must be type='video')
 * @returns thumbnail URL ou null si non disponible (caller doit fallback placeholder)
 */
export function getVideoThumbnail(item: { type: string; url?: string; provider?: string; videoId?: string }): string | null {
  if (item.type !== 'video') return null;
  // Si videoId déjà extrait (cohérent MediaItem post-parseVideoUrl)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stored = (item as any).videoId as string | undefined;
  // Sinon re-parse depuis url (backward compat MediaItem sans videoId stocké)
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
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  // Vimeo + Drive : pas de thumb URL stable côté client → caller fallback placeholder
  return null;
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
