/**
 * BUG #18 — Tests purs des helpers de la card Discovery.
 *
 * Avant ce fix, la card affichait :
 *   1. photoURL si présent
 *   2. placeholder PlaceHolderImages (cycle discovery-1/2/3 — moon, etc.)
 *   3. gradient + initial
 *
 * Conséquence : pour Veldaes (real user) avec photoURL='' en Firestore,
 * la card montrait l'image moon placeholder → visuellement fausse + trompeuse
 * (paraît "uploadée" alors que c'est un mock du site).
 *
 * Fix : si firestoreUid est présent (real user), on saute le placeholder
 * et on retombe directement sur l'initial avatar. Le placeholder reste pour
 * les démo profiles (sans firestoreUid).
 *
 * Couverture (DC1-DC8) :
 *   DC1 — photoURL valide → kind='photo'
 *   DC2 — photoURL vide + firestoreUid → kind='initial' (skip placeholder)
 *   DC3 — photoURL vide + no uid + placeholder → kind='placeholder' (demo)
 *   DC4 — photoURL vide + no uid + no placeholder → kind='initial'
 *   DC5 — photoURL whitespace + uid → kind='initial' (defensive trim)
 *   DC6 — buildProfileHref(uid) → '/profile/{uid}'
 *   DC7 — buildProfileHref(null/undefined) → null
 *   DC8 — buildProfileHref('') ou whitespace → null
 *
 * Exécution : npx tsx tests/discovery/card-image-resolver.test.ts
 */

import { resolveDiscoveryCardImage, buildProfileHref } from '../../src/lib/discovery/cardImage';

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
  section('DC1 — photoURL valide → kind="photo"');
  {
    const r = resolveDiscoveryCardImage({
      photoURL: 'https://firebasestorage.googleapis.com/users/abc/profile/123-foo.jpg',
      firestoreUid: 'abc',
      placeholderUrl: 'https://placeholder/moon.jpg',
    });
    if (r.kind === 'photo' && r.src.startsWith('https://firebasestorage')) ok('photo retournée prioritaire');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DC2 — photoURL vide + firestoreUid → kind="initial" (skip placeholder)');
  {
    const r = resolveDiscoveryCardImage({
      photoURL: '',
      firestoreUid: 'veldaes-uid',
      placeholderUrl: 'https://placeholder/moon.jpg',
    });
    if (r.kind === 'initial') ok('real user → initial avatar (jamais le placeholder)');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DC3 — photoURL vide + no firestoreUid + placeholder → kind="placeholder" (demo)');
  {
    const r = resolveDiscoveryCardImage({
      photoURL: '',
      firestoreUid: null,
      placeholderUrl: 'https://placeholder/moon.jpg',
    });
    if (r.kind === 'placeholder' && r.src === 'https://placeholder/moon.jpg') ok('demo profile → placeholder OK');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DC4 — photoURL vide + no firestoreUid + no placeholder → initial');
  {
    const r = resolveDiscoveryCardImage({ photoURL: '', firestoreUid: null });
    if (r.kind === 'initial') ok('fallback ultime = initial');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DC5 — photoURL whitespace + uid → initial (defensive trim)');
  {
    const r = resolveDiscoveryCardImage({
      photoURL: '   ',
      firestoreUid: 'uid-1',
      placeholderUrl: 'https://placeholder/moon.jpg',
    });
    if (r.kind === 'initial') ok('whitespace photoURL treated as empty');
    else fail('unexpected', r);
  }

  // -----------------------------------------------------------------------
  section('DC6 — buildProfileHref("abc") → /profile/abc');
  {
    const h = buildProfileHref('abc');
    if (h === '/profile/abc') ok('href OK');
    else fail('unexpected', h);
  }

  // -----------------------------------------------------------------------
  section('DC7 — buildProfileHref(null/undefined) → null');
  {
    if (buildProfileHref(null) === null && buildProfileHref(undefined) === null) ok('null/undefined → null');
    else fail('unexpected');
  }

  // -----------------------------------------------------------------------
  section('DC8 — buildProfileHref("") ou whitespace → null');
  {
    if (buildProfileHref('') === null && buildProfileHref('   ') === null) ok('empty/whitespace → null');
    else fail('unexpected');
  }

  console.log(`\n====== Résumé card-image-resolver ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
