/**
 * Spordateur — Phase 9 sub-chantier 5 commit 1/4
 * Excuses pré-session — internal helpers, DI seam, constants, error codes.
 *
 * Doctrine architecture.md ligne 895 + 2096 :
 *   « Excuse pré-session ≥2h avant = no-show pas comptabilisé »
 *
 * Q1=A : window 2h hardcoded Phase 9 (KISS — env var Phase 10 si volume justifie).
 *
 * Pattern DI seam cohérent reports/_internal.ts + admin-actions/_internal.ts.
 */

import { db } from '@/lib/firebase';
import { type Firestore } from 'firebase/firestore';

// =====================================================================
// Constants (Q1=A hardcoded Phase 9)
// =====================================================================

/** Q1=A : excuse créée ≥ 2h avant session.startAt = grace (no-show skip threshold). */
export const EXCUSE_WINDOW_HOURS_BEFORE_SESSION = 2;

/** Limite caractères du champ reason (cohérent comment review 10-500 / report freeText 500). */
export const EXCUSE_REASON_MAX_LENGTH = 300;

// =====================================================================
// DI seam (test injection)
// =====================================================================

let _testDb: Firestore | null = null;

/** @internal — utilisé UNIQUEMENT par les tests pour injecter un Firestore connecté à l'emulator. */
export function __setExcusesDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

export function getExcusesDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}

// =====================================================================
// Errors typed (cohérent ReviewError / ReportError pattern Phase 7)
// =====================================================================

export type ExcuseErrorCode =
  | 'invalid-input'
  | 'session-not-found'
  | 'not-confirmed-booker'
  | 'window-closed'
  | 'already-excused'
  | 'reason-too-long';

export class ExcuseError extends Error {
  public readonly code: ExcuseErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: ExcuseErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'ExcuseError';
    this.code = code;
    this.details = details;
  }
}
