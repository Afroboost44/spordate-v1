/**
 * BUG #9 — Tests hardDeleteNotification (helper côté client pour suppression
 * définitive d'une notification depuis la liste "Activité Récente").
 *
 * Mock Firestore in-memory : on injecte `doc` + `deleteDoc` + `db` via DI seam,
 * sans dépendance Firebase réelle ni emulator.
 *
 * Couverture (HD1-HD4) :
 *   HD1 — empty notificationId → throw NotificationError 'invalid-input'
 *   HD2 — happy path → deleteDoc appelé sur ref('notifications', id)
 *   HD3 — Firestore permission-denied → throw NotificationError 'forbidden'
 *   HD4 — Firestore not-found / autre erreur → propagée telle quelle
 *
 * Exécution : npx tsx tests/notifications/hard-delete.test.ts
 */

import {
  hardDeleteNotification,
  NotificationError,
  __setHardDeleteForTesting,
} from '../../src/lib/notifications/hardDelete';

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
// Mock Firestore
// ============================================================================

interface MockRef {
  _col: string;
  _id: string;
}

function makeMock(opts: { permissionDenied?: boolean; throwError?: Error } = {}) {
  const deletedRefs: MockRef[] = [];
  const docCalls: Array<{ col: string; id: string }> = [];

  const db = { __mock: 'db' } as unknown as import('firebase/firestore').Firestore;

  const mockDoc = ((_db: unknown, col: string, id: string): MockRef => {
    docCalls.push({ col, id });
    return { _col: col, _id: id };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  const mockDeleteDoc = (async (ref: MockRef) => {
    if (opts.permissionDenied) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('Missing or insufficient permissions');
      err.code = 'permission-denied';
      throw err;
    }
    if (opts.throwError) throw opts.throwError;
    deletedRefs.push(ref);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return {
    install: () => __setHardDeleteForTesting({ db, doc: mockDoc, deleteDoc: mockDeleteDoc }),
    deletedRefs,
    docCalls,
  };
}

// ============================================================================
// TESTS
// ============================================================================

async function run() {
  // -----------------------------------------------------------------------
  section('HD1 — empty notificationId → invalid-input');
  {
    makeMock().install();
    try {
      await hardDeleteNotification('');
      fail('aurait dû throw');
    } catch (e) {
      if (e instanceof NotificationError && e.code === 'invalid-input') {
        ok('throw NotificationError invalid-input');
      } else fail('mauvaise erreur', e);
    }
    __setHardDeleteForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('HD2 — happy path → deleteDoc appelé sur notifications/{id}');
  {
    const m = makeMock();
    m.install();
    await hardDeleteNotification('notif-abc-123');
    if (m.docCalls.length === 1 && m.docCalls[0].col === 'notifications' && m.docCalls[0].id === 'notif-abc-123') {
      ok('doc(db, "notifications", "notif-abc-123") appelé');
    } else fail('docCalls', m.docCalls);
    if (m.deletedRefs.length === 1 && m.deletedRefs[0]._id === 'notif-abc-123') {
      ok('deleteDoc(ref) appelé sur le bon doc');
    } else fail('deletedRefs', m.deletedRefs);
    __setHardDeleteForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('HD3 — permission-denied → throw NotificationError forbidden');
  {
    makeMock({ permissionDenied: true }).install();
    try {
      await hardDeleteNotification('notif-x');
      fail('aurait dû throw forbidden');
    } catch (e) {
      if (e instanceof NotificationError && e.code === 'forbidden') {
        ok('throw NotificationError forbidden sur permission-denied Firestore');
      } else fail('mauvaise erreur', e);
    }
    __setHardDeleteForTesting(null);
  }

  // -----------------------------------------------------------------------
  section('HD4 — autres erreurs Firestore → propagées telles quelles');
  {
    const sentinel = new Error('boom-network');
    makeMock({ throwError: sentinel }).install();
    try {
      await hardDeleteNotification('notif-y');
      fail('aurait dû throw');
    } catch (e) {
      if (e === sentinel) ok('erreur réseau propagée telle quelle (pas wrapping)');
      else fail('erreur wrappée à tort', e);
    }
    __setHardDeleteForTesting(null);
  }

  console.log(`\n====== Résumé hard-delete ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
