/**
 * Phase B — Tests des deux paths de processCommission (% vs free-class).
 *
 * Mock Firestore minimal in-memory : on ne teste pas la sémantique Firestore
 * (déjà couvert par tests/checkout/commission.test.ts via emulator), mais
 * uniquement le BRANCHING entre modes et les bons writes émis :
 *
 *   PCM1 — code vide → no-op total
 *   PCM2 — creator path (default percent 10%) → creators.{totalEarnings, pendingPayout} CHF
 *   PCM3 — creator path mode 'free-class' → users.credits + credit doc creator_voucher_class
 *   PCM4 — invite path (default free-class 1) → users.credits + credit doc
 *   PCM5 — invite path mode 'percent' → auto-create creators doc + percent reward
 *   PCM6 — anti self-referral (payer === referrer) → no writes des deux côtés
 *
 * Exécution : npx tsx tests/referral/process-commission-modes.test.ts
 */

import { processCommission } from '../../src/lib/referral/processCommission';

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

// ============================================================================
// Mock Firestore in-memory
// ============================================================================

type WriteOp = { kind: 'set' | 'update'; col: string; id: string; data: Record<string, unknown> };

const FV = {
  increment: (n: number) => ({ __op: 'increment', value: n }),
  serverTimestamp: () => ({ __op: 'ts' }),
};

function makeStore() {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  const writes: WriteOp[] = [];
  let autoId = 0;

  function ensureCol(name: string) {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  }

  function resolveOps(input: Record<string, unknown>, base?: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(input)) {
      const v = input[k] as { __op?: string; value?: number } | unknown;
      if (v && typeof v === 'object' && (v as { __op?: string }).__op === 'increment') {
        const inc = (v as { value: number }).value;
        const cur = (base?.[k] as number | undefined) ?? 0;
        out[k] = cur + inc;
      } else if (v && typeof v === 'object' && (v as { __op?: string }).__op === 'ts') {
        out[k] = '__SERVER_TS__';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function applyOp(op: WriteOp) {
    writes.push(op);
    const col = ensureCol(op.col);
    if (op.kind === 'set') {
      col.set(op.id, resolveOps(op.data));
    } else {
      const existing = col.get(op.id) || {};
      col.set(op.id, { ...existing, ...resolveOps(op.data, existing) });
    }
  }

  function makeDocRef(colName: string, id: string) {
    const ref = {
      id,
      _col: colName,
      _id: id,
      get: async () => {
        const col = ensureCol(colName);
        const exists = col.has(id);
        const docData = col.get(id);
        return {
          exists,
          id,
          data: () => docData,
          ref,
        };
      },
      update: async (d: Record<string, unknown>) => applyOp({ kind: 'update', col: colName, id, data: d }),
    };
    return ref;
  }

  function makeQuery(colName: string, filters: Array<[string, string, unknown]>) {
    const q = {
      where: (f: string, op: string, v: unknown) => makeQuery(colName, [...filters, [f, op, v]]),
      limit: (_n: number) => ({
        get: async () => {
          const col = ensureCol(colName);
          const matches: Array<{ id: string; ref: ReturnType<typeof makeDocRef>; data: () => Record<string, unknown> }> = [];
          for (const [id, doc] of col.entries()) {
            const matchAll = filters.every(([f, _op, v]) => doc[f] === v);
            if (matchAll) {
              matches.push({ id, ref: makeDocRef(colName, id), data: () => doc });
            }
          }
          const sliced = matches.slice(0, 1);
          return { empty: sliced.length === 0, docs: sliced };
        },
      }),
    };
    return q;
  }

  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => makeDocRef(name, id ?? `auto-${++autoId}`),
      where: (f: string, op: string, v: unknown) => makeQuery(name, [[f, op, v]]),
    }),
    batch: () => {
      const ops: WriteOp[] = [];
      return {
        set: (ref: { _col: string; _id: string }, d: Record<string, unknown>) =>
          ops.push({ kind: 'set', col: ref._col, id: ref._id, data: d }),
        update: (ref: { _col: string; _id: string }, d: Record<string, unknown>) =>
          ops.push({ kind: 'update', col: ref._col, id: ref._id, data: d }),
        commit: async () => {
          for (const op of ops) applyOp(op);
        },
      };
    },
  };

  function seed(col: string, id: string, doc: Record<string, unknown>) {
    ensureCol(col).set(id, doc);
  }
  function getCol(col: string) {
    return ensureCol(col);
  }
  function getWrites() {
    return writes;
  }

  return { db, FV, seed, getCol, getWrites };
}

// ============================================================================
// TESTS
// ============================================================================

async function run() {
  // -----------------------------------------------------------------------
  section('PCM1 — code vide → no-op (skip total)');
  {
    const { db, FV, getWrites } = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processCommission({ db: db as any, FV: FV as any, payerUserId: 'p1', amount: 10000, code: '' });
    if (getWrites().length === 0) ok('aucun write effectué pour code vide');
    else fail('writes inattendus', getWrites());
  }

  // -----------------------------------------------------------------------
  section('PCM2 — creator path (default percent 10%)');
  {
    const store = makeStore();
    store.seed('creators', 'c1', { creatorId: 'c1', referralCode: 'ABC', isActive: true });
    store.seed('users', 'c1', { uid: 'c1' }); // pas de commission → defaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processCommission({ db: store.db as any, FV: store.FV as any, payerUserId: 'buyer', amount: 10000, code: 'ABC' });

    const cre = store.getCol('creators').get('c1') as Record<string, unknown> | undefined;
    if (cre && cre.totalEarnings === 10 && cre.pendingPayout === 10) {
      ok('creators.totalEarnings += 10 CHF (10% de 100), pendingPayout idem');
    } else fail('creators state', cre);

    const notifs = Array.from(store.getCol('notifications').values()) as Array<Record<string, unknown>>;
    if (notifs.length === 1 && notifs[0].type === 'affiliation') ok('notification affiliation créée');
    else fail('notif manquante ou wrong type', notifs);

    if (store.getCol('credits').size === 0) ok('aucun credit créé en mode percent');
    else fail('credits inattendus en mode percent', Array.from(store.getCol('credits').entries()));
  }

  // -----------------------------------------------------------------------
  section('PCM3 — creator path mode free-class (custom config)');
  {
    const store = makeStore();
    store.seed('creators', 'c1', { creatorId: 'c1', referralCode: 'XYZ', isActive: true });
    store.seed('users', 'c1', {
      uid: 'c1',
      commission: { creator: { mode: 'free-class', value: 2 } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processCommission({ db: store.db as any, FV: store.FV as any, payerUserId: 'buyer', amount: 10000, code: 'XYZ' });

    const u = store.getCol('users').get('c1') as Record<string, unknown> | undefined;
    if (u && u.credits === 2) ok('users.credits += 2');
    else fail('users.credits', u);

    const credits = Array.from(store.getCol('credits').values()) as Array<Record<string, unknown>>;
    if (
      credits.length === 1 &&
      credits[0].type === 'creator_voucher_class' &&
      credits[0].amount === 2 &&
      credits[0].source === 'commission' &&
      credits[0].userId === 'c1'
    ) {
      ok('credit doc : type=creator_voucher_class, amount=2, source=commission, userId=c1');
    } else fail('credit doc shape', credits);

    const cre = store.getCol('creators').get('c1') as Record<string, unknown> | undefined;
    if (cre && cre.totalPurchases === 1 && cre.totalEarnings === undefined) {
      ok('creators.totalPurchases++ et totalEarnings non touché');
    } else fail('creators state', cre);
  }

  // -----------------------------------------------------------------------
  section('PCM4 — invite path (default free-class 1)');
  {
    const store = makeStore();
    store.seed('users', 'u1', { uid: 'u1', referralCode: 'INV', displayName: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processCommission({ db: store.db as any, FV: store.FV as any, payerUserId: 'buyer', amount: 10000, code: 'INV' });

    const u = store.getCol('users').get('u1') as Record<string, unknown> | undefined;
    if (u && u.credits === 1) ok('users.credits += 1 (default invite free-class)');
    else fail('users.credits', u);

    const credits = Array.from(store.getCol('credits').values()) as Array<Record<string, unknown>>;
    if (
      credits.length === 1 &&
      credits[0].type === 'creator_voucher_class' &&
      credits[0].amount === 1
    ) {
      ok('credit doc : type=creator_voucher_class, amount=1');
    } else fail('credit doc shape', credits);

    if (store.getCol('creators').size === 0) ok('aucun creator doc créé en mode free-class invite');
    else fail('creators inattendus', Array.from(store.getCol('creators').entries()));
  }

  // -----------------------------------------------------------------------
  section('PCM5 — invite path mode percent → auto-create creators doc');
  {
    const store = makeStore();
    store.seed('users', 'u1', {
      uid: 'u1',
      referralCode: 'INV2',
      displayName: 'Alice',
      commission: { invite: { mode: 'percent', value: 20 } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processCommission({ db: store.db as any, FV: store.FV as any, payerUserId: 'buyer', amount: 10000, code: 'INV2' });

    const cre = store.getCol('creators').get('u1') as Record<string, unknown> | undefined;
    if (
      cre &&
      cre.totalEarnings === 20 &&
      cre.pendingPayout === 20 &&
      cre.commissionRate === 0.2 &&
      cre.referralCode === 'INV2' &&
      cre.displayName === 'Alice'
    ) {
      ok('creator doc auto-créé (totalEarnings=20, commissionRate=0.2, displayName + referralCode mirror)');
    } else fail('creator doc auto-create', cre);

    const u = store.getCol('users').get('u1') as Record<string, unknown> | undefined;
    if (u && u.credits === undefined) ok('users.credits non touché en mode percent');
    else fail('users.credits inattendu', u);
  }

  // -----------------------------------------------------------------------
  section('PCM6 — anti self-referral (payer === referrer)');
  {
    const store = makeStore();
    store.seed('creators', 'c1', { creatorId: 'c1', referralCode: 'SELF', isActive: true });
    store.seed('users', 'c1', { uid: 'c1', referralCode: 'SELF' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processCommission({ db: store.db as any, FV: store.FV as any, payerUserId: 'c1', amount: 10000, code: 'SELF' });

    if (store.getWrites().length === 0) ok('aucun write quand payer === referrer (creator + invite paths)');
    else fail('writes effectués malgré self-referral', store.getWrites());
  }

  console.log(`\n====== Résumé process-commission-modes ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
