/**
 * Phase 7 sub-chantier 1 commit 2/6 — Reviews service public API.
 *
 * Module index : re-exports des 6 services + types + DI seams pour tests.
 *
 * Usage Phase 7 sub-chantier 3-6 (UI + admin dashboard + email wiring) :
 *
 *   import { createReview, getReviewsByActivity, moderateReview } from '@/lib/reviews';
 *
 * Cf. architecture.md §9.sexies C pour la doctrine reviews complète.
 */

// Service functions
export { createReview, type CreateReviewInput, type CreateReviewResult } from './createReview';
export {
  getReviewsByActivity,
  getMyReviews,
  getReviewsByUser,
  getPendingReviewsForAdmin,
  type GetReviewsByActivityOptions,
  type GetReviewsByUserOptions,
  type GetPendingReviewsForAdminOptions,
} from './getReviews';
export { editReview, type EditReviewInput } from './editReview';
export {
  moderateReview,
  type ModerateReviewInput,
  type ModerateReviewResult,
  type ModerationDecision,
} from './moderateReview';
export { softDeleteReview, type SoftDeleteReviewInput } from './softDeleteReview';
export { awardReviewBonus, type AwardReviewBonusResult } from './awardReviewBonus';
export {
  isEligibleToReview,
  type IsEligibleToReviewInput,
  type EligibilityResult,
  type EligibilityReason,
} from './isEligibleToReview';
export {
  getReviewerProfiles,
  type ReviewerProfile,
} from './getReviewerProfiles';

// Constants + errors typés
export {
  ReviewError,
  REVIEW_BONUS_CREDITS,
  COOLING_OFF_HOURS,
  REVIEW_WINDOW_DAYS,
  EDITABLE_HOURS_AFTER_PUB,
  COMMENT_MIN_LENGTH,
  COMMENT_MAX_LENGTH,
  type ReviewErrorCode,
  type CreditsAdder,
} from './_internal';

// Test seams (utilisés uniquement par tests/reviews/service.test.ts)
export {
  __setReviewsDbForTesting,
  __setCreditsServiceForTesting,
} from './_internal';
