/**
 * Phase 9.5 c38a CH3 — POST /api/match/create-mutual.
 *
 * Endpoint server-side appelé par /discovery handleLike() quand le client
 * détecte un like inverse (= match mutuel). Création atomique du match en
 * Firestore Admin SDK pour empêcher un client malicieux de forger un match
 * sans like réciproque (anti-fraud via verify des 2 docs likes/ server-side).
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid (fromUid)
 *   2. Body { targetUid }
 *   3. Verify likes/{fromUid}_{toUid} ET likes/{toUid}_{fromUid} existent
 *      (sinon abort, return 412 'no-mutual-likes')
 *   4. Idempotence : check matches/ where userIds array-contains-any [fromUid]
 *      AND userIds array-contains-any [targetUid] — si existe, return existing
 *      matchId (évite double create sur retry)
 *   5. Create matches/{auto-id} :
 *      - userIds: [fromUid, targetUid] (triés alpha pour cohérence)
 *      - status: 'accepted', initiatedBy: 'mutual'
 *      - chatUnlocked: true (CHANGE clé vs legacy createMatch qui mettait false)
 *      - sport, activityId vides (match social, pas lié à une activité spécifique)
 *      - createdAt, expiresAt + 7j
 *   6. Push notif aux 2 users (deferred c38b — pour l'instant, juste le doc).
 *
 * @returns 200 { ok, matchId, alreadyExisted? } / 401 / 412 / 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';

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
    const fromUid = await verifyAuth(request);
    if (!fromUid) {
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
    if (targetUid === fromUid) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'cannot match with self' },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    // 3. Verify both likes/ docs exist (anti-fraud — server source of truth).
    const fwdLikeId = `${fromUid}_${targetUid}`;
    const revLikeId = `${targetUid}_${fromUid}`;
    const [fwdSnap, revSnap] = await Promise.all([
      db.collection('likes').doc(fwdLikeId).get(),
      db.collection('likes').doc(revLikeId).get(),
    ]);
    if (!fwdSnap.exists || !revSnap.exists) {
      return NextResponse.json(
        {
          error: 'no-mutual-likes',
          detail: `Both likes/${fwdLikeId} and likes/${revLikeId} must exist`,
        },
        { status: 412 },
      );
    }

    // 4. Idempotence : check existing match between these 2 users.
    // Strategy : query matches where userIds array-contains fromUid, filter in
    // memory by targetUid presence (Firestore ne supporte pas 2 array-contains
    // dans la même query).
    const existingMatchesSnap = await db
      .collection('matches')
      .where('userIds', 'array-contains', fromUid)
      .get();
    type MatchDoc = {
      id: string;
      data: () => { userIds?: string[] };
    };
    const existingMatch = (existingMatchesSnap.docs as MatchDoc[]).find((d) =>
      (d.data().userIds || []).includes(targetUid),
    );
    if (existingMatch) {
      return NextResponse.json(
        { ok: true, matchId: existingMatch.id, alreadyExisted: true },
        { status: 200 },
      );
    }

    // 5. Create match doc.
    const sortedUids = [fromUid, targetUid].sort();
    const matchRef = db.collection('matches').doc();
    await matchRef.set({
      matchId: matchRef.id,
      userIds: sortedUids,
      status: 'accepted',
      initiatedBy: 'mutual', // distingue des matches legacy (initiatedBy = uid)
      chatUnlocked: true, // KEY CHANGE — chat ouvert d'office sur mutual
      activityId: '',
      sport: '',
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      createdAt: FieldValue.serverTimestamp(),
    });

    // 6. Push notif → deferred c38b (sendPushNotification helper × 2 users)
    return NextResponse.json(
      { ok: true, matchId: matchRef.id, alreadyExisted: false },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/match/create-mutual] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
