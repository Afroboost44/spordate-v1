/**
 * Tests Phase 9.5 c4 — uploadActivityMedia (mock Firebase Storage via DI seam).
 *
 * Exécution :
 *   npm run test:storage:upload-activity-media
 *
 * Pattern : pure unit + mock Storage via __setStorageForTesting (cohérent SC2 sharedStripe).
 *
 * Couverture (UAM1-UAM3 + bonus) :
 *   UAM1 happy path : valid file + partnerId → return {url, source: 'upload', path}
 *        + path format `partners/{partnerId}/activities/{ts}-{slug}`
 *   UAM2 file too big (>5MB) → throw 'file-too-large'
 *   UAM3 wrong contentType (video/mp4) → throw 'invalid-content-type'
 *
 * Bonus :
 *   - empty partnerId → throw 'invalid-input'
 *   - filename slugify (accents + spaces → ascii hyphenated)
 *   - timestamp prefix unicité
 */

import {
  uploadActivityMedia,
  __setStorageForTesting,
  StorageUploadError,
  STORAGE_UPLOAD_MAX_BYTES,
} from '../../src/lib/storage/uploadActivityMedia';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

async function expectThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await fn();
    fail(`${label} (expected throw '${expectedCode}', got success)`);
  } catch (err) {
    if (err instanceof StorageUploadError && err.code === expectedCode) {
      pass(label);
    } else {
      const code = err instanceof StorageUploadError ? err.code : (err as Error).message;
      fail(`${label} (expected '${expectedCode}', got '${code}')`);
    }
  }
}

// =====================================================================
// Mock Firebase Storage
// =====================================================================

interface MockUploadCall {
  path: string;
  fileSize: number;
  fileType: string;
  fileName: string;
}

class MockStorage {
  public uploadCalls: MockUploadCall[] = [];

  ref(path: string) {
    return {
      put: async (file: File) => {
        this.uploadCalls.push({
          path,
          fileSize: file.size,
          fileType: file.type,
          fileName: file.name,
        });
        return {
          ref: {
            getDownloadURL: async () =>
              `https://mock.storage/${path}?alt=media&token=mock`,
          },
        };
      },
    };
  }

  reset() {
    this.uploadCalls = [];
  }
}

const mockStorage = new MockStorage();

// =====================================================================
// File mock builder
// =====================================================================

function mockFile(opts: {
  name: string;
  size: number;
  type: string;
}): File {
  // Polyfill File for Node.js (tsx) — minimal shape matching uploadActivityMedia usage
  const file = {
    name: opts.name,
    size: opts.size,
    type: opts.type,
  } as unknown as File;
  return file;
}

// =====================================================================

async function main(): Promise<void> {
  __setStorageForTesting(mockStorage);

  // ===================================================================
  // UAM1 happy path
  // ===================================================================
  section('UAM1 valid file + partnerId → return {url, source: upload, path}');
  mockStorage.reset();
  {
    const file = mockFile({
      name: 'photo.jpg',
      size: 500 * 1024, // 500KB
      type: 'image/jpeg',
    });
    const result = await uploadActivityMedia(file, 'partner_uam1');
    if (
      result.url.startsWith('https://mock.storage/') &&
      result.source === 'upload' &&
      result.path.startsWith('partners/partner_uam1/activities/')
    ) {
      pass('UAM1 result.url + source=upload + path correct');
    } else {
      fail('UAM1 unexpected', result);
    }
    if (result.path.endsWith('-photo.jpg')) {
      pass('UAM1 path se termine par "-photo.jpg" (slugified filename)');
    } else {
      fail('UAM1 path slug', result.path);
    }
    if (mockStorage.uploadCalls.length === 1) {
      pass('UAM1 mock storage 1 upload call');
    } else {
      fail('UAM1 should be 1 upload', { count: mockStorage.uploadCalls.length });
    }
  }

  // ===================================================================
  // UAM2 file too big → throw 'file-too-large'
  // ===================================================================
  section("UAM2 file > 5MB → throw 'file-too-large'");
  mockStorage.reset();
  {
    const file = mockFile({
      name: 'big.jpg',
      size: STORAGE_UPLOAD_MAX_BYTES + 1, // 5MB + 1 byte
      type: 'image/jpeg',
    });
    await expectThrows(
      () => uploadActivityMedia(file, 'partner_uam2'),
      'file-too-large',
      "UAM2 file too big → throw 'file-too-large'",
    );
    if (mockStorage.uploadCalls.length === 0) {
      pass('UAM2 zero upload calls (validation block avant)');
    } else {
      fail('UAM2 should not call storage', mockStorage.uploadCalls);
    }
  }

  // ===================================================================
  // UAM3 wrong contentType → throw 'invalid-content-type'
  // ===================================================================
  section("UAM3 wrong contentType (video/mp4) → throw 'invalid-content-type'");
  mockStorage.reset();
  {
    const file = mockFile({
      name: 'video.mp4',
      size: 100 * 1024,
      type: 'video/mp4',
    });
    await expectThrows(
      () => uploadActivityMedia(file, 'partner_uam3'),
      'invalid-content-type',
      "UAM3 video/mp4 → throw 'invalid-content-type' (Q4=A images only)",
    );
    if (mockStorage.uploadCalls.length === 0) {
      pass('UAM3 zero upload calls');
    } else {
      fail('UAM3 should not call storage', mockStorage.uploadCalls);
    }
  }

  // ===================================================================
  // Bonus : empty partnerId → invalid-input
  // ===================================================================
  section("Bonus empty partnerId → throw 'invalid-input'");
  mockStorage.reset();
  {
    const file = mockFile({
      name: 'photo.jpg',
      size: 100 * 1024,
      type: 'image/jpeg',
    });
    await expectThrows(
      () => uploadActivityMedia(file, ''),
      'invalid-input',
      "Bonus empty partnerId → 'invalid-input'",
    );
  }

  // ===================================================================
  // Bonus : filename slugify (accents + spaces)
  // ===================================================================
  section('Bonus filename slugify (accents + spaces → ascii hyphenated)');
  mockStorage.reset();
  {
    const file = mockFile({
      name: 'Photo Été N°1 (été 2026).JPEG',
      size: 100 * 1024,
      type: 'image/jpeg',
    });
    const result = await uploadActivityMedia(file, 'partner_bonus_slug');
    // slugify : lowercase + accents stripped + non-ascii → '-'
    const ts = result.path.match(/activities\/(\d+)-(.+)$/);
    const slug = ts ? ts[2] : '';
    if (
      slug.length > 0 &&
      !slug.includes(' ') &&
      !slug.includes('é') &&
      !slug.includes('°') &&
      slug.endsWith('.jpeg')
    ) {
      pass(`Bonus slug propre : "${slug}" (no spaces, no accents, lowercase, ext preserved)`);
    } else {
      fail('Bonus slug invalid', { path: result.path, slug });
    }
  }

  // ===================================================================
  // Bonus : timestamp prefix unicité (2 uploads consécutifs même filename)
  // ===================================================================
  section('Bonus timestamp prefix unicité (2 uploads même filename → paths uniques)');
  mockStorage.reset();
  {
    const f1 = mockFile({
      name: 'same.jpg',
      size: 100 * 1024,
      type: 'image/jpeg',
    });
    const r1 = await uploadActivityMedia(f1, 'partner_bonus_ts');
    // attendre 2ms pour timestamp différent
    await new Promise((resolve) => setTimeout(resolve, 5));
    const r2 = await uploadActivityMedia(f1, 'partner_bonus_ts');
    if (r1.path !== r2.path) {
      pass('Bonus timestamps différents → paths uniques');
    } else {
      fail('Bonus timestamps should differ', { p1: r1.path, p2: r2.path });
    }
  }

  __setStorageForTesting(null);

  console.log('');
  console.log('====== Résumé Upload Activity Media (UAM1-UAM3 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
