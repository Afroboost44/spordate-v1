/**
 * Phase 9.5 c38b CH6 — Tests purs computeChatUnlockCost + CHF_PER_CREDIT cohérence.
 *
 * Exécution : `npx tsx tests/chat-unlock-direct.test.ts`
 * Pas d'emulator nécessaire (constants pures).
 */

import {
  computeChatUnlockCost,
  CHAT_UNLOCK_DIRECT_COST,
  CHF_PER_CREDIT,
} from '../src/lib/billing/chatUnlockDirect';

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

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

section('Coût chat direct = 5 crédits');
{
  assertEq(computeChatUnlockCost(), 5, 'computeChatUnlockCost() retourne 5');
  assertEq(CHAT_UNLOCK_DIRECT_COST, 5, 'CHAT_UNLOCK_DIRECT_COST = 5');
}

section('Cohérence taux 0.5 CHF/crédit');
{
  assertEq(CHF_PER_CREDIT, 0.5, 'CHF_PER_CREDIT = 0.5');
  assertEq(computeChatUnlockCost() * CHF_PER_CREDIT, 2.5, '5 crédits × 0.5 = 2.50 CHF équivalent');
}

section('Cohérence avec boost-credits (même taux 0.5 CHF/crédit)');
{
  // Boost 24h = 30 crédits = 15 CHF. Sanity check cross-module.
  // (Importer BOOST_CREDITS_COST ferait dépendance cyclique avec route.ts, mais
  // on peut vérifier la cohérence du taux directement.)
  const boost24hChfEquiv = 30 * CHF_PER_CREDIT;
  assertEq(boost24hChfEquiv, 15, 'Boost 24h (30 crédits) cohérent avec tarif Stripe 15 CHF');
}

console.log(`\n=== Résultat : ${passes} passes, ${failures} failures ===`);
if (failures > 0) process.exit(1);
process.exit(0);
