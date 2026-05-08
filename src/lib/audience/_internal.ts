/**
 * Spordateur — Phase 9 sub-chantier 6 commit 1/4
 * Female-safety audience helpers — pure logic, error codes, constants.
 *
 * Doctrine architecture.md §9.sexies G + ligne 898 : female-safety women-priority quota.
 *
 * Q1=A : enum existant Phase 7 SC0 c3 préservé (`'all' | 'women-only' | 'men-only' | 'mixed-priority-women'`).
 * Q3=A + Q4=A : hard enforcement booking pour 'women-only' + 'men-only' (gender mismatch → throw).
 * Q2=C : women-priority matching boost defer Phase 10 (Phase 9 = enforcement booking only).
 *
 * Pattern cohérent reviews/_internal.ts + reports/_internal.ts (constants + error class).
 */

import type { Activity, UserProfile } from '@/types/firestore';

// =====================================================================
// Constants
// =====================================================================

/** Q1=A : enum cohérent schema Phase 7 SC0 c3 (Activity.audienceType). */
export const AUDIENCE_TYPES = [
  'all',
  'women-only',
  'men-only',
  'mixed-priority-women',
] as const;

export type AudienceType = (typeof AUDIENCE_TYPES)[number];

/** Type guard pour validation rules + caller defensif. */
export function isAudienceType(value: unknown): value is AudienceType {
  return typeof value === 'string' && (AUDIENCE_TYPES as readonly string[]).includes(value);
}

// =====================================================================
// Errors typed (cohérent ReviewError / ReportError pattern Phase 7)
// =====================================================================

export type AudienceErrorCode = 'gender-mismatch' | 'invalid-audience-type' | 'invalid-input';

export class AudienceError extends Error {
  public readonly code: AudienceErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: AudienceErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'AudienceError';
    this.code = code;
    this.details = details;
  }
}

// =====================================================================
// isAllowedByAudience pure helper (Q3=A + Q4=A hard enforcement)
// =====================================================================

/**
 * Returns true si user.gender peut booker une activity avec audienceType donné.
 *
 * Q3=A + Q4=A — hard enforcement :
 *  - 'all' (default) → tout user autorisé
 *  - 'women-only' → uniquement gender='female'
 *  - 'men-only' → uniquement gender='male'
 *  - 'mixed-priority-women' → tout user autorisé (priority = boost matching Phase 10, defer Q2=C)
 *
 * Graceful degradation :
 *  - audienceType undefined OR null → treated as 'all' (rétro-compat)
 *  - audienceType invalide → fail-safe → false (defense-in-depth, ne devrait pas arriver via rules)
 *  - userGender undefined → treated as 'other' (allowed sauf 'women-only' et 'men-only')
 */
export function isAllowedByAudience(
  userGender: UserProfile['gender'] | undefined | null,
  audienceType: Activity['audienceType'] | undefined | null,
): boolean {
  // Default 'all' si undefined/null (rétro-compat schema)
  const effectiveAudience = audienceType ?? 'all';

  // Defense-in-depth : valeur invalide → fail-safe deny
  if (!isAudienceType(effectiveAudience)) {
    return false;
  }

  switch (effectiveAudience) {
    case 'all':
      return true;
    case 'mixed-priority-women':
      // Q2=C : pas d'enforcement booking — boost matching defer Phase 10
      return true;
    case 'women-only':
      return userGender === 'female';
    case 'men-only':
      return userGender === 'male';
    default:
      // TS exhaustiveness check — unreachable
      return false;
  }
}

/**
 * Variante throw : utilisée par bookSession SC6 c2 pour mapping HTTP propre.
 * @throws AudienceError 'gender-mismatch' si pas autorisé.
 */
export function assertAllowedByAudience(
  userGender: UserProfile['gender'] | undefined | null,
  audienceType: Activity['audienceType'] | undefined | null,
): void {
  if (!isAllowedByAudience(userGender, audienceType)) {
    throw new AudienceError('gender-mismatch', {
      userGender,
      audienceType,
    });
  }
}
