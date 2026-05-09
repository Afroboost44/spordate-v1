/**
 * Phase 8 sub-chantier 3 commit 3/6 — API route /api/suggest-activities (server-only).
 *
 * Doctrine §D : génère 1-3 suggestions activities via Genkit Gemini Flash + persiste
 * un bot message dans le chat post-event. Cadence 1/72h (Q1=A server-side check).
 *
 * Pattern cohérent /api/anti-leak/route.ts (SC2 hotfix) — runtime='nodejs' obligatoire
 * pour Genkit dependencies (@grpc/grpc-js, @opentelemetry/sdk-node serverExternal).
 *
 * Pipeline séquentiel (abort early si fail) :
 *   1. Validate body shape (chatId/userId strings non-vides)
 *   2. Verify participant : chats/{chatId}.participants must include userId → 403
 *   3. 72h cooldown : Chat.lastSuggestionAt + 72h > now → silent skip {cooldownActive:true}
 *   4. Opt-out consensus (Q3=A) : si l'un des 2 users.aiSuggestionsOptIn === false →
 *      silent skip {optedOut:true} (doctrine CGU §7.quinquies "consensus opt-out")
 *   5. Read user.city → query activities matching city + isActive
 *   6. Catalog < 3 (Q10=A min eligibility) → silent skip {insufficientCatalog:true}
 *   7. Read last 30 messages chat (orderBy createdAt desc, reversed)
 *   8. Call suggestActivitiesL3 (Genkit flow SC3 commit 2/6)
 *   9. Si suggestions=[] (IA no match) → skip persistence {aiNoMatch:true}
 *  10. Hydrate suggestions → SuggestionCard[] avec title/sport/city snapshot
 *  11. Admin SDK batch atomic : write bot message + update Chat.lastSuggestionAt
 *  12. Return {suggestions: SuggestionCard[], persisted: true}
 *
 * Auth pattern : trust body.userId (cohérent /api/anti-leak SC2). Bearer ID token
 * hardening = Phase 9. Defense-in-depth via Admin SDK bypass rules :
 *   - Le bot message senderId='system' est REJETÉ par la rule client-side (SC3 c1/6
 *     anti-spoof). Seul Admin SDK peut bypass via cette route serveur.
 *
 * Cf. CGU §7.quinquies + Privacy §5 (commit d54c7a9 SC0 disclosures).
 */

import { NextRequest, NextResponse } from 'next/server';
import { suggestActivitiesL3 } from '@/ai/flows/next-activity-suggester';
import { AiError } from '@/ai/genkit';
import type {
  SuggestionCatalogEntry,
  SuggestionChatMessage,
  SuggestionInput,
} from '@/ai/types';
import type { SuggestionCard } from '@/types/firestore';

export const runtime = 'nodejs'; // Genkit + firebase-admin require Node.js

// =====================================================================
// Constants
// =====================================================================

/** Phase 8 SC3 — cooldown 72h doctrine §D.Q2. */
const COOLDOWN_72H_MS = 72 * 60 * 60 * 1000;

/** Phase 8 SC3 — Q10=A min 3 activities matching → trigger ; sinon skip. */
const MIN_CATALOG_SIZE = 3;

/** Last 30 messages pour contexte Genkit (doctrine §D). */
const CHAT_HISTORY_LIMIT = 30;

/** Catalog query LIMIT (defense scale). */
const CATALOG_QUERY_LIMIT = 50;

// =====================================================================
// Lazy Admin SDK init (cohérent pattern /api/checkout)
// =====================================================================

// Cache au niveau module pour éviter re-init coûteux entre requests serverless.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;

async function getAdminDb() {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

// =====================================================================
// POST handler
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 1. Validate body shape
    if (
      typeof body?.chatId !== 'string' ||
      typeof body?.userId !== 'string' ||
      body.chatId.length === 0 ||
      body.userId.length === 0
    ) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'chatId, userId required (non-empty strings)' },
        { status: 400 },
      );
    }

    const { chatId, userId } = body as { chatId: string; userId: string };
    const db = await getAdminDb();

    // 2. Verify participant
    const chatSnap = await db.collection('chats').doc(chatId).get();
    if (!chatSnap.exists) {
      return NextResponse.json({ error: 'chat-not-found' }, { status: 404 });
    }
    const chatData = chatSnap.data();
    const participants: string[] = chatData?.participants ?? [];
    if (!participants.includes(userId)) {
      return NextResponse.json({ error: 'forbidden-not-participant' }, { status: 403 });
    }

    // 3. 72h cooldown check
    const lastSuggestionAt = chatData?.lastSuggestionAt;
    if (lastSuggestionAt && typeof lastSuggestionAt.toMillis === 'function') {
      const elapsedMs = Date.now() - lastSuggestionAt.toMillis();
      if (elapsedMs < COOLDOWN_72H_MS) {
        return NextResponse.json(
          { suggestions: [], cooldownActive: true, elapsedMs, requiredMs: COOLDOWN_72H_MS },
          { status: 200 },
        );
      }
    }

    // 4. Opt-out consensus check (Q3=A)
    const otherParticipantId = participants.find((uid) => uid !== userId);
    const userSnap = await db.collection('users').doc(userId).get();
    const userOptIn = (userSnap.data()?.aiSuggestionsOptIn as boolean | undefined) !== false;
    let otherOptIn = true;
    if (otherParticipantId) {
      const otherSnap = await db.collection('users').doc(otherParticipantId).get();
      otherOptIn = (otherSnap.data()?.aiSuggestionsOptIn as boolean | undefined) !== false;
    }
    if (!userOptIn || !otherOptIn) {
      return NextResponse.json({ suggestions: [], optedOut: true }, { status: 200 });
    }

    // 5. Read user city
    const userCity = userSnap.data()?.city as string | undefined;
    if (!userCity) {
      return NextResponse.json(
        { suggestions: [], insufficientCatalog: true, reason: 'no-user-city' },
        { status: 200 },
      );
    }

    // 6. Read activities catalog (city + isActive)
    const catalogSnap = await db
      .collection('activities')
      .where('city', '==', userCity)
      .where('isActive', '==', true)
      .limit(CATALOG_QUERY_LIMIT)
      .get();

    const nowMs = Date.now();
    const { Timestamp } = await import('firebase-admin/firestore');
    type AdminDocSnap = { id: string; data: () => Record<string, unknown> | undefined };
    type ScheduleEntry = { startAt?: { toMillis?: () => number } };

    // Phase 9 SC1 c2/5 — enrich catalog avec nextSessionId depuis collection `sessions/`
    // (best-effort parallel). Fallback : legacy `schedule[]` field si pas de session.
    const catalog: SuggestionCatalogEntry[] = (
      await Promise.all(
        catalogSnap.docs.map(async (d: AdminDocSnap) => {
          const data = d.data() ?? {};
          const activityId = d.id;

          // Query future session la plus proche (Phase 9 SC1 c2/5)
          let nextSessionId: string | undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let nextSessionAt: any = undefined;
          try {
            const nextSessionSnap = await db
              .collection('sessions')
              .where('activityId', '==', activityId)
              .where('startAt', '>', Timestamp.fromMillis(nowMs))
              .orderBy('startAt', 'asc')
              .limit(1)
              .get();
            if (!nextSessionSnap.empty) {
              const sd = nextSessionSnap.docs[0];
              nextSessionId = sd.id;
              nextSessionAt = sd.data().startAt;
            }
          } catch (err) {
            // Best-effort : si query fail (index missing en dev) → fallback schedule[]
            console.warn('[/api/suggest-activities] next-session query failed', {
              activityId,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // Fallback : legacy `schedule[]` denormalisé sur Activity (pre-Phase 1 sessions)
          if (!nextSessionAt) {
            const schedule = (data.schedule as ScheduleEntry[] | undefined) ?? [];
            const nextSchedule = schedule.find(
              (s) => s.startAt && typeof s.startAt.toMillis === 'function' && s.startAt.toMillis()! > nowMs,
            );
            nextSessionAt = nextSchedule?.startAt;
          }

          return {
            activityId,
            title: (data.title as string) ?? '',
            sport: (data.sport as string) ?? '',
            city: (data.city as string) ?? userCity,
            partnerId: (data.partnerId as string) ?? '',
            nextSessionAt,
            nextSessionId,
          };
        }),
      )
    ).filter((c: SuggestionCatalogEntry) => c.activityId.length > 0 && c.title.length > 0);

    if (catalog.length < MIN_CATALOG_SIZE) {
      return NextResponse.json(
        { suggestions: [], insufficientCatalog: true, catalogSize: catalog.length },
        { status: 200 },
      );
    }

    // 7. Read last 30 messages (orderBy desc → reverse pour ordre chronologique)
    const msgsSnap = await db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(CHAT_HISTORY_LIMIT)
      .get();
    type AdminMsgSnap = { data: () => Record<string, unknown> | undefined };
    const chatHistory: SuggestionChatMessage[] = msgsSnap.docs
      .reverse()
      .map((d: AdminMsgSnap) => {
        const data = d.data() ?? {};
        return {
          senderId: (data.senderId as string) ?? '',
          text: (data.text as string) ?? '',
          createdAt: data.createdAt as never,
        };
      })
      .filter((m: SuggestionChatMessage) => m.text.length > 0);

    // 8. Call Genkit flow
    const flowInput: SuggestionInput = {
      chatHistory,
      participantUids: participants,
      activitiesCatalog: catalog,
      rateLimitUserId: userId,
    };
    const flowResult = await suggestActivitiesL3(flowInput);

    // 9. Skip persistence si IA no match (Q5=A defensive cohérent flow fallback)
    if (flowResult.suggestions.length === 0) {
      return NextResponse.json({ suggestions: [], aiNoMatch: true }, { status: 200 });
    }

    // 10. Hydrate suggestions → SuggestionCard[] (snapshot dénormalisé)
    // Strip undefined fields (Firestore Admin SDK rejette undefined par défaut).
    const suggestionCards: SuggestionCard[] = flowResult.suggestions.map((s) => {
      const activity = catalog.find((a) => a.activityId === s.activityId);
      const card: SuggestionCard = {
        activityId: s.activityId,
        title: activity?.title ?? '',
        sport: activity?.sport ?? '',
        city: activity?.city ?? '',
        reason: s.reason,
      };
      if (activity?.nextSessionAt) {
        card.nextSessionAt = activity.nextSessionAt;
      }
      // Phase 9 SC1 c2/5 — nextSessionId pour wire InviteButton dans SuggestionMessage
      if (activity?.nextSessionId) {
        card.nextSessionId = activity.nextSessionId;
      }
      return card;
    });

    // 11. Admin SDK batch atomic write (bot message + lastSuggestionAt update)
    const { FieldValue } = await import('firebase-admin/firestore');
    const batch = db.batch();
    const msgRef = db.collection('chats').doc(chatId).collection('messages').doc();
    batch.set(msgRef, {
      messageId: msgRef.id,
      senderId: 'system',
      text: '🤖 Spordateur · Suggestion',
      type: 'ai_suggestion',
      readBy: [],
      createdAt: FieldValue.serverTimestamp(),
      suggestions: suggestionCards,
    });
    batch.update(db.collection('chats').doc(chatId), {
      lastSuggestionAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    // 12. Return success
    return NextResponse.json(
      { suggestions: suggestionCards, persisted: true, messageId: msgRef.id },
      { status: 200 },
    );
  } catch (err) {
    // Rate limit Genkit → 429
    if (err instanceof AiError && err.code === 'rate-limit-exceeded') {
      return NextResponse.json(
        { error: 'rate-limit-exceeded', detail: err.message },
        { status: 429 },
      );
    }
    console.error('[/api/suggest-activities] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
