/**
 * Phase 9 sub-chantier 3 commit 4/5 — PATCH /api/notifications/[id].
 *
 * Body: { action: 'mark-read' | 'dismiss' }
 *
 * Auth : Bearer ID token via verifyAuth (cohérent /api/invites).
 * Ownership : helper markRead.ts vérifie notification.userId === auth.uid → throw 'forbidden'.
 *
 * Returns :
 *   200 { ok: true }
 *   400 { error: 'invalid-input' }
 *   401 { error: 'unauthenticated' }
 *   403 { error: 'forbidden' }
 *   404 { error: 'not-found' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import {
  markNotificationRead,
  dismissNotification,
  NotificationError,
} from '@/lib/notifications/markRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'invalid-input', detail: 'id required' }, { status: 400 });
    }
    const body = await request.json();
    const action = body?.action;
    if (action !== 'mark-read' && action !== 'dismiss') {
      return NextResponse.json(
        { error: 'invalid-input', detail: "action must be 'mark-read' or 'dismiss'" },
        { status: 400 },
      );
    }

    if (action === 'mark-read') {
      await markNotificationRead(id, uid);
    } else {
      await dismissNotification(id, uid);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof NotificationError) {
      const status =
        err.code === 'forbidden' ? 403 : err.code === 'not-found' ? 404 : 400;
      return NextResponse.json(
        { error: err.code, detail: err.message },
        { status },
      );
    }
    console.error('[/api/notifications/[id]] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
