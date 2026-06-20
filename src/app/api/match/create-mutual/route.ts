/**
 * Phase 9.5 c38a CH3 — POST /api/match/create-mutual.
 *
 * Endpoint server-side appelé par /discovery handleLike() quand le client
 * détecte un like inverse (= match mutuel). Création atomique du match en
 * Firestore Admin SDK pour empêcher un client malicieux de forger un match
 * sans like réciproque (anti-fraud via verify des 2 docs likes/ server-side).
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid (fromUid)
 *   2. Body { targetUid }
 *   3. Verify likes/{fromUid}_{toUid} ET likes/{toUid}_{fromUid} existent
 *      (sinon abort, return 412 'no-mutual-likes')
 *   4. Idempotence : check matches/ where userIds array-contains-any [fromUid]
 *      AND userIds array-contains-any [targetUid] — si existe, return existing
 *      matchId (évite double create sur retry)
 *   5. Create matches/{auto-id} :
 *      - userIds: [fromUid, targetUid] (triés alpha pour cohérence)
 *      - status: 'accepted', initiatedBy: 'mutual'
 *      - chatUnlocked: true (CHANGE clé vs legacy createMatch qui mettait false)
 *      - sport, activityId vides (match social, pas lié à une activité spécifique)
 *      - createdAt, expiresAt + 7j
 *   6. Push notif aux 2 users (deferred c38b — pour l'instant, juste le doc).
 *
 * @returns 200 { ok, matchId, alreadyExisted? } / 401 / 412 / 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const fromUid = await verifyAuth(request);
    if (!fromUid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));

    // Fix #118 — Action 'notify-message' : trigger push + email fallback pour
    // un message chat. Réutilise cet endpoint qui compile déjà, contournement
    // d'un bug Next.js qui refusait /api/chat/notify-message (build silencieux).
    console.log('[MARKER-XYZ-118] route hit', { hasAction: !!body?.action, action: body?.action });
    if (body?.action === 'notify-message') {
      const chatId = body.chatId as string;
      const recipientUid = body.recipientUid as string;
      if (!chatId || !recipientUid) {
        return NextResponse.json({ error: 'invalid-input', detail: 'chatId + recipientUid required' }, { status: 400 });
      }
      if (recipientUid === fromUid) {
        return NextResponse.json({ ok: true, skipped: 'self' }, { status: 200 });
      }
      const db = await getAdminDb();
      const chatSnap = await db.collection('chats').doc(chatId).get();
      if (!chatSnap.exists) {
        return NextResponse.json({ error: 'chat-not-found' }, { status: 404 });
      }
      const chatData = chatSnap.data() || {};
      const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
      if (!participants.includes(fromUid) || !participants.includes(recipientUid)) {
        return NextResponse.json({ error: 'not-participant' }, { status: 403 });
      }
      const senderName = (body.senderName || 'Quelqu’un').toString().slice(0, 40);
      const preview = (body.preview || 'Tu as reçu un nouveau message').toString().slice(0, 200);
      const clickUrl = `/chat?match=${chatId}`;
      console.log('[notify-message] incoming', { fromUid, recipientUid, chatId });

      const { notifyUser } = await import('@/lib/notifications/notifyUser');
      const push = await notifyUser({
        uid: recipientUid,
        messageKey: 'chat_new_message',
        params: { senderName, preview },
        clickUrl,
        data: { type: 'message', chatId, matchId: chatId, senderId: fromUid },
      });
      console.log('[notify-message] push', { push });

      let emailResult: { ok: boolean; reason?: string } = { ok: false, reason: 'skipped-push-ok' };
      if (!push.ok) {
        try {
          const recipientSnap = await db.collection('users').doc(recipientUid).get();
          const recipientData = recipientSnap.exists ? recipientSnap.data() || {} : {};
          const recipientEmail = (recipientData.email as string | undefined) || '';
          const emailEnabled = recipientData.emailNotificationsEnabled !== false;
          const { FieldValue } = await import('firebase-admin/firestore');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lastNotifyMap = (recipientData.lastChatEmailNotifyAt || {}) as Record<string, any>;
          const lastNotifyTs = lastNotifyMap[fromUid];
          const lastMs = lastNotifyTs?.toMillis?.() ?? 0;
          const rateLimited = Date.now() - lastMs < 5 * 60 * 1000;
          if (!recipientEmail) emailResult = { ok: false, reason: 'no-email' };
          else if (!emailEnabled) emailResult = { ok: false, reason: 'email-opt-out' };
          else if (rateLimited) emailResult = { ok: false, reason: 'rate-limited-5min' };
          else {
            const { sendEmail } = await import('@/lib/email/sendEmail');
            const { pickUserLang } = await import('@/lib/i18n/getUserLang');
            const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com').replace(/\/$/, '');
            const lang = pickUserLang(recipientData);
            const r = await sendEmail({
              to: recipientEmail,
              templateName: 'chatMessageReceived',
              templateData: {
                toUserName: (recipientData.displayName as string | undefined) || undefined,
                fromUserName: senderName,
                messagePreview: preview,
                chatLink: `${baseUrl}/chat?match=${chatId}`,
              },
              lang,
            });
            emailResult = { ok: r.ok, reason: r.error };
            if (r.ok) {
              try {
                await db.collection('users').doc(recipientUid).set(
                  { lastChatEmailNotifyAt: { [fromUid]: FieldValue.serverTimestamp() } },
                  { merge: true },
                );
              } catch (err) {
                console.warn('[notify-message] update lastChatEmailNotifyAt failed', err);
              }
            }
          }
        } catch (err) {
          console.warn('[notify-message] email fallback failed', err);
          emailResult = { ok: false, reason: 'email-error' };
        }
      }
      console.log('[notify-message] email', { email: emailResult });
      return NextResponse.json({ ok: true, push, email: emailResult }, { status: 200 });
    }

    const targetUid = body?.targetUid as string;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'targetUid required' },
        { status: 400 },
      );
    }
    if (targetUid === fromUid) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'cannot match with self' },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    // 3. Phase 9.5 c38a-fix5 — Check des 2 likes/ docs côté serveur (admin SDK).
    // Bypass complet des rules Firestore qui rejetaient le getDoc reverseLike
    // côté client. Si UN seul ou ZÉRO existe → return { mutual: false } 200,
    // pas une erreur (le like fwd a déjà été créé client-side, on attend juste
    // le retour de l'autre). Pas d'erreur 412 effrayante.
    const fwdLikeId = `${fromUid}_${targetUid}`;
    const revLikeId = `${targetUid}_${fromUid}`;
    const [fwdSnap, revSnap] = await Promise.all([
      db.collection('likes').doc(fwdLikeId).get(),
      db.collection('likes').doc(revLikeId).get(),
    ]);
    if (!fwdSnap.exists || !revSnap.exists) {
      // Pas mutuel encore — le client a juste créé son like, l'autre n'a pas
      // (encore) liké en retour. Toast soft "Like envoyé" côté UI.
      // Phase 2 push — like simple reçu → notif ANONYME au destinataire
      // (fire-and-forget, ne bloque pas la réponse). Cooldown 60 min via
      // users/{targetUid}.lastLikePushAt pour éviter le spam si plusieurs
      // likes rapprochés. Best-effort : si pas de token → no-op silencieux.
      if (fwdSnap.exists && targetUid !== fromUid) {
        void (async () => {
          try {
            const recipSnap = await db.collection('users').doc(targetUid).get();
            const recip = recipSnap.exists ? recipSnap.data() || {} : {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lastTs = (recip as any).lastLikePushAt;
            const lastMs = lastTs?.toMillis?.() ?? 0;
            if (Date.now() - lastMs < 60 * 60 * 1000) return; // cooldown 60 min
            const { FieldValue } = await import('firebase-admin/firestore');
            const { notifyUser } = await import('@/lib/notifications/notifyUser');
            const push = await notifyUser({
              uid: targetUid,
              messageKey: 'like_received',
              clickUrl: '/discovery',
              data: { type: 'like' },
            });
            if (push.ok) {
              await db.collection('users').doc(targetUid).set(
                { lastLikePushAt: FieldValue.serverTimestamp() },
                { merge: true },
              );
            }
          } catch (err) {
            console.warn('[create-mutual] like push failed', err);
          }
        })();
      }
      return NextResponse.json({ ok: true, mutual: false }, { status: 200 });
    }

    // 4. Phase 9.5 c39 Bug C — Deterministic match doc ID + idempotent setDoc merge.
    // Avant : auto-id + idempotence par query → pouvait retourner match legacy
    // sans chatUnlocked:true. Maintenant : ID = sorted uids joined → setDoc
    // crée OU met à jour le même doc. Pas de duplicate possible.
    const sortedUids = [fromUid, targetUid].sort();
    const deterministicMatchId = `${sortedUids[0]}_${sortedUids[1]}`;
    const matchRef = db.collection('matches').doc(deterministicMatchId);
    const chatRef = db.collection('chats').doc(deterministicMatchId);
    const [existingMatchSnap, chatSnap] = await Promise.all([
      matchRef.get(),
      chatRef.get(),
    ]);

    if (existingMatchSnap.exists) {
      // Match déjà créé (par un précédent mutual ou direct-paid). Force
      // chatUnlocked:true au passage pour upgrade UX si pas déjà set.
      const existing = existingMatchSnap.data() ?? {};
      if (!existing.chatUnlocked) {
        await matchRef.update({ chatUnlocked: true });
      }
      // Phase 9.5 c40 — chats/{matchId} sibling créé s'il manque (legacy).
      if (!chatSnap.exists) {
        await chatRef.set({
          chatId: deterministicMatchId,
          participants: sortedUids,
          lastMessage: '',
          lastMessageAt: FieldValue.serverTimestamp(),
          unreadCount: { [sortedUids[0]]: 0, [sortedUids[1]]: 0 },
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return NextResponse.json(
        { ok: true, mutual: true, matchId: deterministicMatchId, alreadyExisted: true },
        { status: 200 },
      );
    }

    // 5. Create match doc avec ID déterministe (Admin SDK bypass rules).
    await matchRef.set({
      matchId: deterministicMatchId,
      userIds: sortedUids,
      status: 'accepted',
      initiatedBy: 'mutual',
      chatUnlocked: true,
      activityId: '',
      sport: '',
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      createdAt: FieldValue.serverTimestamp(),
    });

    // 5-bis. Phase 9.5 c40 — créer chats/{matchId} sibling (architecture
    // historique services/firestore.ts createMatch:193). Indispensable pour
    // que les rules messages/ check chats/{chatId}.participants succeed.
    await chatRef.set({
      chatId: deterministicMatchId,
      participants: sortedUids,
      lastMessage: '',
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadCount: { [sortedUids[0]]: 0, [sortedUids[1]]: 0 },
      createdAt: FieldValue.serverTimestamp(),
    });

    // BUG #116 — Push notifs aux 2 users (fire-and-forget, ne bloque pas la réponse).
    // Lit fcmToken depuis users/{uid} + check toggle pushNotificationsEnabled.
    // Si l'app est ouverte chez le destinataire : foreground handler → toast.
    // Si fermée : background SW → notif système iOS/Android avec son + vibration.
    try {
      const { notifyUser } = await import('@/lib/notifications/notifyUser');
      // Match est mutuel : on notifie les 2 users en parallèle
      const clickUrl = `/chat?match=${deterministicMatchId}`;
      void Promise.all([
        notifyUser({
          uid: fromUid,
          messageKey: 'match_mutual',
          clickUrl,
          data: { type: 'match', matchId: deterministicMatchId },
        }),
        notifyUser({
          uid: targetUid,
          messageKey: 'match_mutual',
          clickUrl,
          data: { type: 'match', matchId: deterministicMatchId },
        }),
      ]).catch(err => console.warn('[match/create-mutual] notifyUser failed', err));
    } catch (err) {
      console.warn('[match/create-mutual] push import failed', err);
    }

    return NextResponse.json(
      { ok: true, mutual: true, matchId: deterministicMatchId, alreadyExisted: false },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/match/create-mutual] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
