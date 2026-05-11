/**
 * Phase 9.5 c38b CH2 — POST /api/chat/unlock-direct.
 *
 * Permet à un user de débloquer un chat instantanément avec un targetUid en
 * débitant 5 crédits Spordate. Court-circuite le mutual matching (= bouton
 * "💬 Chat direct" sur /discovery, à côté de ❤️ Like).
 *
 * Distinct de /api/match/create-mutual (qui crée le match seulement sur
 * mutual ❤️↔️❤️) : ici on crée le match unilatéralement en échange de
 * crédits, avec chatUnlocked: true + initiatedBy: 'direct-paid'.
 *
 * Pipeline (atomic via runTransaction) :
 *   1. Verify Bearer ID token → uid
 *   2. Body { targetUid }
 *   3. runTransaction :
 *      a. Read users/{uid}.credits — 400 insufficient-credits si < 5
 *      b. Idempotence : check existing match entre uid & targetUid (any
 *         status), si exists → return { matchId, alreadyExisted: true }
 *      c. Debit credits (FieldValue.increment(-5))
 *      d. Create matches/{auto-id} avec chatUnlocked: true,
 *         initiatedBy: 'direct-paid'
 *      e. Log transactions/{auto-id} type 'chat_unlock_direct'
 *   4. Return { ok: true, matchId, creditsRemaining, alreadyExisted }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { computeChatUnlockCost, CHF_PER_CREDIT } from '@/lib/billing/chatUnlockDirect';

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

    const body = await request.json().catch(() => ({}));
    const targetUid = body?.targetUid as string;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'targetUid required' },
        { status: 400 },
      );
    }
    if (targetUid === uid) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'cannot unlock chat with self' },
        { status: 400 },
      );
    }

    const cost = computeChatUnlockCost();
    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    const userRef = db.collection('users').doc(uid);
    const matchesCol = db.collection('matches');
    const txnsCol = db.collection('transactions');

    // Atomic : credit check + idempotence + debit + match creation + log.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await db.runTransaction(async (tx: any) => {
      // a. Read credits.
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { error: 'user-not-found', status: 404 } as const;
      }
      const credits = (userSnap.data()?.credits as number | undefined) ?? 0;
      if (credits < cost) {
        return {
          error: 'insufficient-credits',
          status: 400,
          have: credits,
          need: cost,
        } as const;
      }

      // b. Idempotence : check existing match entre uid & targetUid.
      const existingMatchesSnap = await tx.get(
        matchesCol.where('userIds', 'array-contains', uid),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingMatch = existingMatchesSnap.docs.find((d: any) =>
        (d.data().userIds || []).includes(targetUid),
      );
      if (existingMatch) {
        return {
          success: true as const,
          matchId: existingMatch.id,
          creditsRemaining: credits,
          alreadyExisted: true,
        };
      }

      // c. Debit credits.
      tx.update(userRef, { credits: FieldValue.increment(-cost) });

      // d. Create match doc (chatUnlocked: true).
      const sortedUids = [uid, targetUid].sort();
      const matchRef = matchesCol.doc();
      tx.set(matchRef, {
        matchId: matchRef.id,
        userIds: sortedUids,
        status: 'accepted',
        initiatedBy: 'direct-paid',
        chatUnlocked: true,
        activityId: '',
        sport: '',
        creditsSpent: cost,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        createdAt: FieldValue.serverTimestamp(),
      });

      // e. Log transaction.
      const txnRef = txnsCol.doc();
      tx.set(txnRef, {
        transactionId: txnRef.id,
        userId: uid,
        type: 'chat_unlock_direct',
        creditsGranted: -cost,
        amountChf: cost * CHF_PER_CREDIT,
        relatedMatchId: matchRef.id,
        relatedTargetUid: targetUid,
        status: 'succeeded',
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true as const,
        matchId: matchRef.id,
        creditsRemaining: credits - cost,
        alreadyExisted: false,
      };
    });

    if ('error' in result) {
      return NextResponse.json(
        {
          error: result.error,
          ...(('have' in result) && { have: result.have, need: result.need }),
        },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        matchId: result.matchId,
        creditsRemaining: result.creditsRemaining,
        alreadyExisted: result.alreadyExisted,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/chat/unlock-direct] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
