/**
 * Phase 9.5 c21 — POST /api/partner/discovery-opt-in.
 *
 * Toggle partners/{partnerId}.includeInDiscovery (boolean) + audit log adminActions.
 *
 * Pipeline :
 *  1. Verify Bearer ID token → uid
 *  2. Load partners doc owned by uid (where email == auth user.email)
 *     OU partnerId explicitement fourni si user admin
 *  3. Body { includeInDiscovery: boolean }
 *  4. Update partners/{partnerId}.includeInDiscovery + updatedAt
 *  5. Log adminActions {actionType:'toggle_partner_discovery_opt_in'}
 *
 * Sécurité :
 *  - Owner peut toggle son propre partner (lookup via email)
 *  - Admin peut toggle n'importe quel partner (via body.partnerId)
 *  - Pas de cross-user toggle sans admin
 *
 * @returns 200 { ok, includeInDiscovery, partnerId } / 400 / 401 / 403 / 404 / 500
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

async function isAdmin(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists && snap.data()?.role === 'admin';
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const include = body?.includeInDiscovery;
    if (typeof include !== 'boolean') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'includeInDiscovery must be boolean' },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'user-not-found' }, { status: 404 });
    }
    const userEmail = userSnap.data()?.email as string | undefined;

    // Resolve partnerId : admin can pass explicit body.partnerId, sinon lookup by email
    const userIsAdmin = await isAdmin(db, uid);
    let partnerId: string | null = null;

    if (userIsAdmin && typeof body?.partnerId === 'string' && body.partnerId.length > 0) {
      const exists = await db.collection('partners').doc(body.partnerId).get();
      if (!exists.exists) {
        return NextResponse.json({ error: 'partner-not-found' }, { status: 404 });
      }
      partnerId = body.partnerId;
    } else if (userEmail) {
      const q = await db
        .collection('partners')
        .where('email', '==', userEmail)
        .limit(1)
        .get();
      if (q.empty) {
        return NextResponse.json(
          { error: 'partner-not-found', detail: 'no partner doc matched user email' },
          { status: 404 },
        );
      }
      partnerId = q.docs[0].id;
    } else {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    await db.collection('partners').doc(partnerId!).update({
      includeInDiscovery: include,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const auditRef = db.collection('adminActions').doc();
    await auditRef.set({
      actionId: auditRef.id,
      adminId: userIsAdmin ? uid : 'partner-self',
      actionType: 'toggle_partner_discovery_opt_in',
      targetType: 'partner',
      targetId: partnerId,
      metadata: {
        includeInDiscovery: include,
        actorUid: uid,
        actorEmail: userEmail,
      },
      createdAt: Timestamp.now(),
    });

    return NextResponse.json(
      { ok: true, partnerId, includeInDiscovery: include },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/partner/discovery-opt-in]', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
