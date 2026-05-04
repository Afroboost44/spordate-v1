/**
 * Phase 7 sub-chantier 2 commit 2/4 — Blocks service public API.
 *
 * Module index : re-exports services + types + DI seam pour tests.
 *
 * Usage Phase 7 sub-chantier 2 commits 3/4-4/4 (UI + integration) :
 *
 *   import { blockUser, unblockUser, isBlocked, getMutualBlockSet } from '@/lib/blocks';
 *
 * Cf. architecture.md §9.sexies E pour la doctrine block list complète.
 */

// Service functions
export { blockUser, type BlockUserInput, type BlockUserResult } from './blockUser';
export { unblockUser, type UnblockUserInput } from './unblockUser';
export { isBlocked } from './isBlocked';
export { getBlockedByMe } from './getBlockedByMe';
export { getBlockingMe } from './getBlockingMe';
export { getMutualBlockSet } from './getMutualBlockSet';

// Errors + helpers
export {
  BlockError,
  type BlockErrorCode,
  makeBlockId,
} from './_internal';

// Test seams (utilisés uniquement par tests/blocks/service.test.ts)
export { __setBlocksDbForTesting } from './_internal';
