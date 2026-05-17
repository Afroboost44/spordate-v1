/**
 * BUG #35 — Helpers profile photos array (read + normalize).
 *
 * Root cause : profile/page.tsx (fix #13) sauvait UNIQUEMENT photos[0]
 * dans le champ Firestore `photoURL` (singulier, legacy). Les 4 autres
 * photos uploadées sur Storage étaient orphelines → perdues au reload
 * (setPhotos lisait juste [photoURL] = 1 seule URL).
 *
 * Solution : ajouter `UserProfile.photos?: string[]` (additif, backward
 * compat). Helpers ici :
 *  - readProfilePhotos : load avec priorité photos[], fallback photoURL
 *    (handle docs pré-#35 qui n'ont que photoURL singulier).
 *  - normalizePhotosForSave : dedup + truncate max 5 + sync photoURL=[0]
 *    pour les consumers legacy comme discovery (firestoreProfileToCard
 *    line 101 utilise user.photoURL).
 *
 * @module
 */

export interface ProfileLike {
  photos?: string[] | null;
  photoURL?: string | null;
}

/** Max 5 photos par profil (cohérent UI grid 5 slots). */
export const PROFILE_PHOTOS_MAX = 5;

/**
 * Read photos depuis le UserProfile avec backward compat.
 * Priorité : photos[] (non-empty) → photoURL (legacy singulier) → [].
 */
export function readProfilePhotos(profile: ProfileLike | null | undefined): string[] {
  if (!profile) return [];
  const photos = profile.photos;
  if (Array.isArray(photos) && photos.length > 0) {
    return photos.filter((p) => typeof p === 'string' && p.trim().length > 0);
  }
  const single = profile.photoURL;
  if (typeof single === 'string' && single.trim().length > 0) {
    return [single];
  }
  return [];
}

export interface NormalizedPhotosPayload {
  /** Array clean (deduped, truncated, defensive filter). */
  photos: string[];
  /** Premier élément ou '' — pour sync legacy `photoURL` consumers. */
  photoURL: string;
}

/**
 * Normalise un array de photos pour écriture Firestore :
 *  - skip non-string / empty / whitespace
 *  - dedup ordre du premier hit préservé
 *  - truncate à max (défaut 5)
 *  - retourne aussi photoURL = photos[0] || '' pour compat legacy
 */
export function normalizePhotosForSave(
  rawPhotos: ReadonlyArray<unknown>,
  max = PROFILE_PHOTOS_MAX,
): NormalizedPhotosPayload {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of rawPhotos) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
    if (cleaned.length >= max) break;
  }
  return {
    photos: cleaned,
    photoURL: cleaned[0] ?? '',
  };
}
