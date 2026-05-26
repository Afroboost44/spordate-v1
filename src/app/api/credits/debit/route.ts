/**
 * Hardening sécurité crédits — POST /api/credits/debit.
 *
 * Endpoint serveur qui débite N crédits du solde users/{uid}.credits.
 * Remplace l'écriture client-side qui existait dans src/hooks/useCredits.ts
 * (Like sur la page Discovery coûtait 1 crédit via updateDoc direct côté
 * navigateur). Avec les nouvelles Firestore rules qui bloquent toute
 * écriture du champ `credits` depuis le client (sauf admin), ce flow passe
 * désormais obligatoirement par cet endpoint server-side.
 *
 * Pipeline (atomic via runTransaction, cohérent /api/boost-credits +
 * /api/chat/unlock-direct) :
 *   1. Verify Bearer ID token → uid
 *   2. Body { amount: number, reason?: string }
 *      → amount entier > 0 (refus sinon)
 *   3. runTransaction :
 *      a. Read users/{uid}.credits — 402 'insufficient-credits' si < amount
 *      b. Debit credits (FieldValue.increment(-amount))
 *      c. Log dans transactions/{auto} (cohérent autres routes :
 *         creditsGranted < 0 = débit, status 'succeeded')
 *   4. Retourne { ok: true, newBalance, debited }
 *
 * Sécurité : verifyAuth Bearer → uid trusté serveur (jamais lu du body).
 * L'utilisateur ne peut débiter QUE son propre solde.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
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
    const amountRaw = body?.amount;
    const reason = typeof body?.reason === 'string' ? body.reason : 'like';

    const amount = typeof amountRaw === 'number' ? amountRaw : parseInt(amountRaw, 10);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'amount must be a positive integer' },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { FieldValue } = await import('firebase-admin/firestore');

    const userRef = db.collection('users').doc(uid);
    const txnsCol = db.collection('transactions');

    // Atomic : credit check + debit + log.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await db.runTransaction(async (tx: any) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { error: 'user-not-found', status: 404 } as const;
      }
      const credits = (userSnap.data()?.credits as number | undefined) ?? 0;
      if (credits < amount) {
        return {
          error: 'insufficient-credits',
          status: 402,
          have: credits,
          need: amount,
        } as const;
      }

      // Debit credits.
      tx.update(userRef, {
        credits: FieldValue.increment(-amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Log transaction (creditsGranted < 0 = débit, cohérent autoCorrector.ts +
      // /api/boost-credits + /api/chat/unlock-direct).
      const txnRef = txnsCol.doc();
      tx.set(txnRef, {
        transactionId: txnRef.id,
        userId: uid,
        type: `credit_debit_${reason}`,
        creditsGranted: -amount,
        reason,
        status: 'succeeded',
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true as const,
        newBalance: credits - amount,
        debited: amount,
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
        newBalance: result.newBalance,
        debited: result.debited,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/credits/debit] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
