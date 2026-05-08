/**
 * Phase 9 sub-chantier 5 commit 3/4 — Matching algo public API.
 *
 * Doctrine architecture.md ligne 896 : visibility réduite algo matching score reviews <3.5★.
 *
 * Usage :
 *   import { computeMatchScore, LOW_RATING_THRESHOLD } from '@/lib/matching';
 */

export {
  computeMatchScore,
  LOW_RATING_THRESHOLD,
  LOW_RATING_MULTIPLIER,
  LOW_RATING_MIN_REVIEWS,
  type ComputeMatchScoreOptions,
} from './computeMatchScore';

export {
  recomputeRevieweeAverageRating,
  __setRecomputeRatingAdminDbForTesting,
  type RecomputeRatingResult,
} from './recomputeRating';
