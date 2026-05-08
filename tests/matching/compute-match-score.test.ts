/**
 * Tests Phase 9 sub-chantier 5 commit 3/4 — computeMatchScore extension multiplier reviews <3.5★.
 *
 * Exécution :
 *   npm run test:matching:compute-score
 *
 * Pattern : pure unit MS1-MS4 (no emulator) + emulator integration bonus recompute helper.
 *
 * Couverture (MS1-MS4 + bonus) :
 *   MS1  candidate.averageRatingAsReviewee undefined → score normal (graceful degradation)
 *   MS2  candidate.averageRatingAsReviewee=4.2 reviewCount=10 → score normal (≥ 3.5)
 *   MS3  candidate.averageRatingAsReviewee=3.0 reviewCount=10 → score × 0.7 (Q2=B + Q3=A)
 *   MS4  candidate.averageRatingAsReviewee=2.0 reviewCount=2 → score normal (anti-faux-positif Q4=B min 3)
 *
 * Bonus : applyRatingPenalty=false opt-out → score normal même rating < 3.5
 * Bonus : 0 sport en commun + low rating → score 0 (multiplier × 0 = 0)
 * Bonus : recomputeRevieweeAverageRating Admin SDK emulator integration
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-matching';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-matching';

import {
  computeMatchScore,
  LOW_RATING_MULTIPLIER,
  LOW_RATING_THRESHOLD,
  LOW_RATING_MIN_REVIEWS,
  recomputeRevieweeAverageRating,
  __setRecomputeRatingAdminDbForTesting,
} from '../../src/lib/matching';
import type { UserProfile, SportEntry } from '../../src/types/firestore';
import type { Timestamp } from 'firebase-admin/firestore';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Fixture helpers
// =====================================================================

function makeUser(opts: Partial<UserProfile> & { uid: string }): UserProfile {
  return {
    uid: opts.uid,
    email: opts.email ?? `${opts.uid}@test.local`,
    displayName: opts.displayName ?? opts.uid,
    photoURL: opts.photoURL ?? '',
    bio: opts.bio ?? '',
    gender: opts.gender ?? 'other',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    birthDate: opts.birthDate ?? ({ toMillis: () => 0 } as any),
    city: opts.city ?? 'Genève',
    canton: opts.canton ?? 'GE',
    sports: opts.sports ?? [],
    credits: opts.credits ?? 0,
    referralCode: opts.referralCode ?? '',
    referredBy: opts.referredBy ?? '',
    isCreator: opts.isCreator ?? false,
    role: opts.role ?? 'user',
    isPremium: opts.isPremium ?? false,
    fcmToken: opts.fcmToken ?? '',
    language: opts.language ?? 'fr',
    onboardingComplete: opts.onboardingComplete ?? true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lastActive: opts.lastActive ?? ({ toMillis: () => 0 } as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createdAt: opts.createdAt ?? ({ toMillis: () => 0 } as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updatedAt: opts.updatedAt ?? ({ toMillis: () => 0 } as any),
    averageRatingAsReviewee: opts.averageRatingAsReviewee,
    reviewCountAsReviewee: opts.reviewCountAsReviewee,
  } as UserProfile;
}

function sport(name: string, level: SportEntry['level']): SportEntry {
  return { name, level };
}

// =====================================================================

async function main(): Promise<void> {
  // Common myProfile : Yoga intermediate + Pilates beginner, Genève
  const ME = makeUser({
    uid: 'me',
    sports: [sport('Yoga', 'intermediate'), sport('Pilates', 'beginner')],
    city: 'Genève',
  });

  // ===================================================================
  // MS1 : averageRatingAsReviewee undefined → score normal (graceful degradation)
  // ===================================================================
  section('MS1 averageRatingAsReviewee undefined → score normal');
  {
    const candidate = makeUser({
      uid: 'cand_ms1',
      sports: [sport('Yoga', 'intermediate'), sport('Pilates', 'advanced')],
      city: 'Genève',
      // averageRatingAsReviewee undefined
    });
    const score = computeMatchScore(ME, candidate);
    // Yoga common + same level → 30 + 20 = 50
    // Pilates common + diff level → 30 + 10 = 40
    // Same city → 15
    // Total = 105 → cap 100
    if (score === 100) {
      pass('MS1 score=100 (cap, no rating penalty appliquée)');
    } else {
      fail('MS1 expected 100', { score });
    }
  }

  // ===================================================================
  // MS2 : averageRating=4.2 + count=10 → score normal (>= 3.5)
  // ===================================================================
  section('MS2 averageRating=4.2 reviewCount=10 → score normal (≥ 3.5)');
  {
    const candidate = makeUser({
      uid: 'cand_ms2',
      sports: [sport('Yoga', 'intermediate')],
      city: 'Genève',
      averageRatingAsReviewee: 4.2,
      reviewCountAsReviewee: 10,
    });
    const score = computeMatchScore(ME, candidate);
    // Yoga common + same level → 30 + 20 = 50
    // Same city → 15
    // Total = 65 (no penalty)
    if (score === 65) {
      pass('MS2 score=65 (good rating, no penalty)');
    } else {
      fail('MS2 expected 65', { score });
    }
  }

  // ===================================================================
  // MS3 : averageRating=3.0 + count=10 → score × 0.7 (Q2=B + Q3=A)
  // ===================================================================
  section('MS3 averageRating=3.0 reviewCount=10 → score × 0.7 (Q2=B + Q3=A)');
  {
    const candidate = makeUser({
      uid: 'cand_ms3',
      sports: [sport('Yoga', 'intermediate')],
      city: 'Genève',
      averageRatingAsReviewee: 3.0,
      reviewCountAsReviewee: 10,
    });
    const score = computeMatchScore(ME, candidate);
    // Base score = 65 (Yoga 50 + city 15)
    // × 0.7 → 45.5 → round 46
    if (score === Math.round(65 * LOW_RATING_MULTIPLIER)) {
      pass(`MS3 score=${score} (× ${LOW_RATING_MULTIPLIER} appliqué Q2=B)`);
    } else {
      fail('MS3 unexpected', { score, expected: Math.round(65 * LOW_RATING_MULTIPLIER) });
    }
  }

  // ===================================================================
  // MS4 : averageRating=2.0 + count=2 → score normal (anti-faux-positif Q4=B min 3)
  // ===================================================================
  section('MS4 averageRating=2.0 reviewCount=2 → score normal (anti-faux-positif Q4=B min 3)');
  {
    const candidate = makeUser({
      uid: 'cand_ms4',
      sports: [sport('Yoga', 'intermediate')],
      city: 'Genève',
      averageRatingAsReviewee: 2.0,
      reviewCountAsReviewee: 2, // < LOW_RATING_MIN_REVIEWS=3
    });
    const score = computeMatchScore(ME, candidate);
    // Base score = 65, no penalty (count < 3 → anti-faux-positif Q4=B)
    if (score === 65) {
      pass(`MS4 score=65 (count=2 < ${LOW_RATING_MIN_REVIEWS} → no penalty)`);
    } else {
      fail('MS4 expected 65 (anti-FP)', { score });
    }
  }

  // ===================================================================
  // Bonus : applyRatingPenalty=false opt-out → score normal même rating < 3.5
  // ===================================================================
  section('Bonus applyRatingPenalty=false opt-out → score normal même rating < 3.5');
  {
    const candidate = makeUser({
      uid: 'cand_bonus_optout',
      sports: [sport('Yoga', 'intermediate')],
      city: 'Genève',
      averageRatingAsReviewee: 2.0,
      reviewCountAsReviewee: 10,
    });
    const scoreWithPenalty = computeMatchScore(ME, candidate);
    const scoreOptOut = computeMatchScore(ME, candidate, { applyRatingPenalty: false });
    if (scoreWithPenalty < 65 && scoreOptOut === 65) {
      pass(`Bonus opt-out → ${scoreOptOut} (sans pénalité), avec → ${scoreWithPenalty}`);
    } else {
      fail('Bonus opt-out should restore full score', {
        scoreWithPenalty,
        scoreOptOut,
      });
    }
  }

  // ===================================================================
  // Bonus : 0 sport en commun + low rating → score 0 (multiplier × 0 = 0)
  // ===================================================================
  section('Bonus 0 sport en commun + low rating → score 0 (no negative)');
  {
    const candidate = makeUser({
      uid: 'cand_bonus_zero',
      sports: [sport('Tennis', 'beginner')], // pas en commun avec ME
      city: 'Lausanne', // pas same city
      averageRatingAsReviewee: 2.0,
      reviewCountAsReviewee: 10,
    });
    const score = computeMatchScore(ME, candidate);
    if (score === 0) {
      pass('Bonus score=0 (no sport common + city diff + low rating ×0.7 = 0)');
    } else {
      fail('Bonus expected 0', { score });
    }
  }

  // ===================================================================
  // Bonus : myProfile null → 50 neutre (cohérent existing behavior)
  // ===================================================================
  section('Bonus myProfile null → 50 neutre');
  {
    const candidate = makeUser({
      uid: 'cand_bonus_null',
      sports: [sport('Yoga', 'intermediate')],
      city: 'Genève',
      averageRatingAsReviewee: 2.0,
      reviewCountAsReviewee: 10,
    });
    const score = computeMatchScore(null, candidate);
    if (score === 50) {
      pass('Bonus null myProfile → 50 (neutre, no rating penalty appliquée car early return)');
    } else {
      fail('Bonus null should be 50', { score });
    }
  }

  // ===================================================================
  // Bonus : threshold exact 3.5 → no penalty (boundary inclusive)
  // ===================================================================
  section('Bonus rating exact 3.5 (threshold boundary) → no penalty');
  {
    const candidate = makeUser({
      uid: 'cand_boundary',
      sports: [sport('Yoga', 'intermediate')],
      city: 'Genève',
      averageRatingAsReviewee: LOW_RATING_THRESHOLD, // exactement 3.5
      reviewCountAsReviewee: 10,
    });
    const score = computeMatchScore(ME, candidate);
    // 3.5 < 3.5 = false → no penalty (inclusive threshold)
    if (score === 65) {
      pass('Bonus threshold 3.5 boundary → 65 (inclusive, no penalty)');
    } else {
      fail('Bonus boundary should be 65', { score });
    }
  }

  // ===================================================================
  // Bonus integration : recomputeRevieweeAverageRating Admin SDK emulator
  // ===================================================================
  section('Bonus integration recomputeRevieweeAverageRating Admin SDK emulator');
  {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore, Timestamp: AdminTimestamp } = await import('firebase-admin/firestore');
    if (!getApps().length) {
      initializeApp({ projectId: 'demo-spordate-matching' });
    }
    const adminDb = getFirestore();
    __setRecomputeRatingAdminDbForTesting(adminDb);

    // Cleanup
    for (const col of ['users', 'reviews']) {
      const snap = await adminDb.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }

    const REVIEWEE = 'user_reviewee_int';
    await adminDb.collection('users').doc(REVIEWEE).set({
      uid: REVIEWEE,
      email: 'reviewee@test.local',
      displayName: 'Reviewee',
      role: 'user',
    });

    // Seed 4 published reviews : 5,4,3,2 (avg = 3.5)
    for (const [i, rating] of [5, 4, 3, 2].entries()) {
      await adminDb.collection('reviews').doc(`rev_int_${i}`).set({
        reviewId: `rev_int_${i}`,
        activityId: 'activity_int',
        reviewerId: `reviewer_${i}`,
        revieweeId: REVIEWEE,
        rating,
        comment: 'test review integration',
        status: 'published',
        anonymized: false,
        creditsAwarded: false,
        createdAt: AdminTimestamp.now() as unknown as Timestamp,
      });
    }

    // 1 pending review (NOT counted)
    await adminDb.collection('reviews').doc('rev_int_pending').set({
      reviewId: 'rev_int_pending',
      activityId: 'activity_int',
      reviewerId: 'reviewer_pending',
      revieweeId: REVIEWEE,
      rating: 1,
      comment: 'pending review should not count',
      status: 'pending',
      anonymized: true,
      creditsAwarded: false,
      createdAt: AdminTimestamp.now() as unknown as Timestamp,
    });

    const result = await recomputeRevieweeAverageRating(REVIEWEE);
    if (result.ok && result.reviewCount === 4 && result.averageRating === 3.5) {
      pass(`Bonus integration recompute → count=4 + avg=3.5 (pending exclus)`);
    } else {
      fail('Bonus integration recompute mismatch', result);
    }

    // Verify users/{uid} updated
    const userSnap = await adminDb.collection('users').doc(REVIEWEE).get();
    const data = userSnap.data();
    if (data?.averageRatingAsReviewee === 3.5 && data?.reviewCountAsReviewee === 4) {
      pass('Bonus integration : users/{uid}.averageRatingAsReviewee + reviewCountAsReviewee persistés');
    } else {
      fail('Bonus integration users update mismatch', data);
    }

    // Bonus invalid input → ok=false
    const bad = await recomputeRevieweeAverageRating('');
    if (!bad.ok && bad.reason === 'invalid-input') {
      pass('Bonus integration empty uid → ok=false invalid-input');
    } else {
      fail('Bonus integration empty uid should fail', bad);
    }

    __setRecomputeRatingAdminDbForTesting(null);
  }

  console.log('');
  console.log('====== Résumé Compute Match Score (MS1-MS4 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
