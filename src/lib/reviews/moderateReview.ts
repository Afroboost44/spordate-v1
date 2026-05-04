/**
 * Phase 7 sub-chantier 1 commit 2/6 — moderateReview.
 *
 * Admin transitionne une review pending → published OU pending → rejected.
 * Cas d'usage : reviews 1-2★ qui sont créées en status='pending' (modération
 * pré-publication par doctrine §9.sexies C.1).
 *
 * Si decision='publish' :
 *   - status = 'published'
 *   - publishedAt = now
 *   - editableUntil = now + 24h
 *   - moderatedBy = adminId
 *   - moderatedAt = now
 *   - Trigger awardReviewBonus (anti-double via creditsAwarded)
 *
 * Si decision='reject' :
 *   - status = 'rejected'
 *   - moderatedBy = adminId
 *   - moderatedAt = now
 *   - PAS de bonus crédits (review rejetée, pas méritée)
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler. Le service
 * ne fait pas le check (rule firestore + admin UI le font).
 */

import { Timestamp, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Review } from '@/types/firestore';
import { ReviewError, EDITABLE_HOURS_AFTER_PUB, getReviewsDb } from './_internal';
import { awardReviewBonus } from './awardReviewBonus';

export type ModerationDecision = 'publish' | 'reject';

export interface ModerateReviewInput {
  reviewId: string;
  decision: ModerationDecision;
  /** Admin uid qui prend la décision. */
  adminId: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface ModerateReviewResult {
  newStatus: 'published' | 'rejected';
  bonusAwarded: boolean;
}

export async function moderateReview(input: ModerateReviewInput): Promise<ModerateReviewResult> {
  const now = input.now ?? new Date();

  if (input.decision !== 'publish' && input.decision !== 'reject') {
    throw new ReviewError('invalid-decision', { decision: input.decision });
  }

  const fbDb = getReviewsDb();
  const ref = doc(fbDb, 'reviews', input.reviewId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReviewError('review-not-found', { reviewId: input.reviewId });
  }
  const review = snap.data() as Review;

  if (review.status !== 'pending') {
    throw new ReviewError('review-not-pending', {
      reviewId: input.reviewId,
      status: review.status,
    });
  }

  if (input.decision === 'publish') {
    const editableUntil = Timestamp.fromMillis(
      now.getTime() + EDITABLE_HOURS_AFTER_PUB * 60 * 60 * 1000,
    );
    await updateDoc(ref, {
      status: 'published',
      publishedAt: serverTimestamp(),
      editableUntil,
      moderatedBy: input.adminId,
      moderatedAt: serverTimestamp(),
    });

    // Trigger bonus (best effort — la modération réussit même si bonus crash)
    let bonusAwarded = false;
    try {
      const result = await awardReviewBonus(input.reviewId);
      bonusAwarded = result.awarded;
    } catch (err) {
      console.error('[moderateReview] awardReviewBonus failed (review still published)', {
        reviewId: input.reviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { newStatus: 'published', bonusAwarded };
  }

  // decision === 'reject'
  await updateDoc(ref, {
    status: 'rejected',
    moderatedBy: input.adminId,
    moderatedAt: serverTimestamp(),
  });
  return { newStatus: 'rejected', bonusAwarded: false };
}
