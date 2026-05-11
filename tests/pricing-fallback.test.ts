/**
 * Phase 9.5 c29a CH5 — Tests purs de computeFallbackTiers().
 *
 * Exécution : `npx tsx tests/pricing-fallback.test.ts`
 * (pas d'emulator nécessaire — fonction pure, pas de Firestore).
 */

import { computeFallbackTiers } from '../src/services/firestore';
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

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

// ---------------------------------------------------------------------------

section('Activity 10 CHF → tiers en centimes 800/1000/1200');
{
  const tiers = computeFallbackTiers(10);
  assertEq(tiers.length, 3, 'returns 3 tiers');
  const early = tiers.find((t) => t.kind === 'early') as PricingTier;
  const std = tiers.find((t) => t.kind === 'standard') as PricingTier;
  const last = tiers.find((t) => t.kind === 'last_minute') as PricingTier;
  assertEq(early.price, 800, 'early = 80% × 1000 centimes');
  assertEq(std.price, 1000, 'standard = base 1000 centimes');
  assertEq(last.price, 1200, 'last_minute = 120% × 1000 centimes');
}

section('Activity 25 CHF → tiers 2000/2500/3000');
{
  const tiers = computeFallbackTiers(25);
  const early = tiers.find((t) => t.kind === 'early') as PricingTier;
  const std = tiers.find((t) => t.kind === 'standard') as PricingTier;
  const last = tiers.find((t) => t.kind === 'last_minute') as PricingTier;
  assertEq(early.price, 2000, 'early 25 CHF → 2000 centimes');
  assertEq(std.price, 2500, 'standard 25 CHF → 2500 centimes');
  assertEq(last.price, 3000, 'last_minute 25 CHF → 3000 centimes');
}

section('Activate triggers cohérents');
{
  const tiers = computeFallbackTiers(10);
  const early = tiers.find((t) => t.kind === 'early') as PricingTier;
  const std = tiers.find((t) => t.kind === 'standard') as PricingTier;
  const last = tiers.find((t) => t.kind === 'last_minute') as PricingTier;
  assertEq(early.activateMinutesBeforeStart, 10080, 'early triggers 7d before (10080 min)');
  assertEq(early.activateAtFillRate, 0, 'early fill 0%');
  assertEq(std.activateMinutesBeforeStart, 1440, 'standard triggers 24h before (1440 min)');
  assertEq(std.activateAtFillRate, 0.5, 'standard fill 50%');
  assertEq(last.activateMinutesBeforeStart, 60, 'last_minute triggers 1h before');
  assertEq(last.activateAtFillRate, 0.9, 'last_minute fill 90%');
}

section('Arrondi décimal : Activity 15.50 CHF → 1240/1550/1860');
{
  const tiers = computeFallbackTiers(15.5);
  const early = tiers.find((t) => t.kind === 'early') as PricingTier;
  const std = tiers.find((t) => t.kind === 'standard') as PricingTier;
  const last = tiers.find((t) => t.kind === 'last_minute') as PricingTier;
  assertEq(early.price, 1240, 'early 1550 × 0.8 = 1240');
  assertEq(std.price, 1550, 'standard 15.50 CHF → 1550 centimes');
  assertEq(last.price, 1860, 'last_minute 1550 × 1.2 = 1860');
}

section('Edge : Activity 1 CHF → 80/100/120');
{
  const tiers = computeFallbackTiers(1);
  const early = tiers.find((t) => t.kind === 'early') as PricingTier;
  const last = tiers.find((t) => t.kind === 'last_minute') as PricingTier;
  assertEq(early.price, 80, 'early petit prix arrondi correct');
  assertEq(last.price, 120, 'last_minute petit prix arrondi correct');
}

// ---------------------------------------------------------------------------

console.log(`\n=== Résultat : ${passes} passes, ${failures} failures ===`);
if (failures > 0) process.exit(1);
process.exit(0);
