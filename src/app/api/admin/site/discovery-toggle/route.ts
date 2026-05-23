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
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    // Phase 9.5 c21 — body accepte mode (3-state) OU enabled (backward-compat c8 boolean)
    const body = await request.json().catch(() => ({}));
    const VALID_MODES = ['disabled', 'participants-only', 'open-to-all'] as const;
    type DiscoveryMode = (typeof VALID_MODES)[number];

    let mode: DiscoveryMode;
    if (typeof body?.mode === 'string' && VALID_MODES.includes(body.mode)) {
      mode = body.mode as DiscoveryMode;
    } else if (typeof body?.enabled === 'boolean') {
      // Legacy c8 path : { enabled: true } → 'open-to-all', false → 'disabled'
      mode = body.enabled ? 'open-to-all' : 'disabled';
    } else {
      return NextResponse.json(
        {
          error: 'invalid-input',
          detail: `mode must be one of: ${VALID_MODES.join(', ')} (or boolean enabled legacy)`,
        },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    await db.collection('settings').doc('features').set(
      {
        discoveryMode: mode,
        // Backward compat : conserve discoveryEnabled boolean dérivé pour consumers c8 pas migrés
        discoveryEnabled: mode !== 'disabled',
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
      targetId: 'features.discoveryMode',
      metadata: { mode, enabled: mode !== 'disabled' },
      createdAt: Timestamp.now(),
    });

    invalidateFeatureFlagsCache();

    return NextResponse.json(
      { ok: true, mode, enabled: mode !== 'disabled' },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/admin/site/discovery-toggle]', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
