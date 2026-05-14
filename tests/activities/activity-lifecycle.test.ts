/**
 * BUG #3 — Soft-delete d'activity ne cascade pas, sessions orphelines actives.
 *
 * Tests purs des helpers de cycle de vie activity/session :
 *  - isActivityUnavailable          : activity hard-deleted (null) OU soft-deleted (isActive=false)
 *  - isSessionUnavailable           : activity indisponible OU session.status='cancelled'
 *  - shouldCancelSessionOnActivityRemoval : session future & pas déjà cancelled/completed
 *
 * Exécution : `npx tsx tests/activities/activity-lifecycle.test.ts`
 * Pas d'emulator nécessaire — fonctions pures, pas de réseau.
 */

import {
  isActivityUnavailable,
  isSessionUnavailable,
  shouldCancelSessionOnActivityRemoval,
} from '../../src/lib/activities/lifecycle';

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

/** Fake Timestamp Firestore minimal — juste toMillis(). */
const ts = (ms: number) => ({ toMillis: () => ms });

const NOW = 1_700_000_000_000;
const FUTURE = ts(NOW + 86_400_000); // +1j
const PAST = ts(NOW - 86_400_000); // -1j

section('AL1 isActivityUnavailable — hard-delete (null) ou soft-delete (isActive=false)');
assertEq(isActivityUnavailable(null), true, 'null (activity hard-deleted) → indisponible');
assertEq(isActivityUnavailable(undefined), true, 'undefined → indisponible');
assertEq(isActivityUnavailable({ isActive: false }), true, 'isActive=false (soft-delete) → indisponible');
assertEq(isActivityUnavailable({ isActive: true }), false, 'isActive=true → disponible');

section('AL2 isSessionUnavailable — activity indisponible OU session cancelled');
assertEq(
  isSessionUnavailable({ isActive: true }, { status: 'open' }),
  false,
  'activity active + session open → disponible',
);
assertEq(
  isSessionUnavailable({ isActive: false }, { status: 'open' }),
  true,
  'activity inactive + session open → indisponible',
);
assertEq(
  isSessionUnavailable(null, { status: 'open' }),
  true,
  'activity hard-deleted + session open → indisponible',
);
assertEq(
  isSessionUnavailable({ isActive: true }, { status: 'cancelled' }),
  true,
  'activity active mais session cancelled → indisponible',
);
assertEq(
  isSessionUnavailable({ isActive: true }, null),
  false,
  'activity active + session null → disponible',
);

section('AL3 shouldCancelSessionOnActivityRemoval — session future non terminée/annulée');
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'open', startAt: FUTURE }, NOW),
  true,
  'session open future → à annuler',
);
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'scheduled', startAt: FUTURE }, NOW),
  true,
  'session scheduled future → à annuler',
);
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'full', startAt: FUTURE }, NOW),
  true,
  'session full future → à annuler',
);
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'cancelled', startAt: FUTURE }, NOW),
  false,
  'session déjà cancelled → idempotent, ne pas re-annuler',
);
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'completed', startAt: PAST }, NOW),
  false,
  'session completed → ne jamais annuler une session passée',
);
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'open', startAt: PAST }, NOW),
  false,
  'session open mais startAt passé → hors scope (pas future)',
);
assertEq(
  shouldCancelSessionOnActivityRemoval(null, NOW),
  false,
  'session null → false (defensive)',
);
assertEq(
  shouldCancelSessionOnActivityRemoval({ status: 'open' }, NOW),
  false,
  'session sans startAt → false (defensive)',
);

console.log(`\n====== Résumé Activity Lifecycle ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
