/**
 * Fix #122 (refonte UX Instagram) — Helper d'upload de miniature vidéo.
 *
 * Extrait de la logique jadis inline dans VideoThumbnailPicker.handleCapture.
 * Centralise le SEUL chemin d'upload Firebase Storage pour les 3 sources de
 * miniature du picker :
 *   (a) clic sur une des 5 frames pré-extraites  → capture canvas → Blob
 *   (b) capture via scrubber ("Capturer cette frame") → capture canvas → Blob
 *   (c) "Sélectionner depuis l'ordinateur"        → File image (jpg/png)
 *
 * Les 3 convergent ici → garantit un path Firebase identique + un seul endroit
 * à tester / maintenir (anti-régression durable).
 *
 * Path Firebase (INCHANGÉ vs avant la refonte) :
 *   partners/{partnerId}/activities/thumbnails/thumb-{timestamp}.jpg
 * contentType : image/jpeg
 *
 * DI seam (cohérent uploadActivityMedia.__setStorageForTesting) :
 *   - `__setThumbnailStorageForTesting(mock)` injecte un mock testable
 *   - Production : import dynamic firebase/storage (lazy, code-split)
 */

// =====================================================================
// DI seam (test injection) — pattern aligné uploadActivityMedia.ts
// =====================================================================

/**
 * Surface minimale des fonctions firebase/storage dont on a besoin.
 * En prod on injecte les vraies fonctions (dynamic import) ; en test on
 * injecte un mock qui renvoie une URL firebasestorage factice.
 */
export interface ThumbnailStorageDeps {
  getStorage: (app: unknown) => unknown;
  ref: (storage: unknown, path: string) => unknown;
  uploadBytes: (
    ref: unknown,
    data: Blob,
    metadata?: { contentType?: string },
  ) => Promise<unknown>;
  getDownloadURL: (ref: unknown) => Promise<string>;
  /** App Firebase initialisée (en test : n'importe quel objet non-null). */
  app: unknown;
}

let _depsOverride: ThumbnailStorageDeps | null = null;

/** @internal — utilisé UNIQUEMENT par les tests pour mocker Firebase Storage. */
export function __setThumbnailStorageForTesting(
  mock: ThumbnailStorageDeps | null,
): void {
  _depsOverride = mock;
}

// =====================================================================
// Errors
// =====================================================================

export class ThumbnailUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThumbnailUploadError';
  }
}

// =====================================================================
// Path
// =====================================================================

/**
 * Construit le path Firebase Storage de la miniature.
 * INCHANGÉ vs l'ancien code inline pour garantir zéro régression visuelle.
 */
export function buildThumbnailPath(partnerId: string, timestamp: number): string {
  return `partners/${partnerId}/activities/thumbnails/thumb-${timestamp}.jpg`;
}

// =====================================================================
// uploadThumbnailBlob
// =====================================================================

/**
 * Upload un Blob/File image vers Firebase Storage et renvoie la download URL.
 *
 * Accepte aussi bien un `Blob` (frame capturée via canvas.toBlob) qu'un `File`
 * (image choisie depuis l'ordinateur) — `File` étant un sous-type de `Blob`.
 *
 * @param blob   Blob JPEG (capture canvas) ou File image (upload ordi)
 * @param partnerId UID partner (namespace anti-cross-partner)
 * @param ts     timestamp (par défaut Date.now()) — injectable pour tests déterministes
 * @returns download URL publique (firebasestorage)
 * @throws ThumbnailUploadError
 */
export async function uploadThumbnailBlob(
  blob: Blob,
  partnerId: string,
  ts: number = Date.now(),
): Promise<string> {
  if (!blob) throw new ThumbnailUploadError('Aucune image à uploader');
  if (!partnerId) throw new ThumbnailUploadError('partnerId manquant');

  const path = buildThumbnailPath(partnerId, ts);

  // Test path : deps mockées injectées.
  if (_depsOverride) {
    const deps = _depsOverride;
    const storage = deps.getStorage(deps.app);
    const storageRef = deps.ref(storage, path);
    await deps.uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
    return deps.getDownloadURL(storageRef);
  }

  // Prod path : dynamic import firebase/storage (lazy / code-split).
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import(
    'firebase/storage'
  );
  const firebaseModule = await import('@/lib/firebase');
  const app = firebaseModule.default;
  if (!app) throw new ThumbnailUploadError('Firebase non initialisé');

  const storage = getStorage(app);
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}
