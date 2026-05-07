/**
 * Tests Phase 8 sub-chantier 1 commit 1/5 — Firestore rules /chats/{matchId}/messages
 * (modification §A doctrine "chat reste ouvert post-event" + check credits sender)
 * + /aiScanLogs/{id} (nouvelle collection server-only).
 *
 * Exécution :
 *   npm run test:chat:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/chat/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4 (cohérent tests/blocks/rules.test.ts).
 *
 * Couverture (6 cas CHAT1-CHAT6) :
 *
 * CREATE rules /chats/{matchId}/messages (modifiées Phase 8 commit 1/5) :
 *   CHAT1 : create message, session.status='completed', credits=10 → SUCCESS (Phase 8 inversion)
 *   CHAT2 : create message, session.status='cancelled', credits=10 → REJET (block préservé)
 *   CHAT3 : create message, session.status='completed', credits=0 → REJET (additif credits ≥ 1)
 *   CHAT4 : create message non-participant (charlie), credits=10 → REJET (rule participants préservée)
 *   CHAT5 : create message legacy match sans sessionId, credits=10 → SUCCESS (rétro-compat Phase 1)
 *
 * CREATE rules /aiScanLogs/ (nouvelle collection Phase 8 commit 1/5) :
 *   CHAT6 : create aiScanLog client-side (alice) → REJET (server-only via Admin SDK)
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
  setDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/** Cast helper rules-unit-testing v4 (cohérent blocks/rules.test.ts). */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner (cohérent blocks/rules.test.ts)
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

const ALICE_UID = 'user_alice_chat';
const BOB_UID = 'user_bob_chat';
const CHARLIE_UID = 'user_charlie_chat';
const POOR_UID = 'user_poor_chat';

const MATCH_COMPLETED_ID = 'match_completed';
const MATCH_CANCELLED_ID = 'match_cancelled';
const MATCH_POOR_ID = 'match_poor';
const MATCH_LEGACY_ID = 'match_legacy';

const SESSION_COMPLETED_ID = 'session_completed';
const SESSION_CANCELLED_ID = 'session_cancelled';

/** Build minimal user doc with credits balance. */
function seedUser(uid: string, credits: number) {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: `User ${uid}`,
    photoURL: '',
    bio: '',
    gender: 'other' as const,
    city: '',
    canton: '',
    sports: [],
    credits,
    referralCode: '',
    referredBy: '',
    isCreator: false,
    role: 'user' as const,
    isPremium: false,
    fcmToken: '',
    language: 'fr' as const,
    onboardingComplete: true,
    lastActive: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

/** Build match doc — chatUnlocked + optional sessionId. */
function seedMatch(matchId: string, participantA: string, participantB: string, sessionId?: string) {
  return {
    matchId,
    userIds: [participantA, participantB].sort(),
    user1: { uid: participantA, displayName: participantA, photoURL: '' },
    user2: { uid: participantB, displayName: participantB, photoURL: '' },
    status: 'accepted' as const,
    activityId: 'activity_test',
    sport: 'tennis',
    chatUnlocked: true,
    initiatedBy: participantA,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...(sessionId ? { sessionId } : {}),
  };
}

/** Build chat doc — participants array. */
function seedChat(chatId: string, participantA: string, participantB: string) {
  return {
    chatId,
    participants: [participantA, participantB],
    lastMessage: '',
    lastMessageAt: Timestamp.now(),
    unreadCount: { [participantA]: 0, [participantB]: 0 },
  };
}

/** Build session doc with given status. */
function seedSession(sessionId: string, status: 'active' | 'completed' | 'cancelled') {
  return {
    sessionId,
    activityId: 'activity_test',
    partnerId: 'partner_test',
    title: 'Test Session',
    sport: 'tennis',
    startAt: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
    endAt: Timestamp.fromMillis(Date.now() - 23 * 60 * 60 * 1000),
    location: { city: 'Geneva', canton: 'GE' },
    maxParticipants: 8,
    currentParticipants: 2,
    status,
    pricingTiers: [],
    currentTier: 0,
    currentPrice: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

/** Build a valid message payload (cohérent ChatMessage shape). */
function validMessagePayload(senderId: string) {
  return {
    senderId,
    text: 'hello',
    type: 'text' as const,
    readBy: [senderId],
    createdAt: serverTimestamp(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-chat-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ===================================================================
  // SETUP : seed users + matches + chats + sessions via security-disabled
  // ===================================================================
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());

    // Users with varying credits
    await setDoc(doc(fbDb, 'users', ALICE_UID), seedUser(ALICE_UID, 10));
    await setDoc(doc(fbDb, 'users', BOB_UID), seedUser(BOB_UID, 10));
    await setDoc(doc(fbDb, 'users', CHARLIE_UID), seedUser(CHARLIE_UID, 10));
    await setDoc(doc(fbDb, 'users', POOR_UID), seedUser(POOR_UID, 0));

    // Sessions with varying status
    await setDoc(doc(fbDb, 'sessions', SESSION_COMPLETED_ID), seedSession(SESSION_COMPLETED_ID, 'completed'));
    await setDoc(doc(fbDb, 'sessions', SESSION_CANCELLED_ID), seedSession(SESSION_CANCELLED_ID, 'cancelled'));

    // Matches : completed (alice+bob), cancelled (alice+bob), poor (alice+poor), legacy no sessionId (alice+bob)
    await setDoc(doc(fbDb, 'matches', MATCH_COMPLETED_ID), seedMatch(MATCH_COMPLETED_ID, ALICE_UID, BOB_UID, SESSION_COMPLETED_ID));
    await setDoc(doc(fbDb, 'matches', MATCH_CANCELLED_ID), seedMatch(MATCH_CANCELLED_ID, ALICE_UID, BOB_UID, SESSION_CANCELLED_ID));
    await setDoc(doc(fbDb, 'matches', MATCH_POOR_ID), seedMatch(MATCH_POOR_ID, ALICE_UID, POOR_UID, SESSION_COMPLETED_ID));
    await setDoc(doc(fbDb, 'matches', MATCH_LEGACY_ID), seedMatch(MATCH_LEGACY_ID, ALICE_UID, BOB_UID)); // no sessionId

    // Chats (chatId === matchId)
    await setDoc(doc(fbDb, 'chats', MATCH_COMPLETED_ID), seedChat(MATCH_COMPLETED_ID, ALICE_UID, BOB_UID));
    await setDoc(doc(fbDb, 'chats', MATCH_CANCELLED_ID), seedChat(MATCH_CANCELLED_ID, ALICE_UID, BOB_UID));
    await setDoc(doc(fbDb, 'chats', MATCH_POOR_ID), seedChat(MATCH_POOR_ID, ALICE_UID, POOR_UID));
    await setDoc(doc(fbDb, 'chats', MATCH_LEGACY_ID), seedChat(MATCH_LEGACY_ID, ALICE_UID, BOB_UID));
  });

  // ===================================================================
  // CREATE rules /chats/{matchId}/messages (CHAT1-CHAT5)
  // ===================================================================
  section('CREATE rules /chats/{matchId}/messages : Phase 8 inversion + credits (CHAT1-CHAT5)');

  // CHAT1 : Phase 8 happy path — completed + credits=10 → SUCCESS (Phase 8 inversion)
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const msgRef = doc(fbDb, 'chats', MATCH_COMPLETED_ID, 'messages', 'msg_chat1');
    try {
      await assertSucceeds(setDoc(msgRef, validMessagePayload(ALICE_UID)));
      passManually('CHAT1 create completed + credits=10 (alice) → SUCCESS (Phase 8 inversion §A)');
    } catch (e) {
      failManually('CHAT1 (expected success Phase 8)', e);
    }
  }

  // CHAT2 : cancelled status → REJET (block préservé)
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const msgRef = doc(fbDb, 'chats', MATCH_CANCELLED_ID, 'messages', 'msg_chat2');
    try {
      await assertFails(setDoc(msgRef, validMessagePayload(ALICE_UID)));
      passManually('CHAT2 create cancelled status → REJET (block préservé doctrine §A)');
    } catch (e) {
      failManually('CHAT2 (expected fail)', e);
    }
  }

  // CHAT3 : completed + credits=0 → REJET (additif credits ≥ 1)
  {
    const poorCtx = env.authenticatedContext(POOR_UID);
    const fbDb = asFirestore(poorCtx.firestore());
    const msgRef = doc(fbDb, 'chats', MATCH_POOR_ID, 'messages', 'msg_chat3');
    try {
      await assertFails(setDoc(msgRef, validMessagePayload(POOR_UID)));
      passManually('CHAT3 create completed + credits=0 (poor) → REJET (additif credits ≥ 1)');
    } catch (e) {
      failManually('CHAT3 (expected fail)', e);
    }
  }

  // CHAT4 : non-participant (charlie) → REJET (rule participants préservée)
  {
    const charlieCtx = env.authenticatedContext(CHARLIE_UID);
    const fbDb = asFirestore(charlieCtx.firestore());
    const msgRef = doc(fbDb, 'chats', MATCH_COMPLETED_ID, 'messages', 'msg_chat4');
    try {
      await assertFails(setDoc(msgRef, validMessagePayload(CHARLIE_UID)));
      passManually('CHAT4 create non-participant (charlie) → REJET (rule participants préservée)');
    } catch (e) {
      failManually('CHAT4 (expected fail)', e);
    }
  }

  // CHAT5 : legacy match sans sessionId + credits=10 → SUCCESS (rétro-compat Phase 1)
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const msgRef = doc(fbDb, 'chats', MATCH_LEGACY_ID, 'messages', 'msg_chat5');
    try {
      await assertSucceeds(setDoc(msgRef, validMessagePayload(ALICE_UID)));
      passManually('CHAT5 create legacy match sans sessionId + credits=10 → SUCCESS (rétro-compat Phase 1)');
    } catch (e) {
      failManually('CHAT5 (expected success rétro-compat)', e);
    }
  }

  // ===================================================================
  // CREATE rules /aiScanLogs/{id} (CHAT6)
  // ===================================================================
  section('CREATE rules /aiScanLogs/{id} : server-only (CHAT6)');

  // CHAT6 : alice tente create aiScanLog client-side → REJET (server-only)
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const scanRef = doc(fbDb, 'aiScanLogs', 'scan_chat6');
    try {
      await assertFails(
        setDoc(scanRef, {
          scanLogId: 'scan_chat6',
          chatId: MATCH_COMPLETED_ID,
          senderId: ALICE_UID,
          score: 0,
          motive: 'clean',
          messageHash: 'fake_hash',
          createdAt: serverTimestamp(),
        }),
      );
      passManually('CHAT6 create aiScanLog client-side → REJET (server-only via Admin SDK)');
    } catch (e) {
      failManually('CHAT6 (expected fail server-only)', e);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Chat rules (CHAT1-CHAT6) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
