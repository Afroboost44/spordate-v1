/**
 * BUG #14 — Tests purs du helper resolveChatUrlAction.
 *
 * Le helper centralise la décision de ce que le useEffect de /chat doit faire
 * selon les searchParams `?match=ID&payment=success` :
 *  - cas direct-paid (discovery → /api/chat/unlock-direct) : redirection
 *    `?match=ID` seul → on doit sélectionner la conv (server a déjà mis
 *    chatUnlocked:true sur le match doc).
 *  - cas legacy post-payment Stripe : redirection `?match=ID&payment=success`
 *    → sélectionner + unlock client-side + toast "Paiement confirmé".
 *
 * Avant ce fix, l'useEffect demandait `paymentStatus === 'success' && matchIdParam`
 * → si payment=null (cas direct-paid) → noop → conv jamais sélectionnée →
 * user voit "Sélectionnez une conversation" alors qu'il vient de débiter 5 crédits.
 *
 * Couverture (CH1-CH6) :
 *   CH1 — no params → noop
 *   CH2 — payment=success sans match → noop (match required)
 *   CH3 — match seul → select+showMobile, pas d'unlock/toast (direct-paid)
 *   CH4 — match+payment=success → select+unlock+toast (legacy)
 *   CH5 — match+payment=cancelled → select sans unlock (autre status)
 *   CH6 — match="" empty string → noop
 *
 * Exécution : npx tsx tests/chat/url-params.test.ts
 */

import { resolveChatUrlAction } from '../../src/lib/chat/urlParams';

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
  section('CH1 — no params → noop');
  {
    const a = resolveChatUrlAction(null, null);
    if (!a.shouldSelect && a.matchId === null && !a.shouldUnlock && !a.shouldShowPaymentToast) {
      ok('noop complet');
    } else fail('action inattendue', a);
  }

  // -----------------------------------------------------------------------
  section('CH2 — payment=success sans match → noop');
  {
    const a = resolveChatUrlAction(null, 'success');
    if (!a.shouldSelect && a.matchId === null) ok('noop si match absent même avec payment=success');
    else fail('action inattendue', a);
  }

  // -----------------------------------------------------------------------
  section('CH3 — match seul (direct-paid) → select sans unlock/toast');
  {
    const a = resolveChatUrlAction('match-abc', null);
    if (
      a.shouldSelect &&
      a.matchId === 'match-abc' &&
      !a.shouldUnlock &&
      !a.shouldShowPaymentToast
    ) {
      ok('select uniquement (direct-paid : chat déjà unlocked server-side)');
    } else fail('action inattendue', a);
  }

  // -----------------------------------------------------------------------
  section('CH4 — match+payment=success (legacy) → select+unlock+toast');
  {
    const a = resolveChatUrlAction('match-xyz', 'success');
    if (
      a.shouldSelect &&
      a.matchId === 'match-xyz' &&
      a.shouldUnlock &&
      a.shouldShowPaymentToast
    ) {
      ok('select + unlock client + toast paiement');
    } else fail('action inattendue', a);
  }

  // -----------------------------------------------------------------------
  section('CH5 — match+payment=cancelled → select sans unlock');
  {
    const a = resolveChatUrlAction('match-c', 'cancelled');
    if (a.shouldSelect && a.matchId === 'match-c' && !a.shouldUnlock && !a.shouldShowPaymentToast) {
      ok('select mais pas d\'unlock/toast (status payment autre)');
    } else fail('action inattendue', a);
  }

  // -----------------------------------------------------------------------
  section('CH6 — match="" → noop');
  {
    const a = resolveChatUrlAction('', 'success');
    if (!a.shouldSelect && a.matchId === null) ok('empty string traité comme absent');
    else fail('action inattendue', a);
  }

  console.log(`\n====== Résumé chat url-params ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
