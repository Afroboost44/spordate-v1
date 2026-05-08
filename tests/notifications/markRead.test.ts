/**
 * Tests Phase 9 sub-chantier 3 commit 4/5 — UX polish notifications mark-read + dismiss.
 *
 * Exécution :
 *   npm run test:notifications:mark-read
 *
 * Pattern : Admin SDK direct pour seed + DI seam @firebase/rules-unit-testing pour helper
 * client-side (db de markRead.ts qui utilise firebase/firestore web SDK).
 *
 * Couverture (UN1-UN5) :
 *   UN1 markNotificationRead happy : ownership match → readAt set + isRead=true
 *   UN2 markNotificationRead forbidden : auth.uid != userId → throw NotificationError 'forbidden'
 *   UN3 markAllNotificationsRead : 3 unread → 3 readAt set, 0 deuxième run (idempotency)
 *   UN4 dismissNotification : dismissedAt set, doc reste en Firestore (audit-friendly)
 *   UN5 PATCH /api/notifications/[id] action='dismiss' → 200 + dismissedAt persisté
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-mark-read';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-mark-read';

import {
  __setNotificationsDbForTesting,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  NotificationError,
} from '../../src/lib/notifications/markRead';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { PATCH as PATCHNotification } from '../../src/app/api/notifications/[id]/route';
import { POST as POSTNotifications } from '../../src/app/api/notifications/route';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import type { Firestore } from 'firebase/firestore';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

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

// =====================================================================

async function callPatch(
  notificationId: string,
  action: 'mark-read' | 'dismiss',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-token-mark-read',
  };
  const req = new Request(`http://localhost/api/notifications/${notificationId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ action }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  // Next 15 expects context.params as Promise
  const res = await PATCHNotification(req, { params: Promise.resolve({ id: notificationId }) });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function callPostMarkAll(): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-token-mark-read',
  };
  const req = new Request('http://localhost/api/notifications', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'mark-all-read' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTNotifications(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-mark-read' });
  }
  const adminDb = getFirestore();

  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-mark-read',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  const ALICE = 'user_alice_un';
  const BOB = 'user_bob_un';

  async function clearAll(): Promise<void> {
    const snap = await adminDb.collection('notifications').get();
    for (const d of snap.docs) await d.ref.delete().catch(() => {});
  }

  async function seedNotif(id: string, userId: string, extra: Record<string, unknown> = {}) {
    await adminDb
      .collection('notifications')
      .doc(id)
      .set({
        notificationId: id,
        userId,
        type: 'system',
        title: 'Test',
        body: 'Test body',
        data: {},
        isRead: false,
        createdAt: new Date(),
        ...extra,
      });
  }

  // Wire DI seam : markRead helpers utilisent client SDK via rules-unit-testing
  // (qui matche firestore-emulator). Bypass rules pour Alice (signed-in context).
  const aliceCtx = env.authenticatedContext(ALICE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aliceDb: Firestore = asFirestore((aliceCtx as any).firestore());
  __setNotificationsDbForTesting(aliceDb);

  // ===================================================================
  // UN1 : markNotificationRead happy
  // ===================================================================
  section('UN1 markNotificationRead happy : ownership match → readAt set + isRead=true');
  await clearAll();
  await seedNotif('notif_un1', ALICE);

  await markNotificationRead('notif_un1', ALICE);
  const un1Snap = await adminDb.collection('notifications').doc('notif_un1').get();
  const un1 = un1Snap.data();
  if (un1?.isRead === true) {
    pass('UN1 isRead=true persisté');
  } else {
    fail('UN1 isRead should be true', { isRead: un1?.isRead });
  }
  if (un1?.readAt) {
    pass('UN1 readAt set (Timestamp non null)');
  } else {
    fail('UN1 readAt should be set', { readAt: un1?.readAt });
  }

  // Idempotency : 2nd run ne crash pas
  await markNotificationRead('notif_un1', ALICE);
  pass('UN1 2e run idempotent (no throw)');

  // ===================================================================
  // UN2 : markNotificationRead forbidden
  // ===================================================================
  section('UN2 markNotificationRead forbidden : auth.uid != userId → NotificationError forbidden');
  await clearAll();
  await seedNotif('notif_un2', BOB); // owned par BOB
  // markRead.ts utilise aliceDb donc Alice tente de lire BOB doc
  let un2Caught = false;
  try {
    await markNotificationRead('notif_un2', ALICE);
  } catch (err) {
    if (err instanceof NotificationError && err.code === 'forbidden') {
      un2Caught = true;
    }
  }
  if (un2Caught) {
    pass('UN2 NotificationError forbidden thrown (ownership mismatch)');
  } else {
    fail('UN2 should throw NotificationError forbidden');
  }
  // Vérif : doc BOB intact (no readAt)
  const un2Snap = await adminDb.collection('notifications').doc('notif_un2').get();
  if (!un2Snap.data()?.readAt) {
    pass('UN2 doc BOB intact (no readAt set)');
  } else {
    fail('UN2 BOB doc should not be modified', { readAt: un2Snap.data()?.readAt });
  }

  // not-found / forbidden case bonus :
  // Avec Firestore rules denying access aux docs userId != auth.uid (et donc aussi aux docs
  // inexistants), le helper convertit permission-denied en NotificationError 'forbidden'
  // pour ne pas leak l'existence du doc. Test : helper throw NotificationError quel que soit
  // le code (le caller route map → 4xx).
  let nfCaught = false;
  try {
    await markNotificationRead('notif_doesnotexist', ALICE);
  } catch (err) {
    if (err instanceof NotificationError && (err.code === 'not-found' || err.code === 'forbidden')) {
      nfCaught = true;
    }
  }
  if (nfCaught) {
    pass('UN2 bonus NotificationError thrown pour doc inaccessible (no info leak)');
  } else {
    fail('UN2 bonus NotificationError expected pour doc inaccessible');
  }

  // ===================================================================
  // UN3 : markAllNotificationsRead
  // ===================================================================
  section('UN3 markAllNotificationsRead : 3 unread → 3 processed, idempotent 2e run');
  await clearAll();
  await seedNotif('notif_un3a', ALICE);
  await seedNotif('notif_un3b', ALICE);
  await seedNotif('notif_un3c', ALICE);
  // Doc owned par BOB pour vérifier scope
  await seedNotif('notif_un3_bob', BOB);
  // Doc Alice déjà readAt (must skip)
  await seedNotif('notif_un3_alreadyread', ALICE, {
    isRead: true,
    readAt: new Date(),
  });

  const un3a = await markAllNotificationsRead(ALICE);
  if (un3a.processed === 3) {
    pass('UN3 1er run processed=3 (3 unread Alice docs)');
  } else {
    fail('UN3 should process 3', { processed: un3a.processed });
  }

  // Vérif les 3 docs Alice ont readAt set
  let un3Count = 0;
  for (const id of ['notif_un3a', 'notif_un3b', 'notif_un3c']) {
    const s = await adminDb.collection('notifications').doc(id).get();
    if (s.data()?.readAt && s.data()?.isRead === true) un3Count++;
  }
  if (un3Count === 3) {
    pass('UN3 3 docs Alice tous flagged readAt + isRead');
  } else {
    fail('UN3 should have 3 flagged', { un3Count });
  }

  // Vérif BOB doc intact
  const un3BobSnap = await adminDb.collection('notifications').doc('notif_un3_bob').get();
  if (!un3BobSnap.data()?.readAt) {
    pass('UN3 BOB doc intact (scope userId)');
  } else {
    fail('UN3 BOB doc should not be modified');
  }

  // 2e run : idempotent processed=0
  const un3b = await markAllNotificationsRead(ALICE);
  if (un3b.processed === 0) {
    pass('UN3 2e run processed=0 (idempotent)');
  } else {
    fail('UN3 2e run should be idempotent', { processed: un3b.processed });
  }

  // ===================================================================
  // UN4 : dismissNotification
  // ===================================================================
  section('UN4 dismissNotification : dismissedAt set, doc reste en Firestore (audit)');
  await clearAll();
  await seedNotif('notif_un4', ALICE);

  await dismissNotification('notif_un4', ALICE);
  const un4Snap = await adminDb.collection('notifications').doc('notif_un4').get();
  if (un4Snap.exists) {
    pass('UN4 doc encore présent (pas hard-delete)');
  } else {
    fail('UN4 doc should still exist (audit-friendly soft delete)');
  }
  if (un4Snap.data()?.dismissedAt) {
    pass('UN4 dismissedAt Timestamp set');
  } else {
    fail('UN4 dismissedAt should be set', { dismissedAt: un4Snap.data()?.dismissedAt });
  }

  // Forbidden cross-user
  await seedNotif('notif_un4_bob', BOB);
  let un4FbCaught = false;
  try {
    await dismissNotification('notif_un4_bob', ALICE);
  } catch (err) {
    if (err instanceof NotificationError && err.code === 'forbidden') {
      un4FbCaught = true;
    }
  }
  if (un4FbCaught) {
    pass('UN4 dismiss forbidden cross-user');
  } else {
    fail('UN4 dismiss should be forbidden cross-user');
  }

  // ===================================================================
  // UN5 : PATCH /api/notifications/[id] action='dismiss' → 200 + dismissedAt
  // ===================================================================
  section('UN5 PATCH /api/notifications/[id] action=dismiss → 200 + dismissedAt persisté');
  await clearAll();
  await seedNotif('notif_un5', ALICE);

  // Mock verifyAuth → uid=ALICE
  __setVerifyAuthForTesting(async () => ALICE);

  const un5Res = await callPatch('notif_un5', 'dismiss');
  if (un5Res.status === 200 && un5Res.body?.ok === true) {
    pass('UN5 PATCH 200 ok=true');
  } else {
    fail('UN5 PATCH should be 200', un5Res);
  }
  const un5Snap = await adminDb.collection('notifications').doc('notif_un5').get();
  if (un5Snap.data()?.dismissedAt) {
    pass('UN5 dismissedAt persisté via API');
  } else {
    fail('UN5 dismissedAt should be set via API', { data: un5Snap.data() });
  }

  // Bonus : PATCH mark-read
  await seedNotif('notif_un5b', ALICE);
  const un5bRes = await callPatch('notif_un5b', 'mark-read');
  if (un5bRes.status === 200) {
    pass('UN5 bonus PATCH mark-read 200');
  } else {
    fail('UN5 bonus PATCH mark-read should be 200', un5bRes);
  }

  // Bonus : PATCH avec auth uid != userId → 403
  await seedNotif('notif_un5c', BOB);
  const un5cRes = await callPatch('notif_un5c', 'dismiss');
  if (un5cRes.status === 403 && un5cRes.body?.error === 'forbidden') {
    pass('UN5 bonus PATCH cross-user → 403 forbidden');
  } else {
    fail('UN5 bonus PATCH cross-user should be 403', un5cRes);
  }

  // Bonus : POST /api/notifications mark-all-read
  await clearAll();
  await seedNotif('un5_all_a', ALICE);
  await seedNotif('un5_all_b', ALICE);
  const un5dRes = await callPostMarkAll();
  if (un5dRes.status === 200 && un5dRes.body?.processed === 2) {
    pass('UN5 bonus POST mark-all-read processed=2');
  } else {
    fail('UN5 bonus POST mark-all-read should processed=2', un5dRes);
  }

  // Bonus : auth missing → 401
  __setVerifyAuthForTesting(async () => null);
  const un5eRes = await callPatch('whatever', 'dismiss');
  if (un5eRes.status === 401) {
    pass('UN5 bonus PATCH unauth → 401');
  } else {
    fail('UN5 bonus PATCH unauth should be 401', un5eRes);
  }

  // Cleanup
  __setVerifyAuthForTesting(null);
  __setNotificationsDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Mark-Read (UN1-UN5 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
