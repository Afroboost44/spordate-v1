/**
 * Phase 9.5 c4 — Firebase Storage upload helper pour activités partner.
 *
 * Path : `partners/{partnerId}/activities/{timestamp}-{filename-slug}`
 *  - partnerId namespace prevent cross-partner overwrite
 *  - timestamp prefix prevent collisions
 *  - filename-slug ascii safe
 *
 * Validation :
 *  - file.size < 5MB (Q2=A)
 *  - file.type starts with 'image/' (Q4=A — pas de video upload Phase 9.5, URL embed only)
 *
 * DI seam pattern cohérent SC2 sharedStripe + SC4 retaliationDetector :
 *  - `__setStorageForTesting(mock)` injecte mock Firebase Storage
 *  - Production : import dynamic firebase/storage (lazy)
 *
 * Returns `{url, source: 'upload'}` cohérent MediaItem partial type.
 *
 * @throws StorageUploadError typed code = 'invalid-input' | 'file-too-large' |
 *         'invalid-content-type' | 'upload-failed'
 */

// =====================================================================
// Constants
// =====================================================================

/** Q2=A : 5MB max upload pour images. */
export const STORAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** BUG #51 — limite séparée pour vidéos mp4 (16:9 ou 9:16). Plus généreux
 *  qu'images car une vidéo courte (30s-1min) en mp4 typique pèse 5-30 MB. */
export const STORAGE_UPLOAD_MAX_BYTES_VIDEO = 50 * 1024 * 1024;

/** Q4=A : images only initialement (Phase 9.5). BUG #51 — ajout vidéos mp4. */
export const STORAGE_UPLOAD_ALLOWED_MIME_PREFIX = 'image/';
export const STORAGE_UPLOAD_ALLOWED_VIDEO_MIME_PREFIX = 'video/';

/** Determine kind from File MIME type. */
function detectKind(file: File): 'image' | 'video' | null {
  if (file.type.startsWith(STORAGE_UPLOAD_ALLOWED_MIME_PREFIX)) return 'image';
  if (file.type.startsWith(STORAGE_UPLOAD_ALLOWED_VIDEO_MIME_PREFIX)) return 'video';
  return null;
}

// =====================================================================
// DI seam (test injection)
// =====================================================================

interface StorageLike {
  ref(path: string): {
    put(file: File): Promise<{ ref: { getDownloadURL(): Promise<string> } }>;
  };
}

let _storageOverride: StorageLike | null = null;

/** @internal — utilisé UNIQUEMENT par tests pour mock Firebase Storage. */
export function __setStorageForTesting(mock: StorageLike | null): void {
  _storageOverride = mock;
}

// =====================================================================
// Errors typed
// =====================================================================

export type StorageUploadErrorCode =
  | 'invalid-input'
  | 'file-too-large'
  | 'invalid-content-type'
  | 'upload-failed';

export class StorageUploadError extends Error {
  public readonly code: StorageUploadErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: StorageUploadErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'StorageUploadError';
    this.code = code;
    this.details = details;
  }
}

// =====================================================================
// Helpers
// =====================================================================

function slugifyFilename(filename: string): string {
  return filename
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100); // cap longueur
}

function buildStoragePath(partnerId: string, file: File): string {
  const timestamp = Date.now();
  const slug = slugifyFilename(file.name || 'media');
  return `partners/${partnerId}/activities/${timestamp}-${slug}`;
}

// =====================================================================
// uploadActivityMedia
// =====================================================================

export interface UploadActivityMediaResult {
  url: string;
  source: 'upload';
  path: string;
  /** BUG #51 — kind détecté (image ou video) pour MediaItem.type aval. */
  kind: 'image' | 'video';
}

/**
 * BUG #61 — Options upload pour surface un callback de progression.
 *
 * `onProgress(ratio)` est appelé avec un nombre entre 0 et 1 chaque fois
 * que des bytes sont transférés. Utilisé par MediaManager pour afficher
 * la barre de progression pendant un upload (image ou vidéo).
 */
export interface UploadActivityMediaOptions {
  /** Callback de progression (0..1). Optionnel — si absent, pas de tracking. */
  onProgress?: (ratio: number) => void;
}

/**
 * Upload une image vers Firebase Storage et retourne la download URL.
 *
 * @param file File browser (input type='file' OR drag & drop)
 * @param partnerId UID du partner (anti-spoof : rule storage check `request.auth.uid == partnerId`)
 * @param options BUG #61 — { onProgress } pour barre de progression UI.
 * @returns {url, source: 'upload', path}
 * @throws StorageUploadError
 */
export async function uploadActivityMedia(
  file: File,
  partnerId: string,
  options: UploadActivityMediaOptions = {},
): Promise<UploadActivityMediaResult> {
  // Validation
  if (!file || !partnerId) {
    throw new StorageUploadError('invalid-input', { partnerId, hasFile: !!file });
  }
  // BUG #51 — détection kind (image/video) + max-bytes correspondant.
  const kind = detectKind(file);
  if (!kind) {
    throw new StorageUploadError('invalid-content-type', {
      contentType: file.type,
      allowed: 'image/* OR video/*',
    });
  }
  const maxBytes = kind === 'video' ? STORAGE_UPLOAD_MAX_BYTES_VIDEO : STORAGE_UPLOAD_MAX_BYTES;
  if (file.size > maxBytes) {
    throw new StorageUploadError('file-too-large', {
      size: file.size,
      max: maxBytes,
      mb: (file.size / 1024 / 1024).toFixed(1),
      kind,
    });
  }

  const path = buildStoragePath(partnerId, file);
  const { onProgress } = options;

  try {
    if (_storageOverride) {
      // Test path : utilise mock injecté. Pas de progress events réels (mock) :
      // on émet 0 puis 1 pour que les tests qui exposent un spy voient un cycle.
      onProgress?.(0);
      const ref = _storageOverride.ref(path);
      const snap = await ref.put(file);
      const url = await snap.ref.getDownloadURL();
      onProgress?.(1);
      return { url, source: 'upload', path, kind };
    }
    // BUG #61 — Prod path : remplace uploadBytes (one-shot, pas de progress)
    // par uploadBytesResumable qui expose un observable `state_changed` avec
    // bytesTransferred/totalBytes — utilisé par MediaManager pour la progress bar.
    const { getStorage, ref, uploadBytesResumable, getDownloadURL } =
      await import('firebase/storage');
    const { default: app } = await import('@/lib/firebase');
    if (!app) {
      throw new StorageUploadError('upload-failed', { reason: 'firebase-not-initialized' });
    }
    const storage = getStorage(app);
    const fileRef = ref(storage, path);
    const task = uploadBytesResumable(fileRef, file, {
      contentType: file.type || undefined,
    });
    onProgress?.(0);
    // On attend la fin via les callbacks state_changed (progress / error /
    // complete). Quand complete, on récupère task.snapshot.ref pour getDownloadURL.
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (s) => {
          const ratio = s.totalBytes > 0 ? s.bytesTransferred / s.totalBytes : 0;
          // Clamp à [0,1] et exclut le 1 final (on l'émet après getDownloadURL).
          onProgress?.(Math.min(0.99, Math.max(0, ratio)));
        },
        (err) => reject(err),
        () => resolve(),
      );
    });
    const url = await getDownloadURL(task.snapshot.ref);
    onProgress?.(1);
    return { url, source: 'upload', path, kind };
  } catch (err) {
    if (err instanceof StorageUploadError) throw err;
    throw new StorageUploadError('upload-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
