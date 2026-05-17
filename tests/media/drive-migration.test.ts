/**
 * BUG #30 étape 3 — Tests purs helpers Drive migration.
 *
 * Le helper centralise la détection des MediaItems à migrer (Drive non encore
 * uploadés sur Storage) + reconnaissance des URLs Storage video pour render
 * frontend HTML5 <video>.
 *
 * Cloud Function utilise une copie inline de ces helpers (functions/src/ ne
 * peut pas importer src/lib/ — rootDir différents). Pour rester DRY logique-
 * ment : les helpers ici sont la source de vérité, la CF les recopie.
 *
 * Couverture (DM1-DM12) :
 *   DM1 — isDriveMediaItem : provider=drive + source=url → true
 *   DM2 — isDriveMediaItem : provider=youtube → false
 *   DM3 — isDriveMediaItem : pas de provider → false
 *   DM4 — shouldMigrate : drive non-migré (url=drive.google.com) → true
 *   DM5 — shouldMigrate : déjà migré (provider=storage OR url=firebasestorage) → false
 *   DM6 — shouldMigrate : type=image → false (vidéos uniquement)
 *   DM7 — isStorageVideoUrl : firebasestorage.googleapis.com + .mp4 → true
 *   DM8 — isStorageVideoUrl : .webm, .mov accepté
 *   DM9 — isStorageVideoUrl : firebasestorage sans extension video → false
 *   DM10 — isStorageVideoUrl : URL non-Storage → false
 *   DM11 — buildStorageVideoPath : format activities/{actId}/videos/{fileId}.mp4
 *   DM12 — buildStorageVideoPath : extension custom
 *
 * Exécution : npx tsx tests/media/drive-migration.test.ts
 */

import {
  isDriveMediaItem,
  shouldMigrateMediaItem,
  isStorageVideoUrl,
  buildStorageVideoPath,
} from '../../src/lib/media/driveMigration';

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
  section('DM1 — isDriveMediaItem : provider=drive + source=url → true');
  {
    const r = isDriveMediaItem({
      url: 'https://drive.google.com/file/d/abc/view',
      type: 'video',
      source: 'url',
      provider: 'drive',
    });
    if (r === true) ok('Drive item détecté');
    else fail('unexpected', r);
  }

  section('DM2 — isDriveMediaItem : provider=youtube → false');
  {
    const r = isDriveMediaItem({
      url: 'https://youtube.com/watch?v=abc',
      type: 'video',
      source: 'url',
      provider: 'youtube',
    });
    if (r === false) ok('YouTube → false');
    else fail('unexpected', r);
  }

  section('DM3 — isDriveMediaItem : pas de provider → false');
  {
    const r = isDriveMediaItem({
      url: 'https://example.com/foo.mp4',
      type: 'video',
      source: 'url',
    });
    if (r === false) ok('absence provider → false');
    else fail('unexpected', r);
  }

  section('DM4 — shouldMigrate : drive non-migré → true');
  {
    const r = shouldMigrateMediaItem({
      url: 'https://drive.google.com/file/d/abc123/view',
      type: 'video',
      source: 'url',
      provider: 'drive',
    });
    if (r === true) ok('drive non-migré → migrate');
    else fail('unexpected', r);
  }

  section('DM5 — shouldMigrate : déjà migré (firebasestorage url) → false');
  {
    const r1 = shouldMigrateMediaItem({
      url: 'https://firebasestorage.googleapis.com/v0/b/x/o/activities%2Fact1%2Fvideos%2Ffile.mp4?alt=media',
      type: 'video',
      source: 'storage',
      provider: 'direct',
    });
    if (r1 === false) ok('migré (URL Storage) → skip');
    else fail('unexpected', r1);
  }

  section('DM6 — shouldMigrate : type=image → false');
  {
    const r = shouldMigrateMediaItem({
      url: 'https://drive.google.com/file/d/abc/view',
      type: 'image',
      source: 'url',
    });
    if (r === false) ok('image → pas de migration');
    else fail('unexpected', r);
  }

  section('DM7 — isStorageVideoUrl : firebasestorage + .mp4 → true');
  {
    const r = isStorageVideoUrl(
      'https://firebasestorage.googleapis.com/v0/b/spordate.appspot.com/o/activities%2Fact1%2Fvideos%2Ffile.mp4?alt=media&token=xxx',
    );
    if (r === true) ok('Storage MP4 reconnu');
    else fail('unexpected', r);
  }

  section('DM8 — isStorageVideoUrl : .webm + .mov accepté');
  {
    const webm = isStorageVideoUrl(
      'https://firebasestorage.googleapis.com/v0/b/x/o/activities%2Fa%2Fvideos%2Ff.webm?alt=media',
    );
    const mov = isStorageVideoUrl(
      'https://firebasestorage.googleapis.com/v0/b/x/o/activities%2Fa%2Fvideos%2Ff.mov?alt=media',
    );
    if (webm && mov) ok('.webm + .mov reconnus');
    else fail('unexpected', { webm, mov });
  }

  section('DM9 — isStorageVideoUrl : Storage sans ext video → false');
  {
    const r = isStorageVideoUrl(
      'https://firebasestorage.googleapis.com/v0/b/x/o/users%2Fu1%2Fphoto.jpg',
    );
    if (r === false) ok('Storage image .jpg → false');
    else fail('unexpected', r);
  }

  section('DM10 — isStorageVideoUrl : URL non-Storage → false');
  {
    const r = isStorageVideoUrl('https://drive.google.com/file/d/abc/preview');
    if (r === false) ok('non-Storage URL → false');
    else fail('unexpected', r);
  }

  section('DM11 — buildStorageVideoPath : format activities/{id}/videos/{fileId}.mp4');
  {
    const r = buildStorageVideoPath('act-123', 'drive-file-abc');
    if (r === 'activities/act-123/videos/drive-file-abc.mp4') ok('format OK');
    else fail('unexpected', r);
  }

  section('DM12 — buildStorageVideoPath : extension custom');
  {
    const r = buildStorageVideoPath('act-123', 'fileXYZ', 'webm');
    if (r === 'activities/act-123/videos/fileXYZ.webm') ok('custom extension');
    else fail('unexpected', r);
  }

  console.log(`\n====== Résumé drive-migration ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
