/**
 * BUG #17 — Tests purs computeMediaCarouselLayout.
 *
 * Le helper centralise la décision UI du carousel media (page /activities/[id]) :
 *  - basis class par CarouselItem (combien fit par viewport mobile/tablet/desktop)
 *  - flag showArrows (utile pour cacher les flèches sur mobile + quand 1 seul item)
 *
 * Avant ce fix : MediaCarousel était une grille statique (pas vraiment carousel) ;
 * pas de swipe mobile, pas de flèches. Bassi veut un vrai carousel swipe-able
 * sur mobile + flèches sur desktop (UX standard).
 *
 * Couverture (ML1-ML4) :
 *   ML1 — 0 items → basis-full, no arrows (caller render null avant ce path)
 *   ML2 — 1 item → basis-full, no arrows (rien à faire défiler)
 *   ML3 — 2 items → responsive basis (mobile full, tablet 1/2, desktop 1/3), arrows
 *   ML4 — 5 items → idem ML3 (arrows + responsive basis)
 *
 * Exécution : npx tsx tests/activities/media-carousel-layout.test.ts
 */

import { computeMediaCarouselLayout } from '../../src/lib/activities/mediaCarouselLayout';

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
  section('ML1 — 0 items → basis-full + no arrows');
  {
    const r = computeMediaCarouselLayout(0);
    if (r.itemBasis === 'basis-full' && r.showArrows === false) ok('layout single-item / no arrows');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('ML2 — 1 item → basis-full + no arrows (rien à faire défiler)');
  {
    const r = computeMediaCarouselLayout(1);
    if (r.itemBasis === 'basis-full' && r.showArrows === false) ok('single item → pleine largeur, pas d\'arrows');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('ML3 — 2 items → responsive basis + arrows');
  {
    const r = computeMediaCarouselLayout(2);
    if (
      r.itemBasis.includes('basis-full') &&
      r.itemBasis.includes('sm:basis-1/2') &&
      r.itemBasis.includes('lg:basis-1/3') &&
      r.showArrows === true
    ) {
      ok('responsive 1/2/3 + arrows');
    } else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('ML4 — 5 items → idem ML3');
  {
    const r = computeMediaCarouselLayout(5);
    if (
      r.itemBasis.includes('basis-full') &&
      r.itemBasis.includes('sm:basis-1/2') &&
      r.itemBasis.includes('lg:basis-1/3') &&
      r.showArrows === true
    ) {
      ok('responsive 1/2/3 + arrows');
    } else fail('unexpected', r);
  }

  console.log(`\n====== Résumé media-carousel-layout ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
