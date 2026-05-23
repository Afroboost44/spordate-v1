/**
 * BUG #3 — POST /api/admin/migrate-orphan-sessions
 *
 * Migration one-shot : répare les sessions orphelines déjà en prod — sessions
 * futures encore "actives" alors que leur activity parente a été supprimée
 * (hard-delete : doc absent) ou désactivée (soft-delete : isActive=false).
 *
 * Ces sessions sont passées en `status: 'cancelled'`.
 *
 * Pipeline :
 *   1. Auth Bearer ${CRON_SECRET} (cohérent /api/cron/*)
 *   2. Charge la map activityId → isActive (toutes les activities)
 *   3. Scanne les sessions futures (startAt > now)
 *   4. Pour chaque : si shouldCancelSessionOnActivityRemoval && activity
 *      indisponible (absente OU isActive=false) → cancel
 *   5. WriteBatch chunké (500 ops max par batch)
 *
 * Idempotent : une session déjà 'cancelled' est ignorée (re-run safe).
 * Supprimable après exécution réussie.
 *
 * Method : POST (state-changing). Param : ?dryRun=true (scan sans écrire).
 *
 * Returns : { scanned, orphansFound, cancelled, dryRun }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  isActivityUnavailable,
  shouldCancelSessionOnActivityRemoval,
} from '@/lib/activities/lifecycle';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_CHUNK = 500; // limite Firestore WriteBatch

export async function POST(req: NextRequest) {
  // 1. Auth
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === 'true';

  try {
    const db = await getAdminDb();
    const { Timestamp } = await import('firebase-admin/firestore');
    const nowMs = Date.now();

    // 2. Map activityId → isActive (une activity absente de la map = hard-deleted)
    const activitiesSnap = await db.collection('activities').get();
    const activityActiveById = new Map<string, boolean>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activitiesSnap.docs.forEach((d: any) => {
      activityActiveById.set(d.id, d.data()?.isActive !== false);
    });

    // 3. Sessions futures
    const sessionsSnap = await db
      .collection('sessions')
      .where('startAt', '>', Timestamp.fromMillis(nowMs))
      .get();

    // 4. Filtre les orphelines à annuler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orphans: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionsSnap.docs.forEach((sdoc: any) => {
      const session = sdoc.data();
      if (!shouldCancelSessionOnActivityRemoval(session, nowMs)) return;
      const activityId = session.activityId as string | undefined;
      // activity absente de la map → hard-deleted ; sinon on lit son isActive.
      const activityForCheck = activityId && activityActiveById.has(activityId)
        ? { isActive: activityActiveById.get(activityId) }
        : null;
      if (isActivityUnavailable(activityForCheck)) {
        orphans.push(sdoc);
      }
    });

    // 5. WriteBatch chunké
    let cancelled = 0;
    if (!dryRun) {
      const { FieldValue } = await import('firebase-admin/firestore');
      for (let i = 0; i < orphans.length; i += BATCH_CHUNK) {
        const chunk = orphans.slice(i, i + BATCH_CHUNK);
        const batch = db.batch();
        for (const sdoc of chunk) {
          batch.update(sdoc.ref, {
            status: 'cancelled',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        cancelled += chunk.length;
      }
    }

    return NextResponse.json(
      {
        scanned: sessionsSnap.size,
        orphansFound: orphans.length,
        cancelled: dryRun ? 0 : cancelled,
        dryRun,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/admin/migrate-orphan-sessions] fatal', err);
    return NextResponse.json(
      { error: 'migration-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
