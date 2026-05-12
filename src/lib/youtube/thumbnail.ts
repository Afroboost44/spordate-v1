/**
 * Phase 9.5 c48 BUG A — Helper extraction miniature YouTube.
 *
 * Convertit une URL YouTube (différents formats) en URL miniature
 * https://img.youtube.com/vi/{videoId}/hqdefault.jpg utilisable directement
 * dans une balise <img>.
 *
 * Formats supportés :
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 *  - https://youtu.be/VIDEO_ID
 *  - https://www.youtube.com/embed/VIDEO_ID
 *  - https://www.youtube.com/shorts/VIDEO_ID
 *  - https://m.youtube.com/watch?v=VIDEO_ID (mobile)
 *  - URLs avec query params additionnels (t=, list=, etc.)
 *
 * Retourne `null` si l'URL n'est pas reconnue comme YouTube — le caller
 * doit fallback à l'image originale (`<img src={url}>` direct fonctionne
 * pour les CDN classiques).
 *
 * Pure (no DOM, no network) → testable unit.
 */

/** Regex robustes pour extraire un video ID YouTube (11 chars alphanumériques + - _). */
const YOUTUBE_PATTERNS: RegExp[] = [
  // https://www.youtube.com/watch?v=XXX  ou /watch?other&v=XXX
  /(?:youtube\.com\/watch\?(?:[^&]+&)*v=)([A-Za-z0-9_-]{11})/,
  // https://youtu.be/XXX
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  // https://www.youtube.com/embed/XXX
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  // https://www.youtube.com/shorts/XXX
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];

/**
 * Extrait l'ID vidéo YouTube depuis une URL ; retourne `null` si non-YouTube.
 */
export function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Retourne l'URL miniature YouTube haute qualité, ou `null` si non-YouTube.
 *
 * @param url URL YouTube (watch / youtu.be / embed / shorts)
 * @param quality `default` (120×90) | `hq` (480×360, défaut) | `max` (1280×720 si dispo)
 */
export function extractYouTubeThumb(
  url: string | null | undefined,
  quality: 'default' | 'hq' | 'max' = 'hq',
): string | null {
  const id = extractYouTubeId(url);
  if (!id) return null;
  const file = quality === 'max' ? 'maxresdefault.jpg' : quality === 'default' ? 'default.jpg' : 'hqdefault.jpg';
  return `https://img.youtube.com/vi/${id}/${file}`;
}

/**
 * Helper UI : retourne l'URL miniature YouTube si l'URL est YouTube, sinon
 * retourne l'URL originale telle quelle (fallback pour CDN images classiques).
 *
 * Usage card listing : `<img src={resolveThumbnail(media.url)} />`
 */
export function resolveThumbnail(url: string | null | undefined): string {
  if (!url) return '';
  return extractYouTubeThumb(url) ?? url;
}
