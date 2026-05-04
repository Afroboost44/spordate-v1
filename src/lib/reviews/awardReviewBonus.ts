/**
 * Phase 7 sub-chantier 1 commit 2/6 — awardReviewBonus.
 *
 * Alloue le bonus 5 crédits chat au reviewer dès que sa review passe à 'published'.
 * Atomic transaction : check creditsAwarded == false → set true + crédite +5.
 * Anti-double via le flag creditsAwarded (idempotency).
 *
 * Trigger automatique :
 * - createReview avec rating ≥ 3 (auto-publish)
 * - moderateReview decision='publish' (admin approuve une review 1-2★)
 */

import { doc, runTransaction } from 'firebase/firestore';
import type { Review } from '@/types/firestore';
import {
  ReviewError,
  REVIEW_BONUS_CREDITS,
  getCreditsAdder,
  getReviewsDb,
} from './_internal';

export interface AwardReviewBonusResult {
  awarded: boolean;
  creditsAdded: number;
  newBalance?: number;
}

/**
 * Alloue le bonus crédits review au reviewer.
 *
 * @param reviewId ID de la review qui vient d'être publiée
 * @returns { awarded: true, creditsAdded: 5, newBalance } si succès
 *          { awarded: false, creditsAdded: 0 } si déjà alloué (idempotency)
 * @throws ReviewError('review-not-found') si la review n'existe pas
 * @throws ReviewError('review-not-published') si status != 'published'
 */
export async function awardReviewBonus(reviewId: string): Promise<AwardReviewBonusResult> {
  const fbDb = getReviewsDb();
  const ref = doc(fbDb, 'reviews', reviewId);

  // Phase 1 : tx pour set creditsAwarded=true atomically (anti-double)
  const reviewSnapshot = await runTransaction(fbDb, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new ReviewError('review-not-found', { reviewId });
    }
    const review = snap.data() as Review;
    if (review.status !== 'published') {
      throw new ReviewError('review-not-published', { reviewId, status: review.status });
    }
    if (review.creditsAwarded) {
      // Idempotent : ne fait rien, retourne signal "déjà alloué"
      return { alreadyAwarded: true, review };
    }
    tx.update(ref, { creditsAwarded: true });
    return { alreadyAwarded: false, review };
  });

  if (reviewSnapshot.alreadyAwarded) {
    return { awarded: false, creditsAdded: 0 };
  }

  // Phase 2 : créditer +5 chat credits au reviewer (hors-tx pour éviter
  // contention sur users/{uid} qui peut avoir d'autres opérations concurrentes)
  const addCredits = getCreditsAdder();
  const newBalance = await addCredits(
    reviewSnapshot.review.reviewerId,
    REVIEW_BONUS_CREDITS,
    'review_bonus',
    `Bonus pour review (${reviewId})`,
    reviewId,
  );

  return {
    awarded: true,
    creditsAdded: REVIEW_BONUS_CREDITS,
    newBalance,
  };
}
