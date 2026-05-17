/**
 * BUG #29 — Tests purs formatImageCounter.
 *
 * Indicateur swipe sur card LISTE mobile : badge "X/Y" en haut-droite pour
 * rendre explicite qu'il y a plusieurs images à swiper (Bassi : "l'utilisateur
 * ne sait pas s'il faut double-cliqué pour voir plus images").
 *
 * Sémantique :
 *  - total ≤ 1 → null (pas de counter, rien à indiquer)
 *  - total ≥ 2 → "currentIndex+1/total" (UX 1-based)
 *  - currentIndex hors range → clamp 0..total-1
 *  - inputs invalides (NaN, négatifs) → null défensif
 *
 * Couverture (IC1-IC6) :
 *   IC1 — 1 item → null
 *   IC2 — 0 items → null
 *   IC3 — 4 items, current=0 → "1/4"
 *   IC4 — 4 items, current=3 → "4/4"
 *   IC5 — out-of-range current (>= total) → clamp to last
 *   IC6 — NaN / négatif → null defensive
 *
 * Exécution : npx tsx tests/activities/image-counter.test.ts
 */

import { formatImageCounter } from '../../src/lib/activities/imageCounter';

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
  section('IC1 — 1 item → null (pas d\'indicateur si 1 seul)');
  {
    if (formatImageCounter(0, 1) === null) ok('null pour 1 item');
    else fail('unexpected', formatImageCounter(0, 1));
  }

  section('IC2 — 0 items → null');
  {
    if (formatImageCounter(0, 0) === null) ok('null pour 0 items');
    else fail('unexpected');
  }

  section('IC3 — 4 items, current=0 → "1/4"');
  {
    if (formatImageCounter(0, 4) === '1/4') ok('1-based first');
    else fail('unexpected', formatImageCounter(0, 4));
  }

  section('IC4 — 4 items, current=3 → "4/4"');
  {
    if (formatImageCounter(3, 4) === '4/4') ok('1-based last');
    else fail('unexpected', formatImageCounter(3, 4));
  }

  section('IC5 — out-of-range current → clamp');
  {
    if (formatImageCounter(99, 4) === '4/4') ok('clamp >= total → last');
    else fail('unexpected', formatImageCounter(99, 4));
    if (formatImageCounter(-5, 4) === '1/4') ok('clamp < 0 → first');
    else fail('unexpected', formatImageCounter(-5, 4));
  }

  section('IC6 — NaN / non-finite → null');
  {
    if (formatImageCounter(NaN, 4) === null) ok('NaN current → null');
    else fail('unexpected');
    if (formatImageCounter(0, NaN) === null) ok('NaN total → null');
    else fail('unexpected');
    if (formatImageCounter(0, -3) === null) ok('total négatif → null');
    else fail('unexpected');
  }

  console.log(`\n====== Résumé image-counter ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
