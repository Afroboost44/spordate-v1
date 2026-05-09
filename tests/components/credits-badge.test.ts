/**
 * Tests Phase 9.5 c8 BUG 4 — CreditsBadge logique pure (pulse trigger + visibility).
 *
 * Exécution :
 *   npm run test:components:credits-badge
 *
 * Pattern : pure unit (no DOM, no emulator). Tests focus sur la logique du
 * pulse trigger qui décide quand animer (credits++ vs credits===prev vs init).
 *
 * Couverture (5 cas CB1-CB5) :
 *   CB1. shouldPulseOnChange(prev=null, next=5) → false (init, pas de pulse)
 *   CB2. shouldPulseOnChange(prev=5, next=5) → false (no change)
 *   CB3. shouldPulseOnChange(prev=0, next=5) → true (grant credits → pulse)
 *   CB4. shouldPulseOnChange(prev=10, next=5) → false (decrement, pas de pulse)
 *   CB5. shouldShowBadge(loggedIn, loading) — hide quand pas logged in OU loading
 */

export {}; // Phase 9.5 c9 — force module scope (sinon globals collide tsc)

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

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// Réplique pure de la logique CreditsBadge.tsx (Phase 9.5 c8 BUG 4).
// Si la logique change side-by-side, ces tests doivent refléter (et faillir).

/**
 * @param prev valeur précédente du compteur (null = first render, pas encore initialisé)
 * @param next nouvelle valeur du compteur
 * @returns true si on doit déclencher l'animation pulse (credits incrementé)
 */
function shouldPulseOnChange(prev: number | null, next: number): boolean {
  if (prev === null) return false;
  return next > prev;
}

/**
 * @returns true si le badge doit être visible (logged in + auth pas en loading)
 */
function shouldShowBadge(isLoggedIn: boolean, authLoading: boolean): boolean {
  if (authLoading) return false;
  if (!isLoggedIn) return false;
  return true;
}

function main(): void {
  section('CB1 init (prev=null) → no pulse');
  if (shouldPulseOnChange(null, 0) === false) {
    pass('CB1.a init avec credits=0 → no pulse');
  } else {
    fail('CB1.a');
  }
  if (shouldPulseOnChange(null, 5) === false) {
    pass('CB1.b init avec credits=5 → no pulse (premier render = baseline)');
  } else {
    fail('CB1.b');
  }

  section('CB2 no change → no pulse');
  if (shouldPulseOnChange(5, 5) === false) {
    pass('CB2 same value → no pulse');
  } else {
    fail('CB2');
  }

  section('CB3 increment → pulse');
  if (shouldPulseOnChange(0, 5) === true) {
    pass('CB3.a 0 → 5 (free booking grant) → pulse');
  } else {
    fail('CB3.a');
  }
  if (shouldPulseOnChange(5, 60) === true) {
    pass('CB3.b 5 → 60 (paid booking ratio) → pulse');
  } else {
    fail('CB3.b');
  }

  section('CB4 decrement → no pulse');
  if (shouldPulseOnChange(10, 5) === false) {
    pass('CB4 10 → 5 (chat use credit) → no pulse');
  } else {
    fail('CB4');
  }
  if (shouldPulseOnChange(1, 0) === false) {
    pass('CB4.b 1 → 0 (last credit used) → no pulse');
  } else {
    fail('CB4.b');
  }

  section('CB5 visibility gating');
  if (shouldShowBadge(true, false) === true) {
    pass('CB5.a logged in + ready → show');
  } else {
    fail('CB5.a');
  }
  if (shouldShowBadge(false, false) === false) {
    pass('CB5.b not logged in → hide');
  } else {
    fail('CB5.b');
  }
  if (shouldShowBadge(true, true) === false) {
    pass('CB5.c authLoading=true → hide pendant fetch initial');
  } else {
    fail('CB5.c');
  }

  console.log('');
  console.log('====== Résumé Credits Badge (CB1-CB5) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main();
