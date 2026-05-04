/**
 * Tests Phase 7 sub-chantier 1 commit 2/6 — Reviews service layer.
 *
 * Exécution :
 *   npm run test:reviews
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reviews/service.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing (cohérent
 * tests/anti-cheat/maxParticipants-guard.test.ts).
 *
 * - withSecurityRulesDisabled : setup direct + appels services
 * - __setReviewsDbForTesting() injecte le Firestore du test env dans les services
 * - __setCreditsServiceForTesting() mock l'adder pour tracker les calls (pas de write users.credits)
 *
 * Couverture (~22 sub-assertions) :
 *   createReview : eligibility, cooling-off, fenêtre 7j, no-duplicate, branche 3-5★ vs 1-2★,
 *                  validation comment + rating, self-review, no-shared-session
 *   editReview   : fenêtre éditable, cross-tier rejet, mutation comment-only OK, not-reviewer
 *   moderateReview : transitions pending → published / rejected, awardBonus déclenché
 *   awardReviewBonus : anti-double via creditsAwarded
 *   softDeleteReview : reviewer-self OK
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setCreditsServiceForTesting,
  __setReviewsDbForTesting,
  awardReviewBonus,
  createReview,
  editReview,
  moderateReview,
  ReviewError,
  softDeleteReview,
  type CreditsAdder,
} from '../../src/lib/reviews';
import type {
  Activity,
  Booking,
  Review,
  Session,
} from '../../src/types/firestore';

/** Cast helper rules-unit-testing v4 (cohérent fixtures.ts Phase 6). */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function assertEq<T>(actual: T, expected: T, label: string): void {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson === eJson) {
    console.log(`PASS  ${label}`);
    _passes++;
  } else {
    console.log(`FAIL  ${label}`);
    console.log(`        actual  : ${aJson}`);
    console.log(`        expected: ${eJson}`);
    _failures++;
  }
}

async function assertThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<ReviewError | null> {
  try {
    await fn();
    console.log(`FAIL  ${label} (expected throw "${expectedCode}", got success)`);
    _failures++;
    return null;
  } catch (err) {
    if (err instanceof ReviewError && err.code === expectedCode) {
      console.log(`PASS  ${label}`);
      _passes++;
      return err;
    }
    const code = err instanceof ReviewError ? err.code : (err as Error).message;
    console.log(`FAIL  ${label} (expected "${expectedCode}", got "${code}")`);
    _failures++;
    return null;
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Fixture helpers (real Firestore via test env)
// =====================================================================

function tsFromMs(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

async function setupActivity(
  fbDb: Firestore,
  opts: { activityId: string; partnerId: string },
): Promise<void> {
  const minimal: Partial<Activity> = {
    activityId: opts.activityId,
    partnerId: opts.partnerId,
    title: 'Test Activity',
    sport: 'Afroboost',
    city: 'Genève',
  };
  await setDoc(doc(fbDb, 'activities', opts.activityId), minimal);
}

async function setupSession(
  fbDb: Firestore,
  opts: { sessionId: string; activityId: string; endAtMs: number },
): Promise<void> {
  const minimal: Partial<Session> = {
    sessionId: opts.sessionId,
    activityId: opts.activityId,
    startAt: tsFromMs(opts.endAtMs - 60 * 60 * 1000),
    endAt: tsFromMs(opts.endAtMs),
  };
  await setDoc(doc(fbDb, 'sessions', opts.sessionId), minimal);
}

async function setupBooking(
  fbDb: Firestore,
  opts: { bookingId: string; userId: string; sessionId: string; activityId: string },
): Promise<void> {
  const minimal: Partial<Booking> = {
    bookingId: opts.bookingId,
    userId: opts.userId,
    sessionId: opts.sessionId,
    activityId: opts.activityId,
    status: 'confirmed',
  };
  await setDoc(doc(fbDb, 'bookings', opts.bookingId), minimal);
}

// =====================================================================
// Mock credits adder (track calls only, pure in-memory — pas de write Firestore)
// =====================================================================

interface CreditsAdderCall {
  uid: string;
  amount: number;
  type: string;
  description: string;
  relatedId?: string;
}

function makeMockCreditsAdder(): { adder: CreditsAdder; calls: CreditsAdderCall[] } {
  const calls: CreditsAdderCall[] = [];
  const balances = new Map<string, number>();
  const adder: CreditsAdder = async (uid, amount, type, description, relatedId) => {
    calls.push({ uid, amount, type, description, relatedId });
    const newBalance = (balances.get(uid) ?? 0) + amount;
    balances.set(uid, newBalance);
    return newBalance;
  };
  return { adder, calls };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-reviews',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // Tous les tests run dans un seul withSecurityRulesDisabled (cohérent pattern Phase 6 B/C/D)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setReviewsDbForTesting(fbDb);

    const { adder, calls } = makeMockCreditsAdder();
    __setCreditsServiceForTesting(adder);

    // Fixtures globaux
    const PARTNER_ID = 'partner_alice';
    const REVIEWER_ID = 'user_bob';
    const REVIEWEE_ID = 'user_charlie';
    const threeDaysAgoMs = Date.now() - 3 * 24 * 60 * 60 * 1000;

    // ===================================================================
    // SCÉNARIO A — auto-publish 5★ + duplicate + self-review + validation
    // ===================================================================
    section('createReview : eligibility, cooling-off, fenêtre, duplicate, rating branches');

    const ACTIVITY_A = 'act_scenarioA';
    await setupActivity(fbDb, { activityId: ACTIVITY_A, partnerId: PARTNER_ID });
    await setupSession(fbDb, {
      sessionId: 'sess_A1',
      activityId: ACTIVITY_A,
      endAtMs: threeDaysAgoMs,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_A1_reviewer',
      userId: REVIEWER_ID,
      sessionId: 'sess_A1',
      activityId: ACTIVITY_A,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_A1_reviewee',
      userId: REVIEWEE_ID,
      sessionId: 'sess_A1',
      activityId: ACTIVITY_A,
    });

    // R1 : créer review 5★ → auto-publish + bonus
    {
      const result = await createReview({
        activityId: ACTIVITY_A,
        reviewerId: REVIEWER_ID,
        revieweeId: REVIEWEE_ID,
        rating: 5,
        comment: 'Super session, ambiance top !',
      });
      assertEq(result.status, 'published', 'R1 review 5★ → status=published auto');
      assertEq(result.anonymized, false, 'R1 review 5★ → anonymized=false');
      assertEq(result.bonusAwarded, true, 'R1 review 5★ → bonus awarded');
      assertEq(calls.length, 1, 'R1 creditsAdder appelé 1×');
      assertEq(calls[0].amount, 5, 'R1 +5 crédits review_bonus');
      assertEq(calls[0].type, 'review_bonus', 'R1 type=review_bonus');
    }

    // R2 : duplicate → throw
    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_A,
          reviewerId: REVIEWER_ID,
          revieweeId: REVIEWEE_ID,
          rating: 4,
          comment: 'Try duplicate this should fail',
        }),
      'review-already-exists',
      'R2 duplicate (activityId+reviewerId déjà reviewé) → throw',
    );

    // R3 : self-review → throw
    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_A,
          reviewerId: REVIEWER_ID,
          revieweeId: REVIEWER_ID,
          rating: 5,
          comment: 'self-review impossible',
        }),
      'reviewer-equals-reviewee',
      'R3 self-review → throw reviewer-equals-reviewee',
    );

    // R4 : rating out of range
    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_A,
          reviewerId: 'user_diane',
          revieweeId: REVIEWEE_ID,
          rating: 6 as 5,
          comment: 'rating invalid out of range',
        }),
      'rating-out-of-range',
      'R4 rating > 5 → throw',
    );

    // R5 : comment too short
    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_A,
          reviewerId: 'user_eric',
          revieweeId: REVIEWEE_ID,
          rating: 4,
          comment: 'short',
        }),
      'comment-too-short',
      'R5 comment <10 chars → throw',
    );

    // ===================================================================
    // SCÉNARIO B — cooling-off active (session <24h)
    // ===================================================================
    const ACTIVITY_B = 'act_scenarioB';
    await setupActivity(fbDb, { activityId: ACTIVITY_B, partnerId: PARTNER_ID });
    const twelveHoursAgoMs = Date.now() - 12 * 60 * 60 * 1000;
    await setupSession(fbDb, {
      sessionId: 'sess_B1',
      activityId: ACTIVITY_B,
      endAtMs: twelveHoursAgoMs,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_B1_reviewer',
      userId: REVIEWER_ID,
      sessionId: 'sess_B1',
      activityId: ACTIVITY_B,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_B1_reviewee',
      userId: REVIEWEE_ID,
      sessionId: 'sess_B1',
      activityId: ACTIVITY_B,
    });

    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_B,
          reviewerId: REVIEWER_ID,
          revieweeId: REVIEWEE_ID,
          rating: 4,
          comment: 'too soon, cooling-off active',
        }),
      'cooling-off-not-elapsed',
      'R6 review <24h après session → cooling-off-not-elapsed',
    );

    // ===================================================================
    // SCÉNARIO C — fenêtre 7j fermée (session >7j)
    // ===================================================================
    const ACTIVITY_C = 'act_scenarioC';
    await setupActivity(fbDb, { activityId: ACTIVITY_C, partnerId: PARTNER_ID });
    const tenDaysAgoMs = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await setupSession(fbDb, {
      sessionId: 'sess_C1',
      activityId: ACTIVITY_C,
      endAtMs: tenDaysAgoMs,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_C1_reviewer',
      userId: REVIEWER_ID,
      sessionId: 'sess_C1',
      activityId: ACTIVITY_C,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_C1_reviewee',
      userId: REVIEWEE_ID,
      sessionId: 'sess_C1',
      activityId: ACTIVITY_C,
    });

    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_C,
          reviewerId: REVIEWER_ID,
          revieweeId: REVIEWEE_ID,
          rating: 4,
          comment: 'too late, window closed',
        }),
      'review-window-closed',
      'R7 review >7j après session → review-window-closed',
    );

    // ===================================================================
    // SCÉNARIO D — pas de session partagée (les 2 users dans des sessions différentes)
    // ===================================================================
    const ACTIVITY_D = 'act_scenarioD';
    await setupActivity(fbDb, { activityId: ACTIVITY_D, partnerId: PARTNER_ID });
    await setupSession(fbDb, {
      sessionId: 'sess_D1',
      activityId: ACTIVITY_D,
      endAtMs: threeDaysAgoMs,
    });
    await setupSession(fbDb, {
      sessionId: 'sess_D2',
      activityId: ACTIVITY_D,
      endAtMs: threeDaysAgoMs,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_D1_reviewer',
      userId: REVIEWER_ID,
      sessionId: 'sess_D1',
      activityId: ACTIVITY_D,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_D2_reviewee',
      userId: REVIEWEE_ID,
      sessionId: 'sess_D2',
      activityId: ACTIVITY_D,
    });

    await assertThrows(
      () =>
        createReview({
          activityId: ACTIVITY_D,
          reviewerId: REVIEWER_ID,
          revieweeId: REVIEWEE_ID,
          rating: 4,
          comment: 'never met, this should fail',
        }),
      'no-shared-session',
      'R8 reviewer + reviewee jamais dans même session → no-shared-session',
    );

    // ===================================================================
    // SCÉNARIO E — review 1★ → status=pending + anonymized=true + pas de bonus
    // ===================================================================
    section('createReview 1-2★ → pending + modération');

    const ACTIVITY_E = 'act_scenarioE';
    await setupActivity(fbDb, { activityId: ACTIVITY_E, partnerId: PARTNER_ID });
    await setupSession(fbDb, {
      sessionId: 'sess_E1',
      activityId: ACTIVITY_E,
      endAtMs: threeDaysAgoMs,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_E1_reviewer',
      userId: REVIEWER_ID,
      sessionId: 'sess_E1',
      activityId: ACTIVITY_E,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_E1_reviewee',
      userId: REVIEWEE_ID,
      sessionId: 'sess_E1',
      activityId: ACTIVITY_E,
    });

    const callsBeforeR9 = calls.length;
    let pendingReviewId = '';
    {
      const result = await createReview({
        activityId: ACTIVITY_E,
        reviewerId: REVIEWER_ID,
        revieweeId: REVIEWEE_ID,
        rating: 1,
        comment: 'comportement inapproprié pendant la session',
      });
      pendingReviewId = result.reviewId;
      assertEq(result.status, 'pending', 'R9 review 1★ → status=pending (modération)');
      assertEq(result.anonymized, true, 'R9 review 1★ → anonymized=true');
      assertEq(result.bonusAwarded, false, 'R9 review 1★ → pas de bonus avant modération');
      assertEq(
        calls.length,
        callsBeforeR9,
        'R9 creditsAdder PAS appelé pour 1★ pending',
      );
    }

    // ===================================================================
    // moderateReview publish path
    // ===================================================================
    section('moderateReview : pending → published, awardBonus déclenché');

    {
      const result = await moderateReview({
        reviewId: pendingReviewId,
        decision: 'publish',
        adminId: 'admin_alice',
      });
      assertEq(result.newStatus, 'published', 'R10 modération publish → status=published');
      assertEq(result.bonusAwarded, true, 'R10 publish 1★ → bonus déclenché');
      assertEq(calls.length, callsBeforeR9 + 1, 'R10 creditsAdder appelé après modération');
    }

    // ===================================================================
    // awardReviewBonus anti-double
    // ===================================================================
    section('awardReviewBonus : anti-double via creditsAwarded');

    {
      const result = await awardReviewBonus(pendingReviewId);
      assertEq(result.awarded, false, 'R11 awardBonus 2nd call → awarded=false (idempotency)');
      assertEq(result.creditsAdded, 0, 'R11 0 crédits ajoutés (déjà alloué)');
      assertEq(
        calls.length,
        callsBeforeR9 + 1,
        'R11 creditsAdder TOUJOURS pas appelé une 2ème fois',
      );
    }

    // ===================================================================
    // editReview : window, cross-tier rejet, comment OK, not-reviewer
    // ===================================================================
    section('editReview : fenêtre, cross-tier rejet, comment-only OK, not-reviewer');

    // Récupérer l'ID de la review R1 (5★ published) — query par reviewerId
    const r1ReviewerQuery = await getDocs(
      query(
        collection(fbDb, 'reviews'),
        where('activityId', '==', ACTIVITY_A),
        where('reviewerId', '==', REVIEWER_ID),
      ),
    );
    const r1Id = r1ReviewerQuery.docs[0]?.id;
    assertEq(r1ReviewerQuery.size, 1, 'R12 setup : 1 review trouvée pour ACTIVITY_A+REVIEWER_ID');

    // R12 : edit comment-only → success
    await editReview({
      reviewId: r1Id,
      reviewerId: REVIEWER_ID,
      comment: 'Comment révisé après réflexion, super session',
    });
    const r1AfterDoc = await getDoc(doc(fbDb, 'reviews', r1Id));
    const r1After = r1AfterDoc.data() as Review;
    assertEq(
      r1After.comment,
      'Comment révisé après réflexion, super session',
      'R12 edit comment OK',
    );
    assertEq(r1After.rating, 5, 'R12 rating inchangé (pas dans updates)');

    // R13 : edit cross-tier rating 5 → 1 → throw
    await assertThrows(
      () =>
        editReview({
          reviewId: r1Id,
          reviewerId: REVIEWER_ID,
          rating: 1,
        }),
      'cross-tier-rating-change',
      'R13 cross-tier rating 5→1 → throw cross-tier-rating-change',
    );

    // R14 : edit par non-author → throw not-reviewer
    await assertThrows(
      () =>
        editReview({
          reviewId: r1Id,
          reviewerId: 'user_intruder',
          comment: 'malicious edit attempt',
        }),
      'not-reviewer',
      'R14 edit par non-author → throw not-reviewer',
    );

    // R15 : edit hors fenêtre — force editableUntil dans le passé
    await setDoc(
      doc(fbDb, 'reviews', r1Id),
      { ...r1After, editableUntil: tsFromMs(Date.now() - 60 * 1000) },
      { merge: true },
    );
    await assertThrows(
      () =>
        editReview({
          reviewId: r1Id,
          reviewerId: REVIEWER_ID,
          comment: 'too late edit attempt',
        }),
      'edit-window-closed',
      'R15 edit après editableUntil → throw edit-window-closed',
    );

    // ===================================================================
    // softDeleteReview : reviewer-self OK
    // ===================================================================
    section('softDeleteReview : reviewer-self OK');

    await softDeleteReview({
      reviewId: r1Id,
      deletedBy: REVIEWER_ID,
    });
    const r1DeletedDoc = await getDoc(doc(fbDb, 'reviews', r1Id));
    const r1Deleted = r1DeletedDoc.data() as Review;
    assertEq(r1Deleted.status, 'rejected', 'R16 soft delete → status=rejected');
    assertEq(r1Deleted.comment, '', 'R16 soft delete → comment vidé');

    // ===================================================================
    // moderateReview reject path
    // ===================================================================
    section('moderateReview : reject path (no bonus)');

    const ACTIVITY_F = 'act_scenarioF';
    await setupActivity(fbDb, { activityId: ACTIVITY_F, partnerId: PARTNER_ID });
    await setupSession(fbDb, {
      sessionId: 'sess_F1',
      activityId: ACTIVITY_F,
      endAtMs: threeDaysAgoMs,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_F1_reviewer',
      userId: REVIEWER_ID,
      sessionId: 'sess_F1',
      activityId: ACTIVITY_F,
    });
    await setupBooking(fbDb, {
      bookingId: 'book_F1_reviewee',
      userId: REVIEWEE_ID,
      sessionId: 'sess_F1',
      activityId: ACTIVITY_F,
    });

    const callsBeforeR17 = calls.length;
    const r17Pending = await createReview({
      activityId: ACTIVITY_F,
      reviewerId: REVIEWER_ID,
      revieweeId: REVIEWEE_ID,
      rating: 2,
      comment: 'pas top, comportement bizarre',
    });
    assertEq(r17Pending.status, 'pending', 'R17 setup : 2★ pending OK');

    const r17Reject = await moderateReview({
      reviewId: r17Pending.reviewId,
      decision: 'reject',
      adminId: 'admin_alice',
    });
    assertEq(r17Reject.newStatus, 'rejected', 'R17 modération reject → status=rejected');
    assertEq(r17Reject.bonusAwarded, false, 'R17 reject → PAS de bonus crédits');
    assertEq(calls.length, callsBeforeR17, 'R17 creditsAdder PAS appelé pour rejected');
  });

  // Cleanup
  __setReviewsDbForTesting(null);
  __setCreditsServiceForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Reviews service ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
