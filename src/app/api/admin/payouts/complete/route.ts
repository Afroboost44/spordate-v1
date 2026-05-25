/**
 * Fix #144 — POST /api/admin/payouts/complete
 *
 * Admin marque un payoutRequest comme exécuté (le virement SEPA a été fait
 * manuellement depuis la banque). On met à jour :
 *   - payoutRequests/{id}.status = 'completed' + completedAt + completedBy
 *   - walletTransactions/{id} : audit log type='payout_completed' amountCents=-amount
 *
 * Body : { payoutId: string }
 * Auth : Bearer ID token. uid doit être admin (userProfile.role === 'admin').
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

let _db: FirebaseFirestore.Firestore | null = null;
async function getDb() {
  if (_db) return _db;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
    }
  }
  _db = getFirestore();
  return _db;
}

export async function POST(request: NextRequest) {
  const callerUid = await verifyAuth(request);
  if (!callerUid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const payoutId = body.payoutId as string | undefined;
  if (!payoutId) {
    return NextResponse.json({ error: 'invalid-input', detail: 'payoutId required' }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Authz : caller doit être admin
    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    const isAdmin = callerUserSnap.exists && (callerUserSnap.data()?.role === 'admin' || callerUserSnap.data()?.isAdmin === true);
    if (!isAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const payoutRef = db.collection('payoutRequests').doc(payoutId);
    const payoutSnap = await payoutRef.get();
    if (!payoutSnap.exists) {
      return NextResponse.json({ error: 'payout-not-found' }, { status: 404 });
    }
    const payout = payoutSnap.data();
    if (payout?.status === 'completed') {
      return NextResponse.json({ error: 'already-completed' }, { status: 409 });
    }

    const { FieldValue } = await import('firebase-admin/firestore');
    const wtRef = db.collection('walletTransactions').doc();

    await db.runTransaction(async (tx) => {
      tx.update(payoutRef, {
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: callerUid,
      });
      tx.set(wtRef, {
        walletTransactionId: wtRef.id,
        partnerId: payout?.partnerId,
        type: 'payout_completed',
        amountCents: -(payout?.amountCents ?? 0),
        currency: payout?.currency || 'CHF',
        relatedId: payoutId,
        completedBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error('[admin/payouts/complete] ERROR:', m);
    return NextResponse.json({ error: 'internal-error', detail: m }, { status: 500 });
  }
}
