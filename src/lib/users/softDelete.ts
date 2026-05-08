/**
 * Phase 9 sub-chantier 6 commit 3/4 — softDeleteUser + restoreSoftDeletedUser.
 *
 * Doctrine architecture.md ligne 899 + §H : RGPD/nLPD Art. 17 droit à l'effacement.
 *   - Phase 7 = manuel admin (Bassi via Firebase Console)
 *   - Phase 9 SC6 c3 = UI auto user-facing avec grace period 30j (Q5=A)
 *
 * Pipeline softDeleteUser :
 *   1. Validate input (uid + reason ≤ 500 chars)
 *   2. Verify user exists + not already anonymized (cron banlist 24mo SC5 c3 idempotency)
 *   3. Verify pas déjà soft-deleted (anti-doublon)
 *   4. Update users/{uid} : softDeletedAt + softDeleteScheduledPurgeAt = +30j + softDeleteReason
 *   5. Cron purge-old-data anonymise PII automatiquement après grace 30j (cohérent banlist pattern)
 *
 * Pipeline restoreSoftDeletedUser :
 *   1. Validate ownership (caller responsibility upstream)
 *   2. Verify softDeletedAt set
 *   3. Verify grace pas expirée (softDeleteScheduledPurgeAt > now)
 *   4. Clear softDeletedAt + softDeleteScheduledPurgeAt + softDeleteReason
 *
 * Best-effort logout/sign-out post-update = caller responsibility (UI layer).
 *
 * @throws SoftDeleteError typed code = 'invalid-input' | 'already-soft-deleted' |
 *         'grace-expired' | 'not-soft-deleted' | 'not-found'
 */

import {
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserProfile } from '@/types/firestore';

// =====================================================================
// Constants
// =====================================================================

/** Q5=A : grace period 30j cohérent SC5 c3 banlist purge cadence. */
export const SOFT_DELETE_GRACE_DAYS = 30;

/** Limite caractères du champ reason (cohérent comment review 500 / report freeText 500). */
export const SOFT_DELETE_REASON_MAX_LENGTH = 500;

// =====================================================================
// DI seam (test injection cohérent SC5 c1 excuses pattern)
// =====================================================================

let _testDb: Firestore | null = null;

/** @internal — utilisé UNIQUEMENT par tests pour injecter Firestore connecté à l'emulator. */
export function __setSoftDeleteDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

function getSoftDeleteDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}

// =====================================================================
// Errors typed (cohérent ExcuseError / ReviewError pattern)
// =====================================================================

export type SoftDeleteErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'already-soft-deleted'
  | 'not-soft-deleted'
  | 'grace-expired'
  | 'already-anonymized'
  | 'forbidden';

export class SoftDeleteError extends Error {
  public readonly code: SoftDeleteErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: SoftDeleteErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'SoftDeleteError';
    this.code = code;
    this.details = details;
  }
}

// =====================================================================
// softDeleteUser
// =====================================================================

export interface SoftDeleteUserInput {
  uid: string;
  /** Raison libre 0-500 chars (optionnelle, audit). */
  reason?: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface SoftDeleteUserResult {
  uid: string;
  /** Timestamp ms de la grace deadline (uid + 30j). */
  scheduledPurgeAtMs: number;
}

export async function softDeleteUser(input: SoftDeleteUserInput): Promise<SoftDeleteUserResult> {
  if (!input.uid) {
    throw new SoftDeleteError('invalid-input', { uid: input.uid });
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length > SOFT_DELETE_REASON_MAX_LENGTH) {
    throw new SoftDeleteError('invalid-input', {
      reason: 'reason-too-long',
      length: reason.length,
      max: SOFT_DELETE_REASON_MAX_LENGTH,
    });
  }

  const now = input.now ?? new Date();
  const fbDb = getSoftDeleteDb();
  const ref = doc(fbDb, 'users', input.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new SoftDeleteError('not-found', { uid: input.uid });
  }
  const user = snap.data() as UserProfile;

  // Idempotency vs cron banlist 24mo (SC5 c3) — si déjà anonymized, skip
  if (user.anonymizedAt) {
    throw new SoftDeleteError('already-anonymized', { uid: input.uid });
  }

  // Anti-doublon : déjà soft-deleted, fail-safe pour UX (UI redirige vers restore)
  if (user.softDeletedAt) {
    throw new SoftDeleteError('already-soft-deleted', { uid: input.uid });
  }

  const scheduledPurgeAtMs = now.getTime() + SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {
    softDeletedAt: serverTimestamp(),
    softDeleteScheduledPurgeAt: Timestamp.fromMillis(scheduledPurgeAtMs),
  };
  if (reason.length > 0) {
    update.softDeleteReason = reason;
  }

  await updateDoc(ref, update);

  return { uid: input.uid, scheduledPurgeAtMs };
}

// =====================================================================
// restoreSoftDeletedUser
// =====================================================================

export interface RestoreSoftDeletedUserInput {
  uid: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

/**
 * Annule un soft delete pendant grace 30j.
 * @throws SoftDeleteError 'not-soft-deleted' | 'grace-expired' | 'not-found'
 */
export async function restoreSoftDeletedUser(
  input: RestoreSoftDeletedUserInput,
): Promise<void> {
  if (!input.uid) {
    throw new SoftDeleteError('invalid-input', { uid: input.uid });
  }
  const now = input.now ?? new Date();
  const fbDb = getSoftDeleteDb();
  const ref = doc(fbDb, 'users', input.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new SoftDeleteError('not-found', { uid: input.uid });
  }
  const user = snap.data() as UserProfile;

  if (!user.softDeletedAt) {
    throw new SoftDeleteError('not-soft-deleted', { uid: input.uid });
  }

  const purgeAtMs = user.softDeleteScheduledPurgeAt?.toMillis?.() ?? 0;
  if (now.getTime() > purgeAtMs) {
    throw new SoftDeleteError('grace-expired', {
      uid: input.uid,
      purgeAtMs,
      nowMs: now.getTime(),
    });
  }

  // Clear soft delete fields — explicitly null pour Firestore (UI peut filter softDeletedAt == null)
  await updateDoc(ref, {
    softDeletedAt: null,
    softDeleteScheduledPurgeAt: null,
    softDeleteReason: null,
  });
}

// =====================================================================
// isSoftDeleted helper (UI fast-check)
// =====================================================================

/**
 * Pure helper : retourne `true` si user.softDeletedAt set ET grace not expired.
 * UI peut afficher banner "Compte en cours de suppression — grace X jours".
 */
export function isSoftDeleted(user: UserProfile, now: Date = new Date()): boolean {
  if (!user.softDeletedAt) return false;
  const purgeAtMs = user.softDeleteScheduledPurgeAt?.toMillis?.() ?? 0;
  return now.getTime() <= purgeAtMs;
}

/**
 * Pure helper : retourne le nombre de jours restants avant purge auto cron.
 * Returns 0 si déjà expiré ou pas soft-deleted.
 */
export function softDeleteGraceDaysRemaining(user: UserProfile, now: Date = new Date()): number {
  if (!user.softDeletedAt) return 0;
  const purgeAtMs = user.softDeleteScheduledPurgeAt?.toMillis?.() ?? 0;
  const remainingMs = purgeAtMs - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}
