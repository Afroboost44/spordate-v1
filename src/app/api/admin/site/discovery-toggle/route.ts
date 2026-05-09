/**
 * Phase 9.5 c8 — POST /api/admin/site/discovery-toggle.
 *
 * Toggle settings/features.discoveryEnabled (boolean) + log audit adminActions.
 *
 * Pipeline :
 *  1. Verify Bearer ID token → uid (Q6=A pattern)
 *  2. Check users.{uid}.role === 'admin' (server-side)
 *  3. Body { enabled: boolean }
 *  4. Write settings/features.discoveryEnabled + updatedAt
 *  5. Log adminActions { actionType:'toggle_discovery', metadata:{enabled} }
 *  6. invalidateFeatureFlagsCache (next read fresh)
 *
 * @returns 200 { ok, enabled } / 400 invalid-input / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { invalidateFeatureFlagsCache } from '@/lib/site/featureFlags';

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

async function isAdmin(uid: string): Promise<boolean> {
  if (!uid) return false;
  const db = await getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  return snap.data()?.role === 'admin';
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    if (!(await isAdmin(uid))) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'admin role required' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const enabled = body?.enabled;
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'enabled must be boolean' },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    await db.collection('settings').doc('features').set(
      {
        discoveryEnabled: enabled,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true },
    );

    const adminActionRef = db.collection('adminActions').doc();
    await adminActionRef.set({
      actionId: adminActionRef.id,
      adminId: uid,
      actionType: 'toggle_discovery',
      targetType: 'site_setting',
      targetId: 'features.discoveryEnabled',
      metadata: { enabled },
      createdAt: Timestamp.now(),
    });

    invalidateFeatureFlagsCache();

    return NextResponse.json({ ok: true, enabled }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/admin/site/discovery-toggle]', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
