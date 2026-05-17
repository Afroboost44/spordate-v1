/**
 * BUG #12 — Tests purs validateCreditAdjustment.
 *
 * Le helper centralise la validation d'un ajustement de crédits admin
 * (uid + amount string venant d'un <input type=number>) avant l'updateDoc
 * Firestore. Avant ce helper, adjustCredits faisait juste `if (!db ||
 * !creditUserId) return` puis appelait updateDoc sans try/catch → toute
 * erreur (uid vide / amount NaN / permission denied / network) échouait
 * silencieusement → "ne marche plus" pour Bassi.
 *
 * Couverture (CA1-CA8) :
 *   CA1 — uid undefined → error 'missing-user'
 *   CA2 — uid "" → error 'missing-user'
 *   CA3 — uid whitespace → error 'missing-user' (après trim)
 *   CA4 — amount "abc" non-numeric → error 'invalid-amount'
 *   CA5 — amount "0" → error 'invalid-amount'
 *   CA6 — amount "-5" → error 'invalid-amount'
 *   CA7 — happy add → { ok:true, delta:+n, uid }
 *   CA8 — happy remove → { ok:true, delta:-n, uid }
 *
 * Exécution : npx tsx tests/admin/credit-adjustment.test.ts
 */

import { validateCreditAdjustment } from '../../src/lib/admin/creditAdjustment';

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

async function run() {
  // -----------------------------------------------------------------------
  section('CA1 — uid undefined → missing-user');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = validateCreditAdjustment({ userId: undefined as any, amountStr: '5', add: true });
    if (!r.ok && r.error === 'missing-user') ok('error missing-user');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA2 — uid "" → missing-user');
  {
    const r = validateCreditAdjustment({ userId: '', amountStr: '5', add: true });
    if (!r.ok && r.error === 'missing-user') ok('error missing-user');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA3 — uid whitespace → missing-user (après trim)');
  {
    const r = validateCreditAdjustment({ userId: '   ', amountStr: '5', add: true });
    if (!r.ok && r.error === 'missing-user') ok('error missing-user après trim');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA4 — amount "abc" → invalid-amount');
  {
    const r = validateCreditAdjustment({ userId: 'uid', amountStr: 'abc', add: true });
    if (!r.ok && r.error === 'invalid-amount') ok('error invalid-amount');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA5 — amount "0" → invalid-amount (0 n\'a pas de sens)');
  {
    const r = validateCreditAdjustment({ userId: 'uid', amountStr: '0', add: true });
    if (!r.ok && r.error === 'invalid-amount') ok('error invalid-amount pour 0');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA6 — amount "-5" → invalid-amount (negatif via "Retirer" pas via "-")');
  {
    const r = validateCreditAdjustment({ userId: 'uid', amountStr: '-5', add: true });
    if (!r.ok && r.error === 'invalid-amount') ok('error invalid-amount pour -5');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA7 — happy add → delta +n, uid');
  {
    const r = validateCreditAdjustment({ userId: 'user-abc', amountStr: '5', add: true });
    if (r.ok && r.delta === 5 && r.uid === 'user-abc') ok('delta=+5, uid OK');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('CA8 — happy remove → delta -n, uid');
  {
    const r = validateCreditAdjustment({ userId: 'user-xyz', amountStr: '3', add: false });
    if (r.ok && r.delta === -3 && r.uid === 'user-xyz') ok('delta=-3, uid OK');
    else fail('unexpected', r);
  }

  console.log(`\n====== Résumé credit-adjustment ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
