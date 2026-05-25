/**
 * Fix #118 — POST /api/chat/notify-message.
 *
 * Endpoint server-side appelé fire-and-forget par services/firestore.ts
 * sendMessage() après l'envoi d'un message chat. Déclenche :
 *   1. Push FCM via notifyUser (lit users/{recipientUid}.fcmToken)
 *   2. Fallback EMAIL via Resend si push échoue
 *
 * VERSION SIMPLIFIÉE — imports dynamiques pour bypass build-time errors.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Lazy import auth pour éviter problèmes build
    const { verifyAuth } = await import('@/lib/auth/verifyAuth');
    const senderUid = await verifyAuth(request);
    if (!senderUid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await request.json().catch(() => ({}))) as any;
    const chatId = body.chatId as string;
    const recipientUid = body.recipientUid as string;
    if (!chatId || !recipientUid) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'chatId + recipientUid required' },
        { status: 400 },
      );
    }
    if (recipientUid === senderUid) {
      return NextResponse.json({ ok: true, skipped: 'self' }, { status: 200 });
    }

    console.log('[notify-message] incoming', { senderUid, recipientUid, chatId });

    // Lazy init Admin SDK
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
    if (!getApps().length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        initializeApp({
          credential: cert(
            parseServiceAccountKeyDefensive(
              process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
            ) as Parameters<typeof cert>[0],
          ),
        });
      } else {
        initializeApp({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordate-prod',
        });
      }
    }
    const db = getFirestore();

    // Vérif appartenance chat
    const chatSnap = await db.collection('chats').doc(chatId).get();
    if (!chatSnap.exists) {
      return NextResponse.json({ error: 'chat-not-found' }, { status: 404 });
    }
    const chat = chatSnap.data() || {};
    const participants = Array.isArray(chat.participants) ? chat.participants : [];
    if (!participants.includes(senderUid) || !participants.includes(recipientUid)) {
      return NextResponse.json({ error: 'not-participant' }, { status: 403 });
    }

    const senderName = (body.senderName || 'Quelqu’un').toString().slice(0, 40);
    const preview = (body.preview || 'Tu as reçu un nouveau message').toString().slice(0, 200);
    const clickUrl = `/chat?match=${chatId}`;

    // 1. Push FCM
    const { notifyUser } = await import('@/lib/notifications/notifyUser');
    const push = await notifyUser({
      uid: recipientUid,
      messageKey: 'chat_new_message',
      params: { senderName, preview },
      clickUrl,
      data: { type: 'message', chatId, matchId: chatId, senderId: senderUid },
    });

    console.log('[notify-message] push result', { push });

    // 2. Fallback email
    let emailResult: { ok: boolean; reason?: string } = { ok: false, reason: 'skipped-push-ok' };
    if (!push.ok) {
      try {
        const recipientSnap = await db.collection('users').doc(recipientUid).get();
        const recipientData = recipientSnap.exists ? recipientSnap.data() || {} : {};
        const recipientEmail = (recipientData.email as string | undefined) || '';
        const emailEnabled = recipientData.emailNotificationsEnabled !== false;
        const FieldValue = (await import('firebase-admin/firestore')).FieldValue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lastNotifyMap = (recipientData.lastChatEmailNotifyAt || {}) as Record<string, any>;
        const lastNotifyTs = lastNotifyMap[senderUid];
        const now = Date.now();
        const lastMs = lastNotifyTs?.toMillis?.() ?? 0;
        const rateLimited = now - lastMs < 5 * 60 * 1000;

        if (!recipientEmail) {
          emailResult = { ok: false, reason: 'no-email' };
        } else if (!emailEnabled) {
          emailResult = { ok: false, reason: 'email-opt-out' };
        } else if (rateLimited) {
          emailResult = { ok: false, reason: 'rate-limited-5min' };
        } else {
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
                { lastChatEmailNotifyAt: { [senderUid]: FieldValue.serverTimestamp() } },
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

    return NextResponse.json(
      { ok: true, push, email: emailResult },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/chat/notify-message] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "POST { chatId, recipientUid, senderName, preview } avec Bearer pour notifier (push + email fallback).",
  });
}
