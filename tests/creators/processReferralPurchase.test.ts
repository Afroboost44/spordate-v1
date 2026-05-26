/**
 * Tests fix audit créateurs — couverture processReferralPurchase.
 *
 * Exécution :
 *   npx tsx tests/creators/processReferralPurchase.test.ts
 *
 * Stratégie : stubs require.cache (cf. createCreator.test.ts pour le pattern).
 *
 * Couverture (PRP1-PRP5) :
 *   PRP1. user sans referral (no-referrer) → no-op silencieux (pas de throw,
 *         pas d'écriture sur creators/referrals)
 *   PRP2. user avec referral + creator actif → commission = round(amount * rate)
 *         incrémentée sur creators.pendingPayout + totalEarnings + totalPurchases
 *   PRP3. user avec referral + creator INACTIF → no-op silencieux
 *   PRP4. status referral 'registered' → passe à 'first_purchase' après 1er achat
 *   PRP5. status referral 'first_purchase' → passe à 'active' après 2e achat
 *
 * NB : la fonction actuelle n'implémente PAS d'idempotence par paymentIntentId
 * (le caller est le webhook Stripe qui n'appelle qu'une fois par session). Si
 * cette protection est ajoutée plus tard, ajouter PRP6 ici. Question pour Bassi :
 * faut-il blinder l'idempotence côté processReferralPurchase elle-même ?
 *
 * NB2 : la fonction actuelle n'implémente PAS le mode 'free-class' user.credits
 * (cf. doctrine creator.commissionRate = percent uniquement). Le mode free-class
 * est consommé ailleurs (resolveUserCommission → processCommission.ts). Question
 * pour Bassi : doit-on étendre processReferralPurchase pour gérer free-class
 * directement ? Pour l'instant les tests couvrent ce qui existe.
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

// =====================================================================
// Mock store + helpers (cohérent createCreator.test.ts / requestPayout.test.ts)
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
  return `id_${++_idCounter}`;
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

// Helper : applique une mise à jour avec gestion des sentinels increment/serverTimestamp
function applyUpdate(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && '__inc' in (v as object)) {
      const inc = (v as { __inc: number }).__inc;
      const cur = (target[k] as number | undefined) ?? 0;
      target[k] = cur + inc;
    } else {
      target[k] = v;
    }
  }
}

async function fakeUpdateDoc(ref: FakeDocRef, data: Record<string, unknown>): Promise<void> {
  const col = ensureCol(ref.__col);
  if (!col[ref.__id]) col[ref.__id] = {};
  applyUpdate(col[ref.__id] as Record<string, unknown>, data);
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

// fakeGetDocs : query simulator simple — supporte query(collection, where('field', '==', value), limit(n))
// Format query : { __query: [ { __col: 'referrals' }, { __where: ['referredUserId', '==', 'user-1'] }, { __limit: 1 } ] }
async function fakeGetDocs(q: unknown): Promise<{ empty: boolean; docs: Array<{ id: string; ref: FakeDocRef; data: () => unknown }> }> {
  const queryParts = (q as { __query?: unknown[] }).__query;
  if (!queryParts || !Array.isArray(queryParts)) {
    return { empty: true, docs: [] };
  }
  // Cherche la collection
  const colPart = queryParts.find((p) => p && typeof p === 'object' && '__col' in (p as object));
  const wherePart = queryParts.find((p) => p && typeof p === 'object' && '__where' in (p as object));
  if (!colPart) return { empty: true, docs: [] };

  const colName = (colPart as { __col: string }).__col;
  const col = ensureCol(colName);
  let matchingIds = Object.keys(col);

  if (wherePart) {
    const [field, op, value] = (wherePart as { __where: [string, string, unknown] }).__where;
    if (op === '==') {
      matchingIds = matchingIds.filter((id) => (col[id] as Record<string, unknown>)[field] === value);
    }
  }

  const docs = matchingIds.map((id) => ({
    id,
    ref: { __col: colName, __id: id, id } as FakeDocRef,
    data: () => col[id],
  }));

  return { empty: docs.length === 0, docs };
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
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] }),
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
import { processReferralPurchase } from '../../src/services/firestore';

// =====================================================================
// Helpers de seed
// =====================================================================

function seedCreator(id: string, opts: { isActive?: boolean; commissionRate?: number; pendingPayout?: number } = {}): void {
  ensureCol('creators')[id] = {
    creatorId: id,
    displayName: 'Test',
    referralCode: 'SPORT-TEST',
    referralLink: '',
    commissionRate: opts.commissionRate ?? 0.10,
    totalEarnings: 0,
    pendingPayout: opts.pendingPayout ?? 0,
    totalReferrals: 1,
    totalPurchases: 0,
    isActive: opts.isActive ?? true,
    payoutMethod: 'twint',
    payoutDetails: {},
    createdAt: { __ts: 'server' },
  };
}

function seedReferral(referredUserId: string, referrerId: string, status: 'registered' | 'first_purchase' | 'active' = 'registered'): string {
  const id = `ref-${referredUserId}`;
  ensureCol('referrals')[id] = {
    referralId: id,
    referrerId,
    referredUserId,
    referralCode: 'SPORT-TEST',
    status,
    totalPurchases: status === 'registered' ? 0 : 1,
    totalCommission: 0,
    createdAt: { __ts: 'server' },
  };
  return id;
}

// =====================================================================

async function main(): Promise<void> {
  section('PRP1 — user sans referral → no-op (pas de throw, pas d écriture)');
  resetStore();
  await processReferralPurchase('user-no-ref', 2500);
  assertEq(Object.keys(store['creators'] || {}).length, 0, 'PRP1.a aucune écriture creators');
  assertEq(Object.keys(store['referrals'] || {}).length, 0, 'PRP1.b aucune écriture referrals');

  section('PRP2 — user avec referral + creator actif → commission incrémentée');
  resetStore();
  seedCreator('creator-A', { isActive: true, commissionRate: 0.10, pendingPayout: 50 });
  seedReferral('user-1', 'creator-A', 'registered');
  // amount = 2500 (centimes ? non, l'API actuelle calcule commission = round(amount * rate)
  // — amount est passé tel quel par le caller, on respecte la signature actuelle)
  await processReferralPurchase('user-1', 2500);

  const creator = store['creators']['creator-A'] as { pendingPayout: number; totalEarnings: number; totalPurchases: number };
  assertEq(creator.pendingPayout, 50 + 250, 'PRP2.a pendingPayout += 250 (round(2500 * 0.10))');
  assertEq(creator.totalEarnings, 250, 'PRP2.b totalEarnings = 250');
  assertEq(creator.totalPurchases, 1, 'PRP2.c totalPurchases = 1');

  const ref = store['referrals']['ref-user-1'] as { totalPurchases: number; totalCommission: number; status: string };
  assertEq(ref.totalPurchases, 1, 'PRP2.d referral.totalPurchases = 1');
  assertEq(ref.totalCommission, 250, 'PRP2.e referral.totalCommission = 250');
  assertEq(ref.status, 'first_purchase', 'PRP2.f referral.status = first_purchase (registered → first_purchase)');

  section('PRP3 — creator INACTIF → no-op silencieux (aucune écriture)');
  resetStore();
  seedCreator('creator-B', { isActive: false, commissionRate: 0.10, pendingPayout: 100 });
  seedReferral('user-2', 'creator-B', 'registered');
  await processReferralPurchase('user-2', 5000);

  const creatorB = store['creators']['creator-B'] as { pendingPayout: number; totalEarnings: number };
  assertEq(creatorB.pendingPayout, 100, 'PRP3.a pendingPayout INCHANGÉ');
  assertEq(creatorB.totalEarnings, 0, 'PRP3.b totalEarnings INCHANGÉ');
  const refB = store['referrals']['ref-user-2'] as { totalPurchases: number };
  assertEq(refB.totalPurchases, 0, 'PRP3.c referral.totalPurchases INCHANGÉ');

  section('PRP4 — status referral registered → first_purchase après 1er achat');
  resetStore();
  seedCreator('creator-C', { isActive: true, commissionRate: 0.20 });
  seedReferral('user-3', 'creator-C', 'registered');
  await processReferralPurchase('user-3', 1000);
  const refC = store['referrals']['ref-user-3'] as { status: string; totalCommission: number };
  assertEq(refC.status, 'first_purchase', 'PRP4.a status registered → first_purchase');
  assertEq(refC.totalCommission, 200, 'PRP4.b commission = 200 (1000 × 0.20)');

  section('PRP5 — status referral first_purchase → active après 2e achat');
  resetStore();
  seedCreator('creator-D', { isActive: true, commissionRate: 0.10 });
  seedReferral('user-4', 'creator-D', 'first_purchase');
  await processReferralPurchase('user-4', 5000);
  const refD = store['referrals']['ref-user-4'] as { status: string; totalPurchases: number };
  assertEq(refD.status, 'active', 'PRP5.a status first_purchase → active');
  assertTrue(refD.totalPurchases >= 2, 'PRP5.b totalPurchases incrémenté >= 2');

  section('PRP6 — arrondi commission (Math.round) sur valeurs fractionnaires');
  resetStore();
  seedCreator('creator-E', { isActive: true, commissionRate: 0.15 });
  seedReferral('user-5', 'creator-E', 'first_purchase');
  // 333 * 0.15 = 49.95 → round = 50
  await processReferralPurchase('user-5', 333);
  const creatorE = store['creators']['creator-E'] as { totalEarnings: number };
  assertEq(creatorE.totalEarnings, 50, 'PRP6 commission arrondie 49.95 → 50');

  // ==================================================================
  console.log('');
  console.log(`Total : ${_passes} pass / ${_failures} fail`);
  if (_failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test runner crashed', e);
  process.exit(1);
});
