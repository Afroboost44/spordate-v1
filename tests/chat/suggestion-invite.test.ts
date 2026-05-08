/**
 * Tests Phase 9 sub-chantier 1 commit 2/5 — SuggestionCard.nextSessionId persistence
 * + InviteButton conditional rendering helper.
 *
 * Exécution :
 *   npm run test:chat:suggestion-invite
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/chat/suggestion-invite.test.ts")
 *
 * Pattern :
 *  - SI1, SI2, SI5 : tests pure helper `shouldShowInviteButton` (pas d'emulator requis)
 *  - SI3, SI4 : Admin SDK + DI seam mock Genkit (cohérent SAR pattern SC3)
 *
 * Couverture (SI1-SI5) :
 *   SI1 SuggestionCard avec nextSessionId + viewerUid + otherUserId distinct → InviteButton rendered
 *   SI2 SuggestionCard sans nextSessionId → InviteButton hidden
 *   SI3 API enrichit catalog avec nextSessionId si session future existe (Admin SDK)
 *   SI4 Pas de session future → nextSessionId omis dans payload (best-effort silent)
 *   SI5 Self-suggestion (otherUserId === viewerUid) → InviteButton hidden
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-suggest-invite';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-suggest-invite';

import { POST as POSTSuggest } from '../../src/app/api/suggest-activities/route';
import {
  __setSuggestGenerateFnForTesting,
  __resetSuggestCacheForTesting,
} from '../../src/ai/flows/next-activity-suggester';
import { __resetRateLimitForTesting } from '../../src/ai/genkit';
import { shouldShowInviteButton } from '../../src/components/chat/SuggestionMessage';

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

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callPostSuggest(payload: { chatId: string; userId: string }): Promise<MockResponse> {
  const req = new Request('http://localhost/api/suggest-activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTSuggest(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  // ===================================================================
  // SI1, SI2, SI5 : pure helper tests (sync, no emulator needed)
  // ===================================================================
  section('SI1 SuggestionCard avec nextSessionId + viewer + other distinct → InviteButton rendered');
  {
    const result = shouldShowInviteButton({
      nextSessionId: 'session_x',
      viewerUid: 'alice',
      otherUserId: 'bob',
    });
    if (result === true) {
      pass('SI1 shouldShowInviteButton({nextSessionId, viewerUid≠otherUserId}) → true');
    } else {
      fail('SI1', { result });
    }
  }

  section('SI2 SuggestionCard sans nextSessionId → InviteButton hidden');
  {
    const result = shouldShowInviteButton({
      nextSessionId: undefined,
      viewerUid: 'alice',
      otherUserId: 'bob',
    });
    if (result === false) {
      pass('SI2 shouldShowInviteButton({nextSessionId=undefined}) → false');
    } else {
      fail('SI2', { result });
    }
  }

  section('SI5 self-invite (viewerUid === otherUserId) → InviteButton hidden');
  {
    const result = shouldShowInviteButton({
      nextSessionId: 'session_x',
      viewerUid: 'alice',
      otherUserId: 'alice',
    });
    if (result === false) {
      pass('SI5 self-invite → false');
    } else {
      fail('SI5', { result });
    }
  }

  // Edge cases bonus
  section('SI bonus — viewerUid absent → false');
  {
    const result = shouldShowInviteButton({
      nextSessionId: 'session_x',
      viewerUid: null,
      otherUserId: 'bob',
    });
    if (result === false) {
      pass('viewerUid=null → false');
    } else {
      fail('viewerUid=null', { result });
    }
  }

  section('SI bonus — otherUserId absent → false');
  {
    const result = shouldShowInviteButton({
      nextSessionId: 'session_x',
      viewerUid: 'alice',
      otherUserId: null,
    });
    if (result === false) {
      pass('otherUserId=null → false');
    } else {
      fail('otherUserId=null', { result });
    }
  }

  // ===================================================================
  // SI3, SI4 : API integration tests (Admin SDK + emulator)
  // ===================================================================
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-suggest-invite' });
  }
  const db = getFirestore();

  const ALICE = 'user_alice_si';
  const BOB = 'user_bob_si';

  async function seedUser(uid: string): Promise<void> {
    await db.collection('users').doc(uid).set({
      uid,
      email: `${uid}@test.local`,
      displayName: uid,
      city: 'Geneva',
      credits: 10,
    });
  }

  async function seedChat(chatId: string, participants: string[]): Promise<void> {
    await db.collection('chats').doc(chatId).set({
      chatId,
      participants,
      lastMessage: '',
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadCount: {},
    });
  }

  async function seedMessages(chatId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await db.collection('chats').doc(chatId).collection('messages').add({
        senderId: i % 2 === 0 ? ALICE : BOB,
        text: `[${chatId}] msg ${i} : on aime le yoga`,
        type: 'text',
        readBy: [],
        createdAt: Timestamp.fromMillis(Date.now() - (count - i) * 60_000),
      });
    }
  }

  async function seedActivity(activityId: string, city: string, sport: string): Promise<void> {
    await db.collection('activities').doc(activityId).set({
      activityId,
      title: `${sport} ${city}`,
      sport,
      partnerId: 'partner_si',
      partnerName: 'Partner SI',
      city,
      isActive: true,
      schedule: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function seedSession(sessionId: string, activityId: string, startAtMs: number): Promise<void> {
    await db.collection('sessions').doc(sessionId).set({
      sessionId,
      activityId,
      partnerId: 'partner_si',
      creatorId: 'partner_si',
      sport: 'yoga',
      title: `Session ${sessionId}`,
      city: 'Geneva',
      startAt: Timestamp.fromMillis(startAtMs),
      endAt: Timestamp.fromMillis(startAtMs + 60 * 60_000),
      maxParticipants: 8,
      currentParticipants: 0,
      pricingTiers: [],
      currentTier: 'early',
      currentPrice: 2500,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['users', 'activities', 'sessions']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    const chats = await db.collection('chats').get();
    for (const c of chats.docs) {
      const msgs = await db.collection('chats').doc(c.id).collection('messages').get();
      for (const m of msgs.docs) await m.ref.delete().catch(() => {});
      await c.ref.delete().catch(() => {});
    }
  }

  function resetAi(): void {
    __resetSuggestCacheForTesting();
    __resetRateLimitForTesting();
  }

  // =================================================================
  // SI3 API enrichit nextSessionId pour activity avec session future
  // =================================================================
  section('SI3 API enrichit catalog avec nextSessionId si session future existe');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE);
    await seedUser(BOB);
    await seedChat('chat_si3', [ALICE, BOB]);
    await seedMessages('chat_si3', 5);
    // 3 activities Geneva, 1 avec session future, 2 sans
    await seedActivity('act_si3_yoga', 'Geneva', 'yoga');
    await seedActivity('act_si3_padel', 'Geneva', 'padel');
    await seedActivity('act_si3_salsa', 'Geneva', 'salsa');
    // Future session for yoga only
    await seedSession('session_si3_yoga_future', 'act_si3_yoga', Date.now() + 3 * 24 * 60 * 60_000);

    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({
        suggestions: [
          { activityId: 'act_si3_yoga', reason: 'Yoga futur' },
          { activityId: 'act_si3_padel', reason: 'Padel sans session' },
        ],
      }),
    );

    const res = await callPostSuggest({ chatId: 'chat_si3', userId: ALICE });
    if (res.status !== 200 || res.body.persisted !== true) {
      fail('SI3 status', res);
    } else {
      pass('SI3 status 200 + persisted');
    }
    const suggestions = res.body.suggestions as Array<{ activityId: string; nextSessionId?: string }>;

    const yoga = suggestions.find((s) => s.activityId === 'act_si3_yoga');
    if (yoga?.nextSessionId === 'session_si3_yoga_future') {
      pass('SI3 yoga card → nextSessionId="session_si3_yoga_future"');
    } else {
      fail('SI3 yoga nextSessionId', yoga);
    }

    const padel = suggestions.find((s) => s.activityId === 'act_si3_padel');
    if (!padel?.nextSessionId) {
      pass('SI3 padel card → nextSessionId omis (pas de session future)');
    } else {
      fail('SI3 padel should NOT have nextSessionId', padel);
    }
  }

  // =================================================================
  // SI4 Pas de session future pour aucune activity → tous omis sans fail
  // =================================================================
  section('SI4 Pas de session future → nextSessionId omis sans fail (best-effort)');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE);
    await seedUser(BOB);
    await seedChat('chat_si4', [ALICE, BOB]);
    await seedMessages('chat_si4', 5);
    // 3 activities Geneva, ZÉRO session future
    await seedActivity('act_si4_yoga', 'Geneva', 'yoga');
    await seedActivity('act_si4_padel', 'Geneva', 'padel');
    await seedActivity('act_si4_salsa', 'Geneva', 'salsa');

    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({
        suggestions: [
          { activityId: 'act_si4_yoga', reason: 'Test sans session' },
        ],
      }),
    );

    const res = await callPostSuggest({ chatId: 'chat_si4', userId: ALICE });
    if (res.status === 200 && res.body.persisted === true) {
      pass('SI4 status 200 + persisted (pas de fail)');
    } else {
      fail('SI4 status', res);
    }

    const suggestions = res.body.suggestions as Array<{ activityId: string; nextSessionId?: string }>;
    const yoga = suggestions.find((s) => s.activityId === 'act_si4_yoga');
    if (yoga && !yoga.nextSessionId) {
      pass('SI4 yoga card → nextSessionId omis (silent best-effort)');
    } else {
      fail('SI4 nextSessionId should be undefined', yoga);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setSuggestGenerateFnForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Suggestion + Invite (SI1-SI5 + bonus + SI3-SI4 API) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
