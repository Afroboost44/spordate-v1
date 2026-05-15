/**
 * Phase A — Tests purs du module refStorage (capture ?ref= end-to-end).
 *
 * Couvre :
 *  RS1 — save+read roundtrip
 *  RS2 — TTL 30j : expiré → null + auto-remove
 *  RS3 — read sans entrée → null
 *  RS4 — read avec JSON corrompu → null (defensive)
 *  RS5 — save vide / whitespace → no-op
 *  RS6 — clearReferralCode
 *  RS7 — resolveActiveReferralCode : priorité user.referredBy
 *  RS8 — resolveActiveReferralCode : fallback localStorage si user vide
 *  RS9 — resolveActiveReferralCode : '' si nulle part
 *  RS10 — SSR-safe : storage:null → no throw, return null/''
 *
 * Exécution : npx tsx tests/referral/ref-storage.test.ts
 */

import {
  REFERRAL_STORAGE_KEY,
  REFERRAL_TTL_MS,
  saveReferralCode,
  readReferralCode,
  clearReferralCode,
  resolveActiveReferralCode,
} from '../../src/lib/referral/refStorage';

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

/** Fake Storage compliant — Pick<Storage, 'getItem'|'setItem'|'removeItem'>. */
function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    _dump: () => Object.fromEntries(data),
  };
}

const NOW = 1_700_000_000_000;

section('RS0 — constantes exportées');
assertEq(REFERRAL_STORAGE_KEY, 'spordateur_ref', 'storage key = spordateur_ref');
assertEq(REFERRAL_TTL_MS, 30 * 24 * 60 * 60 * 1000, 'TTL = 30 jours');

section('RS1 — save + read roundtrip');
{
  const storage = makeStorage();
  saveReferralCode('SPORT-VMXX', { now: NOW, storage });
  assertEq(readReferralCode({ now: NOW, storage }), 'SPORT-VMXX', 'read = saved code');
  // Aussi : un read juste sous le TTL retourne encore le code
  assertEq(
    readReferralCode({ now: NOW + REFERRAL_TTL_MS - 1, storage }),
    'SPORT-VMXX',
    'read juste avant expiration → code',
  );
}

section('RS2 — TTL 30j : expiré → null + auto-remove');
{
  const storage = makeStorage();
  saveReferralCode('SPORT-EXP', { now: NOW, storage });
  const expiredRead = readReferralCode({ now: NOW + REFERRAL_TTL_MS + 1, storage });
  assertEq(expiredRead, null, 'read après expiration → null');
  // Vérifie que l'entrée a été nettoyée
  assertEq(storage.getItem(REFERRAL_STORAGE_KEY), null, 'entrée expirée auto-supprimée');
}

section('RS3 — read sans entrée → null');
{
  const storage = makeStorage();
  assertEq(readReferralCode({ now: NOW, storage }), null, 'storage vide → null');
}

section('RS4 — read avec JSON corrompu → null (defensive)');
{
  const storage = makeStorage({ [REFERRAL_STORAGE_KEY]: 'not-json{' });
  assertEq(readReferralCode({ now: NOW, storage }), null, 'JSON cassé → null (pas throw)');
  // Entrée structurellement invalide (missing fields)
  const storage2 = makeStorage({ [REFERRAL_STORAGE_KEY]: JSON.stringify({ foo: 'bar' }) });
  assertEq(readReferralCode({ now: NOW, storage: storage2 }), null, 'JSON valide mais champs manquants → null');
}

section('RS5 — save vide / whitespace → no-op (pas de junk persisté)');
{
  const storage = makeStorage();
  saveReferralCode('', { now: NOW, storage });
  saveReferralCode('   ', { now: NOW, storage });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveReferralCode(null as any, { now: NOW, storage });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveReferralCode(undefined as any, { now: NOW, storage });
  assertEq(storage.getItem(REFERRAL_STORAGE_KEY), null, 'aucun appel ne persiste de junk');
}

section('RS6 — clearReferralCode supprime l\'entrée');
{
  const storage = makeStorage();
  saveReferralCode('SPORT-CLR', { now: NOW, storage });
  clearReferralCode({ storage });
  assertEq(storage.getItem(REFERRAL_STORAGE_KEY), null, 'entrée nettoyée après clear');
}

section('RS7 — resolveActiveReferralCode : priorité user.referredBy');
{
  const storage = makeStorage();
  saveReferralCode('FROM-LS', { now: NOW, storage });
  assertEq(
    resolveActiveReferralCode('FROM-USER', { now: NOW, storage }),
    'FROM-USER',
    'user.referredBy non-vide → prime sur localStorage',
  );
}

section('RS8 — resolveActiveReferralCode : fallback localStorage si user vide');
{
  const storage = makeStorage();
  saveReferralCode('FROM-LS', { now: NOW, storage });
  assertEq(resolveActiveReferralCode(null, { now: NOW, storage }), 'FROM-LS', 'user null → localStorage');
  assertEq(resolveActiveReferralCode(undefined, { now: NOW, storage }), 'FROM-LS', 'user undefined → localStorage');
  assertEq(resolveActiveReferralCode('', { now: NOW, storage }), 'FROM-LS', 'user "" → localStorage');
  assertEq(resolveActiveReferralCode('   ', { now: NOW, storage }), 'FROM-LS', 'user whitespace → localStorage');
}

section('RS9 — resolveActiveReferralCode : rien nulle part → ""');
{
  const storage = makeStorage();
  assertEq(resolveActiveReferralCode(null, { now: NOW, storage }), '', 'tout vide → ""');
}

section('RS10 — SSR-safe : storage=null → no throw, retours degraded');
{
  // saveReferralCode no-op (pas d'erreur)
  saveReferralCode('SPORT-SSR', { now: NOW, storage: null });
  assertEq(readReferralCode({ now: NOW, storage: null }), null, 'read avec storage:null → null');
  assertEq(resolveActiveReferralCode(null, { now: NOW, storage: null }), '', 'resolve avec storage:null + no user → ""');
  assertEq(
    resolveActiveReferralCode('FROM-USER', { now: NOW, storage: null }),
    'FROM-USER',
    'resolve avec storage:null + user présent → user',
  );
  clearReferralCode({ storage: null }); // ne doit pas throw
  passes++;
  console.log('  ✓ clearReferralCode({storage:null}) ne throw pas');
}

console.log(`\n====== Résumé refStorage (Phase A) ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
