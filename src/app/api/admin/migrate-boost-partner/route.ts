/**
 * Phase 9.5 c36 — POST /api/admin/migrate-boost-partner.
 *
 * Migration boosts.partnerId legacy "partner-{uid}" → "{uid}". Pattern
 * identique à /api/admin/migrate-activity-partner c34. Voir
 * src/scripts/migrate-boost-partner-id.ts pour la logique.
 *
 * Pipeline :
 *  1. Verify Bearer ID token → uid
 *  2. Check users.{uid}.role === 'admin'
 *  3. Body { dryRun?: boolean } — défaut true (safety)
 *  4. Appel migrateBoostPartnerIds(adminDb, { dryRun })
 *  5. Log adminActions audit si dryRun=false
 *  6. Return { ok, dryRun, totalScanned, totalMigrated, totalAlreadyOk,
 *     errors, migrations }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { migrateBoostPartnerIds } from '@/scripts/migrate-boost-partner-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const dryRun = body?.dryRun !== false;

    const db = await getAdminDb();
    const result = await migrateBoostPartnerIds(db, { dryRun });

    if (!dryRun && result.totalMigrated > 0) {
      const { FieldValue } = await import('firebase-admin/firestore');
      const auditRef = db.collection('adminActions').doc();
      await auditRef.set({
        actionId: auditRef.id,
        actionType: 'migrate_boost_partner_id',
        adminUid: uid,
        metadata: {
          totalScanned: result.totalScanned,
          totalMigrated: result.totalMigrated,
          totalAlreadyOk: result.totalAlreadyOk,
          errorsCount: result.errors.length,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('[/api/admin/migrate-boost-partner] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
