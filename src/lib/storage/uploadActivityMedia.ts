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

/** Q2=A : 5MB max upload. */
export const STORAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** Q4=A : Phase 9.5 = images only (video via URL embed). Phase 10 polish video upload. */
export const STORAGE_UPLOAD_ALLOWED_MIME_PREFIX = 'image/';

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
}

/**
 * Upload une image vers Firebase Storage et retourne la download URL.
 *
 * @param file File browser (input type='file' OR drag & drop)
 * @param partnerId UID du partner (anti-spoof : rule storage check `request.auth.uid == partnerId`)
 * @returns {url, source: 'upload', path}
 * @throws StorageUploadError
 */
export async function uploadActivityMedia(
  file: File,
  partnerId: string,
): Promise<UploadActivityMediaResult> {
  // Validation
  if (!file || !partnerId) {
    throw new StorageUploadError('invalid-input', { partnerId, hasFile: !!file });
  }
  if (file.size > STORAGE_UPLOAD_MAX_BYTES) {
    throw new StorageUploadError('file-too-large', {
      size: file.size,
      max: STORAGE_UPLOAD_MAX_BYTES,
      mb: (file.size / 1024 / 1024).toFixed(1),
    });
  }
  if (!file.type || !file.type.startsWith(STORAGE_UPLOAD_ALLOWED_MIME_PREFIX)) {
    throw new StorageUploadError('invalid-content-type', {
      contentType: file.type,
      allowed: STORAGE_UPLOAD_ALLOWED_MIME_PREFIX + '*',
    });
  }

  const path = buildStoragePath(partnerId, file);

  try {
    if (_storageOverride) {
      // Test path : utilise mock injecté
      const ref = _storageOverride.ref(path);
      const snap = await ref.put(file);
      const url = await snap.ref.getDownloadURL();
      return { url, source: 'upload', path };
    }
    // Prod path : dynamic import firebase/storage (lazy — pas de pull si jamais appelé)
    const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { default: app } = await import('@/lib/firebase');
    if (!app) {
      throw new StorageUploadError('upload-failed', { reason: 'firebase-not-initialized' });
    }
    const storage = getStorage(app);
    const fileRef = ref(storage, path);
    const snap = await uploadBytes(fileRef, file);
    const url = await getDownloadURL(snap.ref);
    return { url, source: 'upload', path };
  } catch (err) {
    if (err instanceof StorageUploadError) throw err;
    throw new StorageUploadError('upload-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
