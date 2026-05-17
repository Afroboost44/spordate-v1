/**
 * BUG #26 bis + #28 — Tests purs des helpers Drive thumbnail/viewer.
 *
 * Root cause : Drive refuse le framing iframe (CSP frame-ancestors). Sur mobile,
 * l'iframe en état d'erreur (chrome-error://chromewebdata/) intercepte les touch
 * events → swipe embla bloqué + vidéo non lisible. Fix : remplacer iframe Drive
 * par thumbnail cliquable qui ouvre le Drive viewer dans une nouvelle tab.
 *
 * Couverture (DR1-DR7) :
 *   DR1 — extractDriveFileId from /file/d/ID/view → ID
 *   DR2 — extractDriveFileId from /file/d/ID/preview → ID
 *   DR3 — extractDriveFileId from /open?id=ID → ID
 *   DR4 — extractDriveFileId from URL non-Drive → null
 *   DR5 — extractDriveFileId from undefined/empty → null
 *   DR6 — buildDriveThumbnailUrl(fileId, size?) → /thumbnail?id=X&sz=w800
 *   DR7 — buildDriveViewerUrl(fileId) → /file/d/X/view
 *
 * Exécution : npx tsx tests/media/drive-thumbnail.test.ts
 */

import {
  extractDriveFileId,
  buildDriveThumbnailUrl,
  buildDriveViewerUrl,
} from '../../src/lib/media/driveThumbnail';

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

async function run() {
  // -----------------------------------------------------------------------
  section('DR1 — /file/d/ID/view → ID');
  {
    const r = extractDriveFileId('https://drive.google.com/file/d/1AbC_dEf-GhI/view?usp=sharing');
    if (r === '1AbC_dEf-GhI') ok('fileId extract OK');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DR2 — /file/d/ID/preview → ID');
  {
    const r = extractDriveFileId('https://drive.google.com/file/d/abc123XYZ/preview');
    if (r === 'abc123XYZ') ok('fileId extract OK');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DR3 — /open?id=ID → ID');
  {
    const r = extractDriveFileId('https://drive.google.com/open?id=XYZ-001');
    if (r === 'XYZ-001') ok('fileId extract OK');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DR4 — URL non-Drive → null');
  {
    const r1 = extractDriveFileId('https://youtube.com/watch?v=abc');
    const r2 = extractDriveFileId('https://example.com/foo');
    if (r1 === null && r2 === null) ok('null pour URLs non-Drive');
    else fail('unexpected', { r1, r2 });
  }

  // -----------------------------------------------------------------------
  section('DR5 — undefined/empty/whitespace → null');
  {
    if (
      extractDriveFileId(undefined) === null &&
      extractDriveFileId(null) === null &&
      extractDriveFileId('') === null &&
      extractDriveFileId('   ') === null
    ) ok('defensive nulls');
    else fail('unexpected');
  }

  // -----------------------------------------------------------------------
  section('DR6 — buildDriveThumbnailUrl(fileId, size?) → /thumbnail?id=X&sz=w800');
  {
    const r1 = buildDriveThumbnailUrl('XYZ');
    if (r1 === 'https://drive.google.com/thumbnail?id=XYZ&sz=w800') ok('default size w800');
    else fail('unexpected', r1);
    const r2 = buildDriveThumbnailUrl('XYZ', 1200);
    if (r2 === 'https://drive.google.com/thumbnail?id=XYZ&sz=w1200') ok('custom size 1200');
    else fail('unexpected', r2);
  }

  // -----------------------------------------------------------------------
  section('DR7 — buildDriveViewerUrl(fileId) → /file/d/X/view');
  {
    const r = buildDriveViewerUrl('XYZ');
    if (r === 'https://drive.google.com/file/d/XYZ/view') ok('viewer URL OK');
    else fail('unexpected', r);
  }

  console.log(`\n====== Résumé drive-thumbnail ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
