/**
 * Phase 9.5 c4 — getMediaItems helper (backward compat MediaItem[] vs string[]).
 *
 * Doctrine : transition douce vers Activity.mediaUrls (rich type) sans casser
 * les activités existantes qui utilisent Activity.images (string[]) Phase 1.
 *
 * Pipeline :
 *   1. Si mediaUrls présent (Phase 9.5 c4+) → return tel quel
 *   2. Sinon fallback : map images → MediaItem { type: 'image', source: 'url', url }
 *   3. Si aucun des deux → return [] (graceful)
 *
 * Migration douce : pas de write-back forcé. Quand le partner re-save l'activity
 * via /partner/offers, le nouveau format mediaUrls est persisté ; en attendant
 * le helper unifie la lecture.
 */

import type { MediaItem } from '@/types/firestore';
import { resolveThumbnail } from '@/lib/youtube/thumbnail';

/**
 * Logo neon Spordateur — fallback final quand un MediaItem image n'a aucune
 * URL exploitable (jamais de placeholder "tasse de café" / image random).
 */
export const SPORDATEUR_LOGO_FALLBACK = '/brand/icon-512.png';

/**
 * Résout l'URL `<img src>` d'un MediaItem `type='image'` rendu par <MediaCarousel>.
 *
 * Chaîne de fallback :
 *   1. URL custom uploadée / CDN classique → telle quelle
 *   2. Lien YouTube (collé comme image, ou hérité de `images: string[]` legacy)
 *      → miniature `hqdefault.jpg` extraite automatiquement
 *   3. URL vide / whitespace / null / undefined → logo Spordateur
 *
 * Pure (no DOM, no network) → testable unit.
 */
export function resolveMediaImageSrc(url: string | null | undefined): string {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  return resolveThumbnail(trimmed) || SPORDATEUR_LOGO_FALLBACK;
}

export function getMediaItems(
  activity: { mediaUrls?: MediaItem[]; images?: string[] } | null | undefined,
): MediaItem[] {
  if (!activity) return [];
  if (Array.isArray(activity.mediaUrls) && activity.mediaUrls.length > 0) {
    return activity.mediaUrls;
  }
  if (Array.isArray(activity.images) && activity.images.length > 0) {
    return activity.images
      .filter((url) => typeof url === 'string' && url.trim().length > 0)
      .map((url) => ({
        url: url.trim(),
        type: 'image' as const,
        source: 'url' as const,
      }));
  }
  return [];
}

/** Pure helper : retourne le 1er media (= image principale du card). Null si vide. */
export function getPrimaryMedia(
  activity: { mediaUrls?: MediaItem[]; images?: string[] } | null | undefined,
): MediaItem | null {
  const items = getMediaItems(activity);
  return items.length > 0 ? items[0] : null;
}
