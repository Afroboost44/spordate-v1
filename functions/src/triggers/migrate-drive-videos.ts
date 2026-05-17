/**
 * Spordateur — BUG #30 étape 3 — Cloud Function trigger Firestore.
 *
 * Auto-migration des vidéos Google Drive vers Firebase Storage au save d'une
 * activity. Objectif : workflow partner inchangé (paste URL Drive) mais
 * frontend joue la vidéo en HTML5 <video> natif (zéro redirection externe,
 * pas de CSP frame-ancestors, pas de iframe absorbing touch events mobile).
 *
 * Trigger : onDocumentWritten('activities/{activityId}')
 *  - Détecte les MediaItem provider='drive' source='url' dont l'url pointe
 *    vers drive.google.com (pas encore migrés vers firebasestorage).
 *  - Pour chaque item : fetch via `drive.google.com/uc?export=download&id={ID}`
 *    (URL publique, no auth), stream vers Storage
 *    `activities/{activityId}/videos/{fileId}.mp4`, génère download URL signée,
 *    update le doc Firestore avec la nouvelle URL.
 *  - Best-effort try/catch par item : un échec n'empêche pas les autres.
 *
 * Limites :
 *  - Fichier > 100MB : Drive affiche un interstitial "confirm download" qui
 *    casse le fetch direct. Fallback : log warning + laisse l'item Drive en
 *    place (frontend a fallback thumbnail #28).
 *  - Cold start 5-10s : pas d'impact UX (l'user voit l'item Drive en attendant).
 *  - Cloud Function v2 memory 256MB default : stream upload (pas tout en RAM).
 *
 * Idempotence :
 *  - L'update du doc Firestore re-trigger la CF (boucle potentielle).
 *  - Garde : si l'item est déjà migré (url contient firebasestorage), skip.
 *  - Marker `mediaMigration.driveCompletedAt` pour audit + skip rapide.
 *
 * Helpers inline : duplicate de src/lib/media/driveMigration.ts (rootDir
 * différents, pas d'import cross-package). Tests dans tests/media/drive-
 * migration.test.ts couvrent la logique partagée. Garder en sync manuellement.
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:migrateDriveVideosTrigger --project spordate-prod
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp, getApps } from 'firebase-admin/app';

const LOG_PREFIX = '[migrate-drive-videos]';

if (!getApps().length) initializeApp();

// =====================================================================
// Helpers inline (duplicate de src/lib/media/driveMigration.ts + driveThumbnail.ts)
// Garder en sync manuellement. Tests source de vérité : tests/media/drive-*.test.ts
// =====================================================================

interface MediaItemShape {
  url?: string;
  type?: string;
  source?: string;
  provider?: string;
  embedUrl?: string;
}

function isDriveMediaItem(item: MediaItemShape | null | undefined): boolean {
  if (!item) return false;
  return item.provider === 'drive' && item.source === 'url' && item.type === 'video';
}

function shouldMigrateMediaItem(item: MediaItemShape | null | undefined): boolean {
  if (!isDriveMediaItem(item)) return false;
  const url = (item?.url ?? '').toLowerCase();
  if (!url) return false;
  if (url.includes('firebasestorage.googleapis.com')) return false;
  return url.includes('drive.google.com');
}

function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  const openMatch = trimmed.match(/drive\.google\.com\/open\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];
  return null;
}

function buildStorageVideoPath(activityId: string, fileId: string, ext = 'mp4'): string {
  return `activities/${activityId}/videos/${fileId}.${ext}`;
}

// =====================================================================
// Migration helpers
// =====================================================================

const DRIVE_DOWNLOAD_URL_TEMPLATE = (fileId: string) =>
  `https://drive.google.com/uc?export=download&id=${fileId}`;

const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB

interface MigrationResult {
  success: boolean;
  storageUrl?: string;
  error?: string;
}

/**
 * Download Drive file → upload to Storage → return public download URL.
 * Best-effort : on échec retourne { success: false, error }.
 */
async function migrateOne(activityId: string, fileId: string): Promise<MigrationResult> {
  const downloadUrl = DRIVE_DOWNLOAD_URL_TEMPLATE(fileId);
  logger.info(`${LOG_PREFIX} fetch start activityId=${activityId} fileId=${fileId}`);

  try {
    const res = await fetch(downloadUrl, { redirect: 'follow' });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    // Detect Drive "confirm download" interstitial : si content-type est text/html, c'est l'interstitial
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      return { success: false, error: 'drive-interstitial (fichier > 100MB ou besoin confirm)' };
    }
    // Check size (Content-Length header si présent)
    const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
    if (contentLength > 0 && contentLength > MAX_VIDEO_BYTES) {
      return { success: false, error: `file too large (${contentLength} bytes > ${MAX_VIDEO_BYTES})` };
    }

    // Stream → Buffer (acceptable pour < 200MB en Cloud Function v2 256MB memory)
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_VIDEO_BYTES) {
      return { success: false, error: `downloaded size ${buffer.length} > ${MAX_VIDEO_BYTES}` };
    }

    const storagePath = buildStorageVideoPath(activityId, fileId);
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);

    // Generate stable access token for public download URL (HTML5 video).
    // Pattern Firebase Storage : metadata.firebaseStorageDownloadTokens = uuid → URL signée stable.
    const downloadToken = crypto.randomUUID();
    await file.save(buffer, {
      contentType: contentType || 'video/mp4',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          driveOriginalFileId: fileId,
          driveOriginalUrl: downloadUrl,
        },
      },
      resumable: false, // small enough for single-PUT
    });

    const bucketName = bucket.name;
    const encodedPath = encodeURIComponent(storagePath);
    const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    logger.info(`${LOG_PREFIX} upload success activityId=${activityId} fileId=${fileId} size=${buffer.length}`);
    return { success: true, storageUrl };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errMsg };
  }
}

// =====================================================================
// Cloud Function entry
// =====================================================================

export const migrateDriveVideosTrigger = onDocumentWritten(
  {
    document: 'activities/{activityId}',
    region: 'us-central1',
    timeoutSeconds: 540, // 9 min max (Cloud Functions v2 limit)
    memory: '512MiB', // up from default 256 pour gros buffers vidéo
  },
  async (event) => {
    const activityId = event.params.activityId;
    const after = event.data?.after.data();
    const before = event.data?.before.data();

    // Delete event → rien à faire
    if (!after) {
      logger.info(`${LOG_PREFIX} delete event activityId=${activityId}, skip`);
      return;
    }

    const mediaUrls: MediaItemShape[] = Array.isArray(after.mediaUrls) ? after.mediaUrls : [];
    if (mediaUrls.length === 0) {
      logger.info(`${LOG_PREFIX} activityId=${activityId} no mediaUrls, skip`);
      return;
    }

    // Détecter quels items à migrer
    const toMigrate: Array<{ index: number; item: MediaItemShape; fileId: string }> = [];
    for (let i = 0; i < mediaUrls.length; i++) {
      const item = mediaUrls[i];
      if (!shouldMigrateMediaItem(item)) continue;
      const fileId = extractDriveFileId(item.url);
      if (!fileId) continue;
      toMigrate.push({ index: i, item, fileId });
    }

    if (toMigrate.length === 0) {
      logger.info(`${LOG_PREFIX} activityId=${activityId} no items to migrate`);
      return;
    }

    // Idempotence : si les mêmes items ont déjà été tentés au write précédent
    // (before === after sur mediaUrls), skip pour éviter retry loop infini.
    if (before) {
      const beforeMediaUrls: MediaItemShape[] = Array.isArray(before.mediaUrls) ? before.mediaUrls : [];
      const beforeUrls = new Set(beforeMediaUrls.map((m) => m?.url ?? ''));
      const afterUrls = new Set(mediaUrls.map((m) => m?.url ?? ''));
      // Si la diff after\before est vide (pas de nouvel item), c'est probablement le write de migration → skip
      let hasNewItem = false;
      for (const u of afterUrls) {
        if (!beforeUrls.has(u)) {
          hasNewItem = true;
          break;
        }
      }
      if (!hasNewItem) {
        logger.info(`${LOG_PREFIX} activityId=${activityId} no new mediaUrls, skip (anti-loop)`);
        return;
      }
    }

    logger.info(`${LOG_PREFIX} activityId=${activityId} migrating ${toMigrate.length} items`);

    // Migrer chaque item séquentiel (mémoire + bandwidth raisonnable)
    const updatedMediaUrls = [...mediaUrls];
    const results: Array<{ index: number; result: MigrationResult }> = [];
    for (const { index, item, fileId } of toMigrate) {
      const result = await migrateOne(activityId, fileId);
      results.push({ index, result });
      if (result.success && result.storageUrl) {
        updatedMediaUrls[index] = {
          ...item,
          url: result.storageUrl,
          source: 'upload',
          provider: 'direct', // plus besoin de provider Drive — c'est notre Storage
          embedUrl: undefined, // legacy field, plus pertinent
        };
      } else {
        logger.warn(
          `${LOG_PREFIX} migration failed activityId=${activityId} fileId=${fileId} : ${result.error}`,
        );
      }
    }

    const successCount = results.filter((r) => r.result.success).length;
    if (successCount === 0) {
      logger.info(`${LOG_PREFIX} activityId=${activityId} 0/${toMigrate.length} migrated, no Firestore update`);
      return;
    }

    // Update Firestore avec les nouvelles URLs Storage + marker audit
    try {
      const db = getFirestore();
      await db.collection('activities').doc(activityId).update({
        mediaUrls: updatedMediaUrls,
        'mediaMigration.driveCompletedAt': FieldValue.serverTimestamp(),
        'mediaMigration.driveLastRunAt': FieldValue.serverTimestamp(),
        'mediaMigration.driveSuccessCount': FieldValue.increment(successCount),
        'mediaMigration.driveFailureCount': FieldValue.increment(toMigrate.length - successCount),
      });
      logger.info(
        `${LOG_PREFIX} activityId=${activityId} Firestore updated, ${successCount}/${toMigrate.length} items migrated`,
      );
    } catch (err) {
      logger.error(
        `${LOG_PREFIX} activityId=${activityId} Firestore update failed`,
        err instanceof Error ? { message: err.message, stack: err.stack } : err,
      );
    }

    // Suppress unused import warning
    void Timestamp;
  },
);
