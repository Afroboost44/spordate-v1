/**
 * Phase 9 sub-chantier 2 commit 4/6 — POST /api/invites/[id]/accept-gift.
 *
 * Endpoint dédié pour acceptation invite mode='gift' (B accepte cadeau A).
 * Pas de Stripe checkout (A a déjà tout payé via /api/checkout mode='invite-prepay').
 *
 * Pipeline :
 *   1. verifyAuth → callerUid (must equal invite.toUserId)
 *   2. Load invite Admin SDK + verify :
 *      - status='pending'
 *      - mode='gift'
 *      - auth.uid === invite.toUserId
 *      - not expired
 *      - inviterPaymentIntentId set (A déjà payé)
 *   3. Load session bookable + activity for chatCreditsBundle
 *   4. runTransaction atomic :
 *      - Booking userId=toUserId + paidByUserId=fromUserId (Q2=C denorm)
 *      - Invite.status='accepted' + acceptedAt
 *      - Increment session.currentParticipants + recompute tier
 *      - Grant chat credits B
 *      - Transaction record type='invite_accept_gift'
 *   5. Post-commit best-effort : notif fromUserId + notif toUserId
 *
 * Errors HTTP :
 *   - missing Bearer → 401
 *   - invite not found → 404
 *   - status != pending → 409
 *   - forbidden (auth ≠ toUserId) → 403
 *   - expired → 410
 *   - mode != gift → 400 invalid-mode
 *   - inviterPaymentIntentId missing → 412 prepay-incomplete
 *   - session not bookable → 409
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { computePricingTier, isSessionBookable } from '@/services/firestore';
import type { Activity, Invite, Session, SessionStatus } from '@/types/firestore';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: inviteId } = await params;
    if (!inviteId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'inviteId required' }, { status: 400 });
    }

    // 1. Verify Bearer
    const callerUid = await verifyAuth(request);
    if (!callerUid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const db = await getAdminDb();

    // 2. Load invite
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      return NextResponse.json({ error: 'invite-not-found' }, { status: 404 });
    }
    const invite = inviteSnap.data() as unknown as Invite;

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'invalid-status', detail: `Invite status='${invite.status}', expected 'pending'` },
        { status: 409 },
      );
    }
    if (invite.mode !== 'gift') {
      return NextResponse.json(
        { error: 'invalid-mode', detail: `Invite mode='${invite.mode ?? 'individual'}', expected 'gift'` },
        { status: 400 },
      );
    }
    if (invite.toUserId !== callerUid) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'Only toUserId can accept this invite' },
        { status: 403 },
      );
    }
    const expiresAtMs = invite.expiresAt?.toMillis?.() ?? 0;
    if (expiresAtMs <= Date.now()) {
      return NextResponse.json({ error: 'expired' }, { status: 410 });
    }
    if (!invite.inviterPaymentIntentId) {
      return NextResponse.json(
        {
          error: 'prepay-incomplete',
          detail: 'Inviter has not yet paid (inviterPaymentIntentId missing)',
        },
        { status: 412 },
      );
    }

    // 3. Load session + activity
    if (!invite.sessionId) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'Invite has no sessionId' },
        { status: 400 },
      );
    }
    const sessionRef = db.collection('sessions').doc(invite.sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const sessionData = sessionSnap.data() as unknown as Session;
    if (!isSessionBookable(sessionData, new Date())) {
      return NextResponse.json(
        {
          error: 'session-not-bookable',
          detail: `status=${sessionData.status}, ${sessionData.currentParticipants}/${sessionData.maxParticipants}`,
        },
        { status: 409 },
      );
    }

    const activitySnap = await db.collection('activities').doc(invite.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() as unknown as Activity;
    const bundleCredits = activity.chatCreditsBundle ?? 50;

    // 4. Transaction atomic
    const { FieldValue } = await import('firebase-admin/firestore');
    let bookingIdResult = '';
    try {
      await db.runTransaction(
        async (tx: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          get: (ref: any) => Promise<any>;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          set: (ref: any, data: any) => void;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          update: (ref: any, data: any) => void;
        }) => {
          // Re-read invite + session intra-tx
          const inviteSnapTx = await tx.get(inviteRef);
          if (!inviteSnapTx.exists || inviteSnapTx.data()?.status !== 'pending') {
            throw new Error(`Invite ${inviteId} not pending (race)`);
          }
          const sessionSnapTx = await tx.get(sessionRef);
          if (!sessionSnapTx.exists) throw new Error(`Session ${invite.sessionId} disparu`);
          const session = sessionSnapTx.data() as unknown as Session;
          if (!isSessionBookable(session, new Date())) {
            throw new Error(`Session non bookable (race)`);
          }

          const computed = computePricingTier(session, new Date());
          // Pour gift, amount = inviterPrepay (déjà payé) — Booking.amount = splitInviterAmountCents
          const bookingAmount = invite.splitInviterAmountCents ?? computed.price;

          // Create booking : userId=toUserId (B participe), paidByUserId=fromUserId (A a payé)
          const bookingRef = db.collection('bookings').doc();
          bookingIdResult = bookingRef.id;
          tx.set(bookingRef, {
            bookingId: bookingRef.id,
            userId: invite.toUserId,
            userName: '',
            matchId: '',
            activityId: invite.activityId,
            partnerId: session.partnerId,
            sport: session.sport,
            ticketType: 'solo',
            sessionDate: session.startAt,
            status: 'confirmed',
            transactionId: '',
            amount: bookingAmount,
            currency: 'CHF',
            creditsUsed: 0,
            sessionId: invite.sessionId,
            paymentIntentId: invite.inviterPaymentIntentId,
            tier: computed.tier,
            paidByUserId: invite.fromUserId, // Q2=C denorm gift mode
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Increment session participants + recompute tier/price/status
          const newParticipants = session.currentParticipants + 1;
          const { tier: newTier, price: newPrice } = computePricingTier(
            session,
            new Date(),
            newParticipants,
          );
          const newStatus: SessionStatus =
            newParticipants >= session.maxParticipants ? 'full' : 'open';
          tx.update(sessionRef, {
            currentParticipants: newParticipants,
            currentTier: newTier,
            currentPrice: newPrice,
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Grant chat credits B
          tx.update(db.collection('users').doc(invite.toUserId), {
            credits: FieldValue.increment(bundleCredits),
            updatedAt: FieldValue.serverTimestamp(),
          });
          const creditRef = db.collection('credits').doc();
          tx.set(creditRef, {
            creditId: creditRef.id,
            userId: invite.toUserId,
            type: 'purchase',
            amount: bundleCredits,
            balance: 0,
            description: `Bundle chat (cadeau accepté) : ${session.title}`,
            relatedId: bookingRef.id,
            createdAt: FieldValue.serverTimestamp(),
          });

          // Update invite : accepted
          tx.update(inviteRef, {
            status: 'accepted',
            acceptedAt: FieldValue.serverTimestamp(),
          });

          // Transaction record
          const txRef = db.collection('transactions').doc();
          tx.set(txRef, {
            transactionId: txRef.id,
            stripeSessionId: '',
            stripePaymentIntentId: invite.inviterPaymentIntentId,
            userId: invite.toUserId,
            type: 'invite_accept_gift',
            amount: bookingAmount,
            currency: 'CHF',
            paymentMethod: 'card',
            status: 'succeeded',
            metadata: { inviteId, fromUserId: invite.fromUserId },
            package: '',
            creditsGranted: bundleCredits,
            sessionId: invite.sessionId,
            bookingId: bookingRef.id,
            inviteId,
            createdAt: FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp(),
          });
        },
      );
    } catch (err) {
      console.error('[/api/invites/[id]/accept-gift] runTransaction failed', err);
      return NextResponse.json(
        { error: 'transaction-failed', detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }

    // 5. Post-commit : notif fromUserId (best-effort)
    try {
      const nRef = db.collection('notifications').doc();
      await nRef.set({
        notificationId: nRef.id,
        userId: invite.fromUserId,
        type: 'invite_accepted',
        title: 'Cadeau accepté !',
        body: `${activity.title || 'Spordateur'} — ton cadeau a été accepté.`,
        data: { inviteId, toUserId: invite.toUserId, sessionId: invite.sessionId, bookingId: bookingIdResult },
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch {
      /* silent */
    }

    // 6. Notif toUserId (booking confirmed)
    try {
      const nRef = db.collection('notifications').doc();
      await nRef.set({
        notificationId: nRef.id,
        userId: invite.toUserId,
        type: 'booking',
        title: 'Réservation confirmée',
        body: `🎁 ${activity.title || 'Spordateur'} — cadeau accepté. ${bundleCredits} crédits chat ajoutés.`,
        data: { sessionId: invite.sessionId, bookingId: bookingIdResult, inviteId },
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch {
      /* silent */
    }

    return NextResponse.json(
      { bookingId: bookingIdResult, status: 'accepted', mode: 'gift' },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/invites/[id]/accept-gift] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
