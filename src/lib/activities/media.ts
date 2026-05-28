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
 * Fix #206 — Placeholder neutre rose accent uni. Fallback final quand un
 * MediaItem image n'a aucune URL exploitable (jamais de placeholder
 * "tasse de café" / image random). L'ancien fichier /brand/icon-512.png
 * a été supprimé physiquement du repo (suppression du logo "S").
 */
export const SPORDATEUR_LOGO_FALLBACK = '/icons/placeholder.png';

/**
 * BUG #6 — Extrait l'ID d'une URL Google Drive `/file/d/{id}/...` (formats share
 * `/view?usp=sharing`, `/edit`, `/preview`). Retourne `null` si l'URL n'est pas
 * une URL Drive `/file/d/`.
 *
 * Une share URL Drive ne charge PAS dans une balise `<img>` (Drive renvoie une
 * page HTML, pas l'image) — il faut la convertir en `drive.google.com/thumbnail`.
 *
 * Pure (no DOM, no network) → testable unit.
 */
export function parseDriveImageUrl(
  url: string | null | undefined,
): { id: string } | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  return m && m[1] ? { id: m[1] } : null;
}

/**
 * Résout l'URL `<img src>` d'un MediaItem `type='image'` rendu par <MediaCarousel>.
 *
 * Chaîne de fallback :
 *   1. URL custom uploadée / CDN classique → telle quelle
 *   2. Image hébergée sur Google Drive (share URL `/file/d/{id}/view`) →
 *      `drive.google.com/thumbnail?id={id}&sz=w800` (BUG #6 — la share URL ne
 *      charge pas dans un `<img>`)
 *   3. Lien YouTube (collé comme image, ou hérité de `images: string[]` legacy)
 *      → miniature `hqdefault.jpg` extraite automatiquement
 *   4. URL vide / whitespace / null / undefined → logo Spordateur
 *
 * Pure (no DOM, no network) → testable unit.
 */
export function resolveMediaImageSrc(url: string | null | undefined): string {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return SPORDATEUR_LOGO_FALLBACK;
  const drive = parseDriveImageUrl(trimmed);
  if (drive) return `https://drive.google.com/thumbnail?id=${drive.id}&sz=w800`;
  return resolveThumbnail(trimmed) || SPORDATEUR_LOGO_FALLBACK;
}

/**
 * Construit la chaîne d'URLs `<Image src>` essayées par <SessionMediaPlayer>
 * (walk via `onError`). Terminée **toujours** par le logo Spordateur — jamais
 * par une photo random Picsum.
 *
 *   resolveSessionImageChain(null)                    → ['/icons/placeholder.png']
 *   resolveSessionImageChain('https://cdn/x.jpg')     → ['https://cdn/x.jpg', '/icons/placeholder.png']
 *   resolveSessionImageChain('https://youtu.be/ID')   → ['https://img.youtube.com/vi/ID/hqdefault.jpg', '/icons/placeholder.png']
 *   resolveSessionImageChain('https://a.jpg', ['b'])  → ['https://a.jpg', 'b', '/icons/placeholder.png']
 *
 * @param primaryUrl URL primaire (media.url ou media.posterUrl). Résolue via
 *   resolveMediaImageSrc (Drive → thumbnail, lien YouTube → miniature, vide → ignoré).
 * @param fallbacks  URLs de repli. Résolues elles aussi via resolveMediaImageSrc
 *   (BUG #6 — une URL Drive en fallback doit aussi être transformée). Idempotent
 *   pour les URLs déjà résolues (thumbnails YouTube/Drive → passthrough).
 *
 * Pure (no DOM, no network) → testable unit.
 */
export function resolveSessionImageChain(
  primaryUrl: string | null | undefined,
  fallbacks?: string[],
): string[] {
  // BUG #65 — On ne push PLUS SPORDATEUR_LOGO_FALLBACK à la fin du chain.
  // Le logo cœur-flèche (icon-512.png) n'est pas le bon logo Spordateur et
  // s'affichait sur les pages session quand l'activity n'avait pas d'image
  // statique (ex: vidéo upload Storage). SessionMediaPlayer gère désormais
  // le cas chain vide via un placeholder neutre.
  const hasPrimary =
    typeof primaryUrl === 'string' && primaryUrl.trim().length > 0;
  const tail = (fallbacks ?? [])
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map((u) => resolveMediaImageSrc(u));
  return [
    ...(hasPrimary ? [resolveMediaImageSrc(primaryUrl)] : []),
    ...tail,
  ];
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
