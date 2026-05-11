/**
 * Phase 9.5 c31 CH5 — Tests purs des helpers d'édition pricing tiers.
 *
 * Exécution : `npx tsx tests/activity-pricing-edit.test.ts`
 * Pas d'emulator nécessaire — fonctions pures, pas de Firestore.
 */

import {
  buildPricingTiersPayload,
  parsePricingTiersFromFirestore,
  suggestPricingTiersFromBase,
  validatePricingTiers,
} from '../src/lib/billing/pricingTiersBuilder';
import type { PricingTier } from '../src/types/firestore';

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function assertThrows(fn: () => void, expectedMessage: string, label: string) {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${label} — expected throw '${expectedMessage}', got none`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === expectedMessage) {
      passes++;
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.error(`  ✗ ${label} — expected '${expectedMessage}', got '${msg}'`);
    }
  }
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

// ---------------------------------------------------------------------------

section('suggestPricingTiersFromBase : 80/100/120% du prix de base');
{
  assertEq(suggestPricingTiersFromBase(10), { earlyCHF: 8, standardCHF: 10, lastMinuteCHF: 12 }, '10 CHF → 8/10/12');
  assertEq(suggestPricingTiersFromBase(15), { earlyCHF: 12, standardCHF: 15, lastMinuteCHF: 18 }, '15 CHF → 12/15/18');
  assertEq(suggestPricingTiersFromBase(25), { earlyCHF: 20, standardCHF: 25, lastMinuteCHF: 30 }, '25 CHF → 20/25/30');
  assertEq(suggestPricingTiersFromBase(1), { earlyCHF: 1, standardCHF: 1, lastMinuteCHF: 1 }, '1 CHF → 1/1/1 (arrondi)');
}

section('buildPricingTiersPayload toggle OFF → []');
{
  assertEq(
    buildPricingTiersPayload(false, { earlyCHF: 8, standardCHF: 10, lastMinuteCHF: 12 }),
    [],
    'toggle OFF retourne array vide quel que soit l\'input',
  );
}

section('buildPricingTiersPayload toggle ON → 3 tiers en centimes');
{
  const result = buildPricingTiersPayload(true, { earlyCHF: 8, standardCHF: 10, lastMinuteCHF: 12 });
  assertEq(result.length, 3, '3 tiers générés');
  assertEq(result[0].kind, 'early', 'kind 1 = early');
  assertEq(result[0].price, 800, 'early 8 CHF → 800 centimes');
  assertEq(result[0].activateMinutesBeforeStart, 10080, 'early trigger 7j (10080 min)');
  assertEq(result[0].activateAtFillRate, 0, 'early fill 0');
  assertEq(result[1].kind, 'standard', 'kind 2 = standard');
  assertEq(result[1].price, 1000, 'standard 10 CHF → 1000 centimes');
  assertEq(result[1].activateMinutesBeforeStart, 1440, 'standard trigger 24h');
  assertEq(result[1].activateAtFillRate, 0.5, 'standard fill 50%');
  assertEq(result[2].kind, 'last_minute', 'kind 3 = last_minute');
  assertEq(result[2].price, 1200, 'last 12 CHF → 1200 centimes');
  assertEq(result[2].activateMinutesBeforeStart, 60, 'last trigger 1h');
  assertEq(result[2].activateAtFillRate, 0.9, 'last fill 90%');
}

section('validatePricingTiers : ordre croissant + positivité');
{
  validatePricingTiers({ earlyCHF: 8, standardCHF: 10, lastMinuteCHF: 12 });
  passes++;
  console.log('  ✓ 8 < 10 < 12 → OK (no throw)');

  assertThrows(
    () => validatePricingTiers({ earlyCHF: 10, standardCHF: 8, lastMinuteCHF: 12 }),
    'order',
    "early > standard → throw 'order'",
  );
  assertThrows(
    () => validatePricingTiers({ earlyCHF: 8, standardCHF: 12, lastMinuteCHF: 10 }),
    'order',
    "standard > last → throw 'order'",
  );
  assertThrows(
    () => validatePricingTiers({ earlyCHF: 10, standardCHF: 10, lastMinuteCHF: 12 }),
    'order',
    "early == standard → throw 'order' (strict <)",
  );

  assertThrows(
    () => validatePricingTiers({ earlyCHF: 0, standardCHF: 10, lastMinuteCHF: 12 }),
    'positive',
    "early=0 → throw 'positive'",
  );
  assertThrows(
    () => validatePricingTiers({ earlyCHF: 8, standardCHF: -5, lastMinuteCHF: 12 }),
    'positive',
    "standard=-5 → throw 'positive'",
  );
  assertThrows(
    () => validatePricingTiers({ earlyCHF: 8, standardCHF: 10, lastMinuteCHF: 0 }),
    'positive',
    "last=0 → throw 'positive'",
  );
}

section('parsePricingTiersFromFirestore : centimes → CHF');
{
  assertEq(parsePricingTiersFromFirestore(null), null, 'null → null');
  assertEq(parsePricingTiersFromFirestore([]), null, '[] → null (toggle OFF)');

  const sample: PricingTier[] = [
    { kind: 'early', price: 800, activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
    { kind: 'standard', price: 1000, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
    { kind: 'last_minute', price: 1200, activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
  ];
  assertEq(
    parsePricingTiersFromFirestore(sample),
    { earlyCHF: 8, standardCHF: 10, lastMinuteCHF: 12 },
    'sample 800/1000/1200 cts → 8/10/12 CHF',
  );

  // Tier manquant → 0 (sera affiché dans l'input, partner pourra corriger)
  assertEq(
    parsePricingTiersFromFirestore([sample[1]]), // standard only
    { earlyCHF: 0, standardCHF: 10, lastMinuteCHF: 0 },
    'tier manquant → 0',
  );
}

// ---------------------------------------------------------------------------

console.log(`\n=== Résultat : ${passes} passes, ${failures} failures ===`);
if (failures > 0) process.exit(1);
process.exit(0);
