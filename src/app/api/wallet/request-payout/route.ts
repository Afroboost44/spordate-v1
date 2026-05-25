/**
 * Fix #144 — POST /api/wallet/request-payout
 *
 * Le partner demande un virement de son solde disponible (partner.balance)
 * vers son IBAN enregistré. La requête crée :
 *   - payoutRequests/{id} : doc avec status='pending', amountCents, iban, partnerId
 *   - walletTransactions/{id} : audit log type='payout_request', amountCents=-balance
 *   - partner.balance = 0 (FieldValue.set, runTransaction atomique)
 *   - partner.payoutCount = +1
 *
 * L'admin voit le payoutRequest dans /admin/payouts → exécute le virement SEPA
 * depuis sa banque → marque le doc 'completed' (workflow temporaire le temps
 * que Stripe Connect KYC soit validé).
 *
 * Body : { partnerId: string }
 * Auth : Bearer ID token. uid doit matcher partner.uid.
 *
 * Errors :
 *   - 401 unauthenticated
 *   - 403 forbidden (caller != partner)
 *   - 404 partner-not-found
 *   - 412 iban-missing (partner doit enregistrer son IBAN avant)
 *   - 412 zero-balance (rien à virer)
 *   - 500 internal
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
  const partnerId = body.partnerId as string | undefined;
  if (!partnerId) {
    return NextResponse.json({ error: 'invalid-input', detail: 'partnerId required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const partnerRef = db.collection('partners').doc(partnerId);
    const partnerSnap = await partnerRef.get();
    if (!partnerSnap.exists) {
      return NextResponse.json({ error: 'partner-not-found' }, { status: 404 });
    }
    const partnerData = partnerSnap.data();

    // Authz : caller doit être le partner
    const partnerUid = partnerData?.userId || partnerData?.uid || partnerId.replace(/^partner-/, '');
    if (callerUid !== partnerUid && callerUid !== partnerId) {
      // Permettre quand même aux admins
      const callerUserSnap = await db.collection('users').doc(callerUid).get();
      const isAdmin = callerUserSnap.exists && (callerUserSnap.data()?.role === 'admin' || callerUserSnap.data()?.isAdmin === true);
      if (!isAdmin) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    const iban = partnerData?.iban as string | undefined;
    const ibanHolder = partnerData?.ibanHolder as string | undefined;
    if (!iban || !ibanHolder) {
      return NextResponse.json(
        { error: 'iban-missing', detail: 'Enregistre ton IBAN avant de demander un virement' },
        { status: 412 },
      );
    }

    const balanceCents = (partnerData?.balance as number | undefined) ?? 0;
    if (balanceCents <= 0) {
      return NextResponse.json(
        { error: 'zero-balance', detail: 'Aucun solde disponible' },
        { status: 412 },
      );
    }

    // Transaction atomique : create payoutRequest + walletTransaction + reset balance + increment payoutCount
    const { FieldValue } = await import('firebase-admin/firestore');
    const payoutRef = db.collection('payoutRequests').doc();
    const wtRef = db.collection('walletTransactions').doc();

    await db.runTransaction(async (tx) => {
      // Re-read partner inside tx for race safety
      const freshSnap = await tx.get(partnerRef);
      if (!freshSnap.exists) throw new Error('partner-vanished');
      const fresh = freshSnap.data();
      const freshBalance = (fresh?.balance as number | undefined) ?? 0;
      if (freshBalance <= 0) throw new Error('zero-balance-race');

      tx.set(payoutRef, {
        payoutRequestId: payoutRef.id,
        partnerId,
        partnerName: partnerData?.name || partnerData?.businessName || '',
        partnerEmail: partnerData?.email || '',
        amountCents: freshBalance,
        currency: 'CHF',
        iban,
        ibanHolder,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(wtRef, {
        walletTransactionId: wtRef.id,
        partnerId,
        type: 'payout_request',
        amountCents: -freshBalance,
        currency: 'CHF',
        relatedId: payoutRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.update(partnerRef, {
        balance: 0,
        payoutCount: FieldValue.increment(1),
        lastPayoutRequestAt: FieldValue.serverTimestamp(),
      });
    });

    // Note : pas d'email auto à l'admin (pas de template generic). L'admin
    // consultera /admin/payouts ; on pourra ajouter un template dédié plus tard.
    console.log(
      `[request-payout] partner=${partnerId} amount=${balanceCents}cts → payoutRequest=${payoutRef.id}`,
    );

    return NextResponse.json({
      ok: true,
      payoutRequestId: payoutRef.id,
      amountCents: balanceCents,
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error('[request-payout] ERROR:', m);
    if (m === 'zero-balance-race') {
      return NextResponse.json({ error: 'zero-balance', detail: 'Solde déjà à 0' }, { status: 412 });
    }
    return NextResponse.json({ error: 'internal-error', detail: m }, { status: 500 });
  }
}
