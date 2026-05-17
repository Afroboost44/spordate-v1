/**
 * BUG #15 — Tests purs resolvePaymentMethodTypes.
 *
 * Le helper centralise la conversion d'une préférence UI (Discovery onglets
 * Carte / TWINT / Crédits) vers le tableau Stripe `payment_method_types`
 * attendu par stripe.checkout.sessions.create.
 *
 * Sémantique :
 *  - 'card'  → ['card']    (force Carte uniquement, pas de TWINT proposé)
 *  - 'twint' → ['twint']   (force TWINT uniquement, pas de Carte proposée)
 *  - 'all' / undefined / null / '' / unknown → ['card', 'twint'] (legacy default)
 *
 * Couverture (PM1-PM6) :
 *   PM1 — undefined → ['card','twint']
 *   PM2 — null → ['card','twint']
 *   PM3 — '' → ['card','twint']
 *   PM4 — 'all' → ['card','twint']
 *   PM5 — 'card' → ['card']
 *   PM6 — 'twint' → ['twint']
 *   PM7 — string invalide → fallback ['card','twint'] (defensive)
 *
 * Exécution : npx tsx tests/payment/method-resolver.test.ts
 */

import { resolvePaymentMethodTypes } from '../../src/lib/payment/methodResolver';

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

function arrayEq(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function run() {
  // -----------------------------------------------------------------------
  section('PM1 — undefined → both');
  {
    const r = resolvePaymentMethodTypes(undefined);
    if (arrayEq(r, ['card', 'twint'])) ok('default both');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('PM2 — null → both');
  {
    const r = resolvePaymentMethodTypes(null);
    if (arrayEq(r, ['card', 'twint'])) ok('null → both');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('PM3 — "" → both');
  {
    const r = resolvePaymentMethodTypes('');
    if (arrayEq(r, ['card', 'twint'])) ok('empty string → both');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('PM4 — "all" → both');
  {
    const r = resolvePaymentMethodTypes('all');
    if (arrayEq(r, ['card', 'twint'])) ok('"all" → both');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('PM5 — "card" → card only');
  {
    const r = resolvePaymentMethodTypes('card');
    if (arrayEq(r, ['card'])) ok('"card" → [card]');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('PM6 — "twint" → twint only');
  {
    const r = resolvePaymentMethodTypes('twint');
    if (arrayEq(r, ['twint'])) ok('"twint" → [twint]');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('PM7 — string invalide → fallback both (defensive)');
  {
    const r = resolvePaymentMethodTypes('paypal');
    if (arrayEq(r, ['card', 'twint'])) ok('invalid → fallback both');
    else fail('unexpected', r);
  }

  console.log(`\n====== Résumé payment method resolver ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
