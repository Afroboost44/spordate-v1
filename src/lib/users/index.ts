/**
 * Phase 9 sub-chantier 6 commit 3/4 — Users public API.
 *
 * Doctrine architecture.md §H : RGPD/nLPD Art. 17 droit à l'effacement.
 *
 * Usage :
 *   import { softDeleteUser, restoreSoftDeletedUser, SoftDeleteError } from '@/lib/users';
 */

export {
  softDeleteUser,
  restoreSoftDeletedUser,
  isSoftDeleted,
  softDeleteGraceDaysRemaining,
  SOFT_DELETE_GRACE_DAYS,
  SOFT_DELETE_REASON_MAX_LENGTH,
  SoftDeleteError,
  type SoftDeleteUserInput,
  type SoftDeleteUserResult,
  type RestoreSoftDeletedUserInput,
  type SoftDeleteErrorCode,
} from './softDelete';

// Test seam
export { __setSoftDeleteDbForTesting } from './softDelete';
