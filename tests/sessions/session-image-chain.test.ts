/**
 * BUG #2 — Image placeholder random sur /sessions/[sessionId].
 *
 * Tests purs du helper resolveSessionImageChain : construit la chaîne d'URLs
 * `<Image src>` essayées par <SessionMediaPlayer>, TOUJOURS terminée par le
 * logo Spordateur — jamais par une photo random Picsum (la "tasse de café").
 *
 * Exécution : `npx tsx tests/sessions/session-image-chain.test.ts`
 * Pas d'emulator nécessaire — fonction pure, pas de réseau.
 */

import {
  resolveSessionImageChain,
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

function assertArrEq(actual: string[], expected: string[], label: string) {
  assertEq(JSON.stringify(actual), JSON.stringify(expected), label);
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

section('SIC0 — la chaîne se termine TOUJOURS par le logo Spordateur');
assertEq(
  resolveSessionImageChain(null).at(-1),
  SPORDATEUR_LOGO_FALLBACK,
  'primary null → dernier élément = logo',
);
assertEq(
  resolveSessionImageChain('https://cdn.example.com/x.jpg', ['https://y.jpg']).at(-1),
  SPORDATEUR_LOGO_FALLBACK,
  'primary + fallbacks → dernier élément = logo',
);

section('SIC1 — aucune image (session zumba en prod) → uniquement le logo');
assertArrEq(resolveSessionImageChain(null, []), [SPORDATEUR_LOGO_FALLBACK], 'null + [] → [logo]');
assertArrEq(
  resolveSessionImageChain(undefined, undefined),
  [SPORDATEUR_LOGO_FALLBACK],
  'undefined + undefined → [logo]',
);

section('SIC2 — image custom uploadée / CDN → passthrough puis logo');
assertArrEq(
  resolveSessionImageChain('https://cdn.example.com/zumba.jpg'),
  ['https://cdn.example.com/zumba.jpg', SPORDATEUR_LOGO_FALLBACK],
  'CDN image → [image, logo]',
);

section('SIC3 — lien YouTube en position image → miniature extraite puis logo');
assertArrEq(
  resolveSessionImageChain('https://youtu.be/dQw4w9WgXcQ'),
  ['https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', SPORDATEUR_LOGO_FALLBACK],
  'youtu.be → [miniature hqdefault, logo]',
);

section('SIC4 — primary + fallback chain (ex: YouTube hq → mq → default)');
assertArrEq(
  resolveSessionImageChain('https://a.jpg', ['https://b.jpg', 'https://c.jpg']),
  ['https://a.jpg', 'https://b.jpg', 'https://c.jpg', SPORDATEUR_LOGO_FALLBACK],
  'primary + 2 fallbacks → [primary, ...fallbacks, logo]',
);

section('SIC5 — entrées vides / whitespace ignorées');
assertArrEq(
  resolveSessionImageChain('   ', ['', '  ']),
  [SPORDATEUR_LOGO_FALLBACK],
  'primary whitespace + fallbacks vides → [logo]',
);

section('SIC6 — RÉGRESSION : jamais de placeholder Picsum random');
{
  const samples = [
    resolveSessionImageChain(null),
    resolveSessionImageChain('zumba'),
    resolveSessionImageChain(undefined, ['yoga']),
    resolveSessionImageChain('https://youtu.be/dQw4w9WgXcQ'),
  ];
  const hasPicsum = samples.some((chain) =>
    chain.some((url) => url.includes('picsum.photos')),
  );
  assertEq(hasPicsum, false, 'aucune chaîne ne contient picsum.photos');
}

section('SIC7 BUG #6 — URL Drive transformée en thumbnail (primary ET fallbacks)');
{
  const driveShare = 'https://drive.google.com/file/d/1aBc2DeF3GhI4JkL5MnO/view?usp=sharing';
  const driveThumb = 'https://drive.google.com/thumbnail?id=1aBc2DeF3GhI4JkL5MnO&sz=w800';

  assertArrEq(
    resolveSessionImageChain(driveShare),
    [driveThumb, SPORDATEUR_LOGO_FALLBACK],
    'Drive en primary → [thumbnail, logo]',
  );
  assertArrEq(
    resolveSessionImageChain('https://cdn.example.com/a.jpg', [driveShare]),
    ['https://cdn.example.com/a.jpg', driveThumb, SPORDATEUR_LOGO_FALLBACK],
    'Drive dans les fallbacks → fallback transformé en thumbnail',
  );
}

console.log(`\n====== Résumé SessionMediaPlayer image chain ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
