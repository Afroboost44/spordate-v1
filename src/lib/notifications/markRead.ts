/**
 * Phase 9 sub-chantier 3 commit 4/5 — Helpers UX polish notifications.
 *
 * 3 helpers pure :
 *   - markNotificationRead    : verify ownership + update readAt = serverTimestamp + isRead=true (compat)
 *   - markAllNotificationsRead : batch update toutes notifs userId=uid + readAt==null
 *   - dismissNotification     : soft delete (dismissedAt = serverTimestamp), doc reste pour audit
 *
 * DI seam `__setNotificationsDbForTesting` (cohérent SC2 c5/6 + SC4 c2/6 pattern) — utilisé par
 * tests/notifications/markRead.test.ts pour injecter Firestore connecté à l'emulator.
 *
 * NotificationError typed (cohérent InviteError) :
 *   - 'invalid-input' : uid ou notificationId vide
 *   - 'not-found'     : notification doc inexistant
 *   - 'forbidden'     : auth.uid != notification.userId (ownership mismatch)
 *
 * Idempotency :
 *   - markNotificationRead 2× même doc → 2nd run no-op (readAt already set)
 *   - markAllNotificationsRead 2× → 2nd run touche 0 docs (filter readAt==null)
 *
 * Note : ces helpers sont **client-side** (Firebase Web SDK doc/query/updateDoc) — utilisés
 * via API routes sécurisées /api/notifications/* qui font verifyAuth Bearer puis appellent
 * helpers via Admin SDK indirectement. Pour les routes Admin, on utilise les mêmes shapes
 * via la DI seam (Firestore type est compat).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// =====================================================================
// Helper : safe getDoc qui mappe FirebaseError permission-denied (rules
// reject) vers NotificationError 'forbidden'. Rationale : si Firestore
// rules refusent l'accès, c'est sémantiquement un ownership mismatch
// — pas un not-found. Le helper ne doit pas leak l'existence aux users
// non-autorisés.
// =====================================================================

async function safeGetDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  try {
    return await getDoc(ref);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any)?.code;
    if (code === 'permission-denied' || code === 'firestore/permission-denied') {
      throw new NotificationError('forbidden', 'Ownership mismatch (rules denied)');
    }
    throw err;
  }
}

// =====================================================================
// DI seam (test injection cohérent __setInvitesDbForTesting)
// =====================================================================

let _notificationsDbOverride: Firestore | null = null;

/**
 * @internal — utilisé UNIQUEMENT par les tests pour injecter un Firestore
 * connecté à l'emulator (cf. tests/notifications/markRead.test.ts).
 */
export function __setNotificationsDbForTesting(testDb: Firestore | null): void {
  _notificationsDbOverride = testDb;
}

function getNotificationsDb(): Firestore {
  const fbDb = _notificationsDbOverride ?? db;
  if (!fbDb) throw new Error('Firestore non initialisé');
  return fbDb;
}

// =====================================================================
// Errors
// =====================================================================

export type NotificationErrorCode = 'invalid-input' | 'not-found' | 'forbidden';

export class NotificationError extends Error {
  public readonly code: NotificationErrorCode;
  constructor(code: NotificationErrorCode, message: string) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

// =====================================================================
// markNotificationRead
// =====================================================================

/**
 * Verify ownership + update readAt = serverTimestamp + isRead=true (compat legacy).
 * @throws NotificationError 'invalid-input' | 'not-found' | 'forbidden'
 */
export async function markNotificationRead(
  notificationId: string,
  uid: string,
): Promise<void> {
  if (!notificationId || !uid) {
    throw new NotificationError('invalid-input', 'notificationId and uid required');
  }
  const fsdb = getNotificationsDb();
  const ref = doc(fsdb, 'notifications', notificationId);
  const snap = await safeGetDoc(ref);
  if (!snap.exists()) {
    throw new NotificationError('not-found', `Notification ${notificationId} introuvable`);
  }
  const data = snap.data();
  if (data?.userId !== uid) {
    throw new NotificationError('forbidden', 'Ownership mismatch');
  }
  if (data?.readAt) {
    // Idempotent : déjà lu, no-op
    return;
  }
  await updateDoc(ref, {
    readAt: serverTimestamp(),
    isRead: true,
  });
}

// =====================================================================
// markAllNotificationsRead
// =====================================================================

/**
 * Batch update toutes notifications userId=uid + readAt==null.
 * Returns count traité (0 si idempotent run).
 */
export async function markAllNotificationsRead(uid: string): Promise<{ processed: number }> {
  if (!uid) {
    throw new NotificationError('invalid-input', 'uid required');
  }
  const fsdb = getNotificationsDb();
  // Query avec filter isRead=false (legacy index existant) + post-filter readAt==null pour
  // éviter de toucher des docs déjà migrés Phase 9.
  const q = query(
    collection(fsdb, 'notifications'),
    where('userId', '==', uid),
    where('isRead', '==', false),
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    return { processed: 0 };
  }
  const batch = writeBatch(fsdb);
  let count = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.readAt) continue; // déjà readAt set (race) — skip
    batch.update(docSnap.ref, {
      readAt: serverTimestamp(),
      isRead: true,
    });
    count++;
  }
  if (count > 0) {
    await batch.commit();
  }
  return { processed: count };
}

// =====================================================================
// dismissNotification (soft delete user)
// =====================================================================

/**
 * Soft-delete : dismissedAt = serverTimestamp, doc reste en Firestore pour audit.
 * UI filtre dismissedAt==null pour masquer ces docs.
 * @throws NotificationError 'invalid-input' | 'not-found' | 'forbidden'
 */
export async function dismissNotification(
  notificationId: string,
  uid: string,
): Promise<void> {
  if (!notificationId || !uid) {
    throw new NotificationError('invalid-input', 'notificationId and uid required');
  }
  const fsdb = getNotificationsDb();
  const ref = doc(fsdb, 'notifications', notificationId);
  const snap = await safeGetDoc(ref);
  if (!snap.exists()) {
    throw new NotificationError('not-found', `Notification ${notificationId} introuvable`);
  }
  const data = snap.data();
  if (data?.userId !== uid) {
    throw new NotificationError('forbidden', 'Ownership mismatch');
  }
  if (data?.dismissedAt) {
    // Idempotent : déjà dismissed
    return;
  }
  await updateDoc(ref, {
    dismissedAt: serverTimestamp(),
  });
}
