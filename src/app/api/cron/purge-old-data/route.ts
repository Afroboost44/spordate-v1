/**
 * Phase 8 sub-chantier 5 commit 3/5 — POST /api/cron/purge-old-data.
 *
 * Comble Différés Phase 8 lignes 882-883 architecture.md :
 *   « ⏳ Cron purge audit trail `/adminActions/` après 24mo »
 *   « ⏳ Cron purge banlist PII après 24mo »
 *
 * Doctrine LPD/nLPD : conservation limitée (24mo). Pour banlist permanent, anonymise
 * PII (displayName / email / photoURL / phoneNumber) au lieu de delete — préserve
 * audit trail Firestore + traçabilité sanctionId si réincidence sur nouveau compte.
 *
 * Pipeline (Q7=A weekly Friday 03:00 — volume faible) :
 *   1. Auth Bearer ${CRON_SECRET}
 *   2. Purge adminActions/ : query createdAt < now-24mo → batch delete max 500/run
 *   3. Anonymise users : query activeSanctionLevel='ban_permanent' → filter anonymizedAt
 *      undefined client-side → fetch sanction + check createdAt < now-24mo →
 *      set displayName/email/photoURL/phoneNumber=null + anonymizedAt=serverTimestamp
 *   4. Best-effort per-doc, continue on fail
 *
 * Support ?dryRun=true : retourne counts sans écrire.
 *
 * Returns : { adminActionsDeleted, usersAnonymized, dryRun, batchLimit, cutoffMs }
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 500;
const CONSERVATION_MONTHS = 24;

// =====================================================================
// Lazy Admin SDK init (cohérent SC4 + SC5 c1-c2)
// =====================================================================

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

export async function POST(req: NextRequest) {
  // 1. Auth check
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
  let batchLimit = BATCH_LIMIT_DEFAULT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > BATCH_LIMIT_DEFAULT) {
      return NextResponse.json(
        { error: 'invalid-limit', detail: `limit must be 1..${BATCH_LIMIT_DEFAULT}` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    batchLimit = Math.floor(parsed);
  }

  try {
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    const db = await getAdminDb();

    const nowMs = Date.now();
    const cutoffMs = nowMs - CONSERVATION_MONTHS * 30 * 24 * 60 * 60 * 1000;
    const cutoffTs = Timestamp.fromMillis(cutoffMs);

    // ---------------------------------------------------------------
    // 3. Purge adminActions/ : createdAt < cutoff → delete
    // ---------------------------------------------------------------
    let adminActionsDeleted = 0;
    try {
      const snap = await db
        .collection('adminActions')
        .where('createdAt', '<', cutoffTs)
        .limit(batchLimit)
        .get();
      for (const d of snap.docs) {
        try {
          if (!dryRun) {
            await d.ref.delete();
          }
          adminActionsDeleted++;
        } catch (err) {
          console.warn('[/api/cron/purge-old-data] delete adminAction failed', {
            actionId: d.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      console.warn('[/api/cron/purge-old-data] adminActions query failed (non-bloquant)', err);
    }

    // ---------------------------------------------------------------
    // 4. Anonymise users : activeSanctionLevel='ban_permanent' + sanction > 24mo
    // ---------------------------------------------------------------
    let usersAnonymized = 0;
    try {
      const snap = await db
        .collection('users')
        .where('activeSanctionLevel', '==', 'ban_permanent')
        .limit(batchLimit)
        .get();

      for (const userDoc of snap.docs) {
        const user = userDoc.data();
        // Idempotency : skip si déjà anonymisé
        if (user.anonymizedAt) continue;

        // Fetch sanction pour vérifier createdAt < cutoff
        const sanctionId = user.activeSanctionId as string | undefined;
        if (!sanctionId) {
          // Phase 9 polish : fallback query userSanctions where userId+level
          // Phase 8 KISS : skip si pas de denorm sanctionId (CF SC5 c2/5 wires this)
          continue;
        }
        try {
          const sanctionSnap = await db.collection('userSanctions').doc(sanctionId).get();
          if (!sanctionSnap.exists) continue;
          const sanction = sanctionSnap.data();
          const sanctionCreatedAtMs = sanction?.createdAt?.toMillis?.() ?? 0;
          if (sanctionCreatedAtMs >= cutoffMs) {
            continue; // pas encore 24mo
          }

          // Anonymise PII
          if (!dryRun) {
            await userDoc.ref.update({
              displayName: null,
              email: null,
              photoURL: null,
              phoneNumber: null,
              anonymizedAt: FieldValue.serverTimestamp(),
            });
          }
          usersAnonymized++;
        } catch (err) {
          console.warn('[/api/cron/purge-old-data] per-user anonymize failed', {
            userId: userDoc.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      console.warn('[/api/cron/purge-old-data] banlist query failed (non-bloquant)', err);
    }

    return NextResponse.json(
      {
        adminActionsDeleted,
        usersAnonymized,
        dryRun,
        batchLimit,
        cutoffMs,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/cron/purge-old-data] fatal', err);
    return NextResponse.json(
      { error: 'cron-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
