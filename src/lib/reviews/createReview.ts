/**
 * Phase 7 sub-chantier 1 commit 2/6 — createReview.
 *
 * Crée une review post-session avec validations doctrine §9.sexies C :
 * - Validation participation : reviewer + reviewee partagent ≥1 session passée de l'activity
 *   (partenaire de l'activity considéré comme attendu à toutes ses sessions)
 * - Cooling-off : refus si now < session.endAt + 24h (anti-impulsion à chaud)
 * - Fenêtre : refus si now > session.endAt + 7j (au-delà, contact support)
 * - Anti-duplicate : 1 review max par (activityId, reviewerId)
 * - Comment longueur 10-500 chars + rating ∈ [1..5]
 * - Auto-set selon rating :
 *     rating ≥ 3 → status='published', anonymized=false, publishedAt=now,
 *                  editableUntil=now+24h + trigger awardReviewBonus
 *     rating ≤ 2 → status='pending', anonymized=true, pas de
 *                  publishedAt/editableUntil (modération admin pré-pub)
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { Activity, Review, ReviewRating } from '@/types/firestore';
import {
  ReviewError,
  COMMENT_MAX_LENGTH,
  COMMENT_MIN_LENGTH,
  COOLING_OFF_HOURS,
  EDITABLE_HOURS_AFTER_PUB,
  REVIEW_WINDOW_DAYS,
  findLatestSharedPastSession,
  getReviewsDb,
  reviewAlreadyExists,
} from './_internal';
import { awardReviewBonus } from './awardReviewBonus';

export interface CreateReviewInput {
  activityId: string;
  reviewerId: string;
  revieweeId: string;
  rating: ReviewRating;
  comment: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface CreateReviewResult {
  reviewId: string;
  status: 'published' | 'pending';
  anonymized: boolean;
  bonusAwarded: boolean;
}

/**
 * Crée une review. Toute violation des doctrines § levée comme ReviewError typée.
 *
 * Workflow :
 * 1. Validation inputs (rating, comment, reviewerId != revieweeId)
 * 2. Anti-duplicate (1 review max par activityId+reviewerId)
 * 3. Vérif activity existe (lookup partnerId)
 * 4. Vérif participation : trouve la session partagée la plus récente passée
 * 5. Cooling-off + fenêtre 7j sur cette session
 * 6. Auto-set status/anonymized/dates selon rating
 * 7. Write Firestore
 * 8. Si rating ≥ 3 → trigger awardReviewBonus (best effort, n'annule pas l'écriture)
 *
 * @throws ReviewError avec code typé (review-not-found, cooling-off-not-elapsed, etc.)
 */
export async function createReview(input: CreateReviewInput): Promise<CreateReviewResult> {
  const now = input.now ?? new Date();

  // 1. Validation inputs basiques
  if (input.reviewerId === input.revieweeId) {
    throw new ReviewError('reviewer-equals-reviewee');
  }
  if (input.rating < 1 || input.rating > 5) {
    throw new ReviewError('rating-out-of-range', { rating: input.rating });
  }
  if (input.comment.length < COMMENT_MIN_LENGTH) {
    throw new ReviewError('comment-too-short', { length: input.comment.length, min: COMMENT_MIN_LENGTH });
  }
  if (input.comment.length > COMMENT_MAX_LENGTH) {
    throw new ReviewError('comment-too-long', { length: input.comment.length, max: COMMENT_MAX_LENGTH });
  }

  // 2. Anti-duplicate
  if (await reviewAlreadyExists(input.activityId, input.reviewerId)) {
    throw new ReviewError('review-already-exists', {
      activityId: input.activityId,
      reviewerId: input.reviewerId,
    });
  }

  // 3. Lookup activity via test seam Firestore (honore __setReviewsDbForTesting)
  const fbDbForActivity = getReviewsDb();
  const actSnap = await getDoc(doc(fbDbForActivity, 'activities', input.activityId));
  if (!actSnap.exists()) {
    throw new ReviewError('activity-not-found', { activityId: input.activityId });
  }
  const activity = actSnap.data() as Activity;

  // 4. Validation participation : trouve la session partagée la plus récente passée
  const sharedSession = await findLatestSharedPastSession(
    input.activityId,
    input.reviewerId,
    input.revieweeId,
    activity.partnerId,
    now,
  );
  if (!sharedSession) {
    throw new ReviewError('no-shared-session', {
      activityId: input.activityId,
      reviewerId: input.reviewerId,
      revieweeId: input.revieweeId,
    });
  }

  // 5. Cooling-off + fenêtre 7j relative à sharedSession.endAt
  const endsAtMs = sharedSession.endAt.toMillis();
  const coolingOffEndMs = endsAtMs + COOLING_OFF_HOURS * 60 * 60 * 1000;
  const windowEndMs = endsAtMs + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  if (nowMs < coolingOffEndMs) {
    throw new ReviewError('cooling-off-not-elapsed', {
      sharedSessionId: sharedSession.sessionId,
      sessionEndAtMs: endsAtMs,
      coolingOffEndMs,
      nowMs,
    });
  }
  if (nowMs > windowEndMs) {
    throw new ReviewError('review-window-closed', {
      sharedSessionId: sharedSession.sessionId,
      sessionEndAtMs: endsAtMs,
      windowEndMs,
      nowMs,
    });
  }

  // 6. Auto-set status/anonymized/dates selon rating (cohérent rules create defense-in-depth)
  const fbDb = getReviewsDb();
  const ref = doc(collection(fbDb, 'reviews'));
  const reviewId = ref.id;
  const isAutoPublish = input.rating >= 3;

  // Build payload pour rules : timestamps "request.time" sentinel via serverTimestamp
  // (résolus côté serveur, équivalent now au moment du write — required par rules)
  const baseDoc = {
    reviewId,
    activityId: input.activityId,
    reviewerId: input.reviewerId,
    revieweeId: input.revieweeId,
    rating: input.rating,
    comment: input.comment,
    creditsAwarded: false,
    createdAt: serverTimestamp(),
  };

  let payload;
  if (isAutoPublish) {
    const editableUntil = Timestamp.fromMillis(nowMs + EDITABLE_HOURS_AFTER_PUB * 60 * 60 * 1000);
    payload = {
      ...baseDoc,
      status: 'published' as const,
      anonymized: false,
      publishedAt: serverTimestamp(),
      editableUntil,
    };
  } else {
    payload = {
      ...baseDoc,
      status: 'pending' as const,
      anonymized: true,
      // pas de publishedAt ni editableUntil (set à la modération admin)
    };
  }

  // 7. Write
  await setDoc(ref, payload);

  // 8. Si auto-publish → award bonus (best effort)
  let bonusAwarded = false;
  if (isAutoPublish) {
    try {
      const result = await awardReviewBonus(reviewId);
      bonusAwarded = result.awarded;
    } catch (err) {
      // Log mais n'invalide pas la review créée — la review existe, le bonus
      // peut être réessayé manuellement Phase 8 admin UI ou par un job nightly.
      console.error('[createReview] awardReviewBonus failed (review still created)', {
        reviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    reviewId,
    status: payload.status,
    anonymized: payload.anonymized,
    bonusAwarded,
  };
}

// Re-export Review type for callers
export type { Review } from '@/types/firestore';
