/**
 * BUG #13 — Tests uploadProfilePhoto (Storage path users/{uid}/profile/*).
 *
 * Mock Firebase Storage in-memory via DI seam __setProfilePhotoStorageForTesting.
 * Cohérent pattern uploadActivityMedia.ts + __setStorageForTesting.
 *
 * Couverture (UP1-UP6) :
 *   UP1 — Empty file → throw 'invalid-input'
 *   UP2 — Empty uid → throw 'invalid-input'
 *   UP3 — file.size > 5MB → throw 'file-too-large'
 *   UP4 — file.type not image/* → throw 'invalid-content-type'
 *   UP5 — Happy path → returns { url, path } avec path "users/{uid}/profile/{ts}-{slug}"
 *   UP6 — Storage.put throw → throw 'upload-failed' avec details.error
 *
 * Exécution : npx tsx tests/profile/upload-photo.test.ts
 */

import {
  uploadProfilePhoto,
  StorageUploadError,
  __setProfilePhotoStorageForTesting,
  PROFILE_PHOTO_MAX_BYTES,
} from '../../src/lib/storage/uploadProfilePhoto';

let passes = 0;
let failures = 0;

function ok(label: string) {
  passes++;
  console.log(`  ✓ ${label}`);
}
function fail(label: string, info?: unknown) {
  failures++;
  console.error(`  ✗ ${label}`, info ?? '');
}
function section(t: string) {
  console.log(`\n--- ${t} ---`);
}

// =====================================================================
// Mock Storage in-memory
// =====================================================================

function makeMockStorage(opts: { throwOnPut?: Error } = {}) {
  const uploads: Array<{ path: string; size: number }> = [];
  const storage = {
    ref(path: string) {
      return {
        async put(file: File) {
          if (opts.throwOnPut) throw opts.throwOnPut;
          uploads.push({ path, size: file.size });
          return {
            ref: {
              async getDownloadURL() {
                return `https://firebasestorage.googleapis.com/${encodeURIComponent(path)}`;
              },
            },
          };
        },
      };
    },
  };
  return { storage, uploads };
}

// Minimal File mock (Node doesn't have File natively in older versions)
function makeFile(name: string, size: number, type: string): File {
  // Use a minimal blob with controlled size
  const blob = new Blob([new Uint8Array(Math.min(size, 1024))], { type });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = new File([blob], name, { type });
  // Override size getter (File default = blob length)
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
}

// =====================================================================
// TESTS
// =====================================================================

async function run() {
  // -----------------------------------------------------------------------
  section('UP1 — Empty file → invalid-input');
  {
    makeMockStorage().storage;
    __setProfilePhotoStorageForTesting(makeMockStorage().storage);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await uploadProfilePhoto(null as any, 'user-1');
      fail('aurait dû throw');
    } catch (e) {
      if (e instanceof StorageUploadError && e.code === 'invalid-input') ok('throw invalid-input');
      else fail('mauvaise erreur', e);
    }
    __setProfilePhotoStorageForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('UP2 — Empty uid → invalid-input');
  {
    __setProfilePhotoStorageForTesting(makeMockStorage().storage);
    try {
      await uploadProfilePhoto(makeFile('a.jpg', 100, 'image/jpeg'), '');
      fail('aurait dû throw');
    } catch (e) {
      if (e instanceof StorageUploadError && e.code === 'invalid-input') ok('throw invalid-input');
      else fail('mauvaise erreur', e);
    }
    __setProfilePhotoStorageForTesting(null);
  }

  // -----------------------------------------------------------------------
  section(`UP3 — file.size > ${PROFILE_PHOTO_MAX_BYTES / 1024 / 1024}MB → file-too-large`);
  {
    __setProfilePhotoStorageForTesting(makeMockStorage().storage);
    try {
      await uploadProfilePhoto(
        makeFile('big.jpg', PROFILE_PHOTO_MAX_BYTES + 1, 'image/jpeg'),
        'user-1',
      );
      fail('aurait dû throw');
    } catch (e) {
      if (e instanceof StorageUploadError && e.code === 'file-too-large') ok('throw file-too-large');
      else fail('mauvaise erreur', e);
    }
    __setProfilePhotoStorageForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('UP4 — file.type not image/* → invalid-content-type');
  {
    __setProfilePhotoStorageForTesting(makeMockStorage().storage);
    try {
      await uploadProfilePhoto(
        makeFile('doc.pdf', 1000, 'application/pdf'),
        'user-1',
      );
      fail('aurait dû throw');
    } catch (e) {
      if (e instanceof StorageUploadError && e.code === 'invalid-content-type') ok('throw invalid-content-type');
      else fail('mauvaise erreur', e);
    }
    __setProfilePhotoStorageForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('UP5 — Happy path → URL + path users/{uid}/profile/{ts}-{slug}');
  {
    const mock = makeMockStorage();
    __setProfilePhotoStorageForTesting(mock.storage);
    const result = await uploadProfilePhoto(
      makeFile('Profile Photo.JPG', 500_000, 'image/jpeg'),
      'user-abc',
    );
    const pathOk = /^users\/user-abc\/profile\/\d+-profile-photo\.jpg$/.test(result.path);
    if (pathOk) ok(`path OK: ${result.path}`);
    else fail('path inattendu', result.path);

    if (result.url.startsWith('https://firebasestorage.googleapis.com/')) ok('URL HTTPS retournée');
    else fail('URL inattendue', result.url);

    if (mock.uploads.length === 1 && mock.uploads[0].size === 500_000) ok('storage.put appelé une fois avec bon size');
    else fail('uploads', mock.uploads);
    __setProfilePhotoStorageForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('UP6 — Storage.put throw → upload-failed avec details.error');
  {
    const mock = makeMockStorage({ throwOnPut: new Error('network down') });
    __setProfilePhotoStorageForTesting(mock.storage);
    try {
      await uploadProfilePhoto(makeFile('a.jpg', 100, 'image/jpeg'), 'user-1');
      fail('aurait dû throw');
    } catch (e) {
      if (
        e instanceof StorageUploadError &&
        e.code === 'upload-failed' &&
        e.details?.error === 'network down'
      ) {
        ok('throw upload-failed avec details.error preservé');
      } else fail('mauvaise erreur', e);
    }
    __setProfilePhotoStorageForTesting(null);
  }

  console.log(`\n====== Résumé upload-photo ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
