/**
 * Phase 9.5 c9 — POST /api/auth/admin-self-promote.
 *
 * Auto-promote au login : si l'email du Bearer token est dans ADMIN_EMAILS
 * (lib/sports.ts), update Firestore users/{uid}.role='admin' + log audit
 * adminActions {actionType:'auto_promote_admin', source:'login'}.
 *
 * Idempotent : si role déjà 'admin', return { ok:true, alreadyAdmin:true }
 * sans re-write ni log doublon.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid
 *   2. Charger users/{uid} → email
 *   3. isAdminEmail(email) ? sinon 403 not-eligible
 *   4. Si role déjà 'admin' → 200 alreadyAdmin (idempotent)
 *   5. Sinon : update role=admin + audit log + return 200 promoted
 *
 * Sécurité :
 *  - Le check email se fait côté serveur depuis le doc Firestore (pas depuis
 *    le claim/token du client) → anti-spoof.
 *  - Admin SDK bypass rules → permet write role même si user.role !== admin
 *    actuellement (chicken-and-egg : nouvelle promotion).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { isAdminEmail } from '@/lib/sports';

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

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const db = await getAdminDb();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'user-not-found' }, { status: 404 });
    }
    const userData = userSnap.data() as { email?: string; role?: string };
    const email = userData?.email;

    if (!isAdminEmail(email)) {
      return NextResponse.json(
        { error: 'not-eligible', detail: 'email not in admin allowlist' },
        { status: 403 },
      );
    }

    // Idempotent : déjà admin → no-op
    if (userData?.role === 'admin') {
      return NextResponse.json(
        { ok: true, alreadyAdmin: true, role: 'admin' },
        { status: 200 },
      );
    }

    // Promote
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    await db.collection('users').doc(uid).update({
      role: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Audit log (Admin SDK bypass rules)
    const auditRef = db.collection('adminActions').doc();
    await auditRef.set({
      actionId: auditRef.id,
      adminId: 'system',
      actionType: 'auto_promote_admin',
      targetType: 'user',
      targetId: uid,
      metadata: {
        email,
        previousRole: userData?.role || 'unknown',
        source: 'login',
      },
      createdAt: Timestamp.now(),
    });

    return NextResponse.json(
      { ok: true, alreadyAdmin: false, role: 'admin' },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/auth/admin-self-promote]', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
