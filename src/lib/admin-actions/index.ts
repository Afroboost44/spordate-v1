/**
 * Phase 7 sub-chantier 5 commit 2/3 — Admin actions audit trail public API.
 *
 * Doctrine §9.sexies H : audit trail conservation 24 mois.
 *
 * Usage :
 *   import { logAdminAction, getAdminActions } from '@/lib/admin-actions';
 */

export {
  logAdminAction,
  type LogAdminActionInput,
  type LogAdminActionResult,
} from './logAdminAction';
export {
  getAdminActions,
  type GetAdminActionsOptions,
} from './getAdminActions';

// Errors + constants
export {
  AdminActionError,
  type AdminActionErrorCode,
  ADMIN_ACTION_TYPES,
  ADMIN_ACTION_TARGET_TYPES,
} from './_internal';

// Test seam
export { __setAdminActionsDbForTesting } from './_internal';
