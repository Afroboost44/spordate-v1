/**
 * Tests Phase 8 sub-chantier 1 commit 3/5 — sendMessage service emulator-based.
 *
 * Exécution :
 *   npm run test:chat:service
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/chat/service.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing v4 + DI seam
 * `__setChatDbForTesting` (cohérent tests/sessions-integration.test.ts).
 *
 * Couverture (8 cas SVC1-SVC8) :
 *
 * SVC1 happy path clean        : alice 10c + completed + "salut" → SUCCESS, credit -1, log clean
 * SVC2 phone CH detection      : alice 10c + "079 123 45 67" → SUCCESS, log score=0.5 motive='phone-ch'
 * SVC3 credits=0 throw         : poor → throw 'insufficient-credits', no side effect
 * SVC4 cancelled throw         : alice + cancelled session → throw permission-denied (rule)
 * SVC5 multi-cat priority      : alice + "079 et test@mail.com" → log score=0.8 motive='phone-ch' (priority)
 * SVC6 hash determinism        : 2× même message → 2 logs avec messageHash identique
 * SVC7 batch atomicity         : alice + cancelled → throw + credits unchanged + no aiScanLog
 * SVC8 clean motive enum       : "salut, à demain" → log motive='clean' score=0
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
  collection,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import { __setChatDbForTesting, sendMessage } from '../../src/services/firestore';

/** Cast helper rules-unit-testing v4. */
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

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass(label);
  } else {
    fail(`${label} (actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)})`);
  }
}

async function assertThrows(
  fn: () => Promise<unknown>,
  expectedSubstring: string,
  label: string,
): Promise<void> {
  try {
    await fn();
    fail(`${label} (expected throw containing "${expectedSubstring}", got success)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes(expectedSubstring.toLowerCase())) {
      pass(label);
    } else {
      fail(`${label} (expected substring "${expectedSubstring}", got "${msg}")`);
    }
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Constantes
// =====================================================================

const ALICE_UID = 'user_alice_svc';
const BOB_UID = 'user_bob_svc';
const POOR_UID = 'user_poor_svc';

const MATCH_ACTIVE_ID = 'match_svc_active';
const MATCH_CANCELLED_ID = 'match_svc_cancelled';
const MATCH_POOR_ID = 'match_svc_poor';

const SESSION_ACTIVE_ID = 'session_svc_active';
const SESSION_CANCELLED_ID = 'session_svc_cancelled';

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

function seedMatch(matchId: string, a: string, b: string, sessionId?: string) {
  return {
    matchId,
    userIds: [a, b].sort(),
    user1: { uid: a, displayName: a, photoURL: '' },
    user2: { uid: b, displayName: b, photoURL: '' },
    status: 'accepted' as const,
    activityId: 'act_test',
    sport: 'tennis',
    chatUnlocked: true,
    initiatedBy: a,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...(sessionId ? { sessionId } : {}),
  };
}

function seedChat(chatId: string, a: string, b: string) {
  return {
    chatId,
    participants: [a, b],
    lastMessage: '',
    lastMessageAt: Timestamp.now(),
    unreadCount: { [a]: 0, [b]: 0 },
  };
}

function seedSession(sessionId: string, status: 'active' | 'completed' | 'cancelled') {
  return {
    sessionId,
    activityId: 'act_test',
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

// =====================================================================

async function getCreditsViaAdmin(env: RulesTestEnvironment, uid: string): Promise<number> {
  let credits = -1;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    const snap = await getDoc(doc(fbDb, 'users', uid));
    credits = (snap.data()?.credits as number | undefined) ?? -1;
  });
  return credits;
}

async function getScanLogsForChatViaAdmin(
  env: RulesTestEnvironment,
  chatId: string,
): Promise<Array<{ score: number; motive: string; messageHash: string }>> {
  const out: Array<{ score: number; motive: string; messageHash: string }> = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    const q = query(collection(fbDb, 'aiScanLogs'), where('chatId', '==', chatId));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data();
      out.push({
        score: data.score as number,
        motive: data.motive as string,
        messageHash: data.messageHash as string,
      });
    });
  });
  return out;
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-chat-service',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // SETUP
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'users', ALICE_UID), seedUser(ALICE_UID, 10));
    await setDoc(doc(fbDb, 'users', BOB_UID), seedUser(BOB_UID, 10));
    await setDoc(doc(fbDb, 'users', POOR_UID), seedUser(POOR_UID, 0));
    await setDoc(doc(fbDb, 'sessions', SESSION_ACTIVE_ID), seedSession(SESSION_ACTIVE_ID, 'active'));
    await setDoc(doc(fbDb, 'sessions', SESSION_CANCELLED_ID), seedSession(SESSION_CANCELLED_ID, 'cancelled'));
    await setDoc(doc(fbDb, 'matches', MATCH_ACTIVE_ID), seedMatch(MATCH_ACTIVE_ID, ALICE_UID, BOB_UID, SESSION_ACTIVE_ID));
    await setDoc(doc(fbDb, 'matches', MATCH_CANCELLED_ID), seedMatch(MATCH_CANCELLED_ID, ALICE_UID, BOB_UID, SESSION_CANCELLED_ID));
    await setDoc(doc(fbDb, 'matches', MATCH_POOR_ID), seedMatch(MATCH_POOR_ID, ALICE_UID, POOR_UID, SESSION_ACTIVE_ID));
    await setDoc(doc(fbDb, 'chats', MATCH_ACTIVE_ID), seedChat(MATCH_ACTIVE_ID, ALICE_UID, BOB_UID));
    await setDoc(doc(fbDb, 'chats', MATCH_CANCELLED_ID), seedChat(MATCH_CANCELLED_ID, ALICE_UID, BOB_UID));
    await setDoc(doc(fbDb, 'chats', MATCH_POOR_ID), seedChat(MATCH_POOR_ID, ALICE_UID, POOR_UID));
  });

  // ===================================================================
  // SVC1 happy path clean
  // ===================================================================
  section('SVC1 happy path clean message');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, 'salut, on se voit jeudi ?');
      assertEq(typeof result.messageId === 'string' && result.messageId.length > 0, true, 'SVC1 messageId returned');
      assertEq(result.scanFlagged, false, 'SVC1 scanFlagged=false (clean message)');
      assertEq(result.scanScore, 0, 'SVC1 scanScore=0 (clean)');
      const credits = await getCreditsViaAdmin(env, ALICE_UID);
      assertEq(credits, 9, 'SVC1 alice credits 10 → 9 (decremented)');
      const logs = await getScanLogsForChatViaAdmin(env, MATCH_ACTIVE_ID);
      assertEq(logs.length, 1, 'SVC1 1 aiScanLog créé');
      assertEq(logs[0].motive, 'clean', "SVC1 log motive='clean'");
    } catch (e) {
      fail('SVC1 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC2 phone CH detection — log score=0.5 motive='phone-ch'
  // ===================================================================
  section('SVC2 phone CH detection');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, 'appelle-moi 079 123 45 67');
      assertEq(result.scanFlagged, true, 'SVC2 scanFlagged=true');
      assertEq(result.scanScore, 0.5, 'SVC2 scanScore=0.5');
      const logs = await getScanLogsForChatViaAdmin(env, MATCH_ACTIVE_ID);
      const last = logs[logs.length - 1];
      assertEq(last.motive, 'phone-ch', "SVC2 log motive='phone-ch'");
    } catch (e) {
      fail('SVC2 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC3 credits=0 throw 'insufficient-credits'
  // ===================================================================
  section('SVC3 credits=0 throw');
  {
    const poorCtx = env.authenticatedContext(POOR_UID);
    __setChatDbForTesting(asFirestore(poorCtx.firestore()));
    const creditsBefore = await getCreditsViaAdmin(env, POOR_UID);
    await assertThrows(
      () => sendMessage(MATCH_POOR_ID, POOR_UID, 'salut'),
      'insufficient-credits',
      'SVC3 throw insufficient-credits (poor 0 credits)',
    );
    const creditsAfter = await getCreditsViaAdmin(env, POOR_UID);
    assertEq(creditsAfter, creditsBefore, 'SVC3 credits unchanged après throw (no side effect)');
  }

  // ===================================================================
  // SVC4 cancelled session throw permission-denied
  // ===================================================================
  section('SVC4 cancelled session throw');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    await assertThrows(
      () => sendMessage(MATCH_CANCELLED_ID, ALICE_UID, 'salut'),
      'permission',
      'SVC4 throw permission-denied (rule cancelled session)',
    );
  }

  // ===================================================================
  // SVC5 multi-cat priority motive='phone-ch'
  // ===================================================================
  section('SVC5 multi-cat priority');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const result = await sendMessage(
        MATCH_ACTIVE_ID,
        ALICE_UID,
        '079 123 45 67 ou test@mail.com',
      );
      assertEq(result.scanScore, 0.8, 'SVC5 scanScore=0.8 (multi-cat)');
      const logs = await getScanLogsForChatViaAdmin(env, MATCH_ACTIVE_ID);
      const last = logs[logs.length - 1];
      assertEq(last.motive, 'phone-ch', "SVC5 motive='phone-ch' (priority)");
    } catch (e) {
      fail('SVC5 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC6 hash determinism — 2× même message → hash identique
  // ===================================================================
  section('SVC6 hash determinism');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, 'message hash determinism test');
      await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, 'message hash determinism test');
      const logs = await getScanLogsForChatViaAdmin(env, MATCH_ACTIVE_ID);
      // Filter logs avec ce text exact via hash matching (les 2 derniers sont les nouveaux)
      const hashes = logs.map((l) => l.messageHash);
      const targetHashCount = hashes.filter((h) => h === hashes[hashes.length - 1]).length;
      assertEq(targetHashCount >= 2, true, 'SVC6 messageHash identique pour même text (déterministe SHA-256)');
    } catch (e) {
      fail('SVC6 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC7 batch atomicity — credits préservés sur rule failure
  // ===================================================================
  section('SVC7 batch atomicity (cancelled → no side effect)');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    const creditsBefore = await getCreditsViaAdmin(env, ALICE_UID);
    const logsBefore = await getScanLogsForChatViaAdmin(env, MATCH_CANCELLED_ID);
    await assertThrows(
      () => sendMessage(MATCH_CANCELLED_ID, ALICE_UID, 'tentative dans cancelled'),
      'permission',
      'SVC7 throw permission-denied (rule)',
    );
    const creditsAfter = await getCreditsViaAdmin(env, ALICE_UID);
    const logsAfter = await getScanLogsForChatViaAdmin(env, MATCH_CANCELLED_ID);
    assertEq(creditsAfter, creditsBefore, 'SVC7 credits unchanged (batch rollback)');
    assertEq(logsAfter.length, logsBefore.length, 'SVC7 aucun aiScanLog créé pour ce chat (batch rollback)');
  }

  // ===================================================================
  // SVC8 clean motive enum — non-flag message
  // ===================================================================
  section('SVC8 clean motive enum (non-flag)');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, "salut, à demain pour la session !");
      assertEq(result.scanFlagged, false, 'SVC8 scanFlagged=false');
      assertEq(result.scanScore, 0, 'SVC8 scanScore=0');
      const logs = await getScanLogsForChatViaAdmin(env, MATCH_ACTIVE_ID);
      const last = logs[logs.length - 1];
      assertEq(last.motive, 'clean', "SVC8 motive='clean' (enum SC1 valide)");
    } catch (e) {
      fail('SVC8 sendMessage threw', e);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setChatDbForTesting(null); // reset DI seam
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Chat service (SVC1-SVC8) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
