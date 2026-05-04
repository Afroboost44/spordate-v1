/**
 * Spordateur — Phase 7 sub-chantier 4 commit 1/4
 * Sessions service helpers — DI seam, error codes (subset Phase 7 — extension future).
 *
 * Pattern DI seam cohérent reports/_internal.ts + blocks/_internal.ts.
 *
 * Phase 7 minimal : exposé uniquement pour getCoInscribedConflicts.
 * Phase 8+ : extension probable avec d'autres helpers session-side.
 */

import { db } from '@/lib/firebase';
import { type Firestore } from 'firebase/firestore';

let _testDb: Firestore | null = null;

export function __setSessionsLibDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

export function getSessionsLibDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}
