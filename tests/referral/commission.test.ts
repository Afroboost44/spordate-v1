/**
 * Phase B — Tests purs des helpers commission.
 *
 *  - resolveUserCommission : retourne config { mode, value } avec defaults
 *  - computePercentCommission : amount cents × value% → cents arrondis
 *  - computeFreeClassCredits  : value sanitisé → nb de credits entier ≥ 0
 *
 * Defaults Phase B :
 *  - slot 'creator' : { mode: 'percent',    value: 10 }
 *  - slot 'invite'  : { mode: 'free-class', value: 1 }
 *
 * Exécution : npx tsx tests/referral/commission.test.ts
 */

import {
  resolveUserCommission,
  computePercentCommission,
  computeFreeClassCredits,
  DEFAULT_CREATOR_COMMISSION,
  DEFAULT_INVITE_COMMISSION,
} from '../../src/lib/referral/commission';

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

function assertDeep<T>(actual: T, expected: T, label: string) {
  assertEq(JSON.stringify(actual), JSON.stringify(expected), label);
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

section('C0 — defaults exportés');
assertDeep(DEFAULT_CREATOR_COMMISSION, { mode: 'percent', value: 10 }, 'creator default = percent 10%');
assertDeep(DEFAULT_INVITE_COMMISSION, { mode: 'free-class', value: 1 }, 'invite default = free-class 1');

section('C1 — resolveUserCommission : defaults si user vide ou pas de commission');
assertDeep(resolveUserCommission(null, 'creator'), DEFAULT_CREATOR_COMMISSION, 'null user → creator default');
assertDeep(resolveUserCommission(undefined, 'invite'), DEFAULT_INVITE_COMMISSION, 'undefined user → invite default');
assertDeep(resolveUserCommission({}, 'creator'), DEFAULT_CREATOR_COMMISSION, '{} → creator default');
assertDeep(resolveUserCommission({ commission: {} }, 'invite'), DEFAULT_INVITE_COMMISSION, 'empty commission → invite default');
assertDeep(
  resolveUserCommission({ commission: { invite: { mode: 'free-class', value: 5 } } }, 'creator'),
  DEFAULT_CREATOR_COMMISSION,
  'creator slot absent mais invite défini → creator default',
);

section('C2 — resolveUserCommission : config custom retournée tel quel');
assertDeep(
  resolveUserCommission({ commission: { creator: { mode: 'percent', value: 25 } } }, 'creator'),
  { mode: 'percent', value: 25 },
  'creator percent 25%',
);
assertDeep(
  resolveUserCommission({ commission: { invite: { mode: 'free-class', value: 3 } } }, 'invite'),
  { mode: 'free-class', value: 3 },
  'invite free-class 3',
);
assertDeep(
  resolveUserCommission({ commission: { creator: { mode: 'free-class', value: 2 } } }, 'creator'),
  { mode: 'free-class', value: 2 },
  'creator free-class 2 (mode swap autorisé)',
);
assertDeep(
  resolveUserCommission({ commission: { invite: { mode: 'percent', value: 20 } } }, 'invite'),
  { mode: 'percent', value: 20 },
  'invite percent 20% (mode swap autorisé)',
);

section('C3 — resolveUserCommission : sanitization defensive');
// Mode invalide → fallback 'percent' (mode "principal" par défaut)
assertDeep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveUserCommission({ commission: { creator: { mode: 'banana' as any, value: 15 } } }, 'creator'),
  { mode: 'percent', value: 15 },
  'mode invalide → fallback percent (value conservée)',
);
// Value invalide → fallback default value du mode courant
assertDeep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveUserCommission({ commission: { creator: { mode: 'percent', value: 'abc' as any } } }, 'creator'),
  { mode: 'percent', value: 10 },
  'value non-number → fallback default 10 pour percent',
);
assertDeep(
  resolveUserCommission({ commission: { invite: { mode: 'free-class', value: -3 } } }, 'invite'),
  { mode: 'free-class', value: 1 },
  'value négative → fallback default 1 pour free-class',
);
assertDeep(
  resolveUserCommission({ commission: { creator: { mode: 'percent', value: NaN } } }, 'creator'),
  { mode: 'percent', value: 10 },
  'value NaN → fallback default',
);

section('C4 — computePercentCommission : amount(cents) × value% → cents arrondis');
assertEq(computePercentCommission(10_000, 10), 1_000, '100 CHF × 10% = 10 CHF (1000 cents)');
assertEq(computePercentCommission(10_000, 20), 2_000, '100 CHF × 20% = 20 CHF');
assertEq(computePercentCommission(2_500, 10), 250, '25 CHF × 10% = 2.50 CHF (250 cents)');
assertEq(computePercentCommission(999, 15), 150, '9.99 CHF × 15% = 1.4985 → arrondi 150 cents');
assertEq(computePercentCommission(0, 10), 0, 'amount 0 → 0');
assertEq(computePercentCommission(-100, 10), 0, 'amount négatif → 0');
assertEq(computePercentCommission(10_000, 0), 0, 'value 0 → 0');
assertEq(computePercentCommission(10_000, -5), 0, 'value négative → 0');
assertEq(computePercentCommission(NaN, 10), 0, 'amount NaN → 0');
assertEq(computePercentCommission(10_000, NaN), 0, 'value NaN → 0');

section('C5 — computeFreeClassCredits : value → entier ≥ 0');
assertEq(computeFreeClassCredits(1), 1, 'value 1 → 1');
assertEq(computeFreeClassCredits(3), 3, 'value 3 → 3');
assertEq(computeFreeClassCredits(2.7), 2, 'value 2.7 → 2 (floor)');
assertEq(computeFreeClassCredits(0), 0, 'value 0 → 0');
assertEq(computeFreeClassCredits(-5), 0, 'value négative → 0');
assertEq(computeFreeClassCredits(NaN), 0, 'NaN → 0');

console.log(`\n====== Résumé commission helpers (Phase B) ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
