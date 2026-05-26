/**
 * POST /api/cron/expire-boosts — Désactivation côté serveur des boosts partenaires
 * dont la fenêtre `expiresAt` est dépassée.
 *
 * Contexte : la collection `boosts` n'avait aucun mécanisme serveur de mise
 * hors-ligne ; seul le client filtrait `expiresAt > now` au moment de l'affichage.
 * Conséquences : (a) toute évolution de la logique de lecture pouvait faire
 * resurgir des boosts morts, (b) les stats admin (active=true) étaient faussées.
 *
 * Pipeline (cohérent avec /api/cron/expire-invites) :
 *   1. Auth Bearer ${CRON_SECRET}
 *   2. Pagination cursor : query `boosts` where active==true AND expiresAt <= now
 *      ORDER BY expiresAt ASC → batch update {active:false, expiredAt: serverTs}
 *   3. pageSize=500, maxPages=10 (5000 docs cap par run, maxDuration 60s safe)
 *   4. truncated=true si maxPages atteint → run suivant continuera
 *
 * Idempotence : transition active=true → active=false ; les docs déjà désactivés
 * ne re-matchent plus la query, donc re-runs sans risque.
 *
 * Best-effort : per-batch failure logged + break (jamais throw fatal).
 *
 * Returns : { processed, pages, hasMore, pageSize, maxPages, dryRun, errors }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 500;
const MAX_PAGES_DEFAULT = 10; // 5000 docs cap par run

export async function POST(req: NextRequest) {
  // 1. Auth Bearer CRON_SECRET
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 2. Parse params
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === 'true';

  const limitParam = searchParams.get('limit');
  let pageSize = BATCH_LIMIT_DEFAULT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > BATCH_LIMIT_DEFAULT) {
      return NextResponse.json(
        { error: 'invalid-limit', detail: `limit must be 1..${BATCH_LIMIT_DEFAULT}` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    pageSize = Math.floor(parsed);
  }

  const maxPagesParam = searchParams.get('maxPages');
  let maxPages = MAX_PAGES_DEFAULT;
  if (maxPagesParam !== null) {
    const parsed = Number(maxPagesParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_PAGES_DEFAULT) {
      return NextResponse.json(
        { error: 'invalid-maxPages', detail: `maxPages must be 1..${MAX_PAGES_DEFAULT}` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    maxPages = Math.floor(parsed);
  }

  try {
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    const db = await getAdminDb();

    const nowTs = Timestamp.fromMillis(Date.now());

    let processed = 0;
    let pages = 0;
    let errors = 0;
    let hasMore = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastDoc: any = null;

    while (pages < maxPages) {
      let pageQuery = db
        .collection('boosts')
        .where('active', '==', true)
        .where('expiresAt', '<=', nowTs)
        .orderBy('expiresAt', 'asc')
        .limit(pageSize);
      if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);

      const snap = await pageQuery.get();
      if (snap.empty) break;
      pages++;

      // Batch update {active:false, expiredAt: serverTimestamp()}
      // Admin SDK bypass rules — cron trusté.
      if (!dryRun) {
        try {
          const batch = db.batch();
          for (const d of snap.docs) {
            batch.update(d.ref, {
              active: false,
              expiredAt: FieldValue.serverTimestamp(),
            });
          }
          await batch.commit();
        } catch (err) {
          errors++;
          console.warn('[/api/cron/expire-boosts] batch update failed (skip page)', {
            page: pages,
            size: snap.size,
            error: err instanceof Error ? err.message : String(err),
          });
          // Best-effort : log + break (next page éviterait re-tenter même cursor)
          break;
        }
      }
      processed += snap.size;

      // dryRun → on ne write pas, mêmes docs reviendraient → break
      if (dryRun) break;
      // Page partielle → terminé
      if (snap.size < pageSize) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    if (pages >= maxPages) {
      hasMore = true;
    }

    console.info('[/api/cron/expire-boosts] done', {
      processed,
      pages,
      hasMore,
      errors,
      dryRun,
    });

    return NextResponse.json(
      {
        processed,
        pages,
        hasMore,
        pageSize,
        maxPages,
        dryRun,
        errors,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/cron/expire-boosts] fatal', err);
    return NextResponse.json(
      { error: 'cron-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
