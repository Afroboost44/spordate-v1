/**
 * Phase 8 sub-chantier 4 commit 3/6 — POST /api/invites.
 *
 * Doctrine §E.Q1 mode Individuel Phase 8 : User A invite User B à une activity/session.
 * B reçoit notification + lien vers /invite/[id] pour accepter (Stripe checkout)
 * ou décliner.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → fromUserId (auth uid)
 *   2. Validate body shape (toUserId, activityId, sessionId required)
 *   3. Call createInvite() service (helper SC4 commit 2/6)
 *   4. Best-effort sendEmail inviteReceived to toUserId (Q5=C — template SC4 commit 4/6)
 *   5. Best-effort createNotification in-app for toUserId (Q5=C)
 *   6. Return { inviteId, status: 'pending' }
 *
 * Error mapping HTTP :
 *   - missing/invalid Bearer → 401
 *   - InviteError 'invalid-input' / 'self-invite-forbidden' / 'session-too-soon' → 400
 *   - InviteError 'session-not-found' → 404
 *   - InviteError 'forbidden' → 403
 *   - autres → 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import {
  createInvite,
  InviteError,
  __setInvitesDbForTesting as _seamRef,
} from '@/lib/invites/service';

export const runtime = 'nodejs'; // firebase-admin requires Node.js

// Re-export DI seam pour tests (cohérent SC1 chat service test pattern)
export const __setInvitesDbForTesting = _seamRef;

export async function POST(request: NextRequest) {
  try {
    // 1. Verify Bearer
    const fromUserId = await verifyAuth(request);
    if (!fromUserId) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // 2. Parse + validate body
    const body = await request.json();
    if (
      typeof body?.toUserId !== 'string' ||
      typeof body?.activityId !== 'string' ||
      typeof body?.sessionId !== 'string' ||
      body.toUserId.length === 0 ||
      body.activityId.length === 0 ||
      body.sessionId.length === 0
    ) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'toUserId, activityId, sessionId required (non-empty strings)' },
        { status: 400 },
      );
    }

    // 3. Call service
    const message = typeof body.message === 'string' ? body.message : undefined;
    const inviteId = await createInvite({
      fromUserId,
      toUserId: body.toUserId,
      activityId: body.activityId,
      sessionId: body.sessionId,
      message,
    });

    // 4-5. Best-effort notifications (template + in-app — wired commit 4/6)
    // Phase 1 stub : skipped jusqu'au commit 4/6 (template inviteReceived).
    // Le bot message client-side stream + page /invite/[id] suffisent pour SC4 c3/6.

    return NextResponse.json({ inviteId, status: 'pending' }, { status: 200 });
  } catch (err) {
    if (err instanceof InviteError) {
      const status =
        err.code === 'invalid-input' ||
        err.code === 'self-invite-forbidden' ||
        err.code === 'session-too-soon'
          ? 400
          : err.code === 'session-not-found'
            ? 404
            : err.code === 'forbidden'
              ? 403
              : 500;
      return NextResponse.json({ error: err.code, detail: err.message }, { status });
    }
    console.error('[/api/invites POST] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
