/**
 * Bug Spordateur — image d'activité incorrecte sur page détail.
 *
 * Tests purs du helper resolveMediaImageSrc : chaîne de fallback pour le
 * <img src> d'un MediaItem type='image' rendu par <MediaCarousel>.
 *
 * Ordre de fallback ciblé :
 *   1. URL custom uploadée / CDN classique → telle quelle
 *   2. Lien YouTube → miniature hqdefault.jpg extraite automatiquement
 *   3. URL vide / null / undefined → logo Spordateur (/brand/icon-512.png)
 *
 * Exécution : `npx tsx tests/activities/media-image-src.test.ts`
 * Pas d'emulator nécessaire — fonction pure, pas de réseau.
 */

import {
  resolveMediaImageSrc,
  SPORDATEUR_LOGO_FALLBACK,
} from '../../src/lib/activities/media';

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

section('MIS0 SPORDATEUR_LOGO_FALLBACK — asset logo neon Spordateur');
assertEq(SPORDATEUR_LOGO_FALLBACK, '/brand/icon-512.png', 'pointe sur /brand/icon-512.png');

section('MIS1 priorité 1 — image custom uploadée / CDN classique → passthrough');
assertEq(
  resolveMediaImageSrc(
    'https://firebasestorage.googleapis.com/v0/b/spordate-prod/o/activities%2Fphoto.jpg?alt=media',
  ),
  'https://firebasestorage.googleapis.com/v0/b/spordate-prod/o/activities%2Fphoto.jpg?alt=media',
  'Firebase Storage upload URL inchangée',
);
assertEq(
  resolveMediaImageSrc('https://cdn.example.com/img/zumba.png'),
  'https://cdn.example.com/img/zumba.png',
  'CDN image URL inchangée',
);

section('MIS2 priorité 2 — lien YouTube → miniature hqdefault extraite');
assertEq(
  resolveMediaImageSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'watch?v= → miniature hqdefault',
);
assertEq(
  resolveMediaImageSrc('https://youtu.be/dQw4w9WgXcQ'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'youtu.be short link → miniature hqdefault',
);
assertEq(
  resolveMediaImageSrc('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  '/shorts/ → miniature hqdefault',
);

section('MIS3 priorité 3 — URL vide / null / undefined → logo Spordateur');
assertEq(resolveMediaImageSrc(''), SPORDATEUR_LOGO_FALLBACK, 'string vide → logo');
assertEq(resolveMediaImageSrc('   '), SPORDATEUR_LOGO_FALLBACK, 'whitespace-only → logo');
assertEq(resolveMediaImageSrc(null), SPORDATEUR_LOGO_FALLBACK, 'null → logo');
assertEq(resolveMediaImageSrc(undefined), SPORDATEUR_LOGO_FALLBACK, 'undefined → logo');

console.log(`\n====== Résumé MediaCarousel image src fallback ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
