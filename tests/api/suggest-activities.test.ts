/**
 * Tests Phase 8 sub-chantier 3 commit 3/6 — API route /api/suggest-activities.
 *
 * Exécution :
 *   npm run test:api:suggest
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/api/suggest-activities.test.ts")
 *
 * Pattern : Admin SDK direct contre l'emulator Firestore (FIRESTORE_EMULATOR_HOST auto-détecté
 * par firebase-admin si set). Mock Genkit flow via __setSuggestGenerateFnForTesting (DI seam).
 * Pas de @firebase/rules-unit-testing — la route bypasse les rules via Admin SDK.
 *
 * Couverture (8 cas SAR1-SAR8) :
 *
 *   SAR1 happy path → 200 + bot message persisté + Chat.lastSuggestionAt updated
 *   SAR2 not participant → 403 forbidden-not-participant
 *   SAR3 cooldown 72h active → 200 {cooldownActive:true} (silent skip)
 *   SAR4 alice optedOut (aiSuggestionsOptIn=false) → 200 {optedOut:true}
 *   SAR5 bob optedOut (consensus) → 200 {optedOut:true}
 *   SAR6 insufficient catalog (<3 matching) → 200 {insufficientCatalog:true}
 *   SAR7 IA no match (suggestions=[]) → 200 {aiNoMatch:true} (skip persist)
 *   SAR8 rate limit propagation 11ème call → 429 rate-limit-exceeded
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import (Admin SDK reads at init time)
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-suggest';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-suggest';

import { POST } from '../../src/app/api/suggest-activities/route';
import {
  __setSuggestGenerateFnForTesting,
  __resetSuggestCacheForTesting,
  __setSuggestNowFnForTesting,
} from '../../src/ai/flows/next-activity-suggester';
import {
  __resetRateLimitForTesting,
  __setNowFnForTesting as __setRateNowForTesting,
} from '../../src/ai/genkit';

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
// Constants + helpers
// =====================================================================

const ALICE_UID = 'user_alice_sar';
const BOB_UID = 'user_bob_sar';
const CHARLIE_UID = 'user_charlie_sar';

const CHAT_ID = 'chat_sar_1';
const COOLDOWN_CHAT_ID = 'chat_sar_cooldown';
const SMALL_CATALOG_CHAT_ID = 'chat_sar_small_catalog';

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callPost(payload: { chatId: string; userId: string }): Promise<MockResponse> {
  const req = new Request('http://localhost/api/suggest-activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POST(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  // Init Admin SDK (will connect to emulator via FIRESTORE_EMULATOR_HOST)
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-suggest' });
  }
  const db = getFirestore();

  // Setup helpers
  async function seedUser(uid: string, opts: { city?: string; aiSuggestionsOptIn?: boolean } = {}) {
    await db.collection('users').doc(uid).set({
      uid,
      email: `${uid}@example.com`,
      displayName: uid,
      city: opts.city ?? 'Lausanne',
      ...(opts.aiSuggestionsOptIn !== undefined ? { aiSuggestionsOptIn: opts.aiSuggestionsOptIn } : {}),
      credits: 10,
    });
  }

  async function seedChat(chatId: string, participants: string[], opts: { lastSuggestionAt?: number } = {}) {
    await db.collection('chats').doc(chatId).set({
      chatId,
      participants,
      lastMessage: '',
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadCount: {},
      ...(opts.lastSuggestionAt !== undefined
        ? { lastSuggestionAt: Timestamp.fromMillis(opts.lastSuggestionAt) }
        : {}),
    });
  }

  async function seedActivity(activityId: string, city: string, sport: string, isActive = true) {
    await db.collection('activities').doc(activityId).set({
      activityId,
      title: `${sport} ${city}`,
      sport,
      description: '',
      partnerId: 'partner_test',
      partnerName: 'Test Partner',
      city,
      address: '',
      price: 2500,
      currency: 'CHF',
      duration: 60,
      maxParticipants: 10,
      currentParticipants: 0,
      schedule: [],
      images: [],
      tags: [],
      isActive,
      rating: 4.5,
      reviewCount: 10,
      createdBy: 'partner_test',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function seedMessages(chatId: string, count: number) {
    // Inclut chatId dans le texte pour différencier les cache keys du flow Genkit
    // (sinon 2 chats avec mêmes messages → même hash → cache hit + rate limit pas trigger).
    for (let i = 0; i < count; i++) {
      await db.collection('chats').doc(chatId).collection('messages').add({
        senderId: i % 2 === 0 ? ALICE_UID : BOB_UID,
        text: `[${chatId}] message ${i} : super on a aimé le yoga`,
        type: 'text',
        readBy: [],
        createdAt: Timestamp.fromMillis(Date.now() - (count - i) * 60_000),
      });
    }
  }

  async function clearAll() {
    // Clean tous les docs touchés (simple — pas de cascade)
    for (const id of [ALICE_UID, BOB_UID, CHARLIE_UID]) {
      await db.collection('users').doc(id).delete().catch(() => {});
    }
    for (const cid of [CHAT_ID, COOLDOWN_CHAT_ID, SMALL_CATALOG_CHAT_ID]) {
      // Delete messages subcollection
      const msgs = await db.collection('chats').doc(cid).collection('messages').get();
      for (const m of msgs.docs) await m.ref.delete().catch(() => {});
      await db.collection('chats').doc(cid).delete().catch(() => {});
    }
    const acts = await db.collection('activities').get();
    for (const a of acts.docs) await a.ref.delete().catch(() => {});
  }

  function resetAi(): void {
    __resetSuggestCacheForTesting();
    __resetRateLimitForTesting();
    __setSuggestNowFnForTesting(null);
    __setRateNowForTesting(null);
  }

  // ===================================================================
  // SAR1 happy path
  // ===================================================================
  section('SAR1 happy path → bot message persisted + lastSuggestionAt');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID, { city: 'Lausanne' });
    await seedUser(BOB_UID, { city: 'Lausanne' });
    await seedChat(CHAT_ID, [ALICE_UID, BOB_UID]);
    await seedMessages(CHAT_ID, 5);
    await seedActivity('act_yoga_lsn', 'Lausanne', 'yoga');
    await seedActivity('act_padel_lsn', 'Lausanne', 'padel');
    await seedActivity('act_salsa_lsn', 'Lausanne', 'salsa');

    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({
        suggestions: [
          { activityId: 'act_yoga_lsn', reason: 'Pour ta prochaine session yoga' },
          { activityId: 'act_padel_lsn', reason: 'Si vous voulez tester le padel' },
        ],
      }),
    );

    const res = await callPost({ chatId: CHAT_ID, userId: ALICE_UID });

    if (res.status === 200 && res.body.persisted === true && Array.isArray(res.body.suggestions) && (res.body.suggestions as unknown[]).length === 2) {
      pass('SAR1 status 200 + persisted=true + 2 suggestions hydratées');
    } else {
      fail('SAR1', res);
    }

    // Verify bot message persisted
    const msgs = await db.collection('chats').doc(CHAT_ID).collection('messages').get();
    const botMsg = msgs.docs.find((d) => d.data().senderId === 'system');
    if (botMsg && botMsg.data().type === 'ai_suggestion') {
      pass('SAR1 bot message senderId=system + type=ai_suggestion persisté');
    } else {
      fail('SAR1 bot message not found', { msgsCount: msgs.size });
    }

    // Verify Chat.lastSuggestionAt updated
    const chatSnap = await db.collection('chats').doc(CHAT_ID).get();
    if (chatSnap.data()?.lastSuggestionAt) {
      pass('SAR1 Chat.lastSuggestionAt updated');
    } else {
      fail('SAR1 lastSuggestionAt missing');
    }
  }

  // ===================================================================
  // SAR2 not participant
  // ===================================================================
  section('SAR2 not participant → 403');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID);
    await seedUser(BOB_UID);
    await seedUser(CHARLIE_UID);
    await seedChat(CHAT_ID, [ALICE_UID, BOB_UID]);

    const res = await callPost({ chatId: CHAT_ID, userId: CHARLIE_UID });
    if (res.status === 403 && res.body.error === 'forbidden-not-participant') {
      pass('SAR2 charlie non-participant → 403 forbidden-not-participant');
    } else {
      fail('SAR2', res);
    }
  }

  // ===================================================================
  // SAR3 cooldown active
  // ===================================================================
  section('SAR3 cooldown 72h active → silent skip');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID);
    await seedUser(BOB_UID);
    // Last suggestion 1h ago (< 72h)
    await seedChat(COOLDOWN_CHAT_ID, [ALICE_UID, BOB_UID], {
      lastSuggestionAt: Date.now() - 60 * 60 * 1000,
    });

    const res = await callPost({ chatId: COOLDOWN_CHAT_ID, userId: ALICE_UID });
    if (res.status === 200 && res.body.cooldownActive === true && Array.isArray(res.body.suggestions) && (res.body.suggestions as unknown[]).length === 0) {
      pass('SAR3 cooldown actif → 200 {cooldownActive:true, suggestions:[]}');
    } else {
      fail('SAR3', res);
    }
  }

  // ===================================================================
  // SAR4 alice optedOut
  // ===================================================================
  section('SAR4 alice aiSuggestionsOptIn=false → optedOut');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID, { aiSuggestionsOptIn: false });
    await seedUser(BOB_UID);
    await seedChat(CHAT_ID, [ALICE_UID, BOB_UID]);

    const res = await callPost({ chatId: CHAT_ID, userId: ALICE_UID });
    if (res.status === 200 && res.body.optedOut === true) {
      pass('SAR4 alice opted out → 200 {optedOut:true}');
    } else {
      fail('SAR4', res);
    }
  }

  // ===================================================================
  // SAR5 bob optedOut (consensus Q3=A)
  // ===================================================================
  section('SAR5 bob optedOut consensus → optedOut');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID, { aiSuggestionsOptIn: true });
    await seedUser(BOB_UID, { aiSuggestionsOptIn: false });
    await seedChat(CHAT_ID, [ALICE_UID, BOB_UID]);

    // Alice (opted in) makes the request, but bob is opted out → consensus rejette
    const res = await callPost({ chatId: CHAT_ID, userId: ALICE_UID });
    if (res.status === 200 && res.body.optedOut === true) {
      pass('SAR5 bob opted out (consensus) → alice request → 200 {optedOut:true}');
    } else {
      fail('SAR5', res);
    }
  }

  // ===================================================================
  // SAR6 insufficient catalog
  // ===================================================================
  section('SAR6 catalog < 3 → insufficientCatalog');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID);
    await seedUser(BOB_UID);
    await seedChat(SMALL_CATALOG_CHAT_ID, [ALICE_UID, BOB_UID]);
    await seedMessages(SMALL_CATALOG_CHAT_ID, 3);
    // Seulement 2 activités → < MIN_CATALOG_SIZE (3)
    await seedActivity('act_solo_1', 'Lausanne', 'yoga');
    await seedActivity('act_solo_2', 'Lausanne', 'padel');

    const res = await callPost({ chatId: SMALL_CATALOG_CHAT_ID, userId: ALICE_UID });
    if (res.status === 200 && res.body.insufficientCatalog === true) {
      pass('SAR6 catalog 2 activities (<3) → 200 {insufficientCatalog:true}');
    } else {
      fail('SAR6', res);
    }
  }

  // ===================================================================
  // SAR7 IA no match
  // ===================================================================
  section('SAR7 IA no match → aiNoMatch (skip persist)');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID, { city: 'Lausanne' });
    await seedUser(BOB_UID, { city: 'Lausanne' });
    await seedChat(CHAT_ID, [ALICE_UID, BOB_UID]);
    await seedMessages(CHAT_ID, 3);
    await seedActivity('act_a', 'Lausanne', 'yoga');
    await seedActivity('act_b', 'Lausanne', 'padel');
    await seedActivity('act_c', 'Lausanne', 'salsa');

    // Mock Gemini renvoie suggestions=[]
    __setSuggestGenerateFnForTesting(async () => JSON.stringify({ suggestions: [] }));

    const msgsBefore = await db.collection('chats').doc(CHAT_ID).collection('messages').get();
    const countBefore = msgsBefore.size;

    const res = await callPost({ chatId: CHAT_ID, userId: ALICE_UID });
    if (res.status === 200 && res.body.aiNoMatch === true) {
      pass('SAR7 IA empty → 200 {aiNoMatch:true}');
    } else {
      fail('SAR7', res);
    }

    // Verify NO bot message persisted
    const msgsAfter = await db.collection('chats').doc(CHAT_ID).collection('messages').get();
    if (msgsAfter.size === countBefore) {
      pass('SAR7 NO bot message persisté (skip persistence empty IA)');
    } else {
      fail('SAR7 unexpected new messages', { countBefore, countAfter: msgsAfter.size });
    }
  }

  // ===================================================================
  // SAR8 rate limit propagation → 429
  // ===================================================================
  section('SAR8 rate limit propagation → 429');
  {
    await clearAll();
    resetAi();
    await seedUser(ALICE_UID, { city: 'Lausanne' });
    await seedUser(BOB_UID, { city: 'Lausanne' });
    await seedActivity('act_a', 'Lausanne', 'yoga');
    await seedActivity('act_b', 'Lausanne', 'padel');
    await seedActivity('act_c', 'Lausanne', 'salsa');

    // Freeze time pour empêcher fenêtre 60s expiration
    const fixedTime = 1_700_000_000_000;
    __setRateNowForTesting(() => fixedTime);
    __setSuggestGenerateFnForTesting(async () => JSON.stringify({ suggestions: [] }));

    // Effectuer 10 calls dans des chats différents (cache miss à chaque)
    for (let i = 0; i < 10; i++) {
      const cid = `chat_sar8_${i}`;
      await seedChat(cid, [ALICE_UID, BOB_UID]);
      await seedMessages(cid, 2);
      await callPost({ chatId: cid, userId: ALICE_UID });
    }

    // 11ème call avec userId=alice → wrapAiCall throw → 429
    await seedChat('chat_sar8_x', [ALICE_UID, BOB_UID]);
    await seedMessages('chat_sar8_x', 2);
    const res = await callPost({ chatId: 'chat_sar8_x', userId: ALICE_UID });
    if (res.status === 429 && res.body.error === 'rate-limit-exceeded') {
      pass('SAR8 11ème call → 429 rate-limit-exceeded propagé');
    } else {
      fail('SAR8', res);
    }

    // Cleanup chats SAR8
    for (let i = 0; i < 10; i++) {
      const msgs = await db.collection('chats').doc(`chat_sar8_${i}`).collection('messages').get();
      for (const m of msgs.docs) await m.ref.delete().catch(() => {});
      await db.collection('chats').doc(`chat_sar8_${i}`).delete().catch(() => {});
    }
    const xMsgs = await db.collection('chats').doc('chat_sar8_x').collection('messages').get();
    for (const m of xMsgs.docs) await m.ref.delete().catch(() => {});
    await db.collection('chats').doc('chat_sar8_x').delete().catch(() => {});
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setSuggestGenerateFnForTesting(null);
  __setRateNowForTesting(null);
  __setSuggestNowFnForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé /api/suggest-activities (SAR1-SAR8) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
