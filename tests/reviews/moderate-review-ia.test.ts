/**
 * Tests Phase 9 sub-chantier 4 commit 2/6 — Genkit moderateReview IA + integration API route.
 *
 * Exécution :
 *   npm run test:reviews:moderate-review-ia
 *
 * Pattern : pure unit MR1-MR4 (mock _generateFn DI seam) + emulator integration MR5
 * (POST /api/reviews/[id]/moderate avec Admin SDK seed review).
 *
 * Couverture (MR1-MR5) :
 *   MR1  review civil 2★ → recommendation='publish' civility>0.7
 *   MR2  review insulte/slur → recommendation='reject' civility<0.3
 *   MR3  cache hit déterministe : 2nd run même comment → no AI call (mock count = 1)
 *   MR4  Gemini error mock throw → motive='ai-error' recommendation='borderline'
 *   MR5  POST /api/reviews/[id]/moderate → review.aiSuggestion field persisté async post-create
 *
 * Bonus : modelVersion stable + motive truncate ≤ 100 chars.
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-mod-review-ia';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-mod-review-ia';

import {
  runReviewModerator,
  __setReviewModeratorGenerateFnForTesting,
  __resetReviewModeratorCacheForTesting,
  MODEL_VERSION,
} from '../../src/ai/flows/review-moderator';
import { __resetRateLimitForTesting } from '../../src/ai/genkit';
import { POST as POSTModerateReview } from '../../src/app/api/reviews/[id]/moderate/route';
import { Timestamp } from 'firebase-admin/firestore';

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

function resetAll(): void {
  __resetReviewModeratorCacheForTesting();
  __resetRateLimitForTesting();
}

// =====================================================================
// Helpers
// =====================================================================

async function callModerate(
  reviewId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`http://localhost/api/reviews/${reviewId}/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTModerateReview(req, {
    params: Promise.resolve({ id: reviewId }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-mod-review-ia' });
  }
  const adminDb = getFirestore();

  // ===================================================================
  // MR1 : civil 2★ → recommendation='publish' civility>0.7
  // ===================================================================
  section('MR1 review civil 2★ → recommendation=publish civility>0.7');
  {
    resetAll();
    __setReviewModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        civility: 0.92,
        factuality: 0.7,
        recommendation: 'publish',
        motive: 'Critique civile et factuelle',
      }),
    );
    const result = await runReviewModerator({
      rating: 2,
      comment: 'Cours pas top, instructeur pas très clair sur les pas.',
      activityTitle: 'Yoga Sunset',
      reviewerHashId: 'mr1hash',
    });
    if (
      result.recommendation === 'publish' &&
      result.civility > 0.7 &&
      result.motive === 'Critique civile et factuelle' &&
      result.modelVersion === MODEL_VERSION
    ) {
      pass('MR1 publish + civility>0.7 + motive + modelVersion');
    } else {
      fail('MR1 unexpected', result);
    }
  }

  // ===================================================================
  // MR2 : insulte/slur → recommendation='reject' civility<0.3
  // ===================================================================
  section('MR2 review insulte/slur → recommendation=reject civility<0.3');
  {
    resetAll();
    __setReviewModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        civility: 0.05,
        factuality: 0.0,
        recommendation: 'reject',
        motive: 'Insulte / slur — non publiable',
      }),
    );
    const result = await runReviewModerator({
      rating: 1,
      comment: 'Quel arnaqueur ce coach, vraiment [insulte], à éviter.',
      reviewerHashId: 'mr2hash',
    });
    if (
      result.recommendation === 'reject' &&
      result.civility < 0.3 &&
      result.motive.includes('Insulte')
    ) {
      pass('MR2 reject + civility<0.3 + motive insulte');
    } else {
      fail('MR2 unexpected', result);
    }
  }

  // ===================================================================
  // MR3 : cache hit déterministe — 2nd run même comment → mock pas invoqué
  // ===================================================================
  section('MR3 cache hit déterministe : 2nd run même comment → mock count = 1');
  {
    resetAll();
    let callCount = 0;
    __setReviewModeratorGenerateFnForTesting(async () => {
      callCount++;
      return JSON.stringify({
        civility: 0.85,
        factuality: 0.6,
        recommendation: 'publish',
        motive: 'Critique factuelle',
      });
    });
    const r1 = await runReviewModerator({
      rating: 2,
      comment: 'Studio froid et vestiaires sales.',
      activityTitle: 'CrossFit',
      reviewerHashId: 'mr3hash',
    });
    const r2 = await runReviewModerator({
      rating: 2,
      comment: 'Studio froid et vestiaires sales.',
      activityTitle: 'CrossFit',
      reviewerHashId: 'mr3hash',
    });
    if (callCount === 1 && r1.recommendation === r2.recommendation) {
      pass('MR3 cache hit — mock invoqué 1x sur 2 runs identiques');
    } else {
      fail('MR3 cache should hit', { callCount, r1, r2 });
    }
    // Différent comment → cache miss → 2e call
    const r3 = await runReviewModerator({
      rating: 2,
      comment: 'Différent comment cache miss.',
      reviewerHashId: 'mr3hash',
    });
    if (callCount === 2 && r3.recommendation === 'publish') {
      pass('MR3 cache miss sur comment différent → 2e call');
    } else {
      fail('MR3 cache miss should trigger 2nd call', { callCount });
    }
  }

  // ===================================================================
  // MR4 : Gemini error → motive='ai-error' recommendation='borderline'
  // ===================================================================
  section('MR4 Gemini error mock throw → motive=ai-error recommendation=borderline');
  {
    resetAll();
    __setReviewModeratorGenerateFnForTesting(async () => {
      throw new Error('Gemini 503 Service Unavailable');
    });
    const result = await runReviewModerator({
      rating: 1,
      comment: 'Test error fallback.',
      reviewerHashId: 'mr4hash',
    });
    if (result.recommendation === 'borderline' && result.motive === 'ai-error') {
      pass('MR4 Gemini error → borderline + ai-error motive');
    } else {
      fail('MR4 should fallback', result);
    }
    if (result.civility === 0.5 && result.factuality === 0.5) {
      pass('MR4 fallback default scores 0.5/0.5');
    } else {
      fail('MR4 fallback scores unexpected', result);
    }

    // Bonus : JSON malformed → même fallback
    resetAll();
    __setReviewModeratorGenerateFnForTesting(async () => 'not-json-at-all');
    const r2 = await runReviewModerator({
      rating: 1,
      comment: 'JSON malformed test.',
      reviewerHashId: 'mr4hash2',
    });
    if (r2.recommendation === 'borderline' && r2.motive === 'ai-error') {
      pass('MR4 bonus malformed JSON → borderline + ai-error');
    } else {
      fail('MR4 bonus should fallback malformed', r2);
    }
  }

  // ===================================================================
  // MR5 : POST /api/reviews/[id]/moderate → aiSuggestion persisté
  // ===================================================================
  section('MR5 POST /api/reviews/[id]/moderate → aiSuggestion persisté async');
  {
    resetAll();
    // Seed a review pending in Firestore (rating=1)
    const reviewId = 'review_mr5';
    await adminDb.collection('reviews').doc(reviewId).set({
      reviewId,
      activityId: 'activity_mr5',
      reviewerId: 'user_mr5',
      revieweeId: 'partner_mr5',
      rating: 1,
      comment: 'Pas terrible, instructeur en retard.',
      status: 'pending',
      anonymized: true,
      creditsAwarded: false,
      createdAt: Timestamp.now(),
    });

    // Mock Gemini for the API route call
    __setReviewModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        civility: 0.9,
        factuality: 0.65,
        recommendation: 'publish',
        motive: 'Critique civile, factuelle',
      }),
    );

    const res = await callModerate(reviewId, {
      rating: 1,
      comment: 'Pas terrible, instructeur en retard.',
      activityTitle: 'Yoga MR5',
      reviewerId: 'user_mr5',
    });

    if (res.status === 200 && res.body?.ok === true && res.body?.recommendation === 'publish') {
      pass('MR5 POST 200 ok=true recommendation=publish');
    } else {
      fail('MR5 POST should be 200 publish', res);
    }

    // Verify aiSuggestion field persisté
    const snap = await adminDb.collection('reviews').doc(reviewId).get();
    const data = snap.data();
    const ai = data?.aiSuggestion;
    if (
      ai &&
      ai.recommendation === 'publish' &&
      ai.civility === 0.9 &&
      ai.factuality === 0.65 &&
      ai.motive === 'Critique civile, factuelle' &&
      ai.modelVersion === MODEL_VERSION &&
      ai.scoredAt
    ) {
      pass('MR5 review.aiSuggestion field persisté avec tous les champs');
    } else {
      fail('MR5 aiSuggestion missing or invalid', { ai });
    }

    // Bonus : invalid input → 400
    const resBad = await callModerate(reviewId, {
      rating: 99, // invalid
      comment: 'test',
      reviewerId: 'user_mr5',
    });
    if (resBad.status === 400) {
      pass('MR5 bonus invalid rating → 400');
    } else {
      fail('MR5 bonus should be 400', resBad);
    }
  }

  // Cleanup
  __setReviewModeratorGenerateFnForTesting(null);
  __resetReviewModeratorCacheForTesting();
  __resetRateLimitForTesting();

  console.log('');
  console.log('====== Résumé Moderate Review IA (MR1-MR5 + bonus) ======');
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
