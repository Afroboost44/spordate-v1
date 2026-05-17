/**
 * BUG #24 — Tests purs buildOtherUser.
 *
 * Root cause originale : loadConversations dans src/app/chat/page.tsx accédait
 * `match.user1.uid` et `match.user2` directement. Pour les matches direct-paid
 * (créés par /api/chat/unlock-direct), ces champs sont ABSENTS du doc Firestore
 * (le route handler n'écrit que userIds[]). En aval, dès que profile?.photoURL
 * était falsy (cas Veldaes : photoURL='' suite BUG #18), le `||` évaluait la
 * branche match.user1.uid → TypeError → outer try/catch swallow → conversations
 * stays [] → "0 conversations actives" affiché → user croit que le chat a
 * débité 5 crédits dans le vide.
 *
 * Le helper résout le user "autre" pour la conversation list de manière
 * defensive (?. operators) en privilégiant : profile fetché > match embedded
 * (legacy mutual) > defaults.
 *
 * Couverture (BOU1-BOU6) :
 *   BOU1 — profile complete (display+photo) → uses profile.{display,photo}
 *   BOU2 — profile.display set + profile.photo vide + match.user1 has photo →
 *          uses profile.display + match.user1.photo
 *   BOU3 — profile.photo vide + match SANS user1/user2 (direct-paid) →
 *          uses profile.display + '' (CRITICAL — no throw)
 *   BOU4 — profile null + match has user1/user2 → uses match.userN values
 *   BOU5 — profile null + match SANS user1/user2 → defaults 'Utilisateur'+''
 *   BOU6 — otherUid matches user2 (pas user1) → uses user2 values
 *
 * Exécution : npx tsx tests/chat/build-other-user.test.ts
 */

import { buildOtherUser } from '../../src/lib/chat/buildOtherUser';

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
  section('BOU1 — profile complete → uses profile values');
  {
    const r = buildOtherUser(
      { displayName: 'Veldaes', photoURL: 'https://photo.jpg' },
      { user1: { uid: 'a', displayName: 'OldA', photoURL: 'oldA.jpg' }, user2: { uid: 'b', displayName: 'OldB', photoURL: 'oldB.jpg' } },
      'a',
    );
    if (r.uid === 'a' && r.displayName === 'Veldaes' && r.photoURL === 'https://photo.jpg') ok('profile values prioritaires');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('BOU2 — profile display set + photo vide + match.user1 has photo → fallback partiel');
  {
    const r = buildOtherUser(
      { displayName: 'Veldaes', photoURL: '' },
      { user1: { uid: 'a', displayName: 'OldA', photoURL: 'fallback.jpg' }, user2: { uid: 'b', displayName: 'OldB', photoURL: 'oldB.jpg' } },
      'a',
    );
    if (r.displayName === 'Veldaes' && r.photoURL === 'fallback.jpg') ok('profile.display préservé, photo fallback match.user1');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('BOU3 — profile.photo vide + match SANS user1/user2 (direct-paid) → no throw');
  {
    const r = buildOtherUser(
      { displayName: 'Veldaes', photoURL: '' },
      {} as { user1?: undefined; user2?: undefined }, // simule match direct-paid
      'veldaes-uid',
    );
    if (r.uid === 'veldaes-uid' && r.displayName === 'Veldaes' && r.photoURL === '') ok('aucun throw, photoURL vide accepté');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('BOU4 — profile null + match has user1/user2 → uses embedded');
  {
    const r = buildOtherUser(
      null,
      { user1: { uid: 'a', displayName: 'Alice', photoURL: 'alice.jpg' }, user2: { uid: 'b', displayName: 'Bob', photoURL: 'bob.jpg' } },
      'a',
    );
    if (r.displayName === 'Alice' && r.photoURL === 'alice.jpg') ok('embedded user1 utilisé');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('BOU5 — profile null + match SANS user1/user2 → defaults');
  {
    const r = buildOtherUser(null, {}, 'some-uid');
    if (r.uid === 'some-uid' && r.displayName === 'Utilisateur' && r.photoURL === '') ok('defaults Utilisateur + ""');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('BOU6 — otherUid matches user2 → use user2 values');
  {
    const r = buildOtherUser(
      null,
      { user1: { uid: 'a', displayName: 'Alice', photoURL: 'alice.jpg' }, user2: { uid: 'b', displayName: 'Bob', photoURL: 'bob.jpg' } },
      'b',
    );
    if (r.displayName === 'Bob' && r.photoURL === 'bob.jpg') ok('user2 values utilisées');
    else fail('unexpected', r);
  }

  console.log(`\n====== Résumé chat buildOtherUser ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
