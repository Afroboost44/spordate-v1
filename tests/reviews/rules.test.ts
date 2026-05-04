/**
 * Tests Phase 7 sub-chantier 1 commit 6/6 — Firestore rules /reviews/{reviewId}
 * defense-in-depth (cohérent rules commit 1/6).
 *
 * Exécution :
 *   npm run test:reviews:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reviews/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4 (cohérent tests/anti-cheat/*).
 * - assertFails : la write/read DOIT échouer côté rules
 * - assertSucceeds : la write/read DOIT passer côté rules
 *
 * Couverture (~22 sub-assertions sur 18 cas RR1-RR18) :
 *
 * CREATE rules (defense-in-depth commit 1/6) :
 *   RR1 : reviewerId != auth.uid → REJET
 *   RR2 : reviewerId == revieweeId (self-review) → REJET
 *   RR3 : 1★ + status='published' (bypass modération) → REJET
 *   RR4 : 5★ + status='pending' (mauvais auto-status) → REJET
 *   RR5 : 1★ + anonymized=false (mauvaise anonymisation) → REJET
 *   RR6 : creditsAwarded=true à la création (bypass anti-double) → REJET
 *   RR7 : moderatedBy/moderatedAt présents (server-managed) → REJET
 *   RR8 : 4★ + status='published' + anonymized=false (happy 3-5★) → SUCCESS
 *   RR9 : 2★ + status='pending' + anonymized=true (happy 1-2★) → SUCCESS
 *
 * UPDATE rules :
 *   RR10 : update par non-reviewer → REJET
 *   RR11 : update status (mutation interdite client) → REJET
 *   RR12 : cross-tier rating 5→1 → REJET
 *   RR13 : intra-tier rating 5→4 + comment → SUCCESS
 *   RR14 : update après editableUntil → REJET
 *
 * DELETE rules :
 *   RR15 : delete par non-admin → REJET
 *
 * READ rules :
 *   RR16 : read pending par auteur → SUCCESS
 *   RR17 : read pending par autre user non-admin → REJET
 *   RR18 : read published par n'importe qui → SUCCESS
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/** Cast helper rules-unit-testing v4. */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function passManually(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function failManually(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Constantes
// =====================================================================

const REVIEWER_UID = 'user_reviewer_rr';
const REVIEWEE_UID = 'user_reviewee_rr';
const PARTNER_UID = 'user_partner_rr';
const ADMIN_UID = 'user_admin_rr';
const OTHER_UID = 'user_other_rr';
const ACTIVITY_ID = 'act_rr_test';

/** Construit un payload valide pour la branche 3-5★ (RR8 happy path). */
function validHighRatingPayload(opts: {
  reviewerId: string;
  revieweeId: string;
  rating: 3 | 4 | 5;
  futureMs: number;
}) {
  return {
    reviewId: 'will-be-overridden',
    activityId: ACTIVITY_ID,
    reviewerId: opts.reviewerId,
    revieweeId: opts.revieweeId,
    rating: opts.rating,
    comment: 'Comment valide minimum 10 caractères pour passer la rule',
    status: 'published' as const,
    anonymized: false,
    publishedAt: serverTimestamp(),
    editableUntil: Timestamp.fromMillis(opts.futureMs),
    creditsAwarded: false,
    createdAt: serverTimestamp(),
  };
}

/** Construit un payload valide pour la branche 1-2★ (RR9 happy path). */
function validLowRatingPayload(opts: {
  reviewerId: string;
  revieweeId: string;
  rating: 1 | 2;
}) {
  return {
    reviewId: 'will-be-overridden',
    activityId: ACTIVITY_ID,
    reviewerId: opts.reviewerId,
    revieweeId: opts.revieweeId,
    rating: opts.rating,
    comment: 'Comment valide pour pending review minimum 10 chars',
    status: 'pending' as const,
    anonymized: true,
    creditsAwarded: false,
    createdAt: serverTimestamp(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-reviews-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ===================================================================
  // SETUP : users (admin role pour ADMIN_UID) + activity
  // ===================================================================
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin@test.local',
      displayName: 'Admin Tester',
      role: 'admin',
    });
    await setDoc(doc(fbDb, 'users', REVIEWER_UID), {
      uid: REVIEWER_UID,
      email: 'reviewer@test.local',
      displayName: 'Reviewer Tester',
      role: 'user',
    });
    await setDoc(doc(fbDb, 'users', REVIEWEE_UID), {
      uid: REVIEWEE_UID,
      email: 'reviewee@test.local',
      displayName: 'Reviewee Tester',
      role: 'user',
    });
    await setDoc(doc(fbDb, 'users', OTHER_UID), {
      uid: OTHER_UID,
      email: 'other@test.local',
      displayName: 'Other Tester',
      role: 'user',
    });
    // Activity (nécessaire pour update rule qui get(activities/...).data.partnerId)
    await setDoc(doc(fbDb, 'activities', ACTIVITY_ID), {
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      title: 'Test Activity Rules',
    });
  });

  // ===================================================================
  // CREATE rules — defense-in-depth (RR1-RR9)
  // ===================================================================
  section('CREATE rules : defense-in-depth (RR1-RR9)');

  const futureMs = Date.now() + 24 * 60 * 60 * 1000;

  // RR1 : reviewerId != auth.uid → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = validHighRatingPayload({
      reviewerId: 'someone_else_uid', // ≠ auth.uid
      revieweeId: REVIEWEE_UID,
      rating: 4,
      futureMs,
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr1-spoof'), payload));
      passManually('RR1 reviewerId != auth.uid → REJET');
    } catch (e) {
      failManually('RR1 (expected fail)', e);
    }
  }

  // RR2 : self-review → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = validHighRatingPayload({
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWER_UID, // = self
      rating: 4,
      futureMs,
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr2-self'), payload));
      passManually('RR2 self-review (reviewerId == revieweeId) → REJET');
    } catch (e) {
      failManually('RR2 (expected fail)', e);
    }
  }

  // RR3 : 1★ + status='published' (bypass modération) → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = {
      ...validLowRatingPayload({
        reviewerId: REVIEWER_UID,
        revieweeId: REVIEWEE_UID,
        rating: 1,
      }),
      status: 'published' as const, // ✗ devrait être 'pending'
      anonymized: true,
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr3-bypass-mod'), payload));
      passManually('RR3 1★ + status=published (bypass modération) → REJET');
    } catch (e) {
      failManually('RR3 (expected fail)', e);
    }
  }

  // RR4 : 5★ + status='pending' (mauvais auto-status) → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = {
      reviewId: 'will-be-overridden',
      activityId: ACTIVITY_ID,
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWEE_UID,
      rating: 5,
      comment: 'Comment valide pour test, minimum 10 caractères',
      status: 'pending' as const, // ✗ devrait être 'published'
      anonymized: false,
      creditsAwarded: false,
      createdAt: serverTimestamp(),
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr4-wrong-status'), payload));
      passManually('RR4 5★ + status=pending (mauvais auto) → REJET');
    } catch (e) {
      failManually('RR4 (expected fail)', e);
    }
  }

  // RR5 : 1★ + anonymized=false → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = {
      ...validLowRatingPayload({
        reviewerId: REVIEWER_UID,
        revieweeId: REVIEWEE_UID,
        rating: 1,
      }),
      anonymized: false, // ✗ devrait être true pour 1-2★
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr5-wrong-anon'), payload));
      passManually('RR5 1★ + anonymized=false (mauvaise anonymisation) → REJET');
    } catch (e) {
      failManually('RR5 (expected fail)', e);
    }
  }

  // RR6 : creditsAwarded=true à la création → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = {
      ...validHighRatingPayload({
        reviewerId: REVIEWER_UID,
        revieweeId: REVIEWEE_UID,
        rating: 5,
        futureMs,
      }),
      creditsAwarded: true, // ✗ devrait être false (server-managed)
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr6-bypass-bonus'), payload));
      passManually('RR6 creditsAwarded=true création (bypass anti-double) → REJET');
    } catch (e) {
      failManually('RR6 (expected fail)', e);
    }
  }

  // RR7 : moderatedBy/moderatedAt présents → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = {
      ...validHighRatingPayload({
        reviewerId: REVIEWER_UID,
        revieweeId: REVIEWEE_UID,
        rating: 5,
        futureMs,
      }),
      moderatedBy: ADMIN_UID, // ✗ devrait être absent (server-managed)
      moderatedAt: serverTimestamp(),
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reviews', 'rr7-spoof-mod'), payload));
      passManually('RR7 moderatedBy/moderatedAt présents au create → REJET');
    } catch (e) {
      failManually('RR7 (expected fail)', e);
    }
  }

  // RR8 : 4★ happy path → SUCCESS
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = validHighRatingPayload({
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWEE_UID,
      rating: 4,
      futureMs,
    });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'reviews', 'rr8-happy-high'), payload));
      passManually('RR8 4★ + status=published + anonymized=false (happy 3-5★) → SUCCESS');
    } catch (e) {
      failManually('RR8 (expected success)', e);
    }
  }

  // RR9 : 2★ happy path → SUCCESS
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    const payload = validLowRatingPayload({
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWEE_UID,
      rating: 2,
    });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'reviews', 'rr9-happy-low'), payload));
      passManually('RR9 2★ + status=pending + anonymized=true (happy 1-2★) → SUCCESS');
    } catch (e) {
      failManually('RR9 (expected success)', e);
    }
  }

  // ===================================================================
  // UPDATE rules (RR10-RR14)
  // ===================================================================
  section('UPDATE rules (RR10-RR14)');

  // Setup : review published 5★ pour tests UPDATE (created by REVIEWER_UID, editableUntil future)
  const PUBLISHED_REVIEW_ID = 'rr-update-target';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID), {
      reviewId: PUBLISHED_REVIEW_ID,
      activityId: ACTIVITY_ID,
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWEE_UID,
      rating: 5,
      comment: 'Comment original pour les tests update',
      status: 'published',
      anonymized: false,
      publishedAt: Timestamp.now(),
      editableUntil: Timestamp.fromMillis(futureMs),
      creditsAwarded: false,
      createdAt: Timestamp.now(),
    });
  });

  // RR10 : update par non-reviewer → REJET
  {
    const otherCtx = env.authenticatedContext(OTHER_UID);
    const fbDb = asFirestore(otherCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID), {
          comment: 'Tentative malicious update par non-author',
        }),
      );
      passManually('RR10 update par non-reviewer → REJET');
    } catch (e) {
      failManually('RR10 (expected fail)', e);
    }
  }

  // RR11 : update status (mutation interdite client) → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID), {
          status: 'rejected', // ✗ status n'est PAS dans hasOnly(['comment', 'rating'])
        }),
      );
      passManually('RR11 update status (mutation interdite client) → REJET');
    } catch (e) {
      failManually('RR11 (expected fail)', e);
    }
  }

  // RR12 : cross-tier rating 5→1 → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID), {
          rating: 1, // ✗ cross-tier (resource.rating=5, request.rating=1)
        }),
      );
      passManually('RR12 cross-tier rating 5→1 → REJET');
    } catch (e) {
      failManually('RR12 (expected fail)', e);
    }
  }

  // RR13 : intra-tier rating 5→4 + comment → SUCCESS
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID), {
          rating: 4,
          comment: 'Comment révisé après réflexion intra-tier',
        }),
      );
      passManually('RR13 intra-tier rating 5→4 + comment → SUCCESS');
    } catch (e) {
      failManually('RR13 (expected success)', e);
    }
  }

  // RR14 : update après editableUntil → REJET
  // Setup : review avec editableUntil dans le passé
  const EXPIRED_REVIEW_ID = 'rr-update-expired';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'reviews', EXPIRED_REVIEW_ID), {
      reviewId: EXPIRED_REVIEW_ID,
      activityId: ACTIVITY_ID,
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWEE_UID,
      rating: 5,
      comment: 'Comment original pour test edit-window-closed',
      status: 'published',
      anonymized: false,
      publishedAt: Timestamp.fromMillis(Date.now() - 48 * 60 * 60 * 1000),
      editableUntil: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000), // 24h ago
      creditsAwarded: true,
      createdAt: Timestamp.fromMillis(Date.now() - 48 * 60 * 60 * 1000),
    });
  });
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'reviews', EXPIRED_REVIEW_ID), {
          comment: 'Tentative edit après editableUntil',
        }),
      );
      passManually('RR14 update après editableUntil → REJET');
    } catch (e) {
      failManually('RR14 (expected fail)', e);
    }
  }

  // ===================================================================
  // DELETE rules (RR15)
  // ===================================================================
  section('DELETE rules (RR15)');

  // RR15 : delete par non-admin → REJET
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID)));
      passManually('RR15 delete par non-admin (reviewer self-delete) → REJET');
    } catch (e) {
      failManually('RR15 (expected fail)', e);
    }
  }

  // ===================================================================
  // READ rules (RR16-RR18)
  // ===================================================================
  section('READ rules (RR16-RR18)');

  // Setup : review en pending pour tests read
  const PENDING_REVIEW_ID = 'rr-read-pending';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'reviews', PENDING_REVIEW_ID), {
      reviewId: PENDING_REVIEW_ID,
      activityId: ACTIVITY_ID,
      reviewerId: REVIEWER_UID,
      revieweeId: REVIEWEE_UID,
      rating: 1,
      comment: 'Pending review pour tests read access',
      status: 'pending',
      anonymized: true,
      creditsAwarded: false,
      createdAt: Timestamp.now(),
    });
  });

  // RR16 : read pending par auteur → SUCCESS
  {
    const reviewerCtx = env.authenticatedContext(REVIEWER_UID);
    const fbDb = asFirestore(reviewerCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'reviews', PENDING_REVIEW_ID)));
      passManually('RR16 read pending par auteur → SUCCESS');
    } catch (e) {
      failManually('RR16 (expected success)', e);
    }
  }

  // RR17 : read pending par autre user (non-admin) → REJET
  {
    const otherCtx = env.authenticatedContext(OTHER_UID);
    const fbDb = asFirestore(otherCtx.firestore());
    try {
      await assertFails(getDoc(doc(fbDb, 'reviews', PENDING_REVIEW_ID)));
      passManually('RR17 read pending par autre user non-admin → REJET');
    } catch (e) {
      failManually('RR17 (expected fail)', e);
    }
  }

  // RR18 : read published par anyone → SUCCESS
  {
    const otherCtx = env.authenticatedContext(OTHER_UID);
    const fbDb = asFirestore(otherCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'reviews', PUBLISHED_REVIEW_ID)));
      passManually('RR18 read published par autre user → SUCCESS');
    } catch (e) {
      failManually('RR18 (expected success)', e);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Reviews rules (RR1-RR18) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
