/**
 * Tests Phase 9.5 c9 — <AdminMenuLink> visibility logic.
 *
 * Exécution :
 *   npm run test:components:admin-menu-link
 *
 * Pattern : pure unit (no DOM, no emulator). Tests focus sur la logique pure
 * du gating du composant (role check) qui détermine show/hide.
 *
 * Couverture (3 cas AML1-AML3) :
 *   AML1. shouldShowAdminLink role='admin' → true
 *   AML2. shouldShowAdminLink role='user' / 'partner' / 'creator' → false
 *   AML3. shouldShowAdminLink null/undefined userProfile → false (defensive)
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

// Réplique pure de la logique gating dans AdminMenuLink.tsx (Phase 9.5 c9).
// Si la logique change side-by-side, ces tests doivent refléter (et faillir).
function shouldShowAdminLink(userProfile: { role?: string } | null | undefined): boolean {
  if (!userProfile) return false;
  return userProfile.role === 'admin';
}

function main(): void {
  section('AML1 role admin → show');
  if (shouldShowAdminLink({ role: 'admin' }) === true) {
    pass('AML1 role=admin → show');
  } else {
    fail('AML1');
  }

  section('AML2 role non-admin → hide');
  if (shouldShowAdminLink({ role: 'user' }) === false) {
    pass('AML2.a role=user → hide');
  } else {
    fail('AML2.a');
  }
  if (shouldShowAdminLink({ role: 'partner' }) === false) {
    pass('AML2.b role=partner → hide');
  } else {
    fail('AML2.b');
  }
  if (shouldShowAdminLink({ role: 'creator' }) === false) {
    pass('AML2.c role=creator → hide');
  } else {
    fail('AML2.c');
  }
  if (shouldShowAdminLink({ role: '' }) === false) {
    pass('AML2.d role=empty → hide');
  } else {
    fail('AML2.d');
  }

  section('AML3 null/undefined → hide (defensive)');
  if (shouldShowAdminLink(null) === false) {
    pass('AML3.a null userProfile → hide');
  } else {
    fail('AML3.a');
  }
  if (shouldShowAdminLink(undefined) === false) {
    pass('AML3.b undefined userProfile → hide');
  } else {
    fail('AML3.b');
  }
  if (shouldShowAdminLink({}) === false) {
    pass('AML3.c userProfile sans role field → hide');
  } else {
    fail('AML3.c');
  }

  console.log('');
  console.log('====== Résumé Admin Menu Link (AML1-AML3) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main();
