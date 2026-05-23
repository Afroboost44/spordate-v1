/**
 * Phase 9.5 c39 — POST /api/admin/dedupe-matches.
 *
 * Cleanup matches/ legacy : dedupe docs en doublon pour une même paire userIds,
 * migration vers les deterministic IDs c39. Voir src/scripts/dedupe-matches.ts.
 *
 * Pattern identique à /api/admin/migrate-* (c29a, c34, c36).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { dedupeMatches } from '@/scripts/dedupe-matches';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const result = await dedupeMatches(db, { dryRun });

    if (!dryRun && (result.totalDeleted > 0 || result.totalMigrated > 0)) {
      const { FieldValue } = await import('firebase-admin/firestore');
      const auditRef = db.collection('adminActions').doc();
      await auditRef.set({
        actionId: auditRef.id,
        actionType: 'dedupe_matches',
        adminUid: uid,
        metadata: {
          totalScanned: result.totalScanned,
          totalGroups: result.totalGroups,
          totalKept: result.totalKept,
          totalDeleted: result.totalDeleted,
          totalMigrated: result.totalMigrated,
          errorsCount: result.errors.length,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('[/api/admin/dedupe-matches] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
