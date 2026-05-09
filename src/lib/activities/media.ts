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
