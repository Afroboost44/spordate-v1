/**
 * BUG #13 — Firebase Storage upload helper pour photos de profil user.
 *
 * Avant : src/app/profile/page.tsx encodait l'image en base64 via
 *   FileReader.readAsDataURL → setPhotos(base64) → updateDoc(users/{uid},
 *   { photoURL: base64 }). Dès qu'une image faisait plus de ~750KB, le doc
 *   Firestore dépassait la limite 1MB → updateDoc throw silencieusement →
 *   profil pas sauvegardé + discovery affiche une image par défaut.
 *
 * Fix : upload vers Firebase Storage `users/{uid}/profile/{ts}-{slug}` puis
 *   stocker la download URL HTTPS courte dans `photoURL`.
 *
 * Path matche les Storage rules existantes (storage.rules) :
 *   match /users/{userId}/{allPaths=**} { allow write: if owner }
 *
 * Pattern DI seam cohérent uploadActivityMedia.ts (__setStorageForTesting).
 *
 * @module
 */

// =====================================================================
// Constants
// =====================================================================

/** 5 MB max upload — cohérent avec uploadActivityMedia + Storage rule 10MB. */
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Images uniquement (jpg, png, webp, heic…). */
export const PROFILE_PHOTO_ALLOWED_MIME_PREFIX = 'image/';

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
export function __setProfilePhotoStorageForTesting(mock: StorageLike | null): void {
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
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function buildStoragePath(uid: string, file: File): string {
  const timestamp = Date.now();
  const slug = slugifyFilename(file.name || 'photo.jpg');
  return `users/${uid}/profile/${timestamp}-${slug}`;
}

// =====================================================================
// uploadProfilePhoto
// =====================================================================

export interface UploadProfilePhotoResult {
  /** Download URL HTTPS retournée par Firebase Storage (à stocker dans photoURL). */
  url: string;
  /** Path Storage (utile pour delete ultérieur). */
  path: string;
}

/**
 * Upload une photo de profil vers Firebase Storage et retourne la download URL.
 *
 * @param file File browser (input type='file' OR drag & drop)
 * @param uid  UID du user (anti-spoof : rule storage check `request.auth.uid == userId`)
 * @returns { url, path }
 * @throws StorageUploadError
 */
export async function uploadProfilePhoto(
  file: File,
  uid: string,
): Promise<UploadProfilePhotoResult> {
  if (!file || !uid) {
    throw new StorageUploadError('invalid-input', { uid, hasFile: !!file });
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new StorageUploadError('file-too-large', {
      size: file.size,
      max: PROFILE_PHOTO_MAX_BYTES,
      mb: (file.size / 1024 / 1024).toFixed(1),
    });
  }
  if (!file.type || !file.type.startsWith(PROFILE_PHOTO_ALLOWED_MIME_PREFIX)) {
    throw new StorageUploadError('invalid-content-type', {
      contentType: file.type,
      allowed: PROFILE_PHOTO_ALLOWED_MIME_PREFIX + '*',
    });
  }

  const path = buildStoragePath(uid, file);

  try {
    if (_storageOverride) {
      const ref = _storageOverride.ref(path);
      const snap = await ref.put(file);
      const url = await snap.ref.getDownloadURL();
      return { url, path };
    }
    // Prod : dynamic import firebase/storage (lazy)
    const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { default: app } = await import('@/lib/firebase');
    if (!app) {
      throw new StorageUploadError('upload-failed', { reason: 'firebase-not-initialized' });
    }
    const storage = getStorage(app);
    const fileRef = ref(storage, path);
    const snap = await uploadBytes(fileRef, file);
    const url = await getDownloadURL(snap.ref);
    return { url, path };
  } catch (err) {
    if (err instanceof StorageUploadError) throw err;
    throw new StorageUploadError('upload-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
