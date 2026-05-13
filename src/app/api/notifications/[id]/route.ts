/**
 * Phase 9 sub-chantier 3 commit 4/5 — PATCH /api/notifications/[id].
 *
 * Body: { action: 'mark-read' | 'dismiss' }
 *
 * Auth : Bearer ID token via verifyAuth (cohérent /api/invites).
 *
 * Phase 9.5 c44 — refactor server-side direct via Admin SDK. Avant c44 ce
 * handler appelait les helpers `markRead.ts` qui utilisent le SDK Firebase
 * Web (client-side) — incompatible avec une exécution server-side car les
 * Firestore rules s'évaluent sans auth context côté serveur (request.auth
 * null → permission-denied → toast "Impossible de masquer"). Maintenant on
 * lit/écrit directement avec Admin SDK et on vérifie l'ownership inline
 * (notification.userId === uid).
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

/**
 * Phase 9.5 c53 — DELETE /api/notifications/[id].
 *
 * Hard-delete : supprime définitivement le doc Firestore (vs soft-delete via
 * dismissedAt c44+c52 jugé fragile par UX — l'optimistic update pouvait se
 * faire revert par re-fire du snapshot listener avant que dismissedAt soit
 * persisté). Hard-delete élimine la classe entière de race condition.
 *
 * Auth : Bearer ID token via verifyAuth.
 * Ownership : data.userId === uid sinon 403.
 *
 * Returns : 200 { ok } / 401 / 403 / 404 / 500
 */
export async function DELETE(
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
    const db = await getAdminDb();
    const ref = db.collection('notifications').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      // Idempotent : suppression d'un doc déjà absent → 200 ok
      return NextResponse.json({ ok: true, alreadyAbsent: true }, { status: 200 });
    }
    const data = snap.data() ?? {};
    if (data.userId !== uid) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[/api/notifications/[id] DELETE] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

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
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'mark-read' && action !== 'dismiss') {
      return NextResponse.json(
        { error: 'invalid-input', detail: "action must be 'mark-read' or 'dismiss'" },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { FieldValue } = await import('firebase-admin/firestore');
    const ref = db.collection('notifications').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    const data = snap.data() ?? {};
    if (data.userId !== uid) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (action === 'mark-read') {
      // Idempotent : skip si déjà lu (readAt OU isRead).
      if (!data.readAt && !data.isRead) {
        await ref.update({
          readAt: FieldValue.serverTimestamp(),
          isRead: true,
        });
      }
    } else {
      // dismiss : soft-delete via dismissedAt timestamp (UI filtre côté client).
      if (!data.dismissedAt) {
        await ref.update({
          dismissedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[/api/notifications/[id]] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
