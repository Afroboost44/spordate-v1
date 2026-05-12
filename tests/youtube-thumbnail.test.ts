/**
 * Phase 9.5 c48 BUG A — Tests purs du helper extractYouTubeThumb.
 *
 * Exécution : `npx tsx tests/youtube-thumbnail.test.ts`
 * Pas d'emulator nécessaire — fonctions pures, pas de réseau.
 */

import {
  extractYouTubeId,
  extractYouTubeThumb,
  resolveThumbnail,
} from '../src/lib/youtube/thumbnail';

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

section('YT1 extractYouTubeId — formats supportés');
assertEq(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'watch?v=ID');
assertEq(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'youtu.be short link');
assertEq(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', '/embed/ID');
assertEq(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', '/shorts/ID');
assertEq(extractYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'mobile m.youtube.com');
assertEq(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ', 'youtu.be avec timestamp');
assertEq(extractYouTubeId('https://www.youtube.com/watch?list=PLxxx&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'watch avec list= avant v=');
assertEq(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), 'dQw4w9WgXcQ', 'watch avec params suivants');

section('YT2 extractYouTubeId — invalid inputs → null');
assertEq(extractYouTubeId('https://example.com/image.png'), null, 'URL non-YouTube');
assertEq(extractYouTubeId('https://vimeo.com/12345'), null, 'Vimeo non match');
assertEq(extractYouTubeId(''), null, 'string vide');
assertEq(extractYouTubeId(null), null, 'null');
assertEq(extractYouTubeId(undefined), null, 'undefined');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assertEq(extractYouTubeId(123 as any), null, 'non-string defensive');

section('YT3 extractYouTubeThumb — URL miniature');
assertEq(
  extractYouTubeThumb('https://youtu.be/dQw4w9WgXcQ'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'hq par défaut',
);
assertEq(
  extractYouTubeThumb('https://youtu.be/dQw4w9WgXcQ', 'default'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/default.jpg',
  'quality=default',
);
assertEq(
  extractYouTubeThumb('https://youtu.be/dQw4w9WgXcQ', 'max'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  'quality=max',
);
assertEq(extractYouTubeThumb('https://example.com/x.png'), null, 'non-YouTube → null');

section('YT4 resolveThumbnail — fallback CDN images');
assertEq(
  resolveThumbnail('https://youtu.be/dQw4w9WgXcQ'),
  'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'YouTube → miniature',
);
assertEq(
  resolveThumbnail('https://cdn.example.com/img/photo.jpg'),
  'https://cdn.example.com/img/photo.jpg',
  'CDN image passthrough',
);
assertEq(resolveThumbnail(''), '', 'empty string passthrough');
assertEq(resolveThumbnail(null), '', 'null → empty');
assertEq(resolveThumbnail(undefined), '', 'undefined → empty');

console.log(`\n====== Résumé YouTube Thumbnail ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
