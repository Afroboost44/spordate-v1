/**
 * Phase 8 sub-chantier 4 commit 3/6 — POST /api/invites/[id]/decline.
 *
 * Doctrine §E.Q9=A explicit decline pour KPI tracking taux refus Phase 9.
 * Path b rule (toUserId only) appliqué côté service.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → toUserId (auth uid)
 *   2. Load invite via Admin SDK + verify (status='pending', toUserId match)
 *   3. Update invite (status='declined', declinedAt) via Admin SDK
 *   4. Best-effort refundForInvite() si mode in ['split','gift'] AND
 *      inviterPaymentIntentId set
 *   5. Best-effort createNotification in-app for fromUserId (Phase 1 stub)
 *   6. Return { status: 'declined' }
 *
 * Error mapping HTTP :
 *   - missing/invalid Bearer → 401
 *   - invite not-found → 404
 *   - forbidden (auth ≠ toUserId) → 403
 *   - status != 'pending' → 409 (idempotency)
 *   - autres → 500
 *
 * Fix bug "Missing or insufficient permissions" : avant ce commit, la route
 * handler appelait declineInvite() du service qui utilise le SDK firebase/firestore
 * CLIENT (sans auth côté serveur) → les rules /invites update path b
 * (request.auth.uid == resource.data.toUserId) échouaient systématiquement.
 * Désormais l'update se fait via Firebase Admin SDK (bypass rules), avec
 * ownership check explicite côté serveur (defense-in-depth équivalent à la
 * rule path b).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Invite } from '@/types/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Verify Bearer
    const toUserId = await verifyAuth(request);
    if (!toUserId) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // 2. Extract inviteId
    const { id: inviteId } = await params;
    if (typeof inviteId !== 'string' || inviteId.length === 0) {
      return NextResponse.json({ error: 'invalid-input', detail: 'inviteId required' }, { status: 400 });
    }

    // 3. Load invite via Admin SDK
    const db = await getAdminDb();
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      return NextResponse.json(
        { error: 'not-found', detail: `Invite ${inviteId} introuvable` },
        { status: 404 },
      );
    }
    const invite = inviteSnap.data() as unknown as Invite;

    // Ownership check (defense-in-depth : équivalent rule path b toUserId only)
    if (invite.toUserId !== toUserId) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'Only toUserId can decline' },
        { status: 403 },
      );
    }
    // Idempotency : ne peut décliner que pending
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'invalid-status', detail: `Invite status='${invite.status}', expected 'pending'` },
        { status: 409 },
      );
    }

    // 4. Update : pending → declined (Admin SDK bypass rules)
    const { FieldValue } = await import('firebase-admin/firestore');
    await inviteRef.update({
      status: 'declined',
      declinedAt: FieldValue.serverTimestamp(),
    });

    // 5. Phase 9 SC2 c5/6 — refund auto si mode Split/Gift et inviter a déjà payé (Q6=A)
    // Best-effort : si refund fail, decline reste valide (admin manual fallback Phase 10)
    const inviteMode = (invite.mode as string | undefined) ?? 'individual';
    if (inviteMode !== 'individual' && invite.inviterPaymentIntentId) {
      try {
        const { refundForInvite } = await import('@/lib/stripe/refundForInvite');
        const result = await refundForInvite({ inviteId });
        console.info('[/api/invites/[id]/decline] refund auto result', {
          inviteId,
          inviteMode,
          result,
        });
      } catch (err) {
        console.warn(
          '[/api/invites/[id]/decline] refundForInvite failed (best-effort, decline reste valide)',
          {
            inviteId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    // 6. Best-effort notif fromUserId (in-app)
    try {
      const nRef = db.collection('notifications').doc();
      await nRef.set({
        notificationId: nRef.id,
        userId: invite.fromUserId,
        type: 'invite_declined',
        title: 'Invitation refusée',
        body: 'Ton invitation a été refusée.',
        data: { inviteId, toUserId: invite.toUserId, sessionId: invite.sessionId },
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch {
      /* silent — notif best-effort */
    }

    return NextResponse.json({ status: 'declined' }, { status: 200 });
  } catch (err) {
    console.error('[/api/invites/[id]/decline] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
