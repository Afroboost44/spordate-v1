/**
 * Phase 9 sub-chantier 1 commit 1/5 — GET /api/sessions/[sessionId]/participants.
 *
 * Comble Différé Phase 9 ligne 890 architecture.md :
 *   « ⏳ Card session UI participants list complète + entry points block/report
 *      participants (Phase 7 wire seulement le partner) »
 *
 * Doctrine §F privacy : la liste participants n'est PAS publique. Visibilité
 * gradée :
 *   1. session.endAt < now (passée) → liste publique (event terminé, contexte sport)
 *   2. viewer = partner de la session → toujours autorisé (gestion check-in)
 *   3. viewer = participant confirmé sur cette session → autorisé (mêmes inscrits)
 *   4. viewer = admin → toujours autorisé (modération)
 *   5. autres → 403 forbidden
 *
 * Pipeline :
 *   1. verifyAuth → uid (null = guest)
 *   2. Lazy Admin SDK + read session
 *   3. Determine access selon les 5 paths
 *   4. Si autorisé : query bookings sessionId=X status='confirmed' + load users PII minimal
 *   5. Return [{uid, displayName, photoURL?}, ...]
 *
 * Architecture : route uses Admin SDK (bypass rules — server-side auth gating).
 * Rule /bookings/ reste restrictive (`userId == auth.uid OR isAdmin`) — pas de
 * relaxation Phase 9. La participation list visibility = via cette route uniquement.
 *
 * Privacy : on retourne uniquement uid + displayName + photoURL. Pas d'email,
 * pas de phone, pas d'autres PII (cohérent doctrine LPD/nLPD minimisation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent SC4+SC5 pattern)
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

interface ParticipantOut {
  uid: string;
  displayName: string;
  photoURL?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'sessionId required' }, { status: 400 });
    }

    // 1. Verify Bearer (null OK = guest)
    const viewerUid = await verifyAuth(request);

    // 2. Load session
    const db = await getAdminDb();
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const session = sessionSnap.data();
    const endAtMs = session?.endAt?.toMillis?.() ?? 0;
    const isPastSession = endAtMs > 0 && endAtMs < Date.now();
    const sessionPartnerId = session?.partnerId as string | undefined;

    // 3. Determine viewer access
    let allowed = false;
    let accessReason: string = 'denied';

    if (isPastSession) {
      allowed = true;
      accessReason = 'past-session-public';
    } else if (viewerUid) {
      // viewer = partner of session
      if (sessionPartnerId && viewerUid === sessionPartnerId) {
        allowed = true;
        accessReason = 'partner';
      } else {
        // viewer = admin ?
        const userSnap = await db.collection('users').doc(viewerUid).get();
        if (userSnap.exists && userSnap.data()?.role === 'admin') {
          allowed = true;
          accessReason = 'admin';
        } else {
          // viewer = confirmed participant ?
          const viewerBookingSnap = await db
            .collection('bookings')
            .where('userId', '==', viewerUid)
            .where('sessionId', '==', sessionId)
            .where('status', '==', 'confirmed')
            .limit(1)
            .get();
          if (!viewerBookingSnap.empty) {
            allowed = true;
            accessReason = 'confirmed-participant';
          }
        }
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'forbidden', detail: 'not authorized to view participants' }, { status: 403 });
    }

    // 4. Load participants : bookings status='confirmed' for this session
    const bookingsSnap = await db
      .collection('bookings')
      .where('sessionId', '==', sessionId)
      .where('status', '==', 'confirmed')
      .get();

    const participantUids = Array.from(
      new Set(bookingsSnap.docs.map((d: { data: () => { userId?: string } }) => d.data().userId).filter(Boolean)),
    ) as string[];

    // 5. Load users PII minimal (uid + displayName + photoURL only)
    const userSnaps = await Promise.all(
      participantUids.map((uid) => db.collection('users').doc(uid).get()),
    );
    const participants: ParticipantOut[] = userSnaps
      .filter((s) => s.exists)
      .map((s) => {
        const data = s.data();
        return {
          uid: s.id,
          displayName: (data?.displayName as string | undefined) || 'Membre',
          photoURL: (data?.photoURL as string | undefined) || undefined,
        };
      });

    return NextResponse.json(
      {
        sessionId,
        accessReason,
        count: participants.length,
        participants,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/sessions/[id]/participants] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
