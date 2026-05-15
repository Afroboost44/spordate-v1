/**
 * BUG #9 — Hard-delete d'une notification depuis la liste "Activité Récente".
 *
 * Pourquoi un module séparé / pourquoi pas passer par /api/notifications/[id] DELETE ?
 *
 *  Les tentatives c44/c52/c53 routaient le clic X vers l'endpoint Next.js qui
 *  utilise Admin SDK + verifyIdToken. Cela impose :
 *    - FIREBASE_SERVICE_ACCOUNT_KEY présent + valide en production
 *    - projectId du service account = projectId du token client (sinon
 *      verifyIdToken throw, l'endpoint répond 401, le toast erreur passe
 *      inaperçu)
 *    - 1 roundtrip Vercel + 1 roundtrip Firestore = 2 sauts réseau
 *
 *  Depuis Phase 9.5 c53, firestore.rules autorise déjà le delete direct par
 *  l'owner :
 *    allow delete: if isAuth() && (resource.data.userId == request.auth.uid || isAdmin());
 *
 *  → On peut donc supprimer le doc directement depuis le client via le SDK
 *    Web Firebase. 1 seul roundtrip, pas de dépendance service account, pas
 *    de mismatch projectId possible. Si jamais les rules refusent (deploy
 *    pas à jour), on remap la FirebaseError 'permission-denied' vers
 *    NotificationError 'forbidden' pour un toast explicite.
 *
 * DI seam `__setHardDeleteForTesting` : permet d'injecter `db`, `doc`,
 * `deleteDoc` mockés pour tester sans Firebase réel ni emulator (cohérent
 * pattern resolveUserCommission / processCommission Phase B).
 */

import {
  doc as realDoc,
  deleteDoc as realDeleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { db as realDb } from '@/lib/firebase';

// =====================================================================
// Errors (cohérent NotificationError de markRead.ts)
// =====================================================================

export type HardDeleteErrorCode = 'invalid-input' | 'forbidden';

export class NotificationError extends Error {
  public readonly code: HardDeleteErrorCode;
  constructor(code: HardDeleteErrorCode, message: string) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

// =====================================================================
// DI seam
// =====================================================================

interface Overrides {
  db?: Firestore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc?: (db: any, collection: string, id: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteDoc?: (ref: any) => Promise<void>;
}

let _overrides: Overrides = {};

/**
 * @internal — utilisé UNIQUEMENT par tests/notifications/hard-delete.test.ts.
 * Passer `null` pour reset.
 */
export function __setHardDeleteForTesting(overrides: Overrides | null): void {
  _overrides = overrides ?? {};
}

// =====================================================================
// hardDeleteNotification
// =====================================================================

/**
 * Supprime définitivement une notification du Firestore (hard-delete via le
 * SDK Web client). Les rules garantissent l'ownership (owner uniquement).
 *
 * @throws NotificationError 'invalid-input' si notificationId vide.
 * @throws NotificationError 'forbidden' si Firestore renvoie permission-denied
 *         (rules pas déployées OU userId mismatch).
 * @throws Erreur originale (réseau, etc.) propagée pour le caller.
 */
export async function hardDeleteNotification(notificationId: string): Promise<void> {
  if (!notificationId) {
    throw new NotificationError('invalid-input', 'notificationId required');
  }
  const fsdb = _overrides.db ?? realDb;
  if (!fsdb) {
    throw new Error('Firestore non initialisé');
  }
  const docFn = _overrides.doc ?? realDoc;
  const deleteFn = _overrides.deleteDoc ?? realDeleteDoc;

  const ref = docFn(fsdb, 'notifications', notificationId);
  try {
    await deleteFn(ref);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any)?.code;
    if (code === 'permission-denied' || code === 'firestore/permission-denied') {
      throw new NotificationError('forbidden', 'Firestore rules denied delete');
    }
    throw err;
  }
}
