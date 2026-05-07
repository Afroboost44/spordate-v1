/**
 * Tests Phase 8 sub-chantier 4 commit 2/6 — Invite service helpers.
 *
 * Exécution :
 *   npm run test:invites:service
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/invites/service.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing v4 + DI seam
 * `__setInvitesDbForTesting` (cohérent SC1+SC2+SC3).
 *
 * Couverture (8 cas INV-S1-INV-S8) :
 *   INV-S1 createInvite happy path → SUCCESS doc créé
 *   INV-S2 createInvite self-invite (from==to) → throw 'self-invite-forbidden'
 *   INV-S3 createInvite expiresAt clamped à sessionStart-1h si <7j
 *   INV-S4 acceptInvite par toUserId → status='accepted' + acceptedAt set
 *   INV-S5 acceptInvite par fromUserId → throw 'forbidden'
 *   INV-S6 acceptInvite si status!='pending' → throw 'invalid-status' (idempotency)
 *   INV-S7 declineInvite par toUserId → status='declined' + declinedAt set
 *   INV-S8 expireInvitesIfDue → batch update pending+expired (Admin SDK bypass rules)
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  getDoc,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setInvitesDbForTesting,
  createInvite,
  acceptInvite,
  declineInvite,
  expireInvitesIfDue,
  makeInviteDocId,
  InviteError,
} from '../../src/lib/invites/service';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, err?: unknown): void {
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

const ALICE_UID = 'user_alice_invs';
const BOB_UID = 'user_bob_invs';
const CHARLIE_UID = 'user_charlie_invs';

const ACTIVITY_ID = 'activity_invs_1';

// Sessions seedées avec startAt variés (pour test clamping Q3=C)
const SESSION_FAR_ID = 'session_far_8days'; // startAt now + 8 jours → Min = now + 7j (clamp)
const SESSION_CLOSE_ID = 'session_close_3days'; // startAt now + 3 jours → Min = now + 3j - 1h
const SESSION_TOO_SOON_ID = 'session_too_soon'; // startAt now + 30min → throw
const SESSION_GENERIC_ID = 'session_generic'; // startAt now + 5 jours (cas généraux)

function seedSessionPayload(sessionId: string, startAtMs: number) {
  const endAtMs = startAtMs + 60 * 60_000;
  return {
    sessionId,
    activityId: ACTIVITY_ID,
    partnerId: 'partner_test',
    creatorId: 'creator_test',
    sport: 'tennis',
    title: 'Test Session',
    city: 'Geneva',
    startAt: Timestamp.fromMillis(startAtMs),
    endAt: Timestamp.fromMillis(endAtMs),
    chatOpenAt: Timestamp.fromMillis(startAtMs - 2 * 60 * 60_000),
    chatCloseAt: Timestamp.fromMillis(endAtMs),
    maxParticipants: 8,
    currentParticipants: 0,
    pricingTiers: [],
    currentTier: 'early' as const,
    currentPrice: 2500,
    status: 'open' as const,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-invs-svc',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // SETUP : seed sessions via security-disabled
  const nowMs = Date.now();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'sessions', SESSION_FAR_ID), seedSessionPayload(SESSION_FAR_ID, nowMs + 8 * 24 * 60 * 60_000));
    await setDoc(doc(fbDb, 'sessions', SESSION_CLOSE_ID), seedSessionPayload(SESSION_CLOSE_ID, nowMs + 3 * 24 * 60 * 60_000));
    await setDoc(doc(fbDb, 'sessions', SESSION_TOO_SOON_ID), seedSessionPayload(SESSION_TOO_SOON_ID, nowMs + 30 * 60_000));
    await setDoc(doc(fbDb, 'sessions', SESSION_GENERIC_ID), seedSessionPayload(SESSION_GENERIC_ID, nowMs + 5 * 24 * 60 * 60_000));
  });

  // ===================================================================
  // INV-S1 createInvite happy path
  // ===================================================================
  section('INV-S1 createInvite happy path → SUCCESS doc créé');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setInvitesDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const inviteId = await createInvite({
        fromUserId: ALICE_UID,
        toUserId: BOB_UID,
        activityId: ACTIVITY_ID,
        sessionId: SESSION_GENERIC_ID,
      });
      const expectedId = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_GENERIC_ID);
      if (inviteId === expectedId) {
        pass('INV-S1 inviteId match doc-id pattern');
      } else {
        fail('INV-S1 inviteId mismatch', { inviteId, expectedId });
      }

      // Verify doc créé via admin
      await env.withSecurityRulesDisabled(async (ctx) => {
        const fbDb = asFirestore(ctx.firestore());
        const snap = await getDoc(doc(fbDb, 'invites', inviteId));
        if (snap.exists() && snap.data()?.status === 'pending' && snap.data()?.fromUserId === ALICE_UID) {
          pass('INV-S1 doc persisté status=pending fromUserId=alice');
        } else {
          fail('INV-S1 doc inexistant ou data incorrect', snap.data());
        }
      });
    } catch (e) {
      fail('INV-S1 createInvite threw', e);
    }
  }

  // ===================================================================
  // INV-S2 self-invite throw
  // ===================================================================
  section('INV-S2 self-invite (from==to) → throw self-invite-forbidden');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setInvitesDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      await createInvite({
        fromUserId: ALICE_UID,
        toUserId: ALICE_UID,
        activityId: ACTIVITY_ID,
        sessionId: SESSION_GENERIC_ID,
      });
      fail('INV-S2 createInvite aurait dû throw');
    } catch (err) {
      if (err instanceof InviteError && err.code === 'self-invite-forbidden') {
        pass('INV-S2 self-invite → throw InviteError(self-invite-forbidden)');
      } else {
        fail('INV-S2 wrong error type', err);
      }
    }
  }

  // ===================================================================
  // INV-S3 expiresAt clamping (sessionStart - 1h si < 7j)
  // ===================================================================
  section('INV-S3 expiresAt clamped à sessionStart-1h (Q3=C)');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setInvitesDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const inviteId = await createInvite({
        fromUserId: ALICE_UID,
        toUserId: BOB_UID,
        activityId: ACTIVITY_ID,
        sessionId: SESSION_CLOSE_ID, // startAt now + 3j
      });

      await env.withSecurityRulesDisabled(async (ctx) => {
        const fbDb = asFirestore(ctx.firestore());
        const snap = await getDoc(doc(fbDb, 'invites', inviteId));
        const expiresAtMs = (snap.data()?.expiresAt as Timestamp).toMillis();
        const sessionStartMs = nowMs + 3 * 24 * 60 * 60_000;
        const expectedClampMs = sessionStartMs - 60 * 60_000; // sessionStart - 1h
        const sevenDaysMs = nowMs + 7 * 24 * 60 * 60_000;
        // expiresAt should be clamped to sessionStart-1h (which is < 7j here)
        // Allow ~5s tolerance for serverTimestamp + setDoc latency
        const tolerance = 5_000;
        if (
          Math.abs(expiresAtMs - expectedClampMs) < tolerance &&
          expiresAtMs < sevenDaysMs
        ) {
          pass('INV-S3 expiresAt clamped à sessionStart-1h (< 7j seuil)');
        } else {
          fail('INV-S3 clamp incorrect', { expiresAtMs, expectedClampMs, sevenDaysMs });
        }
      });
    } catch (e) {
      fail('INV-S3 createInvite threw', e);
    }
  }

  // ===================================================================
  // SETUP : invite pending alice→bob session_generic_2 pour INV-S4-S6
  // ===================================================================
  const SESSION_S4 = 'session_invs_s4';
  const docIdS4 = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_S4);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'sessions', SESSION_S4), seedSessionPayload(SESSION_S4, nowMs + 5 * 24 * 60 * 60_000));
    await setDoc(doc(fbDb, 'invites', docIdS4), {
      inviteId: docIdS4,
      fromUserId: ALICE_UID,
      toUserId: BOB_UID,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_S4,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60_000 - 60 * 60_000),
      createdAt: Timestamp.now(),
    });
  });

  // ===================================================================
  // INV-S4 acceptInvite par toUserId
  // ===================================================================
  section('INV-S4 acceptInvite par toUserId (bob) → SUCCESS');
  {
    const bobCtx = env.authenticatedContext(BOB_UID);
    __setInvitesDbForTesting(asFirestore(bobCtx.firestore()));
    try {
      await acceptInvite(docIdS4, BOB_UID);
      // Verify doc updated
      await env.withSecurityRulesDisabled(async (ctx) => {
        const fbDb = asFirestore(ctx.firestore());
        const snap = await getDoc(doc(fbDb, 'invites', docIdS4));
        const data = snap.data();
        if (data?.status === 'accepted' && data.acceptedAt) {
          pass('INV-S4 status=accepted + acceptedAt set');
        } else {
          fail('INV-S4 update incorrect', data);
        }
      });
    } catch (e) {
      fail('INV-S4 acceptInvite threw', e);
    }
  }

  // ===================================================================
  // INV-S5 acceptInvite par fromUserId
  // ===================================================================
  // Setup : nouvelle invite pending alice→bob session_invs_s5
  const SESSION_S5 = 'session_invs_s5';
  const docIdS5 = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_S5);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'sessions', SESSION_S5), seedSessionPayload(SESSION_S5, nowMs + 5 * 24 * 60 * 60_000));
    await setDoc(doc(fbDb, 'invites', docIdS5), {
      inviteId: docIdS5,
      fromUserId: ALICE_UID,
      toUserId: BOB_UID,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_S5,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60_000 - 60 * 60_000),
      createdAt: Timestamp.now(),
    });
  });

  section('INV-S5 acceptInvite par fromUserId (alice) → throw forbidden');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setInvitesDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      // Alice (fromUserId) tries to accept her own invite — should fail
      await acceptInvite(docIdS5, ALICE_UID);
      fail('INV-S5 acceptInvite aurait dû throw');
    } catch (err) {
      if (err instanceof InviteError && err.code === 'forbidden') {
        pass('INV-S5 acceptInvite par fromUserId → throw InviteError(forbidden)');
      } else {
        fail('INV-S5 wrong error type', err);
      }
    }
  }

  // ===================================================================
  // INV-S6 acceptInvite si status!='pending'
  // ===================================================================
  section('INV-S6 acceptInvite status=accepted (idempotency) → throw invalid-status');
  {
    // Re-utilise docIdS4 qui est maintenant 'accepted' (depuis INV-S4)
    const bobCtx = env.authenticatedContext(BOB_UID);
    __setInvitesDbForTesting(asFirestore(bobCtx.firestore()));
    try {
      await acceptInvite(docIdS4, BOB_UID);
      fail('INV-S6 acceptInvite already-accepted aurait dû throw');
    } catch (err) {
      if (err instanceof InviteError && err.code === 'invalid-status') {
        pass('INV-S6 acceptInvite status=accepted → throw InviteError(invalid-status)');
      } else {
        fail('INV-S6 wrong error type', err);
      }
    }
  }

  // ===================================================================
  // INV-S7 declineInvite par toUserId
  // ===================================================================
  // Setup : nouvelle invite pending charlie→alice session_invs_s7 (charlie invites alice)
  const SESSION_S7 = 'session_invs_s7';
  const docIdS7 = makeInviteDocId(CHARLIE_UID, ALICE_UID, SESSION_S7);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'sessions', SESSION_S7), seedSessionPayload(SESSION_S7, nowMs + 5 * 24 * 60 * 60_000));
    await setDoc(doc(fbDb, 'invites', docIdS7), {
      inviteId: docIdS7,
      fromUserId: CHARLIE_UID,
      toUserId: ALICE_UID,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_S7,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60_000 - 60 * 60_000),
      createdAt: Timestamp.now(),
    });
  });

  section('INV-S7 declineInvite par toUserId (alice) → SUCCESS');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setInvitesDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      await declineInvite(docIdS7, ALICE_UID);
      await env.withSecurityRulesDisabled(async (ctx) => {
        const fbDb = asFirestore(ctx.firestore());
        const snap = await getDoc(doc(fbDb, 'invites', docIdS7));
        const data = snap.data();
        if (data?.status === 'declined' && data.declinedAt) {
          pass('INV-S7 status=declined + declinedAt set');
        } else {
          fail('INV-S7 update incorrect', data);
        }
      });
    } catch (e) {
      fail('INV-S7 declineInvite threw', e);
    }
  }

  // ===================================================================
  // INV-S8 expireInvitesIfDue (Admin SDK bypass rules)
  // ===================================================================
  // Setup : 2 invites pending expirées (expiresAt < now) + 1 invite pending non-expirée
  const SESSION_S8a = 'session_invs_s8a';
  const SESSION_S8b = 'session_invs_s8b';
  const SESSION_S8c = 'session_invs_s8c';
  const docIdS8a = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_S8a);
  const docIdS8b = makeInviteDocId(BOB_UID, CHARLIE_UID, SESSION_S8b);
  const docIdS8c = makeInviteDocId(ALICE_UID, CHARLIE_UID, SESSION_S8c);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    // 2 expirées (expiresAt = now - 1h)
    const pastTs = Timestamp.fromMillis(nowMs - 60 * 60_000);
    await setDoc(doc(fbDb, 'invites', docIdS8a), {
      inviteId: docIdS8a, fromUserId: ALICE_UID, toUserId: BOB_UID,
      activityId: ACTIVITY_ID, sessionId: SESSION_S8a,
      status: 'pending', expiresAt: pastTs, createdAt: Timestamp.now(),
    });
    await setDoc(doc(fbDb, 'invites', docIdS8b), {
      inviteId: docIdS8b, fromUserId: BOB_UID, toUserId: CHARLIE_UID,
      activityId: ACTIVITY_ID, sessionId: SESSION_S8b,
      status: 'pending', expiresAt: pastTs, createdAt: Timestamp.now(),
    });
    // 1 non-expirée (futur)
    const futureTs = Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60_000);
    await setDoc(doc(fbDb, 'invites', docIdS8c), {
      inviteId: docIdS8c, fromUserId: ALICE_UID, toUserId: CHARLIE_UID,
      activityId: ACTIVITY_ID, sessionId: SESSION_S8c,
      status: 'pending', expiresAt: futureTs, createdAt: Timestamp.now(),
    });
  });

  section('INV-S8 expireInvitesIfDue → batch update pending+expired');
  {
    // Use security-disabled context (= Admin SDK bypass) cohérent doctrine SC4 cron Phase 9
    await env.withSecurityRulesDisabled(async (ctx) => {
      __setInvitesDbForTesting(asFirestore(ctx.firestore()));
      try {
        const expiredCount = await expireInvitesIfDue();
        // Au moins les 2 setup INV-S8 doivent être expirés (peut-être plus si autres restes tests)
        if (expiredCount >= 2) {
          pass(`INV-S8 expireInvitesIfDue → ${expiredCount} invites expirés (>=2 setup)`);
        } else {
          fail('INV-S8 expiredCount < 2', { expiredCount });
        }

        // Verify status updates
        const snapA = await getDoc(doc(asFirestore(ctx.firestore()), 'invites', docIdS8a));
        const snapB = await getDoc(doc(asFirestore(ctx.firestore()), 'invites', docIdS8b));
        const snapC = await getDoc(doc(asFirestore(ctx.firestore()), 'invites', docIdS8c));
        if (
          snapA.data()?.status === 'expired' &&
          snapB.data()?.status === 'expired' &&
          snapC.data()?.status === 'pending' // non-expirée preserved
        ) {
          pass('INV-S8 statuses : 2 expired + 1 pending preserved (sélectivité query)');
        } else {
          fail('INV-S8 statuses incorrect', {
            a: snapA.data()?.status,
            b: snapB.data()?.status,
            c: snapC.data()?.status,
          });
        }
      } catch (e) {
        fail('INV-S8 expireInvitesIfDue threw', e);
      }
    });
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setInvitesDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Invites service (INV-S1-INV-S8) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
