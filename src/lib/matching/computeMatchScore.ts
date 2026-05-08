/**
 * Phase 9 sub-chantier 5 commit 3/4 — Pure helper computeMatchScore (extracted from /discovery inline).
 *
 * Doctrine architecture.md ligne 896 : visibility réduite algo matching score reviews <3.5★.
 *
 * Logique :
 *   1. Sport scoring : +30 par sport en commun + 20 même level OU +10 même sport diff level
 *   2. City scoring : +15 si même ville
 *   3. Cap à 100
 *   4. Phase 9 SC5 c3/4 : si applyRatingPenalty=true (default) AND candidate a >= 3 reviews
 *      AND averageRating < 3.5 → score *= 0.7 (Q2=B modéré, score réduit pas écrasé)
 *
 * Constants exportées :
 *  - LOW_RATING_THRESHOLD = 3.5 (Q3=A)
 *  - LOW_RATING_MULTIPLIER = 0.7 (Q2=B)
 *  - LOW_RATING_MIN_REVIEWS = 3 (Q4=B anti-faux-positif)
 *
 * Q5=B opts.applyRatingPenalty pour testabilité + admin override (default true Phase 9).
 */

import type { UserProfile, SportEntry } from '@/types/firestore';

// =====================================================================
// Constants (exportées pour tests + admin override)
// =====================================================================

/** Q3=A : threshold below which ratings reduce visibility. */
export const LOW_RATING_THRESHOLD = 3.5;

/** Q2=B : multiplier modéré (score × 0.7) — visibilité réduite, pas exclusion. */
export const LOW_RATING_MULTIPLIER = 0.7;

/** Q4=B : min reviews avant pénalité (anti-faux-positif sur 1-2 reviews atypiques). */
export const LOW_RATING_MIN_REVIEWS = 3;

// =====================================================================
// Types
// =====================================================================

export interface ComputeMatchScoreOptions {
  /** Phase 9 SC5 c3/4 — apply low rating penalty (default true Phase 9).
   *  Opt-out via false : tests + admin override + future polish UX flag. */
  applyRatingPenalty?: boolean;
}

// =====================================================================
// computeMatchScore (pure function)
// =====================================================================

/**
 * Score matching ∈ [0, 100] — sport en commun + level + city + Q3=A penalty rating low.
 *
 * Pure function : no Firestore calls, no side-effects. Caller (discovery page) doit
 * pré-charger UserProfile.averageRatingAsReviewee + reviewCountAsReviewee (denorm fields).
 *
 * @param myProfile  Profil de l'user courant (peut être null → score neutre 50)
 * @param candidate  Profil candidat à matcher
 * @param opts       Options { applyRatingPenalty?: boolean = true }
 * @returns score ∈ [0, 100] (entier)
 */
export function computeMatchScore(
  myProfile: UserProfile | null,
  candidate: UserProfile,
  opts: ComputeMatchScoreOptions = {},
): number {
  // Default neutre 50 si pas de profil ou pas de sports défini
  if (!myProfile || !myProfile.sports || myProfile.sports.length === 0) {
    return 50;
  }

  const mySports = new Set(myProfile.sports.map((s: SportEntry) => s.name));
  const theirSports = candidate.sports || [];

  let score = 0;

  for (const sport of theirSports) {
    if (mySports.has(sport.name)) {
      // Bonus base pour sport commun
      score += 30;

      const mySport = myProfile.sports.find((s: SportEntry) => s.name === sport.name);
      if (mySport && mySport.level === sport.level) {
        score += 20; // Same level = perfect match
      } else if (mySport) {
        score += 10; // Different level but same sport
      }
    }
  }

  // Same city bonus
  if (myProfile.city && candidate.city && myProfile.city === candidate.city) {
    score += 15;
  }

  // Cap at 100 (avant pénalité)
  score = Math.min(score, 100);

  // Phase 9 SC5 c3/4 — Q2=B + Q3=A + Q4=B : multiplier × 0.7 si rating < 3.5 + ≥ 3 reviews
  const applyRatingPenalty = opts.applyRatingPenalty !== false; // default true
  if (
    applyRatingPenalty &&
    typeof candidate.averageRatingAsReviewee === 'number' &&
    typeof candidate.reviewCountAsReviewee === 'number' &&
    candidate.reviewCountAsReviewee >= LOW_RATING_MIN_REVIEWS &&
    candidate.averageRatingAsReviewee < LOW_RATING_THRESHOLD
  ) {
    score = Math.round(score * LOW_RATING_MULTIPLIER);
  }

  return score;
}
