/**
 * Phase 7 sub-chantier 4 commit 1/4 — Sessions service public API.
 *
 * Module index — exposé minimal Phase 7 (uniquement getCoInscribedConflicts).
 * Phase 8+ : extension probable avec helpers session-side additionnels.
 */

export {
  getCoInscribedConflicts,
  type CoInscribedConflict,
  type GetCoInscribedConflictsOptions,
} from './getCoInscribedConflicts';

// Test seam (utilisé uniquement par tests)
export { __setSessionsLibDbForTesting } from './_internal';
