/**
 * Tests Phase 9 sub-chantier 2 commit 2/6 — pure helper computeSplitAmounts.
 *
 * Exécution :
 *   npm run test:invites:split-math
 *
 * Pure function tests (pas d'emulator requis). Pattern cohérent SC1 c2/5
 * `shouldShowInviteButton` — tests sync direct.
 *
 * Couverture (SM1-SM7) :
 *   SM1 mode='individual' totalCents=2500 → inviter=0, invitee=2500, fee=125 (5% sur invitee)
 *   SM2 mode='split' ratio=0.5 totalCents=2500 → inviter=1250, invitee=1250, fee répartie
 *   SM3 mode='split' ratio=0.7 totalCents=2500 → inviter=1750, invitee=750
 *   SM4 mode='split' ratio=0.05 → throw SplitMathError 'invalid-ratio' (< 10%)
 *   SM5 mode='split' ratio=0.95 → throw SplitMathError 'invalid-ratio' (> 90%)
 *   SM6 mode='gift' totalCents=2500 → inviter=2500, invitee=0, fee sur inviter
 *   SM7 round-up resolution : ratio=0.333 totalCents=2500 → inviter+invitee = 2500 exact
 */

import {
  computeSplitAmounts,
  getApplicationFeePct,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  SplitMathError,
} from '../../src/lib/invites/splitMath';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, { actual, expected });
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================

async function main(): Promise<void> {
  // Force fee 5% pour tests deterministe (cohérent default Q4=B Phase 9)
  delete process.env.SPORDATE_INVITE_FEE_PCT;
  const expectedFeePct = getApplicationFeePct();
  if (expectedFeePct !== 5) {
    fail(`Default fee pct should be 5 (got ${expectedFeePct})`);
  } else {
    pass('Default fee pct = 5% (Q4=B Phase 9)');
  }

  // ===================================================================
  // SM1 mode='individual' totalCents=2500
  // ===================================================================
  section('SM1 mode=individual totalCents=2500 → invitee paye 100%');
  {
    const r = computeSplitAmounts({ totalCents: 2500, mode: 'individual' });
    assertEq(r.inviterCents, 0, 'SM1 inviterCents=0');
    assertEq(r.inviteeCents, 2500, 'SM1 inviteeCents=2500');
    assertEq(r.inviterFeeCents, 0, 'SM1 inviterFeeCents=0 (no inviter payment)');
    assertEq(r.inviteeFeeCents, 125, 'SM1 inviteeFeeCents=125 (5% of 2500)');
  }

  // ===================================================================
  // SM2 mode='split' ratio=0.5 totalCents=2500
  // ===================================================================
  section('SM2 mode=split ratio=0.5 totalCents=2500 → 50/50');
  {
    const r = computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: 0.5 });
    assertEq(r.inviterCents, 1250, 'SM2 inviterCents=1250');
    assertEq(r.inviteeCents, 1250, 'SM2 inviteeCents=1250');
    assertEq(r.inviterFeeCents, 63, 'SM2 inviterFeeCents=63 (5% of 1250 round)');
    assertEq(r.inviteeFeeCents, 63, 'SM2 inviteeFeeCents=63 (5% of 1250 round)');
    // Somme exacte
    assertEq(r.inviterCents + r.inviteeCents, 2500, 'SM2 sum exact = totalCents');
  }

  // ===================================================================
  // SM3 mode='split' ratio=0.7 totalCents=2500
  // ===================================================================
  section('SM3 mode=split ratio=0.7 totalCents=2500 → 70/30');
  {
    const r = computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: 0.7 });
    assertEq(r.inviterCents, 1750, 'SM3 inviterCents=1750');
    assertEq(r.inviteeCents, 750, 'SM3 inviteeCents=750');
    assertEq(r.inviterCents + r.inviteeCents, 2500, 'SM3 sum exact = 2500');
  }

  // ===================================================================
  // SM4 mode='split' ratio=0.05 → throw invalid-ratio
  // ===================================================================
  section('SM4 mode=split ratio=0.05 → throw invalid-ratio (< 10%)');
  {
    try {
      computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: 0.05 });
      fail('SM4 expected throw, got success');
    } catch (err) {
      if (err instanceof SplitMathError && err.code === 'invalid-ratio') {
        pass('SM4 throw SplitMathError invalid-ratio');
      } else {
        fail('SM4 unexpected error', err);
      }
    }
  }

  // ===================================================================
  // SM5 mode='split' ratio=0.95 → throw invalid-ratio
  // ===================================================================
  section('SM5 mode=split ratio=0.95 → throw invalid-ratio (> 90%)');
  {
    try {
      computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: 0.95 });
      fail('SM5 expected throw, got success');
    } catch (err) {
      if (err instanceof SplitMathError && err.code === 'invalid-ratio') {
        pass('SM5 throw SplitMathError invalid-ratio');
      } else {
        fail('SM5 unexpected error', err);
      }
    }
  }

  // ===================================================================
  // SM6 mode='gift' totalCents=2500
  // ===================================================================
  section('SM6 mode=gift totalCents=2500 → inviter paye 100%');
  {
    const r = computeSplitAmounts({ totalCents: 2500, mode: 'gift' });
    assertEq(r.inviterCents, 2500, 'SM6 inviterCents=2500');
    assertEq(r.inviteeCents, 0, 'SM6 inviteeCents=0');
    assertEq(r.inviterFeeCents, 125, 'SM6 inviterFeeCents=125 (5% of 2500)');
    assertEq(r.inviteeFeeCents, 0, 'SM6 inviteeFeeCents=0');
  }

  // ===================================================================
  // SM7 round-up resolution
  // ===================================================================
  section('SM7 round-up resolution : ratio=0.333 totalCents=2500 → sum exact');
  {
    const r = computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: 0.333 });
    assertEq(r.inviterCents + r.inviteeCents, 2500, 'SM7 inviter + invitee = 2500 exact');
    if (r.inviterCents > 0 && r.inviteeCents > 0) {
      pass('SM7 both > 0 (no orphan / no zero side)');
    } else {
      fail('SM7 unexpected zero side', r);
    }
  }

  // ===================================================================
  // Edge cases bonus
  // ===================================================================
  section('Bonus edge cases');
  {
    // ratio exactly at boundaries
    try {
      computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: MIN_SPLIT_RATIO });
      pass(`ratio=${MIN_SPLIT_RATIO} (boundary inclusive) → SUCCESS`);
    } catch (err) {
      fail(`ratio=${MIN_SPLIT_RATIO} (boundary) should pass`, err);
    }
    try {
      computeSplitAmounts({ totalCents: 2500, mode: 'split', splitInviterRatio: MAX_SPLIT_RATIO });
      pass(`ratio=${MAX_SPLIT_RATIO} (boundary inclusive) → SUCCESS`);
    } catch (err) {
      fail(`ratio=${MAX_SPLIT_RATIO} (boundary) should pass`, err);
    }

    // ratio missing pour mode=split → ratio-required
    try {
      computeSplitAmounts({ totalCents: 2500, mode: 'split' });
      fail('ratio missing should throw');
    } catch (err) {
      if (err instanceof SplitMathError && err.code === 'ratio-required') {
        pass('ratio missing pour mode=split → throw ratio-required');
      } else {
        fail('ratio missing unexpected error', err);
      }
    }

    // totalCents <= 0 → invalid-total
    try {
      computeSplitAmounts({ totalCents: 0, mode: 'individual' });
      fail('totalCents=0 should throw');
    } catch (err) {
      if (err instanceof SplitMathError && err.code === 'invalid-total') {
        pass('totalCents=0 → throw invalid-total');
      } else {
        fail('totalCents=0 unexpected error', err);
      }
    }
  }

  console.log('');
  console.log('====== Résumé Split Math (SM1-SM7 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
