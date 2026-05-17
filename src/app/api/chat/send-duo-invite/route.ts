/**
 * BUG #36 COMMIT 3 — POST /api/chat/send-duo-invite
 *
 * Mode Duo : sender paie 2 places via Stripe, après confirmation paiement
 * le message activity_invite (mode=duo, sponsorPaidAt) est créé dans le chat.
 *
 * ⚠️ STUB COMMIT 3 — Pour livrer le flow UI complet sans bloquer sur
 * l'intégration Stripe Checkout (qui demande refactor /api/checkout pour
 * accepter activityInviteMatchId metadata + webhook handleSessionPayment
 * hook pour créer le message après paiement). Cette version :
 *  - Verify auth + body
 *  - Crée DIRECTEMENT le message activity_invite via Admin SDK (skip paiement)
 *  - sponsorPaidAt = now (FAUX paiement pour démo end-to-end)
 *  - Return successUrl=/chat?match=X (redirect imitation)
 *
 * TODO COMMIT 4 (vrai paiement) :
 *  - Charger session prochaine de l'activity (getNextFutureSessionForActivity)
 *  - Calculer prix server-side (computePricingTier)
 *  - Créer stripe.checkout.sessions.create avec :
 *    * mode='payment', payment_method_types=['card','twint']
 *    * line_items: 2× price (sender + invitee)
 *    * metadata: { activityInviteMode='duo', activityInviteMatchId,
 *                  activityInviteReceiverUid, activityInviteSenderUid,
 *                  activityTitle, activityCity, activitySport, inviteeUid,
 *                  isDuoTicket='true' } — réutilise patterns existants fix #c45/c47
 *    * success_url=`/chat?match={matchId}&duoInvite=success`
 *    * cancel_url=`/chat?match={matchId}&duoInvite=cancel`
 *  - Webhook handleSessionPayment hook : si metadata.activityInviteMatchId
 *    présent, après création bookings, créer message activity_invite via
 *    Admin SDK avec mode=duo + sponsorPaidAt=FieldValue.serverTimestamp()
 *  - Si paiement annulé → no webhook fire → no message créé (décision Q-D OK)
 *
 * @module
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'spordateur-claude',
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

interface BodyShape {
  matchId?: string;
  senderUid?: string;
  receiverUid?: string;
  activityId?: string;
  activityTitle?: string;
  activityCity?: string;
  activitySport?: string;
  activityImageUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as BodyShape;
    if (!body.matchId || !body.senderUid || !body.receiverUid || !body.activityId || !body.activityTitle) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'matchId, senderUid, receiverUid, activityId, activityTitle requis' },
        { status: 400 },
      );
    }
    if (body.senderUid !== uid) {
      return NextResponse.json({ error: 'forbidden', detail: 'senderUid != auth uid' }, { status: 403 });
    }
    if (body.senderUid === body.receiverUid) {
      return NextResponse.json({ error: 'invalid-input', detail: 'self-invite' }, { status: 400 });
    }

    const db = await getAdminDb();
    const { FieldValue } = await import('firebase-admin/firestore');

    // Anti-doublon : check existing pending invite sender+activityId
    const existingSnap = await db
      .collection('chats').doc(body.matchId)
      .collection('messages')
      .where('type', '==', 'activity_invite')
      .where('senderId', '==', body.senderUid)
      .where('invite.activityId', '==', body.activityId)
      .where('inviteStatus', '==', 'pending')
      .limit(1)
      .get();

    const messagesRef = db.collection('chats').doc(body.matchId).collection('messages');
    let messageId: string;
    let replaced = false;

    const inviteData: Record<string, unknown> = {
      activityId: body.activityId,
      activityTitle: body.activityTitle,
      inviteMode: 'duo',
    };
    if (body.activityCity) inviteData.activityCity = body.activityCity;
    if (body.activitySport) inviteData.activitySport = body.activitySport;
    if (body.activityImageUrl) inviteData.activityImageUrl = body.activityImageUrl;

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      await existingDoc.ref.set(
        {
          messageId: existingDoc.id,
          senderId: body.senderUid,
          text: '',
          type: 'activity_invite',
          readBy: [body.senderUid],
          invite: inviteData,
          inviteStatus: 'pending',
          sponsorPaidAt: FieldValue.serverTimestamp(),
          createdAt: existingDoc.data().createdAt ?? FieldValue.serverTimestamp(),
        },
        { merge: false },
      );
      messageId = existingDoc.id;
      replaced = true;
    } else {
      const docRef = await messagesRef.add({
        senderId: body.senderUid,
        text: '',
        type: 'activity_invite',
        readBy: [body.senderUid],
        invite: inviteData,
        inviteStatus: 'pending',
        sponsorPaidAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
      await docRef.update({ messageId: docRef.id });
      messageId = docRef.id;
    }

    // Notification receiver best-effort
    try {
      const notifRef = db.collection('notifications').doc();
      await notifRef.set({
        notificationId: notifRef.id,
        userId: body.receiverUid,
        type: 'activity_invite',
        title: 'Nouvelle invitation (Duo) 💝',
        body: `Quelqu'un a payé pour t'inviter à ${body.activityTitle}`,
        data: {
          matchId: body.matchId,
          messageId,
          activityId: body.activityId,
          clickUrl: `/chat?match=${body.matchId}`,
        },
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('[/api/chat/send-duo-invite] notification create failed (non-bloquant)', err);
    }

    // STUB COMMIT 3 : pas de Stripe Checkout réel. Return success direct.
    // COMMIT 4 : retourner Stripe Checkout URL → client redirect window.location.href
    return NextResponse.json(
      {
        ok: true,
        messageId,
        replaced,
        // URL de redirection : retour au chat avec confirmation
        url: `/chat?match=${body.matchId}&duoInvite=success`,
        stub: true,
        note: 'COMMIT 3 STUB — Stripe Checkout will be integrated in COMMIT 4',
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/chat/send-duo-invite] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
