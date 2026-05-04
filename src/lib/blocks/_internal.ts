/**
 * Spordateur — Phase 7 sub-chantier 2 commit 2/4
 * Blocks service — internal helpers, DI seam, error codes.
 *
 * Pattern DI seam cohérent src/lib/reviews/_internal.ts (sub-chantier 1) :
 * - __setBlocksDbForTesting(db) → override Firestore client pour tests unit
 * - getBlocksDb() retourne db importé de @/lib/firebase en prod
 *
 * Cf. architecture.md §9.sexies E pour la doctrine block list complète.
 */

import { db } from '@/lib/firebase';
import { type Firestore } from 'firebase/firestore';

// =====================================================================
// DI seam (test injection)
// =====================================================================

let _testDb: Firestore | null = null;

export function __setBlocksDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

export function getBlocksDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}

// =====================================================================
// Doc-id pattern (defense-in-depth aligné firestore.rules)
// =====================================================================

/**
 * Pattern strict enforcé côté rule create : `${blockerId}_${blockedId}`.
 * Garantit déduplication + idempotency + anti-spoofing au niveau doc-id.
 */
export function makeBlockId(blockerId: string, blockedId: string): string {
  return `${blockerId}_${blockedId}`;
}

// =====================================================================
// Error codes (machine-parseable)
// =====================================================================

export type BlockErrorCode =
  | 'self-block'
  | 'block-not-found'
  | 'not-blocker'
  | 'invalid-uid';

export class BlockError extends Error {
  constructor(
    public code: BlockErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'BlockError';
  }
}
