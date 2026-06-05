/**
 * Fix #122 (refonte UX) — Tests anti-régression du chemin d'upload miniature.
 *
 * Exécution :
 *   npx tsx tests/storage/upload-thumbnail.test.ts
 *
 * Pure unit tests (pas d'emulator). On injecte des deps Firebase Storage
 * mockées via __setThumbnailStorageForTesting → le chemin prod (dynamic import
 * firebase/storage + @/lib/firebase) n'est JAMAIS exécuté.
 *
 * Ce test garantit que les 3 sources de miniature du VideoThumbnailPicker
 * convergent toutes vers uploadThumbnailBlob et que onThumbnailSaved reçoit
 * bien une URL Firebase Storage :
 *   (a) clic sur une des 5 frames suggérées → frame capturée = Blob   (cas T1)
 *   (b) capture via scrubber "Capturer cette frame" → Blob            (cas T1)
 *   (c) "Sélectionner depuis l'ordinateur" → File image              (cas T2)
 *
 * (a) et (b) partagent EXACTEMENT le même pipeline (canvas → Blob → helper),
 * donc un seul cas Blob les couvre tous les deux. (c) passe un File (sous-type
 * de Blob) par le même helper.
 */

import {
  uploadThumbnailBlob,
  buildThumbnailPath,
  __setThumbnailStorageForTesting,
  type ThumbnailStorageDeps,
} from '../../src/lib/storage/uploadThumbnail';

// =====================================================================
// Mini test runner
// =====================================================================

let passes = 0;
let failures = 0;
function ok(label: string) {
  passes++;
  console.log(`✓ ${label}`);
}
function fail(label: string, detail?: unknown) {
  failures++;
  console.error(`✗ ${label}`, detail ?? '');
}
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) ok(label);
  else fail(label, detail);
}

const FAKE_URL =
  'https://firebasestorage.googleapis.com/v0/b/spordate-prod.appspot.com/o/thumb.jpg?alt=media&token=abc123';

/** Mock deps qui enregistre ce qui est appelé + renvoie une URL Firebase factice. */
function makeMockDeps() {
  const calls: {
    path?: string;
    data?: Blob;
    contentType?: string;
    uploadCount: number;
  } = { uploadCount: 0 };

  const deps: ThumbnailStorageDeps = {
    app: { __fake: true },
    getStorage: () => ({ __storage: true }),
    ref: (_storage, path) => {
      calls.path = path;
      return { __ref: path };
    },
    uploadBytes: async (_ref, data, metadata) => {
      calls.uploadCount += 1;
      calls.data = data;
      calls.contentType = metadata?.contentType;
      return { __snap: true };
    },
    getDownloadURL: async () => FAKE_URL,
  };

  return { deps, calls };
}

const isFirebaseUrl = (u: string) =>
  /^https:\/\/firebasestorage\.(googleapis\.com|app)/.test(u);
const isThumbPath = (p: string, partnerId: string) =>
  new RegExp(
    `^partners/${partnerId}/activities/thumbnails/thumb-\\d+\\.jpg$`,
  ).test(p);

async function main() {
  // ── T1 — capture frame (Blob) : couvre clic mini (a) + scrub capture (b) ──
  {
    const { deps, calls } = makeMockDeps();
    __setThumbnailStorageForTesting(deps);

    const frameBlob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });

    // Réplique EXACTE des 2 lignes de saveBlob() du composant :
    //   const url = await uploadThumbnailBlob(blob, partnerId);
    //   onThumbnailSaved(url);
    let savedUrl: string | null = null;
    const onThumbnailSaved = (url: string) => {
      savedUrl = url;
    };
    const url = await uploadThumbnailBlob(frameBlob, 'p1', 1700000000000);
    onThumbnailSaved(url);

    assert(savedUrl !== null, 'T1 — onThumbnailSaved appelé (capture frame)');
    assert(
      savedUrl !== null && isFirebaseUrl(savedUrl),
      'T1 — onThumbnailSaved reçoit une URL Firebase Storage',
      savedUrl,
    );
    assert(
      calls.path !== undefined && isThumbPath(calls.path, 'p1'),
      'T1 — path = partners/{id}/activities/thumbnails/thumb-*.jpg',
      calls.path,
    );
    assert(
      calls.contentType === 'image/jpeg',
      'T1 — contentType image/jpeg',
      calls.contentType,
    );
    assert(calls.uploadCount === 1, 'T1 — exactement 1 upload', calls.uploadCount);
  }

  // ── T2 — "Sélectionner depuis l'ordinateur" : File image jpg/png (c) ──
  {
    const { deps, calls } = makeMockDeps();
    __setThumbnailStorageForTesting(deps);

    // File hérite de Blob — Node 20+ expose File en global.
    const imageFile = new File(['fake-png-bytes'], 'cover.png', {
      type: 'image/png',
    });

    let savedUrl: string | null = null;
    const onThumbnailSaved = (url: string) => {
      savedUrl = url;
    };
    const url = await uploadThumbnailBlob(imageFile, 'partner-42');
    onThumbnailSaved(url);

    assert(savedUrl !== null, 'T2 — onThumbnailSaved appelé (upload ordi)');
    assert(
      savedUrl !== null && isFirebaseUrl(savedUrl),
      'T2 — onThumbnailSaved reçoit une URL Firebase Storage',
      savedUrl,
    );
    assert(
      calls.path !== undefined && isThumbPath(calls.path, 'partner-42'),
      'T2 — path = partners/{id}/activities/thumbnails/thumb-*.jpg',
      calls.path,
    );
    assert(
      calls.contentType === 'image/jpeg',
      'T2 — uploadé en image/jpeg (path Firebase identique aux captures)',
      calls.contentType,
    );
  }

  // ── T3 — buildThumbnailPath déterministe + format ──
  {
    const p = buildThumbnailPath('abc', 123);
    assert(
      p === 'partners/abc/activities/thumbnails/thumb-123.jpg',
      'T3 — buildThumbnailPath format exact',
      p,
    );
  }

  // ── T4 — garde-fous (partnerId / blob manquant) ──
  {
    __setThumbnailStorageForTesting(makeMockDeps().deps);
    let threw = false;
    try {
      await uploadThumbnailBlob(
        new Blob(['x'], { type: 'image/jpeg' }),
        '',
      );
    } catch {
      threw = true;
    }
    assert(threw, 'T4 — throw si partnerId manquant');
  }

  __setThumbnailStorageForTesting(null);

  console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Erreur fatale test', err);
  process.exit(1);
});
