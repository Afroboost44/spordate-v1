/**
 * Tests Phase 9.5 c7 — credit rules central config + computeBundledCredits + isFreeBooking.
 *
 * Exécution :
 *   npm run test:billing:credit-rules
 *   (équivalent : npx tsx tests/billing/credit-rules.test.ts)
 *
 * Couverture (4 cas) :
 *   CR1. CREDIT_RULES exposed correctement (freeActivityBundle=5, paidActivityRatio=2)
 *   CR2. computeBundledCredits free → freeActivityBundle (5)
 *   CR3. computeBundledCredits paid → price × paidActivityRatio (30 → 60)
 *   CR4. computeBundledCredits per-activity override (chatCreditsBundle=99 → 99 même si paid 30 CHF)
 *   CR5. isFreeBooking(price=0) → true / isFreeBooking(price=25) → false
 *   CR6. computeBundledCredits throws sur invalid input (null, NaN, négatif)
 *
 * Pas d'emulator — tests purs (config + helpers stateless).
 */

import { CREDIT_RULES, computeBundledCredits, isFreeBooking } from '../../src/lib/billing/creditRules';

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    pass(label);
  } else {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, label: string): void {
  try {
    fn();
    fail(label, 'expected throw, got result');
  } catch {
    pass(label);
  }
}

async function main(): Promise<void> {
  section('CR1 — CREDIT_RULES const exposed');
  assertEq(CREDIT_RULES.freeActivityBundle, 5, 'CR1.a freeActivityBundle = 5');
  assertEq(CREDIT_RULES.paidActivityRatio, 2, 'CR1.b paidActivityRatio = 2');

  section('CR2 — computeBundledCredits free → 5');
  assertEq(
    computeBundledCredits({ price: 0 }),
    CREDIT_RULES.freeActivityBundle,
    'CR2 free booking grants freeActivityBundle (5)',
  );

  section('CR3 — computeBundledCredits paid → price × ratio');
  assertEq(
    computeBundledCredits({ price: 30 }),
    60,
    'CR3.a 30 CHF × 2 = 60',
  );
  assertEq(
    computeBundledCredits({ price: 1 }),
    2,
    'CR3.b 1 CHF × 2 = 2',
  );

  section('CR4 — per-activity chatCreditsBundle override');
  assertEq(
    computeBundledCredits({ price: 30, chatCreditsBundle: 99 }),
    99,
    'CR4.a override 99 trumps 30 × 2',
  );
  assertEq(
    computeBundledCredits({ price: 0, chatCreditsBundle: 0 }),
    0,
    'CR4.b override 0 trumps freeActivityBundle (admin can disable)',
  );

  section('CR5 — isFreeBooking');
  assertEq(isFreeBooking({ price: 0 }), true, 'CR5.a price=0 → true');
  assertEq(isFreeBooking({ price: 25 }), false, 'CR5.b price=25 → false');
  assertEq(isFreeBooking(null), false, 'CR5.c null → false (defensive)');
  assertEq(isFreeBooking(undefined), false, 'CR5.d undefined → false (defensive)');

  section('CR6 — invalid input throws');
  assertThrows(() => computeBundledCredits(null), 'CR6.a null throws');
  assertThrows(() => computeBundledCredits(undefined), 'CR6.b undefined throws');
  assertThrows(() => computeBundledCredits({ price: NaN }), 'CR6.c NaN throws');
  assertThrows(() => computeBundledCredits({ price: -1 }), 'CR6.d negative throws');

  section('Récap');
  console.log(`Total : ${_passes} passes, ${_failures} failures`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
