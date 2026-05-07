/**
 * Tests Phase 8 sub-chantier 1 commit 3/5 + sub-chantier 2 commit 3/6 — sendMessage service emulator-based.
 *
 * Exécution :
 *   npm run test:chat:service
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/chat/service.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing v4 + DI seam
 * `__setChatDbForTesting` (cohérent tests/sessions-integration.test.ts).
 * Mock IA via __setGenerateFnForTesting depuis anti-leak-classifier (SC2 commit 2/6).
 *
 * Couverture (14 cas SVC1-SVC14) :
 *
 * SC1 (commit 3/5) — base sendMessage + L1 silent log :
 * SVC1 happy path clean        : alice 10c + completed + "salut" → SUCCESS, credit -1, log clean
 * SVC2 phone CH detection      : alice 10c + "079 123 45 67" → SUCCESS, log score=0.5 motive='phone-ch'
 * SVC3 credits=0 throw         : poor → throw 'insufficient-credits', no side effect
 * SVC4 cancelled throw         : alice + cancelled session → throw permission-denied (rule)
 * SVC5 multi-cat priority      : alice + "079 et test@mail.com" → log score=0.8 motive='phone-ch' (priority)
 * SVC6 hash determinism        : 2× même message → 2 logs avec messageHash identique
 * SVC7 batch atomicity         : alice + cancelled → throw + credits unchanged + no aiScanLog
 * SVC8 clean motive enum       : "salut, à demain" → log motive='clean' score=0
 *
 * SC2 (commit 3/6) — IA hybride + escalation :
 * SVC9  ambigu + IA likely=1   : score=0.5 + IA confirme → motive='ai-leak-likely', leakBySender=1, level='L2'
 * SVC10 ambigu + IA likely=0   : score=0.5 + IA infirme → motive='ai-leak-unlikely', flagged=false, level='L0'
 * SVC11 ambigu + IA error      : score=0.5 + Gemini fail → motive='ai-error', preserve L1 (Q5=A)
 * SVC12 escalation L2→L0→L3   : 3 messages flagged → niveaux 'L2'/'L0'/'L3'
 * SVC13 escalation L4         : 5 messages flagged → 5ème = 'L4' (admin email trigger commit 5/6)
 * SVC14 score=0.8 no IA call  : multi-cat → IA pas invoqué, L1 verdict direct, leakBySender++
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
  orderBy,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setChatDbForTesting,
  sendMessage,
  triggerSuggestionsIfEligible,
} from '../../src/services/firestore';
import type { AntiLeakInput, AntiLeakOutput } from '../../src/ai/types';

// Phase 8 SC2 hotfix — Genkit isolated server-only via /api/anti-leak.
// Tests mock global.fetch au lieu de classifier DI seams (le classifier reste
// testable directement par tests/anti-leak/classifier — couverture séparée).
const _originalFetch = global.fetch;

function mockApiFetch(response: AntiLeakOutput): { calls: number; lastBody: AntiLeakInput | null } {
  const tracker = { calls: 0, lastBody: null as AntiLeakInput | null };
  global.fetch = (async (url: unknown, options: unknown) => {
    const urlStr = String(url);
    const opts = options as { body?: string } | undefined;
    if (urlStr.includes('/api/anti-leak')) {
      tracker.calls++;
      tracker.lastBody = opts?.body ? (JSON.parse(opts.body) as AntiLeakInput) : null;
      return {
        ok: true,
        status: 200,
        json: async () => response,
      } as Response;
    }
    return _originalFetch(url as RequestInfo, options as RequestInit);
  }) as typeof global.fetch;
  return tracker;
}

function mockApiFetchHttpError(status = 500): { calls: number } {
  const tracker = { calls: 0 };
  global.fetch = (async (url: unknown) => {
    if (String(url).includes('/api/anti-leak')) {
      tracker.calls++;
      return {
        ok: false,
        status,
        json: async () => ({ error: 'internal-error' }),
      } as Response;
    }
    return _originalFetch(url as RequestInfo);
  }) as typeof global.fetch;
  return tracker;
}

function restoreFetch(): void {
  global.fetch = _originalFetch;
}

// Phase 8 SC3 commit 4/6 — Helpers mock fetch /api/suggest-activities.
function mockSuggestApiFetch(response: Record<string, unknown>): { calls: number; lastBody: { chatId?: string; userId?: string } | null } {
  const tracker = { calls: 0, lastBody: null as { chatId?: string; userId?: string } | null };
  global.fetch = (async (url: unknown, options: unknown) => {
    const urlStr = String(url);
    const opts = options as { body?: string } | undefined;
    if (urlStr.includes('/api/suggest-activities')) {
      tracker.calls++;
      tracker.lastBody = opts?.body ? JSON.parse(opts.body) : null;
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      } as Response;
    }
    return _originalFetch(url as RequestInfo, options as RequestInit);
  }) as typeof global.fetch;
  return tracker;
}

function mockSuggestApiFetchNetworkError(): { calls: number } {
  const tracker = { calls: 0 };
  global.fetch = (async (url: unknown) => {
    if (String(url).includes('/api/suggest-activities')) {
      tracker.calls++;
      throw new Error('Network error simulated');
    }
    return _originalFetch(url as RequestInfo);
  }) as typeof global.fetch;
  return tracker;
}

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

async function getAdminActionsForUserViaAdmin(
  env: RulesTestEnvironment,
  targetId: string,
  actionType: string,
): Promise<Array<{ adminId: string; metadata: Record<string, unknown> | null }>> {
  const out: Array<{ adminId: string; metadata: Record<string, unknown> | null }> = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    const q = query(
      collection(fbDb, 'adminActions'),
      where('targetId', '==', targetId),
      where('actionType', '==', actionType),
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data();
      out.push({
        adminId: data.adminId as string,
        metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
      });
    });
  });
  return out;
}

async function getUserLeakFlaggedViaAdmin(env: RulesTestEnvironment, uid: string): Promise<boolean> {
  let flagged = false;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    const snap = await getDoc(doc(fbDb, 'users', uid));
    flagged = (snap.data()?.leakFlagged as boolean | undefined) ?? false;
  });
  return flagged;
}

async function setUserLeakFlaggedViaAdmin(env: RulesTestEnvironment, uid: string, flagged: boolean): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'users', uid), { leakFlagged: flagged }, { merge: true });
  });
}

async function getScanLogsForChatViaAdmin(
  env: RulesTestEnvironment,
  chatId: string,
): Promise<Array<{ score: number; motive: string; messageHash: string }>> {
  const out: Array<{ score: number; motive: string; messageHash: string }> = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    // orderBy('createdAt', 'asc') critique : sans cet ordre Firestore retourne
    // par doc-id (lexicographique sur auto-IDs random) → tests intermittents
    // sur 'last log'. Cf. CHAT_RULES_TESTS commit 5/5 close-out.
    const q = query(
      collection(fbDb, 'aiScanLogs'),
      where('chatId', '==', chatId),
      orderBy('createdAt', 'asc'),
    );
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
  // SVC2 phone CH detection (multi-occ score=0.6 — hors zone ambigu SC2 IA)
  // ===================================================================
  section('SVC2 phone CH detection (L1 multi-occ, no IA call)');
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      // Multi-occ phone (2× phone-ch même cat) → score=0.6 → IA pas appelée (≠ 0.5).
      // Préserve l'intent SC1 testing L1 phone-ch detection sans wiring IA.
      const result = await sendMessage(
        MATCH_ACTIVE_ID,
        ALICE_UID,
        'appelle-moi 079 123 45 67 ou 079 234 56 78',
      );
      assertEq(result.scanFlagged, true, 'SVC2 scanFlagged=true');
      assertEq(Math.round(result.scanScore * 100) / 100, 0.6, 'SVC2 scanScore=0.6 (1 cat multi-occ)');
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
  // Setup SC2 — restock alice credits + reset chat.leakBySender + IA mock helpers
  // ===================================================================
  section('SC2 setup — restock alice credits + reset chat.leakBySender');

  /** Restock alice's credits to a high value via admin bypass for SVC9-SVC14. */
  async function restockAliceCredits(target = 30): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(doc(fbDb, 'users', ALICE_UID), { credits: target, updatedAt: Timestamp.now() }, { merge: true });
    });
  }

  /** Reset chat.leakBySender to empty map. */
  async function resetChatLeakBySender(chatId: string): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(doc(fbDb, 'chats', chatId), { leakBySender: {} }, { merge: true });
    });
  }

  /** Read current chat.leakBySender[uid] via admin bypass. */
  async function getLeakCount(chatId: string, uid: string): Promise<number> {
    let count = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      const snap = await getDoc(doc(fbDb, 'chats', chatId));
      const map = (snap.data()?.leakBySender as Record<string, number> | undefined) ?? {};
      count = map[uid] ?? 0;
    });
    return count;
  }

  await restockAliceCredits(30);
  pass('SC2 setup : alice credits = 30');

  // ===================================================================
  // SVC9 ambigu + IA likely=1 → motive='ai-leak-likely', count=1, level='L2'
  // ===================================================================
  section('SVC9 ambigu (score=0.5) + IA likely=1');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    // Mock /api/anti-leak (Phase 8 SC2 hotfix — isolation Genkit server-only)
    const tracker = mockApiFetch({
      riskScore: 0.92,
      flagged: true,
      technicalMotive: 'ai-leak-likely',
      reason: 'Détection IA: phone',
    });

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      // Message ambigu : "079 123 45 67" seul → L1 score=0.5 (1 cat phone-ch)
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 123 45 67');
      assertEq(tracker.calls, 1, 'SVC9 /api/anti-leak invoquée 1× (ambigu score=0.5 doctrine §C)');
      assertEq(result.scanFlagged, true, 'SVC9 flagged=true (IA confirme)');
      assertEq(result.scanMotive, 'ai-leak-likely', "SVC9 motive='ai-leak-likely'");
      assertEq(Math.round(result.scanScore * 100) / 100, 0.92, 'SVC9 scanScore=0.92 (IA confidence)');
      assertEq(result.escalationLevel, 'L2', "SVC9 escalationLevel='L2' (count=1)");
      assertEq(result.leakCountAfter, 1, 'SVC9 leakCountAfter=1');
      const count = await getLeakCount(MATCH_ACTIVE_ID, ALICE_UID);
      assertEq(count, 1, 'SVC9 chat.leakBySender[alice]=1 persisté');
    } catch (e) {
      fail('SVC9 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC10 ambigu + IA likely=0 → motive='ai-leak-unlikely', flagged=false, level='L0'
  // ===================================================================
  section('SVC10 ambigu (score=0.5) + IA likely=0');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    const tracker = mockApiFetch({
      riskScore: 0.15,
      flagged: false,
      technicalMotive: 'ai-leak-unlikely',
    });

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 123 45 67');
      assertEq(tracker.calls, 1, 'SVC10 /api/anti-leak invoquée 1×');
      assertEq(result.scanFlagged, false, 'SVC10 flagged=false (IA infirme — FP L1)');
      assertEq(result.scanMotive, 'ai-leak-unlikely', "SVC10 motive='ai-leak-unlikely'");
      assertEq(result.scanScore, 0, 'SVC10 scanScore=0 (downgrade)');
      assertEq(result.escalationLevel, 'L0', "SVC10 escalationLevel='L0' (silent log seul)");
      assertEq(result.leakCountAfter, 0, 'SVC10 leakCountAfter=0 (pas d\'increment)');
    } catch (e) {
      fail('SVC10 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC11 ambigu + IA error → motive='ai-error', preserve L1 (Q5=A)
  // ===================================================================
  section('SVC11 ambigu (score=0.5) + IA error fallback');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    // API HTTP error 500 → callAntiLeakL2API renvoie fallback ai-error
    const tracker = mockApiFetchHttpError(500);

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 123 45 67');
      assertEq(tracker.calls, 1, 'SVC11 /api/anti-leak invoquée 1× (avant fail)');
      assertEq(result.scanMotive, 'ai-error', "SVC11 motive='ai-error' (Q5=A defensive)");
      assertEq(result.scanFlagged, true, 'SVC11 flagged préservé L1=true (preserve)');
      assertEq(Math.round(result.scanScore * 100) / 100, 0.5, 'SVC11 scanScore préservé L1=0.5');
      assertEq(result.escalationLevel, 'L2', "SVC11 escalationLevel='L2' (count=1, L1 preserved)");
    } catch (e) {
      fail('SVC11 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC12 escalation L2 → L0 → L3 (3 messages flagged successifs)
  // ===================================================================
  section('SVC12 escalation L2 → L0 → L3 (3 flagged)');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));

    // Mock /api/anti-leak : likely=1 pour tous les messages ambigus
    mockApiFetch({
      riskScore: 0.9,
      flagged: true,
      technicalMotive: 'ai-leak-likely',
    });

    try {
      // Message 1 → count=1, L2
      const r1 = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 111 22 33');
      assertEq(r1.escalationLevel, 'L2', "SVC12 msg 1 → 'L2' (count=1)");
      assertEq(r1.leakCountAfter, 1, 'SVC12 msg 1 leakCountAfter=1');

      // Message 2 → count=2, L0 (silent)
      const r2 = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 222 33 44');
      assertEq(r2.escalationLevel, 'L0', "SVC12 msg 2 → 'L0' (count=2 silent)");
      assertEq(r2.leakCountAfter, 2, 'SVC12 msg 2 leakCountAfter=2');

      // Message 3 → count=3, L3 (modal post-send)
      const r3 = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 333 44 55');
      assertEq(r3.escalationLevel, 'L3', "SVC12 msg 3 → 'L3' (count=3)");
      assertEq(r3.leakCountAfter, 3, 'SVC12 msg 3 leakCountAfter=3');
    } catch (e) {
      fail('SVC12 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC13 escalation L4 (5 messages flagged → 5ème = L4)
  // ===================================================================
  section('SVC13 escalation L4 (5 flagged → admin trigger)');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    mockApiFetch({
      riskScore: 0.9,
      flagged: true,
      technicalMotive: 'ai-leak-likely',
    });

    try {
      const messages = ['079 111 22 33', '079 222 33 44', '079 333 44 55', '079 444 55 66', '079 555 66 77'];
      const levels: string[] = [];
      for (const msg of messages) {
        const r = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, msg);
        levels.push(r.escalationLevel);
      }
      assertEq(levels[0], 'L2', "SVC13 msg 1 → 'L2'");
      assertEq(levels[1], 'L0', "SVC13 msg 2 → 'L0'");
      assertEq(levels[2], 'L3', "SVC13 msg 3 → 'L3'");
      assertEq(levels[3], 'L0', "SVC13 msg 4 → 'L0'");
      assertEq(levels[4], 'L4', "SVC13 msg 5 → 'L4' (admin email trigger commit 5/6)");
    } catch (e) {
      fail('SVC13 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC14 score=0.8 (multi-cat) → no IA call, L1 verdict direct
  // ===================================================================
  section('SVC14 multi-cat L1 (score=0.8) → no IA call');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    const tracker = mockApiFetch({
      riskScore: 0.9,
      flagged: true,
      technicalMotive: 'ai-leak-likely',
    });

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    try {
      // Multi-cat : phone-ch + email = score=0.8 (NOT 0.5 → API pas appelée)
      const result = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, '079 111 22 33 et test@mail.com');
      assertEq(tracker.calls, 0, 'SVC14 /api/anti-leak pas invoquée (score=0.8 multi-cat ≠ 0.5 ambigu)');
      assertEq(Math.round(result.scanScore * 100) / 100, 0.8, 'SVC14 scanScore=0.8 (L1 direct)');
      assertEq(result.scanFlagged, true, 'SVC14 flagged=true (L1 multi-cat)');
      assertEq(result.scanMotive, 'phone-ch', "SVC14 motive='phone-ch' (L1 priority)");
      assertEq(result.escalationLevel, 'L2', "SVC14 escalationLevel='L2' (count=1)");
    } catch (e) {
      fail('SVC14 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC15 escalation L4 trigger : leakFlagged + adminActions audit (commit 5/6)
  // ===================================================================
  section('SVC15 L4 trigger → leakFlagged=true + adminAction audit');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    await setUserLeakFlaggedViaAdmin(env, ALICE_UID, false);
    // Track delta plutôt qu'absolu (tests précédents ont pu créer des audits)
    const auditsBefore = await getAdminActionsForUserViaAdmin(env, ALICE_UID, 'leak_escalation_l4');

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    mockApiFetch({ riskScore: 0.9, flagged: true, technicalMotive: 'ai-leak-likely' });

    try {
      // 5 messages flagged → 5ème déclenche L4 + side effects
      const messages = ['079 111 22 33', '079 222 33 44', '079 333 44 55', '079 444 55 66', '079 555 66 77'];
      let lastResult;
      for (const msg of messages) {
        lastResult = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, msg);
      }
      assertEq(lastResult?.escalationLevel, 'L4', "SVC15 5ème message escalationLevel='L4'");

      // Verify side effects post-L4 (delta = +1 nouvelle audit)
      const flagged = await getUserLeakFlaggedViaAdmin(env, ALICE_UID);
      assertEq(flagged, true, 'SVC15 alice.leakFlagged=true (Q7=A boolean)');

      const auditsAfter = await getAdminActionsForUserViaAdmin(env, ALICE_UID, 'leak_escalation_l4');
      assertEq(
        auditsAfter.length - auditsBefore.length,
        1,
        'SVC15 +1 entry adminActions/ leak_escalation_l4 (delta vs avant test)',
      );
      // Vérifier le plus récent (dernière entry par order de création — auditsAfter contient tout)
      const latest = auditsAfter[auditsAfter.length - 1];
      assertEq(latest.adminId, 'system', "SVC15 adminAction.adminId='system' (auto-escalation)");
      assertEq(
        (latest.metadata?.chatId as string) === MATCH_ACTIVE_ID,
        true,
        'SVC15 adminAction.metadata.chatId match',
      );
      assertEq(
        (latest.metadata?.leakCount as number) === 5,
        true,
        'SVC15 adminAction.metadata.leakCount=5',
      );
    } catch (e) {
      fail('SVC15 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC16 idempotency : leakFlagged déjà true → no re-trigger sur count>=6
  // ===================================================================
  section('SVC16 idempotency — count=6 sans re-trigger (leakFlagged déjà true)');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    await setUserLeakFlaggedViaAdmin(env, ALICE_UID, true); // pré-flagged
    // Track delta vs absolu
    const auditsBefore = await getAdminActionsForUserViaAdmin(env, ALICE_UID, 'leak_escalation_l4');

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    mockApiFetch({ riskScore: 0.9, flagged: true, technicalMotive: 'ai-leak-likely' });

    try {
      // 5 messages flagged — 5ème devrait être L4 mais sender déjà flagged → no side effect
      const messages = ['079 111 22 33', '079 222 33 44', '079 333 44 55', '079 444 55 66', '079 555 66 77'];
      for (const msg of messages) {
        await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, msg);
      }
      // Verify : 0 nouvelle entry adminAction (delta == 0)
      const auditsAfter = await getAdminActionsForUserViaAdmin(env, ALICE_UID, 'leak_escalation_l4');
      assertEq(
        auditsAfter.length - auditsBefore.length,
        0,
        'SVC16 0 nouvelle audit adminAction (idempotent — leakFlagged préexistant)',
      );
    } catch (e) {
      fail('SVC16 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC17 counts 1-4 (sub-threshold) → no L4 trigger même si flagged
  // ===================================================================
  section('SVC17 sub-threshold counts 1-4 → no L4 side effect');
  {
    await restockAliceCredits(30);
    await resetChatLeakBySender(MATCH_ACTIVE_ID);
    await setUserLeakFlaggedViaAdmin(env, ALICE_UID, false);

    const aliceCtx = env.authenticatedContext(ALICE_UID);
    __setChatDbForTesting(asFirestore(aliceCtx.firestore()));
    mockApiFetch({ riskScore: 0.9, flagged: true, technicalMotive: 'ai-leak-likely' });

    try {
      // 4 messages flagged uniquement (count atteint 4, pas L4)
      const messages = ['079 111 22 33', '079 222 33 44', '079 333 44 55', '079 444 55 66'];
      let lastResult;
      for (const msg of messages) {
        lastResult = await sendMessage(MATCH_ACTIVE_ID, ALICE_UID, msg);
      }
      assertEq(lastResult?.escalationLevel, 'L0', "SVC17 4ème message escalationLevel='L0' (silent count=4)");

      const flagged = await getUserLeakFlaggedViaAdmin(env, ALICE_UID);
      assertEq(flagged, false, 'SVC17 alice.leakFlagged reste false (sub-threshold)');
    } catch (e) {
      fail('SVC17 sendMessage threw', e);
    }
  }

  // ===================================================================
  // SVC18-SVC20 — triggerSuggestionsIfEligible (Phase 8 SC3 commit 4/6)
  // ===================================================================
  section('SVC18 triggerSuggestions happy path → no throw, fetch called');
  {
    restoreFetch();
    const tracker = mockSuggestApiFetch({
      suggestions: [{ activityId: 'act_yoga', title: 'Yoga', sport: 'yoga', city: 'Lausanne', reason: 'test' }],
      persisted: true,
      messageId: 'msg_test_18',
    });

    let threw = false;
    try {
      await triggerSuggestionsIfEligible('chat_svc18', ALICE_UID);
    } catch {
      threw = true;
    }

    if (!threw && tracker.calls === 1 && tracker.lastBody?.chatId === 'chat_svc18' && tracker.lastBody?.userId === ALICE_UID) {
      pass('SVC18 happy path : fetch /api/suggest-activities appelé 1× avec chatId+userId, no throw');
    } else {
      fail('SVC18', { threw, tracker });
    }
  }

  section('SVC19 triggerSuggestions cooldownActive → silent skip, no throw');
  {
    restoreFetch();
    const tracker = mockSuggestApiFetch({
      suggestions: [],
      cooldownActive: true,
    });

    let threw = false;
    try {
      await triggerSuggestionsIfEligible('chat_svc19', ALICE_UID);
    } catch {
      threw = true;
    }

    if (!threw && tracker.calls === 1) {
      pass('SVC19 cooldownActive=true → silent skip, no throw au caller');
    } else {
      fail('SVC19', { threw, tracker });
    }
  }

  section('SVC20 triggerSuggestions network error → silent catch, no throw');
  {
    restoreFetch();
    const tracker = mockSuggestApiFetchNetworkError();

    let threw = false;
    try {
      await triggerSuggestionsIfEligible('chat_svc20', ALICE_UID);
    } catch {
      threw = true;
    }

    if (!threw && tracker.calls === 1) {
      pass('SVC20 fetch throw network error → silent catch, no throw au caller (Q5=A defensive)');
    } else {
      fail('SVC20', { threw, tracker });
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setChatDbForTesting(null); // reset DI seam
  restoreFetch(); // restore global.fetch (Phase 8 SC2 hotfix)
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Chat service (SVC1-SVC20) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
