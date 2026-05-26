/**
 * Tests fix audit créateurs — couverture requestPayout + validatePayoutRequest.
 *
 * Exécution :
 *   npx tsx tests/creators/requestPayout.test.ts
 *
 * Stratégie : 2 niveaux de couverture :
 *  1. Tests PURS sur `validatePayoutRequest` (logique extraite dans
 *     `src/lib/creators/limits.ts`) — pas de mock nécessaire. C'est la
 *     vraie défense in-depth contre l'attaque DevTools.
 *  2. Tests sur `requestPayout` end-to-end avec stubs de
 *     `firebase/firestore` + `@/lib/firebase` (cf. createCreator.test.ts
 *     pour le même pattern require.cache).
 *
 * Couverture (RP1-RP8) :
 *   RP1. validatePayoutRequest amount >= 10 + solde suffisant → ok
 *   RP2. validatePayoutRequest amount < 10 → 'payout-below-minimum'
 *   RP3. validatePayoutRequest amount = 0.01 (attaque DevTools) → rejet
 *   RP4. validatePayoutRequest amount NaN / Infinity → rejet (durci)
 *   RP5. validatePayoutRequest amount > pendingPayout → 'insufficient-balance'
 *   RP6. requestPayout end-to-end succès : doc payouts créé + pendingPayout
 *        PAS décrémenté (la déduction se fait dans processPayoutAdmin)
 *   RP7. requestPayout throw 'payout-below-minimum' si amount < 10 (server guard)
 *   RP8. requestPayout throw 'Solde insuffisant' si amount > pendingPayout
 */

import Module from 'module';
import path from 'path';

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

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, { actual, expected });
}

function assertTrue(cond: boolean, label: string): void {
  if (cond) pass(label);
  else fail(label);
}

async function assertThrowsWithCode(fn: () => Promise<unknown>, expectedMessage: string, label: string): Promise<void> {
  try {
    await fn();
    fail(label, 'no throw');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === expectedMessage) pass(label);
    else fail(label, `expected '${expectedMessage}' got '${msg}'`);
  }
}

// =====================================================================
// === Phase 1 : Tests PURS sur validatePayoutRequest ==================
// =====================================================================
// On import directement le helper pur — pas besoin de stubs Firebase.

import {
  validatePayoutRequest,
  MIN_PAYOUT_CHF,
  PAYOUT_BELOW_MINIMUM_ERROR,
  INSUFFICIENT_BALANCE_ERROR,
} from '../../src/lib/creators/limits';

// =====================================================================
// === Phase 2 : Stubs Firestore pour requestPayout end-to-end =========
// =====================================================================

type DocStore = Record<string, Record<string, unknown>>;
const store: { [collection: string]: DocStore } = {};

function resetStore(): void {
  for (const k of Object.keys(store)) delete store[k];
}

function ensureCol(name: string): DocStore {
  if (!store[name]) store[name] = {};
  return store[name];
}

let _idCounter = 0;
function newId(): string {
  return `payout_${++_idCounter}`;
}

interface FakeDocRef {
  __col: string;
  __id: string;
  id: string;
}

function fakeDoc(...args: unknown[]): FakeDocRef {
  if (args.length === 1) {
    const col = (args[0] as { __col: string }).__col;
    const id = newId();
    return { __col: col, __id: id, id };
  }
  const col = args[1] as string;
  const id = args[2] as string;
  return { __col: col, __id: id, id };
}

function fakeCollection(_db: unknown, name: string): { __col: string } {
  return { __col: name };
}

async function fakeSetDoc(ref: FakeDocRef, data: Record<string, unknown>): Promise<void> {
  ensureCol(ref.__col)[ref.__id] = { ...data };
}

async function fakeUpdateDoc(ref: FakeDocRef, data: Record<string, unknown>): Promise<void> {
  const col = ensureCol(ref.__col);
  col[ref.__id] = { ...(col[ref.__id] || {}), ...data };
}

async function fakeGetDoc(ref: FakeDocRef): Promise<{
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
  id: string;
}> {
  const data = ensureCol(ref.__col)[ref.__id];
  return {
    exists: () => Boolean(data),
    data: () => data,
    id: ref.__id,
  };
}

async function fakeGetDocs(_q: unknown): Promise<{ empty: boolean; docs: unknown[] }> {
  return { empty: true, docs: [] };
}

function fakeWriteBatch(_db: unknown): {
  update: (ref: FakeDocRef, data: Record<string, unknown>) => void;
  commit: () => Promise<void>;
} {
  const ops: Array<{ ref: FakeDocRef; data: Record<string, unknown> }> = [];
  return {
    update(ref, data) {
      ops.push({ ref, data });
    },
    async commit() {
      for (const { ref, data } of ops) {
        await fakeUpdateDoc(ref, data);
      }
    },
  };
}

function stubModule(modulePath: string, exports: Record<string, unknown>): void {
  const resolved = require.resolve(modulePath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new (Module as any)(resolved, module);
  m.filename = resolved;
  m.loaded = true;
  m.exports = exports;
  require.cache[resolved] = m;
}

stubModule('firebase/firestore', {
  doc: fakeDoc,
  setDoc: fakeSetDoc,
  getDoc: fakeGetDoc,
  getDocs: fakeGetDocs,
  addDoc: async (col: { __col: string }, data: Record<string, unknown>) => {
    const id = newId();
    ensureCol(col.__col)[id] = { ...data };
    return { id };
  },
  updateDoc: fakeUpdateDoc,
  deleteDoc: async (ref: FakeDocRef) => {
    delete ensureCol(ref.__col)[ref.__id];
  },
  query: (...args: unknown[]) => ({ __query: args }),
  collection: fakeCollection,
  where: (...args: unknown[]) => ({ __where: args }),
  orderBy: (...args: unknown[]) => ({ __orderBy: args }),
  limit: (n: number) => ({ __limit: n }),
  onSnapshot: () => () => undefined,
  increment: (n: number) => ({ __inc: n }),
  serverTimestamp: () => ({ __ts: 'server' }),
  Timestamp: { fromDate: (d: Date) => ({ __ts: d.getTime() }), now: () => ({ __ts: Date.now() }) },
  writeBatch: fakeWriteBatch,
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  startAfter: (...args: unknown[]) => ({ __startAfter: args }),
  GeoPoint: class { constructor(public lat: number, public lng: number) {} },
});

const firebaseLibPath = path.resolve(__dirname, '../../src/lib/firebase.ts');
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new (Module as any)(firebaseLibPath, module);
  m.filename = firebaseLibPath;
  m.loaded = true;
  m.exports = {
    db: { __fake: 'firestore' },
    auth: null,
    isFirebaseConfigured: true,
    isStripeConfigured: false,
    isAppReady: false,
    isProductionMode: false,
    getMissingConfig: () => [],
    default: null,
  };
  require.cache[firebaseLibPath] = m;
}

const sendEmailPath = path.resolve(__dirname, '../../src/lib/email/sendEmail.ts');
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new (Module as any)(sendEmailPath, module);
  m.filename = sendEmailPath;
  m.loaded = true;
  m.exports = { sendEmail: async () => ({ ok: true }) };
  require.cache[sendEmailPath] = m;
}

// Import APRÈS stubs
import { requestPayout } from '../../src/services/firestore';

function seedCreator(id: string, pendingPayout: number): void {
  // Doc creator minimal — Timestamp fake (mock store agnostique au type Firestore)
  ensureCol('creators')[id] = {
    creatorId: id,
    displayName: 'Test',
    referralCode: 'SPORT-TEST',
    referralLink: '',
    commissionRate: 0.10,
    totalEarnings: pendingPayout,
    pendingPayout,
    totalReferrals: 0,
    totalPurchases: 0,
    isActive: true,
    payoutMethod: 'twint',
    payoutDetails: {},
    createdAt: { __ts: 'server' },
  };
}

// =====================================================================

async function main(): Promise<void> {
  section(`MIN_PAYOUT_CHF constante = ${MIN_PAYOUT_CHF}`);
  assertEq(MIN_PAYOUT_CHF, 10, 'MIN_PAYOUT_CHF = 10');
  assertEq(PAYOUT_BELOW_MINIMUM_ERROR, 'payout-below-minimum', 'PAYOUT_BELOW_MINIMUM_ERROR code');
  assertEq(INSUFFICIENT_BALANCE_ERROR, 'insufficient-balance', 'INSUFFICIENT_BALANCE_ERROR code');

  section('RP1 — validatePayoutRequest amount=15 pending=20 → ok');
  assertEq(validatePayoutRequest(15, 20), { ok: true }, 'RP1 ok');

  section('RP2 — validatePayoutRequest amount=9.99 → payout-below-minimum');
  assertEq(
    validatePayoutRequest(9.99, 100),
    { ok: false, reason: PAYOUT_BELOW_MINIMUM_ERROR },
    'RP2 amount juste sous seuil rejeté',
  );

  section('RP3 — attaque DevTools amount=0.01 pending=100 → payout-below-minimum');
  assertEq(
    validatePayoutRequest(0.01, 100),
    { ok: false, reason: PAYOUT_BELOW_MINIMUM_ERROR },
    'RP3 attaque DevTools bloquée',
  );

  section('RP4 — amount NaN / Infinity / négatif → payout-below-minimum');
  assertEq(
    validatePayoutRequest(NaN, 100),
    { ok: false, reason: PAYOUT_BELOW_MINIMUM_ERROR },
    'RP4.a NaN rejeté',
  );
  assertEq(
    validatePayoutRequest(Infinity, 100),
    { ok: false, reason: PAYOUT_BELOW_MINIMUM_ERROR },
    'RP4.b Infinity rejeté (>= 10 mais !isFinite)',
  );
  assertEq(
    validatePayoutRequest(-5, 100),
    { ok: false, reason: PAYOUT_BELOW_MINIMUM_ERROR },
    'RP4.c négatif rejeté',
  );

  section('RP5 — validatePayoutRequest amount=50 pending=20 → insufficient-balance');
  assertEq(
    validatePayoutRequest(50, 20),
    { ok: false, reason: INSUFFICIENT_BALANCE_ERROR },
    'RP5 solde insuffisant',
  );
  // Cas limite : amount = pending exact → ok
  assertEq(
    validatePayoutRequest(10, 10),
    { ok: true },
    'RP5.bis amount = pending exact = MIN_PAYOUT → ok',
  );

  section('RP6 — requestPayout end-to-end succès (amount=15, pending=20)');
  resetStore();
  seedCreator('creator-1', 20);
  const payoutId = await requestPayout('creator-1', 15, 'twint', { twintNumber: '+41791234567' });
  assertTrue(typeof payoutId === 'string' && payoutId.length > 0, 'RP6.a payoutId retourné');
  const payoutDoc = store['payouts'][payoutId] as { creatorId: string; amount: number; status: string; method: string };
  assertEq(payoutDoc.creatorId, 'creator-1', 'RP6.b doc payouts creatorId match');
  assertEq(payoutDoc.amount, 15, 'RP6.c doc payouts amount match');
  assertEq(payoutDoc.status, 'requested', 'RP6.d doc payouts status = requested');
  assertEq(payoutDoc.method, 'twint', 'RP6.e doc payouts method = twint');
  // Le pendingPayout du creator N'EST PAS décrémenté ici — c'est processPayoutAdmin
  // qui le fait à la validation admin (legacy comportement préservé).
  const creatorAfter = store['creators']['creator-1'] as { pendingPayout: number };
  assertEq(creatorAfter.pendingPayout, 20, 'RP6.f pendingPayout PAS décrémenté à la demande (decrement en admin)');

  section('RP7 — requestPayout throw payout-below-minimum si amount < 10 (server guard)');
  resetStore();
  seedCreator('creator-2', 50);
  await assertThrowsWithCode(
    () => requestPayout('creator-2', 5, 'twint', {}),
    'payout-below-minimum',
    'RP7.a amount=5 → throw payout-below-minimum',
  );
  await assertThrowsWithCode(
    () => requestPayout('creator-2', 0.01, 'twint', {}),
    'payout-below-minimum',
    'RP7.b attaque DevTools 0.01 → throw payout-below-minimum',
  );
  // Aucun doc payout créé pour ce creator
  assertTrue(
    Object.keys(store['payouts'] || {}).length === 0,
    'RP7.c aucun doc payout créé après rejet (defense in depth)',
  );

  section('RP8 — requestPayout throw Solde insuffisant si amount > pendingPayout');
  resetStore();
  seedCreator('creator-3', 20);
  await assertThrowsWithCode(
    () => requestPayout('creator-3', 50, 'twint', {}),
    'Solde insuffisant',
    'RP8 amount=50 pending=20 → throw Solde insuffisant',
  );

  // Test creator inexistant
  section('RP9 — requestPayout throw si creator inexistant');
  resetStore();
  await assertThrowsWithCode(
    () => requestPayout('ghost-creator', 15, 'twint', {}),
    'Créateur non trouvé',
    'RP9 creator inexistant → throw Créateur non trouvé',
  );

  // ==================================================================
  console.log('');
  console.log(`Total : ${_passes} pass / ${_failures} fail`);
  if (_failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test runner crashed', e);
  process.exit(1);
});
