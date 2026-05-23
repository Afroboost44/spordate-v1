import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';
/**
 * Phase 9 sub-chantier 5 commit 3/4 — Helper recomputeRevieweeAverageRating (Admin SDK).
 *
 * Doctrine : aggregated rating denormalized sur UserProfile pour matching algo perf.
 * Recompute fire-and-forget post-publish review (called from /api/users/[id]/recompute-rating).
 *
 * Pipeline :
 *   1. Query reviews where revieweeId=X AND status='published' (Admin SDK bypass rules)
 *   2. Compute average rating + count
 *   3. Update users/{revieweeId}.averageRatingAsReviewee + reviewCountAsReviewee
 *
 * Best-effort : never throw — caller fire-and-forget logs warning.
 * Idempotent : recompute always returns same result for same Firestore state (no flag).
 *
 * DI seam pattern cohérent SC4 c4 retaliationDetector Admin SDK.
 *
 * @module
 */

// =====================================================================
// DI seam (test injection cohérent SC4 retaliationDetector pattern)
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDbOverride: any = null;

/** @internal — utilisé UNIQUEMENT par tests pour injecter Admin SDK Firestore emulator. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setRecomputeRatingAdminDbForTesting(testDb: any): void {
  _adminDbOverride = testDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAdminDb(): Promise<any> {
  if (_adminDbOverride) return _adminDbOverride;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  return getFirestore();
}

// =====================================================================
// recomputeRevieweeAverageRating
// =====================================================================

export interface RecomputeRatingResult {
  ok: boolean;
  averageRating?: number;
  reviewCount?: number;
  reason?: string;
}

/**
 * Recompute users/{revieweeId}.averageRatingAsReviewee + reviewCountAsReviewee.
 * Best-effort silent : ne throw jamais (caller fire-and-forget).
 */
export async function recomputeRevieweeAverageRating(
  revieweeId: string,
): Promise<RecomputeRatingResult> {
  if (!revieweeId) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    const db = await getAdminDb();

    // Query reviews published où user est reviewee
    const snap = await db
      .collection('reviews')
      .where('revieweeId', '==', revieweeId)
      .where('status', '==', 'published')
      .get();

    let total = 0;
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const docSnap of snap.docs as any[]) {
      const data = docSnap.data();
      const rating = typeof data?.rating === 'number' ? data.rating : null;
      if (rating === null) continue;
      total += rating;
      count++;
    }

    const averageRating = count > 0 ? total / count : 0;

    // Update users/{revieweeId} (Admin SDK bypass rules)
    await db.collection('users').doc(revieweeId).update({
      averageRatingAsReviewee: averageRating,
      reviewCountAsReviewee: count,
    });

    return { ok: true, averageRating, reviewCount: count };
  } catch (err) {
    // Best-effort silent — never throw
    console.warn('[recomputeRevieweeAverageRating] failed (non-blocking)', {
      revieweeId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      reason: `recompute-failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
