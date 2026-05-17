/**
 * BUG #30 étape 3 — Helpers Drive migration (frontend + référence pour CF).
 *
 * Workflow : partenaire colle URL Drive → CF onWrite télécharge le fichier
 * et le réuploade vers Firebase Storage → frontend joue en HTML5 <video>
 * natif (zéro redirection externe).
 *
 * Ces helpers servent à :
 *  - Frontend (MediaItemRender) : détecter si un item est Storage video
 *    pour render <video> au lieu de iframe/thumbnail.
 *  - Cloud Function (functions/src/triggers/migrate-drive-videos.ts) :
 *    détecter quels items à migrer, construire les paths Storage.
 *    Comme functions/src/ et src/lib/ sont des packages séparés (rootDir
 *    différents), la CF recopie inline les mêmes helpers. Source de
 *    vérité = ce fichier, tests ici, CF doit rester en sync.
 *
 * @module
 */

interface MediaItemShape {
  url?: string;
  type?: string;
  source?: string;
  provider?: string;
}

/**
 * Vrai si l'item est un MediaItem Drive (vidéo, source=url, provider=drive).
 * Ne dit RIEN sur l'état de migration (utiliser shouldMigrateMediaItem).
 */
export function isDriveMediaItem(item: MediaItemShape | null | undefined): boolean {
  if (!item) return false;
  return item.provider === 'drive' && item.source === 'url' && item.type === 'video';
}

/**
 * Vrai si l'item nécessite une migration Drive→Storage :
 *  - C'est un Drive vidéo (isDriveMediaItem)
 *  - ET son URL pointe encore vers Drive (pas déjà hébergé sur Storage)
 *
 * Defensive : url undefined / non-Drive URL / type≠video → false.
 */
export function shouldMigrateMediaItem(item: MediaItemShape | null | undefined): boolean {
  if (!isDriveMediaItem(item)) return false;
  const url = (item?.url ?? '').toLowerCase();
  if (!url) return false;
  // Déjà sur Storage (cas migré) → skip
  if (url.includes('firebasestorage.googleapis.com')) return false;
  // Doit pointer vers drive.google.com (defensive)
  return url.includes('drive.google.com');
}

/** Extensions vidéo reconnues HTML5. Lowercase compare. */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.ogg'];

/**
 * Vrai si l'URL pointe vers une vidéo Firebase Storage (host
 * firebasestorage.googleapis.com + extension reconnue).
 *
 * Frontend utilise pour décider entre <video> natif vs iframe.
 */
export function isStorageVideoUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (!lower.includes('firebasestorage.googleapis.com')) return false;
  // L'URL Storage peut avoir des query params (?alt=media&token=...) après le path.
  // On vérifie l'extension dans la partie path uniquement (avant le ?).
  const pathPart = lower.split('?')[0];
  return VIDEO_EXTENSIONS.some((ext) => pathPart.endsWith(ext));
}

/**
 * Construit le path Storage pour une vidéo migrée Drive.
 * Format : `activities/{activityId}/videos/{fileId}.{ext}`
 *
 * @param activityId ID du doc Firestore activities/{id}
 * @param fileId Drive fileId extrait via extractDriveFileId
 * @param ext Extension sans le dot (défaut 'mp4')
 */
export function buildStorageVideoPath(activityId: string, fileId: string, ext = 'mp4'): string {
  return `activities/${activityId}/videos/${fileId}.${ext}`;
}
