/**
 * Tests Phase 9 sub-chantier 4 commit 4/6 — Heuristique détection représailles cross-user.
 *
 * Exécution :
 *   npm run test:reviews:retaliation-detector
 *
 * Pattern : Admin SDK direct (cohérent SC2 c5/6 refund-on-decline pattern) — pas de rules
 * intermediary, parce que detectRetaliation utilise Admin SDK pour bypass rules client-side
 * (cas: prior review pending unreadable par auth.uid de l'auteur de la review en cours).
 *
 * Couverture (RV1-RV4 + bonus) :
 *   RV1 Alice→Bob 5★ J0, Bob→Alice 1★ J0+10h same session → flagged retaliation +
 *       review.flaggedAsRetaliation=true + adminAction review_retaliation_flag persisté
 *   RV2 Alice→Bob 5★ J0, Bob→Alice 1★ J0+30h same session → NOT flagged (>24h Q5=A)
 *   RV3 Alice→Bob 5★ J0, Bob→Alice 1★ J0+10h DIFFERENT session → NOT flagged (Q5=A same-session)
 *   RV4 verify Review.retaliationDeltaMs + retaliationSuspectReviewId persistés correctement
 *   Bonus 1 pas de prior cross-review → not flagged (no false positive)
 *   Bonus 2 idempotency : applyRetaliationFlag 2× même review → 2nd run skip (already flagged)
 *   Bonus 3 self-review attempted (reviewerId == revieweeId) → not flagged
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-retaliation';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-retaliation';

import {
  detectRetaliation,
  applyRetaliationFlag,
  __setRetaliationAdminDbForTesting,
} from '../../src/lib/reviews/retaliationDetector';
import { POST as POSTCheckRetaliation } from '../../src/app/api/reviews/[id]/check-retaliation/route';

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

const ALICE = 'user_alice_rv';
const BOB = 'user_bob_rv';
const SESSION_A = 'session_rv_a';
const SESSION_B = 'session_rv_b';

async function callApi(
  reviewId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`http://localhost/api/reviews/${reviewId}/check-retaliation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTCheckRetaliation(req, {
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
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-retaliation' });
  }
  const adminDb = getFirestore();

  // Wire DI seam pour helper detectRetaliation + applyRetaliationFlag
  __setRetaliationAdminDbForTesting(adminDb);

  async function clearAll(): Promise<void> {
    for (const col of ['reviews', 'adminActions']) {
      const snap = await adminDb.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  async function seedReview(
    reviewId: string,
    opts: {
      reviewerId: string;
      revieweeId: string;
      sessionId: string;
      rating: 1 | 2 | 3 | 4 | 5;
      createdAtMs: number;
    },
  ): Promise<void> {
    await adminDb
      .collection('reviews')
      .doc(reviewId)
      .set({
        reviewId,
        activityId: 'activity_rv',
        reviewerId: opts.reviewerId,
        revieweeId: opts.revieweeId,
        sessionId: opts.sessionId,
        rating: opts.rating,
        comment: 'Test review for retaliation detection.',
        status: opts.rating >= 3 ? 'published' : 'pending',
        anonymized: opts.rating <= 2,
        creditsAwarded: false,
        createdAt: Timestamp.fromMillis(opts.createdAtMs),
      });
  }

  const J0 = Date.now() - 12 * 60 * 60_000; // J0 = 12h ago (anchor for tests)

  // ===================================================================
  // RV1 : Alice→Bob 5★ J0, Bob→Alice 1★ J0+10h same session → flagged
  // ===================================================================
  section('RV1 cross-review same session within 24h → flagged retaliation');
  await clearAll();
  await seedReview('rev_alice_to_bob_rv1', {
    reviewerId: ALICE,
    revieweeId: BOB,
    sessionId: SESSION_A,
    rating: 5,
    createdAtMs: J0,
  });
  // Bob's review at J0+10h (within 24h)
  const bobCreatedMs = J0 + 10 * 60 * 60_000;
  await seedReview('rev_bob_to_alice_rv1', {
    reviewerId: BOB,
    revieweeId: ALICE,
    sessionId: SESSION_A,
    rating: 1,
    createdAtMs: bobCreatedMs,
  });
  {
    const detection = await detectRetaliation({
      reviewId: 'rev_bob_to_alice_rv1',
      reviewerId: BOB,
      revieweeId: ALICE,
      sessionId: SESSION_A,
      createdAtMs: bobCreatedMs,
    });
    if (detection.isRetaliation) {
      pass('RV1 isRetaliation=true');
    } else {
      fail('RV1 should be retaliation', detection);
    }
    if (detection.suspectReviewId === 'rev_alice_to_bob_rv1') {
      pass('RV1 suspectReviewId = Alice review');
    } else {
      fail('RV1 suspectReviewId mismatch', detection);
    }
    // deltaMs ≈ 10h
    const expectedDelta = 10 * 60 * 60_000;
    if (
      typeof detection.deltaMs === 'number' &&
      Math.abs(detection.deltaMs - expectedDelta) < 1000
    ) {
      pass(`RV1 deltaMs ≈ 10h (${detection.deltaMs}ms)`);
    } else {
      fail('RV1 deltaMs unexpected', detection);
    }
    if (detection.reason && detection.reason.includes('Cross-review')) {
      pass('RV1 reason contient "Cross-review"');
    } else {
      fail('RV1 reason missing', detection);
    }
  }

  // ===================================================================
  // RV2 : Alice→Bob 5★ J0, Bob→Alice 1★ J0+30h → NOT flagged (>24h)
  // ===================================================================
  section('RV2 cross-review >24h → NOT flagged (Q5=A 24h window)');
  await clearAll();
  await seedReview('rev_alice_to_bob_rv2', {
    reviewerId: ALICE,
    revieweeId: BOB,
    sessionId: SESSION_A,
    rating: 5,
    createdAtMs: J0,
  });
  const bobCreatedMs2 = J0 + 30 * 60 * 60_000; // 30h after Alice
  await seedReview('rev_bob_to_alice_rv2', {
    reviewerId: BOB,
    revieweeId: ALICE,
    sessionId: SESSION_A,
    rating: 1,
    createdAtMs: bobCreatedMs2,
  });
  {
    const detection = await detectRetaliation({
      reviewId: 'rev_bob_to_alice_rv2',
      reviewerId: BOB,
      revieweeId: ALICE,
      sessionId: SESSION_A,
      createdAtMs: bobCreatedMs2,
    });
    if (!detection.isRetaliation) {
      pass('RV2 isRetaliation=false (>24h window)');
    } else {
      fail('RV2 should NOT be retaliation', detection);
    }
  }

  // ===================================================================
  // RV3 : Alice→Bob 5★ J0 SESSION_A, Bob→Alice 1★ J0+10h DIFFERENT session → NOT flagged
  // ===================================================================
  section('RV3 cross-review different session → NOT flagged (Q5=A same-session)');
  await clearAll();
  await seedReview('rev_alice_to_bob_rv3', {
    reviewerId: ALICE,
    revieweeId: BOB,
    sessionId: SESSION_A,
    rating: 5,
    createdAtMs: J0,
  });
  const bobCreatedMs3 = J0 + 10 * 60 * 60_000;
  await seedReview('rev_bob_to_alice_rv3', {
    reviewerId: BOB,
    revieweeId: ALICE,
    sessionId: SESSION_B, // DIFFERENT session
    rating: 1,
    createdAtMs: bobCreatedMs3,
  });
  {
    const detection = await detectRetaliation({
      reviewId: 'rev_bob_to_alice_rv3',
      reviewerId: BOB,
      revieweeId: ALICE,
      sessionId: SESSION_B,
      createdAtMs: bobCreatedMs3,
    });
    if (!detection.isRetaliation) {
      pass('RV3 isRetaliation=false (different session)');
    } else {
      fail('RV3 should NOT be retaliation', detection);
    }
  }

  // ===================================================================
  // RV4 : verify applyRetaliationFlag persiste tous les fields + adminAction
  // ===================================================================
  section('RV4 applyRetaliationFlag → review.flaggedAsRetaliation + adminAction persistés');
  await clearAll();
  await seedReview('rev_alice_rv4', {
    reviewerId: ALICE,
    revieweeId: BOB,
    sessionId: SESSION_A,
    rating: 5,
    createdAtMs: J0,
  });
  const bobCreatedMs4 = J0 + 8 * 60 * 60_000;
  await seedReview('rev_bob_rv4', {
    reviewerId: BOB,
    revieweeId: ALICE,
    sessionId: SESSION_A,
    rating: 1,
    createdAtMs: bobCreatedMs4,
  });
  {
    const apply = await applyRetaliationFlag({
      reviewId: 'rev_bob_rv4',
      suspectReviewId: 'rev_alice_rv4',
      deltaMs: 8 * 60 * 60_000,
      reason: 'test reason RV4',
    });
    if (apply.ok) {
      pass('RV4 applyRetaliationFlag ok=true');
    } else {
      fail('RV4 applyRetaliationFlag should ok=true', apply);
    }

    const reviewSnap = await adminDb.collection('reviews').doc('rev_bob_rv4').get();
    const reviewData = reviewSnap.data();
    if (reviewData?.flaggedAsRetaliation === true) {
      pass('RV4 review.flaggedAsRetaliation=true');
    } else {
      fail('RV4 flag missing', reviewData);
    }
    if (reviewData?.retaliationDeltaMs === 8 * 60 * 60_000) {
      pass('RV4 review.retaliationDeltaMs persisté');
    } else {
      fail('RV4 retaliationDeltaMs missing', reviewData);
    }
    if (reviewData?.retaliationSuspectReviewId === 'rev_alice_rv4') {
      pass('RV4 review.retaliationSuspectReviewId persisté');
    } else {
      fail('RV4 retaliationSuspectReviewId missing', reviewData);
    }

    // Verify adminAction
    const aaSnap = await adminDb
      .collection('adminActions')
      .where('targetType', '==', 'review')
      .where('targetId', '==', 'rev_bob_rv4')
      .get();
    if (!aaSnap.empty) {
      const aa = aaSnap.docs[0].data();
      if (
        aa.actionType === 'review_retaliation_flag' &&
        aa.adminId === 'system' &&
        aa.metadata?.suspectReviewId === 'rev_alice_rv4' &&
        aa.metadata?.deltaMs === 8 * 60 * 60_000
      ) {
        pass('RV4 adminAction review_retaliation_flag avec metadata persisté (adminId=system Q6=A)');
      } else {
        fail('RV4 adminAction shape mismatch', aa);
      }
    } else {
      fail('RV4 adminAction not found');
    }
  }

  // ===================================================================
  // Bonus 1 : pas de prior cross-review → not flagged (no false positive)
  // ===================================================================
  section('Bonus 1 isolated review (no prior cross-review) → not flagged');
  await clearAll();
  // Bob écrit une review sans prior d'Alice
  const isoMs = Date.now() - 1000;
  {
    const detection = await detectRetaliation({
      reviewId: 'rev_iso',
      reviewerId: BOB,
      revieweeId: ALICE,
      sessionId: SESSION_A,
      createdAtMs: isoMs,
    });
    if (!detection.isRetaliation) {
      pass('Bonus 1 isolated → not flagged (no false positive)');
    } else {
      fail('Bonus 1 should not flag isolated', detection);
    }
  }

  // ===================================================================
  // Bonus 2 : idempotency applyRetaliationFlag 2× → 2nd skip
  // ===================================================================
  section('Bonus 2 applyRetaliationFlag 2× même review → 2nd run idempotent');
  await clearAll();
  await seedReview('rev_idem', {
    reviewerId: BOB,
    revieweeId: ALICE,
    sessionId: SESSION_A,
    rating: 1,
    createdAtMs: Date.now(),
  });
  {
    const r1 = await applyRetaliationFlag({
      reviewId: 'rev_idem',
      suspectReviewId: 'rev_alice_xxx',
      deltaMs: 5 * 60 * 60_000,
      reason: 'first',
    });
    const r2 = await applyRetaliationFlag({
      reviewId: 'rev_idem',
      suspectReviewId: 'rev_alice_xxx',
      deltaMs: 5 * 60 * 60_000,
      reason: 'second',
    });
    if (r1.ok && r2.ok && r2.reason === 'already-flagged-idempotent') {
      pass('Bonus 2 1er run ok / 2e run ok=true reason=already-flagged-idempotent');
    } else {
      fail('Bonus 2 idempotency failed', { r1, r2 });
    }
    // Verify 1 seul adminAction (pas de doublon)
    const aaSnap = await adminDb
      .collection('adminActions')
      .where('targetId', '==', 'rev_idem')
      .get();
    if (aaSnap.size === 1) {
      pass('Bonus 2 1 seul adminAction logged (no duplicate)');
    } else {
      fail('Bonus 2 should have exactly 1 adminAction', { count: aaSnap.size });
    }
  }

  // ===================================================================
  // Bonus 3 : self-review attempted (reviewerId == revieweeId) → not flagged
  // ===================================================================
  section('Bonus 3 self-review attempted → not flagged (defensive)');
  {
    const detection = await detectRetaliation({
      reviewId: 'rev_self',
      reviewerId: ALICE,
      revieweeId: ALICE,
      sessionId: SESSION_A,
      createdAtMs: Date.now(),
    });
    if (!detection.isRetaliation) {
      pass('Bonus 3 self-review → not flagged (defensive)');
    } else {
      fail('Bonus 3 should not flag self-review', detection);
    }
  }

  // ===================================================================
  // Bonus 4 : API route end-to-end (POST /api/reviews/[id]/check-retaliation)
  // ===================================================================
  section('Bonus 4 API route end-to-end → flagged + adminAction via Admin SDK');
  await clearAll();
  await seedReview('rev_api_alice', {
    reviewerId: ALICE,
    revieweeId: BOB,
    sessionId: SESSION_A,
    rating: 5,
    createdAtMs: J0,
  });
  const apiBobMs = J0 + 5 * 60 * 60_000;
  await seedReview('rev_api_bob', {
    reviewerId: BOB,
    revieweeId: ALICE,
    sessionId: SESSION_A,
    rating: 1,
    createdAtMs: apiBobMs,
  });
  {
    const res = await callApi('rev_api_bob', {
      reviewerId: BOB,
      revieweeId: ALICE,
      sessionId: SESSION_A,
      createdAtMs: apiBobMs,
    });
    if (res.status === 200 && res.body?.flagged === true) {
      pass('Bonus 4 API 200 + flagged=true');
    } else {
      fail('Bonus 4 API should be 200 flagged', res);
    }
    if (res.body?.suspectReviewId === 'rev_api_alice') {
      pass('Bonus 4 API response contient suspectReviewId');
    } else {
      fail('Bonus 4 suspectReviewId missing', res);
    }
    // Verify review flagged
    const reviewSnap = await adminDb.collection('reviews').doc('rev_api_bob').get();
    if (reviewSnap.data()?.flaggedAsRetaliation === true) {
      pass('Bonus 4 API persiste review.flaggedAsRetaliation=true');
    } else {
      fail('Bonus 4 review not flagged via API', reviewSnap.data());
    }
  }

  // Cleanup
  __setRetaliationAdminDbForTesting(null);

  console.log('');
  console.log('====== Résumé Retaliation Detector (RV1-RV4 + 4 bonus) ======');
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
