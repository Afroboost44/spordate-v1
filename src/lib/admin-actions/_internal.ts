/**
 * Spordateur — Phase 7 sub-chantier 5 commit 2/3
 * Audit trail admin actions — internal helpers, DI seam, error codes.
 *
 * Doctrine §9.sexies H : collection séparée `adminActions/{actionId}` pour audit
 * traçabilité 24 mois (vs sub-collection users — query plus simple, filtres temporels propres).
 *
 * Pattern DI seam cohérent reports/_internal.ts + blocks/_internal.ts.
 */

import { db } from '@/lib/firebase';
import { type Firestore } from 'firebase/firestore';
import type { AdminActionType, AdminActionTargetType } from '@/types/firestore';

// =====================================================================
// DI seam (test injection)
// =====================================================================

let _testDb: Firestore | null = null;

export function __setAdminActionsDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

export function getAdminActionsDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}

// =====================================================================
// Constants — enums (cohérent rule firestore + UI Phase 9 future)
// =====================================================================

export const ADMIN_ACTION_TYPES: AdminActionType[] = [
  'review_publish',
  'review_reject',
  'report_dismiss',
  'report_sustain',
  'sanction_overturn',
  'appeal_resolve_upheld',
  'appeal_resolve_overturned',
  'sanction_manual_create',
  'leak_escalation_l4', // Phase 8 SC2 commit 5/6 — auto-escalation system
  'auto_refund_partner_no_show', // Phase 8 SC5 c4/5 — refund auto level 3 partner no-show
];

export const ADMIN_ACTION_TARGET_TYPES: AdminActionTargetType[] = [
  'review',
  'report',
  'sanction',
  'user', // Phase 8 SC2 commit 5/6 — target user pour leak_escalation_l4
];

// =====================================================================
// Error codes
// =====================================================================

export type AdminActionErrorCode = 'invalid-input';

export class AdminActionError extends Error {
  constructor(
    public code: AdminActionErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AdminActionError';
  }
}
