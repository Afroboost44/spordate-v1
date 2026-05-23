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
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

      // Phase 9.5 c39 Bug C — Deterministic match doc ID = sorted uids joined.
      // Avant : auto-id + idempotence par query. Problème : si un match legacy
      // existait avec chatUnlocked: false, il était retourné tel quel → user
      // redirigé sur un chat verrouillé. Maintenant : doc id déterministe →
      // setDoc force toujours chatUnlocked:true sur le BON doc, jamais de
      // duplicate possible (idempotent par design via Firestore).
      const sortedUids = [uid, targetUid].sort();
      const deterministicMatchId = `${sortedUids[0]}_${sortedUids[1]}`;
      const matchRef = matchesCol.doc(deterministicMatchId);
      const chatRef = db.collection('chats').doc(deterministicMatchId);

      // PHASE 1 : tous les reads upfront (Firestore TX exige reads avant writes).
      const [existingMatchSnap, chatSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(chatRef),
      ]);

      // PHASE 2 : décider + écrire selon les états lus.
      if (existingMatchSnap.exists) {
        // Match existait déjà (mutual antérieur, direct-paid précédent, ou
        // legacy migré). Force chatUnlocked:true au passage pour upgrade UX,
        // PAS de débit crédits (idempotent — un re-click direct n'est pas
        // facturé). Si l'ancien initiatedBy était 'mutual'/'accepted', on le
        // préserve (ne pas overwriter l'historique).
        const existing = existingMatchSnap.data() ?? {};
        if (!existing.chatUnlocked) {
          tx.update(matchRef, { chatUnlocked: true });
        }
        // Phase 9.5 c40 — créer chats/{matchId} sibling s'il manque (legacy
        // match d'avant c40 OU dedupe winner sans chats/ associé).
        if (!chatSnap.exists) {
          tx.set(chatRef, {
            chatId: deterministicMatchId,
            participants: sortedUids,
            lastMessage: '',
            lastMessageAt: FieldValue.serverTimestamp(),
            unreadCount: { [sortedUids[0]]: 0, [sortedUids[1]]: 0 },
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        return {
          success: true as const,
          matchId: deterministicMatchId,
          creditsRemaining: credits,
          alreadyExisted: true,
        };
      }

      // c. Debit credits (uniquement si nouveau match créé).
      tx.update(userRef, { credits: FieldValue.increment(-cost) });

      // d. Create match doc avec ID déterministe + chatUnlocked: true.
      tx.set(matchRef, {
        matchId: deterministicMatchId,
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

      // d-bis. Phase 9.5 c40 — créer aussi le doc chats/{matchId} sibling
      // (architecture historique : services/firestore.ts createMatch:193).
      // Sans ce doc, la rule messages/ check `chats/{chatId}.participants`
      // throws → permission-denied → toast "session annulée — lecture seule".
      tx.set(chatRef, {
        chatId: deterministicMatchId,
        participants: sortedUids,
        lastMessage: '',
        lastMessageAt: FieldValue.serverTimestamp(),
        unreadCount: { [sortedUids[0]]: 0, [sortedUids[1]]: 0 },
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
