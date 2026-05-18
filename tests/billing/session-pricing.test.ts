/**
 * Fix B B2 — Tests purs `buildSessionPricingTiers`.
 *
 * Helper qui construit le tableau PricingTier[] à appliquer sur
 * Session.pricingTiers selon le mode :
 *  - 'custom' : 3 tiers identiques au customPriceCHF (override total)
 *  - 'inherit' : copie activityPricingTiers si présents, sinon fallback
 *    [3 tiers depuis activityPriceCHF via computeFallbackTiers]
 *
 * Décisions Bassi :
 *  - Override total : tous les tiers (early/standard/last_minute) prennent
 *    la même valeur (customPriceCHF) → computePricingTier retourne toujours
 *    customPriceCHF quel que soit le moment ou le fill.
 *  - 0 CHF accepté → free booking flow déjà géré en aval.
 *  - Max 1000 CHF (validation côté caller, mais helper clamp défensif).
 *
 * Couverture SP1-SP8 :
 *   SP1 — mode=custom + customPriceCHF=5 → 3 tiers à 500 centimes
 *   SP2 — mode=custom + customPriceCHF=0 → 3 tiers à 0 (free)
 *   SP3 — mode=custom + customPriceCHF=10.5 → 3 tiers à 1050 (arrondi)
 *   SP4 — mode=custom + customPriceCHF négatif → clamp à 0
 *   SP5 — mode=inherit + activityPricingTiers présents → copie exacte
 *   SP6 — mode=inherit + activityPricingTiers vides + activityPriceCHF=8 → fallback computeFallbackTiers(8)
 *   SP7 — mode=inherit + tout vide → fallback computeFallbackTiers(0) = 3 tiers à 0
 *   SP8 — la structure de chaque tier garde activateMinutesBeforeStart + activateAtFillRate corrects
 *
 * Exécution : npx tsx tests/billing/session-pricing.test.ts
 */

import { buildSessionPricingTiers } from '../../src/lib/billing/sessionPricingTiers';
import type { PricingTier } from '../../src/types/firestore';

let passes = 0;
let failures = 0;

function ok(label: string) { passes++; console.log(`  ✓ ${label}`); }
function fail(label: string, info?: unknown) { failures++; console.error(`  ✗ ${label}`, info ?? ''); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

async function run() {
  section('SP1 — custom 5 CHF → 3 tiers à 500 centimes');
  {
    const r = buildSessionPricingTiers({
      mode: 'custom',
      customPriceCHF: 5,
      activityPricingTiers: undefined,
      activityPriceCHF: 0,
    });
    if (
      r.length === 3 &&
      r[0].price === 500 &&
      r[1].price === 500 &&
      r[2].price === 500 &&
      r[0].kind === 'early' &&
      r[1].kind === 'standard' &&
      r[2].kind === 'last_minute'
    ) {
      ok('3 tiers identiques @ 500c, ordering early/standard/last_minute');
    } else {
      fail('unexpected', r);
    }
  }

  section('SP2 — custom 0 CHF → 3 tiers à 0 (free)');
  {
    const r = buildSessionPricingTiers({
      mode: 'custom',
      customPriceCHF: 0,
      activityPricingTiers: undefined,
      activityPriceCHF: 0,
    });
    if (r.length === 3 && r.every((t) => t.price === 0)) ok('free triple');
    else fail('unexpected', r);
  }

  section('SP3 — custom 10.5 CHF → 1050 centimes (Math.round)');
  {
    const r = buildSessionPricingTiers({
      mode: 'custom',
      customPriceCHF: 10.5,
      activityPricingTiers: undefined,
      activityPriceCHF: 0,
    });
    if (r.every((t) => t.price === 1050)) ok('rounded to 1050c');
    else fail('unexpected', r);
  }

  section('SP4 — custom négatif → clamp à 0 (défensif)');
  {
    const r = buildSessionPricingTiers({
      mode: 'custom',
      customPriceCHF: -5,
      activityPricingTiers: undefined,
      activityPriceCHF: 0,
    });
    if (r.every((t) => t.price === 0)) ok('clamped to 0');
    else fail('unexpected', r);
  }

  section('SP5 — inherit + activityPricingTiers présents → copie exacte');
  {
    const activityTiers: PricingTier[] = [
      { kind: 'early', price: 400, activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
      { kind: 'standard', price: 500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
      { kind: 'last_minute', price: 600, activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
    ];
    const r = buildSessionPricingTiers({
      mode: 'inherit',
      activityPricingTiers: activityTiers,
      activityPriceCHF: 0,
    });
    if (
      r.length === 3 &&
      r[0].price === 400 &&
      r[1].price === 500 &&
      r[2].price === 600
    ) {
      ok('copy exact 400/500/600c');
    } else {
      fail('unexpected', r);
    }
  }

  section('SP6 — inherit + activityPricingTiers absents + price 8 CHF → fallback 640/800/960');
  {
    const r = buildSessionPricingTiers({
      mode: 'inherit',
      activityPricingTiers: undefined,
      activityPriceCHF: 8,
    });
    // computeFallbackTiers(8) : 8 × 0.8 = 6.4 CHF = 640c, base 800c, ×1.2 = 960c
    if (r.length === 3 && r[0].price === 640 && r[1].price === 800 && r[2].price === 960) {
      ok('fallback 640/800/960');
    } else {
      fail('unexpected', r);
    }
  }

  section('SP7 — inherit + tout vide → fallback computeFallbackTiers(0) = 0/0/0');
  {
    const r = buildSessionPricingTiers({
      mode: 'inherit',
      activityPricingTiers: undefined,
      activityPriceCHF: 0,
    });
    if (r.length === 3 && r.every((t) => t.price === 0)) ok('all zero');
    else fail('unexpected', r);
  }

  section('SP8 — structure tier intacte (activateMinutesBeforeStart + activateAtFillRate)');
  {
    const r = buildSessionPricingTiers({
      mode: 'custom',
      customPriceCHF: 5,
      activityPricingTiers: undefined,
      activityPriceCHF: 0,
    });
    if (
      r[0].activateMinutesBeforeStart === 10080 && r[0].activateAtFillRate === 0 &&
      r[1].activateMinutesBeforeStart === 1440 && r[1].activateAtFillRate === 0.5 &&
      r[2].activateMinutesBeforeStart === 60 && r[2].activateAtFillRate === 0.9
    ) {
      ok('triggers intacts');
    } else {
      fail('unexpected triggers', r);
    }
  }

  console.log(`\n====== Résumé session-pricing ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
