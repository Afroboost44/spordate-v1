/**
 * Phase 9.5 c29b CH4 — Tests purs de computeBoostCost().
 *
 * Exécution : `npx tsx tests/boost-credits.test.ts`
 * (pas d'emulator nécessaire — fonction pure, pas de Firestore).
 *
 * Couvre le mapping duration→cost et la cohérence avec le taux 0.5 CHF/crédit.
 */

// Phase 9.5 c30 — import depuis lib (extrait du route.ts pour respecter
// la contrainte Next.js 15 sur les exports route files).
import { computeBoostCost, BOOST_CREDITS_COST } from '../src/lib/billing/boostCredits';

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${expected}\n    actual:   ${actual}`);
  }
}

function assertThrows(fn: () => void, label: string) {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${label} — expected throw, got none`);
  } catch {
    passes++;
    console.log(`  ✓ ${label}`);
  }
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

const CHF_PER_CREDIT = 0.5;

// ---------------------------------------------------------------------------

section('Mapping duration → coût en crédits');
{
  assertEq(computeBoostCost('24h'), 30, "24h = 30 crédits");
  assertEq(computeBoostCost('3d'), 70, '3d = 70 crédits');
  assertEq(computeBoostCost('7d'), 100, '7d = 100 crédits');
}

section('Cohérence taux 0.5 CHF/crédit (Phase 3 bundle 50 crédits = 25 CHF)');
{
  // Tarifs Stripe correspondants : 15 / 35 / 50 CHF (cf. /api/boost-checkout)
  assertEq(computeBoostCost('24h') * CHF_PER_CREDIT, 15, '30 crédits × 0.5 = 15 CHF (Stripe 24h)');
  assertEq(computeBoostCost('3d') * CHF_PER_CREDIT, 35, '70 crédits × 0.5 = 35 CHF (Stripe 3d)');
  assertEq(computeBoostCost('7d') * CHF_PER_CREDIT, 50, '100 crédits × 0.5 = 50 CHF (Stripe 7d)');
}

section('Validation entrées invalides → throw');
{
  assertThrows(() => computeBoostCost('1h'), "'1h' invalide → throw");
  assertThrows(() => computeBoostCost(''), 'string vide → throw');
  assertThrows(() => computeBoostCost('30d'), "'30d' inconnu → throw");
}

section('Export BOOST_CREDITS_COST cohérent avec computeBoostCost()');
{
  assertEq(BOOST_CREDITS_COST['24h'], 30, "BOOST_CREDITS_COST['24h']");
  assertEq(BOOST_CREDITS_COST['3d'], 70, "BOOST_CREDITS_COST['3d']");
  assertEq(BOOST_CREDITS_COST['7d'], 100, "BOOST_CREDITS_COST['7d']");
  assertEq(Object.keys(BOOST_CREDITS_COST).length, 3, '3 durées totales');
}

// ---------------------------------------------------------------------------

console.log(`\n=== Résultat : ${passes} passes, ${failures} failures ===`);
if (failures > 0) process.exit(1);
process.exit(0);
