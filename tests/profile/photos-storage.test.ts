/**
 * BUG #35 — Tests purs helpers profile photos (read + normalize).
 *
 * Root cause : profile/page.tsx ne sauvait QUE photos[0] dans
 * `photoURL` (legacy singulier). Les 4 autres slots uploadés sur Storage
 * étaient orphelins → perdus au reload.
 *
 * Solution : ajouter `photos?: string[]` au UserProfile (additif, backward
 * compat avec photoURL singulier). Helpers ici centralisent la logique
 * read (priorité photos[], fallback photoURL) + save (dedup + truncate +
 * sync photoURL pour consumers legacy comme discovery).
 *
 * Couverture (PP1-PP8) :
 *   PP1 — readProfilePhotos : photos array présent → utilise tel quel
 *   PP2 — readProfilePhotos : photos absent + photoURL string → [photoURL]
 *   PP3 — readProfilePhotos : ni l'un ni l'autre → []
 *   PP4 — readProfilePhotos : photos absent + photoURL vide → []
 *   PP5 — normalizePhotosForSave : array clean → { photos, photoURL: [0] }
 *   PP6 — normalizePhotosForSave : > max (5) → truncate
 *   PP7 — normalizePhotosForSave : dedup ordre préservé
 *   PP8 — normalizePhotosForSave : empty/whitespace/non-string skip
 *
 * Exécution : npx tsx tests/profile/photos-storage.test.ts
 */

import { readProfilePhotos, normalizePhotosForSave } from '../../src/lib/profile/photos';

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

function arrayEq(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function run() {
  // ─── readProfilePhotos ─────────────────────────────────────────────

  section('PP1 — photos array présent → utilise tel quel');
  {
    const r = readProfilePhotos({ photos: ['a', 'b', 'c'], photoURL: 'legacy' });
    if (arrayEq(r, ['a', 'b', 'c'])) ok('photos prioritaire vs photoURL');
    else fail('unexpected', r);
  }

  section('PP2 — photos absent + photoURL string → [photoURL]');
  {
    const r = readProfilePhotos({ photoURL: 'https://photo.jpg' });
    if (arrayEq(r, ['https://photo.jpg'])) ok('backward compat photoURL → array');
    else fail('unexpected', r);
  }

  section('PP3 — ni photos ni photoURL → []');
  {
    const r = readProfilePhotos({});
    if (arrayEq(r, [])) ok('empty');
    else fail('unexpected', r);
  }

  section('PP4 — photos absent + photoURL vide → []');
  {
    const r = readProfilePhotos({ photoURL: '' });
    if (arrayEq(r, [])) ok('empty string skip');
    else fail('unexpected', r);
  }

  section('PP4b — photos vide [] + photoURL set → fallback photoURL');
  {
    // photos vide est traité comme "absent" pour fallback legacy
    const r = readProfilePhotos({ photos: [], photoURL: 'legacy.jpg' });
    if (arrayEq(r, ['legacy.jpg'])) ok('photos=[] → fallback photoURL');
    else fail('unexpected', r);
  }

  // ─── normalizePhotosForSave ─────────────────────────────────────────

  section('PP5 — clean array → photos + photoURL=[0]');
  {
    const r = normalizePhotosForSave(['url1', 'url2', 'url3']);
    if (arrayEq(r.photos, ['url1', 'url2', 'url3']) && r.photoURL === 'url1') {
      ok('photos array + photoURL sync premier');
    } else fail('unexpected', r);
  }

  section('PP6 — > max (5) → truncate');
  {
    const r = normalizePhotosForSave(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    if (r.photos.length === 5 && arrayEq(r.photos, ['a', 'b', 'c', 'd', 'e'])) {
      ok('truncate à 5');
    } else fail('unexpected', r);
  }

  section('PP7 — dedup ordre préservé');
  {
    const r = normalizePhotosForSave(['a', 'b', 'a', 'c', 'b']);
    if (arrayEq(r.photos, ['a', 'b', 'c'])) ok('dedup OK premier ordre');
    else fail('unexpected', r);
  }

  section('PP8 — defensive : empty/whitespace/non-string skip');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = normalizePhotosForSave(['url1', '', '  ', null as any, undefined as any, 42 as any, 'url2']);
    if (arrayEq(r.photos, ['url1', 'url2']) && r.photoURL === 'url1') ok('skip invalides');
    else fail('unexpected', r);
  }

  section('PP8b — array vide → photos [] + photoURL ""');
  {
    const r = normalizePhotosForSave([]);
    if (r.photos.length === 0 && r.photoURL === '') ok('empty → empty');
    else fail('unexpected', r);
  }

  console.log(`\n====== Résumé profile photos ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
