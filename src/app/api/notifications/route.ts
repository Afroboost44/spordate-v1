/**
 * Phase 9 sub-chantier 3 commit 4/5 + Phase 9.5 c52 — POST /api/notifications.
 *
 * Body: { action: 'mark-all-read' }
 *
 * Auth : Bearer ID token via verifyAuth.
 * Scope : tous les docs userId=auth.uid + isRead==false.
 *
 * Phase 9.5 c52 — refactor server-side direct via Admin SDK. Avant c52 ce
 * handler appelait markAllNotificationsRead() qui utilise le SDK Firebase
 * Web (client-side) — incompatible avec une exécution server-side car les
 * Firestore rules s'évaluent sans auth context (request.auth null →
 * permission-denied → 400 silencieux). Bug identique à BUG 1 c44 mais sur
 * POST au lieu de PATCH /api/notifications/[id].
 *
 * Returns :
 *   200 { ok: true, processed: number }
 *   400 { error: 'invalid-input' }
 *   401 { error: 'unauthenticated' }
 *   500 { error: 'internal' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (body?.action !== 'mark-all-read') {
      return NextResponse.json(
        { error: 'invalid-input', detail: "action must be 'mark-all-read'" },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { FieldValue } = await import('firebase-admin/firestore');

    // Query toutes les notifs userId=uid + isRead=false (cohérent legacy index)
    const snap = await db
      .collection('notifications')
      .where('userId', '==', uid)
      .where('isRead', '==', false)
      .get();

    if (snap.empty) {
      return NextResponse.json({ ok: true, processed: 0 }, { status: 200 });
    }

    // Batch update — max 500 ops par batch Firestore. Chunk si besoin.
    const docs = snap.docs;
    let processed = 0;
    const CHUNK = 450;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = db.batch();
      const slice = docs.slice(i, i + CHUNK);
      for (const docSnap of slice) {
        const data = docSnap.data() ?? {};
        if (data.readAt) continue; // déjà readAt set (race), skip
        batch.update(docSnap.ref, {
          readAt: FieldValue.serverTimestamp(),
          isRead: true,
        });
        processed++;
      }
      if (processed > 0) await batch.commit();
    }

    return NextResponse.json({ ok: true, processed }, { status: 200 });
  } catch (err) {
    console.error('[/api/notifications POST mark-all] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
