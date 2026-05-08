/**
 * Phase 9 sub-chantier 3 commit 4/5 — POST /api/notifications (mark-all-read).
 *
 * Body: { action: 'mark-all-read' }
 *
 * Auth : Bearer ID token via verifyAuth.
 * Scope : tous les docs userId=auth.uid + readAt==null/isRead==false.
 *
 * Returns :
 *   200 { ok: true, processed: number }
 *   400 { error: 'invalid-input' }
 *   401 { error: 'unauthenticated' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import {
  markAllNotificationsRead,
  NotificationError,
} from '@/lib/notifications/markRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await request.json();
    if (body?.action !== 'mark-all-read') {
      return NextResponse.json(
        { error: 'invalid-input', detail: "action must be 'mark-all-read'" },
        { status: 400 },
      );
    }
    const result = await markAllNotificationsRead(uid);
    return NextResponse.json({ ok: true, processed: result.processed }, { status: 200 });
  } catch (err) {
    if (err instanceof NotificationError) {
      return NextResponse.json(
        { error: err.code, detail: err.message },
        { status: 400 },
      );
    }
    console.error('[/api/notifications] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
