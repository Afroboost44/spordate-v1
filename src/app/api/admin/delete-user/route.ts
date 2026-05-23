/**
 * Fix #124 — POST /api/admin/delete-user.
 *
 * Cascade delete d'un utilisateur, déclenché depuis admin dashboard.
 * Supprime tout pour éviter les comptes fantômes :
 *   1. Firebase Auth account (sinon le user peut toujours se reconnecter)
 *   2. users/{uid} doc
 *   3. likes/* où fromUid OR toUid === uid
 *   4. matches/* contenant uid dans userIds (+ chats/{matchId} sibling)
 *   5. notifications/* où userId === uid
 *   6. fcmToken cleanup (déjà dans users/{uid} supprimé)
 *
 * Sécurité : Bearer ID token requis + le caller doit avoir role='admin' dans
 * users/{callerUid}. Empêche un user normal de supprimer d'autres comptes.
 *
 * @returns 200 { ok, deletedCounts: { likes, matches, notifications } }
 *          401 unauthenticated / 403 not-admin / 400 invalid-input / 500 internal
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const callerUid = await verifyAuth(request);
    if (!callerUid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetUid = body?.uid as string;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'uid required' },
        { status: 400 },
      );
    }
    if (targetUid === callerUid) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'cannot self-delete' },
        { status: 400 },
      );
    }

    // Lazy init admin SDK
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { getAuth } = await import('firebase-admin/auth');
    const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
    if (!getApps().length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        initializeApp({
          credential: cert(
            parseServiceAccountKeyDefensive(
              process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
            ) as Parameters<typeof cert>[0],
          ),
        });
      } else {
        initializeApp({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordate-prod',
        });
      }
    }
    const db = getFirestore();
    const auth = getAuth();

    // Vérif caller est admin
    const callerSnap = await db.collection('users').doc(callerUid).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== 'admin') {
      return NextResponse.json(
        { error: 'not-admin', detail: 'admin role required' },
        { status: 403 },
      );
    }

    const counts = { likes: 0, matches: 0, chats: 0, notifications: 0, authDeleted: false, userDocDeleted: false };

    // 1. Firebase Auth — delete (peut échouer si user n'existe plus en Auth, c'est OK)
    try {
      await auth.deleteUser(targetUid);
      counts.authDeleted = true;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/user-not-found') {
        console.warn('[admin/delete-user] auth.deleteUser failed', { uid: targetUid, code, err });
      }
    }

    // 2. likes — collection 'likes' avec docId = `${from}_${to}` :
    //    supprime tous les docs où from OR to === targetUid
    const likesQuery1 = await db.collection('likes').where('fromUid', '==', targetUid).get();
    const likesQuery2 = await db.collection('likes').where('toUid', '==', targetUid).get();
    const likesBatch = db.batch();
    [...likesQuery1.docs, ...likesQuery2.docs].forEach((d) => {
      likesBatch.delete(d.ref);
      counts.likes++;
    });
    if (counts.likes > 0) await likesBatch.commit();

    // 3. matches — supprime tous les matches où userIds contient targetUid
    //    + supprime aussi le chat sibling chats/{matchId}
    const matchesQuery = await db
      .collection('matches')
      .where('userIds', 'array-contains', targetUid)
      .get();
    for (const matchDoc of matchesQuery.docs) {
      const matchId = matchDoc.id;
      // Supprime messages subcollection (best-effort, peut être vide)
      try {
        const messagesQuery = await db
          .collection('chats')
          .doc(matchId)
          .collection('messages')
          .limit(500)
          .get();
        if (!messagesQuery.empty) {
          const msgBatch = db.batch();
          messagesQuery.docs.forEach((m) => msgBatch.delete(m.ref));
          await msgBatch.commit();
        }
      } catch (err) {
        console.warn('[admin/delete-user] messages delete failed', { matchId, err });
      }
      // Supprime chat doc + match doc
      try {
        await db.collection('chats').doc(matchId).delete();
        counts.chats++;
      } catch {
        // Si pas de chat sibling, OK
      }
      await matchDoc.ref.delete();
      counts.matches++;
    }

    // 4. notifications — supprime les notifs ciblant targetUid
    const notifQuery = await db
      .collection('notifications')
      .where('userId', '==', targetUid)
      .limit(500)
      .get();
    if (!notifQuery.empty) {
      const notifBatch = db.batch();
      notifQuery.docs.forEach((n) => {
        notifBatch.delete(n.ref);
        counts.notifications++;
      });
      await notifBatch.commit();
    }

    // 5. user doc lui-même (en dernier pour bien checkter avant)
    try {
      await db.collection('users').doc(targetUid).delete();
      counts.userDocDeleted = true;
    } catch (err) {
      console.warn('[admin/delete-user] users doc delete failed', { uid: targetUid, err });
    }

    console.log('[admin/delete-user] cascade complete', { targetUid, counts });
    return NextResponse.json({ ok: true, deletedCounts: counts }, { status: 200 });
  } catch (err) {
    console.error('[/api/admin/delete-user] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
