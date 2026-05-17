/**
 * BUG #20 — Tests purs buildActivityListUrl.
 *
 * Le helper construit l'URL vers la page liste activités, avec hash optionnel
 * pour le scroll auto vers une carte précise (BUG #20 : modal "Où pratiquer ?"
 * → liste filtrée + scrolled au lieu de detail direct).
 *
 * Sémantique :
 *  - activityId présent → '/activities#activity-{id}' (browser auto-scroll)
 *  - absent/null/empty/whitespace → '/activities' (no hash)
 *
 * Couverture (AL1-AL5) :
 *   AL1 — activityId valide → '/activities#activity-{id}'
 *   AL2 — undefined → '/activities'
 *   AL3 — null → '/activities'
 *   AL4 — empty string → '/activities'
 *   AL5 — whitespace → '/activities'
 *
 * Exécution : npx tsx tests/activities/list-url.test.ts
 */

import { buildActivityListUrl } from '../../src/lib/activities/listUrl';

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
  section('AL1 — activityId valide → /activities#activity-{id}');
  {
    if (buildActivityListUrl('act-abc-123') === '/activities#activity-act-abc-123') ok('hash OK');
    else fail('url inattendue', buildActivityListUrl('act-abc-123'));
  }

  section('AL2 — undefined → /activities');
  {
    if (buildActivityListUrl(undefined) === '/activities') ok('no hash si undefined');
    else fail('url inattendue', buildActivityListUrl(undefined));
  }

  section('AL3 — null → /activities');
  {
    if (buildActivityListUrl(null) === '/activities') ok('no hash si null');
    else fail('url inattendue', buildActivityListUrl(null));
  }

  section('AL4 — empty string → /activities');
  {
    if (buildActivityListUrl('') === '/activities') ok('no hash si empty');
    else fail('url inattendue', buildActivityListUrl(''));
  }

  section('AL5 — whitespace → /activities (defensive trim)');
  {
    if (buildActivityListUrl('   ') === '/activities') ok('no hash si whitespace');
    else fail('url inattendue', buildActivityListUrl('   '));
  }

  console.log(`\n====== Résumé activities list-url ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
