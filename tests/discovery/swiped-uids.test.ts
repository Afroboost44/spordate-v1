/**
 * BUG #25 — Tests purs extractSwipedUids.
 *
 * Le helper combine N doc arrays (likes + passes du user courant) en un Set
 * des toUid à exclure de la stack /discovery. Defensive : skip docs avec
 * toUid manquant / non-string / vide / whitespace.
 *
 * Avant ce fix : handleNextProfile (X click) ne persistait RIEN, et la query
 * loadFirestoreProfiles ne filtrait PAS les déjà-swipés → les profils
 * likés/passés re-apparaissaient en boucle (Bassi : casse la mécanique Tinder).
 *
 * Couverture (SU1-SU7) :
 *   SU1 — empty arrays → empty Set
 *   SU2 — likes only → toUids des likes
 *   SU3 — passes only → toUids des passes
 *   SU4 — likes + passes both → union (dedup)
 *   SU5 — invalid toUid (undefined / number / null) → skip
 *   SU6 — whitespace trim
 *   SU7 — multiple sources combined OK
 *
 * Exécution : npx tsx tests/discovery/swiped-uids.test.ts
 */

import { extractSwipedUids } from '../../src/lib/discovery/swipedUids';

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

function setEq(a: Set<string>, b: string[]) {
  return a.size === b.length && b.every((v) => a.has(v));
}

async function run() {
  // -----------------------------------------------------------------------
  section('SU1 — empty arrays → empty Set');
  {
    const r = extractSwipedUids([]);
    if (r.size === 0) ok('empty Set');
    else fail('unexpected', Array.from(r));
  }

  // -----------------------------------------------------------------------
  section('SU2 — likes only → toUids');
  {
    const r = extractSwipedUids([
      { toUid: 'user-a' },
      { toUid: 'user-b' },
    ]);
    if (setEq(r, ['user-a', 'user-b'])) ok('2 toUids extraits');
    else fail('unexpected', Array.from(r));
  }

  // -----------------------------------------------------------------------
  section('SU3 — passes only → toUids');
  {
    const r = extractSwipedUids([{ toUid: 'user-x' }]);
    if (setEq(r, ['user-x'])) ok('toUid pass extrait');
    else fail('unexpected', Array.from(r));
  }

  // -----------------------------------------------------------------------
  section('SU4 — likes + passes both → union dedup');
  {
    const r = extractSwipedUids(
      [{ toUid: 'a' }, { toUid: 'b' }],
      [{ toUid: 'b' }, { toUid: 'c' }],
    );
    if (setEq(r, ['a', 'b', 'c'])) ok('union avec dedup (b une seule fois)');
    else fail('unexpected', Array.from(r));
  }

  // -----------------------------------------------------------------------
  section('SU5 — invalid toUid → skip');
  {
    const r = extractSwipedUids([
      { toUid: undefined },
      { toUid: null },
      { toUid: '' },
      { toUid: 123 as unknown as string },
      { toUid: 'valid' },
    ]);
    if (setEq(r, ['valid'])) ok('seul valid retenu, invalids skippés');
    else fail('unexpected', Array.from(r));
  }

  // -----------------------------------------------------------------------
  section('SU6 — whitespace trim');
  {
    const r = extractSwipedUids([
      { toUid: '   ' },
      { toUid: ' user-trim ' },
    ]);
    if (setEq(r, ['user-trim'])) ok('whitespace-only skip + autres trimmed');
    else fail('unexpected', Array.from(r));
  }

  // -----------------------------------------------------------------------
  section('SU7 — multiple sources (3+) combinées');
  {
    const r = extractSwipedUids(
      [{ toUid: 'a' }],
      [{ toUid: 'b' }],
      [{ toUid: 'c' }, { toUid: 'a' }],
    );
    if (setEq(r, ['a', 'b', 'c'])) ok('3 sources merged + dedup');
    else fail('unexpected', Array.from(r));
  }

  console.log(`\n====== Résumé discovery swipedUids ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
