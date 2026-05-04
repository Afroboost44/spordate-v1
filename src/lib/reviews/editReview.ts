/**
 * Phase 7 sub-chantier 1 commit 2/6 — editReview.
 *
 * Edit une review existante par son auteur dans la fenêtre éditable (24h post-pub).
 * Cohérent rule update : seuls comment + rating mutables. Cross-tier rating change
 * (3-5 ↔ 1-2) interdit (anti re-modération bypass post-pub).
 *
 * Pour un user qui veut passer 5★ → 1★ : doit soft-delete + re-créer (re-modération
 * pré-pub appliquée).
 */

import { Timestamp, doc, getDoc, updateDoc } from 'firebase/firestore';
import type { Review, ReviewRating } from '@/types/firestore';
import { ReviewError, COMMENT_MAX_LENGTH, COMMENT_MIN_LENGTH, getReviewsDb } from './_internal';

export interface EditReviewInput {
  reviewId: string;
  /** Auteur supposé (vérifié vs review.reviewerId). */
  reviewerId: string;
  /** Nouveau commentaire (mutable, sous validation). */
  comment?: string;
  /** Nouvelle note (mutable, mais cross-tier interdit). */
  rating?: ReviewRating;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

/**
 * Edit review.
 *
 * @throws ReviewError code typé :
 *   - 'review-not-found'
 *   - 'not-reviewer' (reviewerId ne correspond pas à l'auteur)
 *   - 'review-not-published' (pending non éditable, doit attendre modération)
 *   - 'edit-window-closed' (now > editableUntil)
 *   - 'cross-tier-rating-change' (transition 3-5 ↔ 1-2 interdite)
 *   - 'invalid-fields' (ni comment ni rating fourni)
 *   - 'comment-too-short' / 'comment-too-long' / 'rating-out-of-range'
 */
export async function editReview(input: EditReviewInput): Promise<void> {
  const now = input.now ?? new Date();

  if (input.comment === undefined && input.rating === undefined) {
    throw new ReviewError('invalid-fields', { hint: 'au moins comment OU rating requis' });
  }

  // Validation comment si fourni
  if (input.comment !== undefined) {
    if (input.comment.length < COMMENT_MIN_LENGTH) {
      throw new ReviewError('comment-too-short', {
        length: input.comment.length,
        min: COMMENT_MIN_LENGTH,
      });
    }
    if (input.comment.length > COMMENT_MAX_LENGTH) {
      throw new ReviewError('comment-too-long', {
        length: input.comment.length,
        max: COMMENT_MAX_LENGTH,
      });
    }
  }

  // Validation rating si fourni
  if (input.rating !== undefined && (input.rating < 1 || input.rating > 5)) {
    throw new ReviewError('rating-out-of-range', { rating: input.rating });
  }

  const fbDb = getReviewsDb();
  const ref = doc(fbDb, 'reviews', input.reviewId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReviewError('review-not-found', { reviewId: input.reviewId });
  }
  const review = snap.data() as Review;

  // Vérif auteur
  if (review.reviewerId !== input.reviewerId) {
    throw new ReviewError('not-reviewer', {
      reviewId: input.reviewId,
      actualReviewerId: review.reviewerId,
    });
  }

  // Vérif status published
  if (review.status !== 'published') {
    throw new ReviewError('review-not-published', {
      reviewId: input.reviewId,
      status: review.status,
    });
  }

  // Vérif fenêtre éditable
  if (!review.editableUntil) {
    throw new ReviewError('edit-window-closed', {
      reviewId: input.reviewId,
      reason: 'editableUntil-missing',
    });
  }
  if (now.getTime() >= review.editableUntil.toMillis()) {
    throw new ReviewError('edit-window-closed', {
      reviewId: input.reviewId,
      editableUntilMs: review.editableUntil.toMillis(),
      nowMs: now.getTime(),
    });
  }

  // Cross-tier guard : rating 3-5 ↔ 1-2 interdit
  // Cohérent rule update : (resource.rating >= 3 && request.rating >= 3) || (both <= 2)
  if (input.rating !== undefined) {
    const oldTier = review.rating >= 3 ? 'high' : 'low';
    const newTier = input.rating >= 3 ? 'high' : 'low';
    if (oldTier !== newTier) {
      throw new ReviewError('cross-tier-rating-change', {
        reviewId: input.reviewId,
        oldRating: review.rating,
        newRating: input.rating,
        hint: 'Pour passer 3-5★ → 1-2★ ou inverse, soft-delete + re-create (re-modération appliquée)',
      });
    }
  }

  // Build updates partiels (seuls comment + rating mutables)
  const updates: { comment?: string; rating?: ReviewRating } = {};
  if (input.comment !== undefined) updates.comment = input.comment;
  if (input.rating !== undefined) updates.rating = input.rating;

  await updateDoc(ref, updates);
}
