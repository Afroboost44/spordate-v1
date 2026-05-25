/**
 * Fix #144 — POST /api/wallet/update-iban
 *
 * Permet au partner de sauvegarder son IBAN + titulaire dans Firestore.
 * Ces champs sont lus par l'admin (/admin/payouts) pour exécuter manuellement
 * les virements SEPA via la banque (le temps que Stripe Connect KYC soit validé).
 *
 * Body : { partnerId: string, iban: string, ibanHolder: string }
 * Auth : Bearer ID token. uid doit matcher partner.uid OU être admin.
 *
 * Validation IBAN : pattern Suisse + UE basique (2 lettres + 13-32 alphanum).
 * On accepte volontairement large pour ne pas bloquer les partners étrangers ;
 * la validation finale se fait à l'œil par l'admin avant d'exécuter le virement.
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

const IBAN_PATTERN = /^[A-Z]{2}[0-9A-Z]{13,32}$/;

export async function POST(request: NextRequest) {
  const callerUid = await verifyAuth(request);
  if (!callerUid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const partnerId = body.partnerId as string | undefined;
  const iban = (body.iban as string | undefined)?.trim().replace(/\s+/g, '').toUpperCase();
  const ibanHolder = (body.ibanHolder as string | undefined)?.trim();

  if (!partnerId || !iban || !ibanHolder) {
    return NextResponse.json(
      { error: 'invalid-input', detail: 'partnerId + iban + ibanHolder required' },
      { status: 400 },
    );
  }
  if (!IBAN_PATTERN.test(iban)) {
    return NextResponse.json(
      { error: 'invalid-iban', detail: 'Format IBAN invalide. Exemple : CH9300762011623852957' },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const partnerSnap = await db.collection('partners').doc(partnerId).get();
    if (!partnerSnap.exists) {
      return NextResponse.json({ error: 'partner-not-found' }, { status: 404 });
    }
    const partnerData = partnerSnap.data();

    // Authz : caller doit être le partner lui-même OU un admin
    const callerUserSnap = await db.collection('users').doc(callerUid).get();
    const isAdmin = callerUserSnap.exists && (callerUserSnap.data()?.role === 'admin' || callerUserSnap.data()?.isAdmin === true);
    const partnerUid = partnerData?.userId || partnerData?.uid || partnerId.replace(/^partner-/, '');
    if (!isAdmin && callerUid !== partnerUid && callerUid !== partnerId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('partners').doc(partnerId).update({
      iban,
      ibanHolder,
      ibanUpdatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error('[update-iban] ERROR:', m);
    return NextResponse.json({ error: 'internal-error', detail: m }, { status: 500 });
  }
}
