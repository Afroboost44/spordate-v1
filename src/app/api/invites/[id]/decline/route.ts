/**
 * Phase 8 sub-chantier 4 commit 3/6 — POST /api/invites/[id]/decline.
 *
 * Doctrine §E.Q9=A explicit decline pour KPI tracking taux refus Phase 9.
 * Path b rule (toUserId only) appliqué côté service.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → toUserId (auth uid)
 *   2. Call declineInvite(inviteId, toUserId)
 *   3. Best-effort createNotification in-app for fromUserId (Phase 1 stub)
 *   4. Return { status: 'declined' }
 *
 * Error mapping HTTP :
 *   - missing/invalid Bearer → 401
 *   - InviteError 'not-found' → 404
 *   - InviteError 'forbidden' → 403
 *   - InviteError 'invalid-status' → 409 (idempotency)
 *   - autres → 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { declineInvite, InviteError } from '@/lib/invites/service';

export const runtime = 'nodejs';

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

    // 3. Call service
    await declineInvite(inviteId, toUserId);

    return NextResponse.json({ status: 'declined' }, { status: 200 });
  } catch (err) {
    if (err instanceof InviteError) {
      const status =
        err.code === 'not-found'
          ? 404
          : err.code === 'forbidden'
            ? 403
            : err.code === 'invalid-status'
              ? 409
              : 500;
      return NextResponse.json({ error: err.code, detail: err.message }, { status });
    }
    console.error('[/api/invites/[id]/decline] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
