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

    // 3. Phase 9.5 c38a-fix5 — Check des 2 likes/ docs côté serveur (admin SDK).
    // Bypass complet des rules Firestore qui rejetaient le getDoc reverseLike
    // côté client. Si UN seul ou ZÉRO existe → return { mutual: false } 200,
    // pas une erreur (le like fwd a déjà été créé client-side, on attend juste
    // le retour de l'autre). Pas d'erreur 412 effrayante.
    const fwdLikeId = `${fromUid}_${targetUid}`;
    const revLikeId = `${targetUid}_${fromUid}`;
    const [fwdSnap, revSnap] = await Promise.all([
      db.collection('likes').doc(fwdLikeId).get(),
      db.collection('likes').doc(revLikeId).get(),
    ]);
    if (!fwdSnap.exists || !revSnap.exists) {
      // Pas mutuel encore — le client a juste créé son like, l'autre n'a pas
      // (encore) liké en retour. Toast soft "Like envoyé" côté UI.
      return NextResponse.json({ ok: true, mutual: false }, { status: 200 });
    }

    // 4. Phase 9.5 c39 Bug C — Deterministic match doc ID + idempotent setDoc merge.
    // Avant : auto-id + idempotence par query → pouvait retourner match legacy
    // sans chatUnlocked:true. Maintenant : ID = sorted uids joined → setDoc
    // crée OU met à jour le même doc. Pas de duplicate possible.
    const sortedUids = [fromUid, targetUid].sort();
    const deterministicMatchId = `${sortedUids[0]}_${sortedUids[1]}`;
    const matchRef = db.collection('matches').doc(deterministicMatchId);
    const chatRef = db.collection('chats').doc(deterministicMatchId);
    const [existingMatchSnap, chatSnap] = await Promise.all([
      matchRef.get(),
      chatRef.get(),
    ]);

    if (existingMatchSnap.exists) {
      // Match déjà créé (par un précédent mutual ou direct-paid). Force
      // chatUnlocked:true au passage pour upgrade UX si pas déjà set.
      const existing = existingMatchSnap.data() ?? {};
      if (!existing.chatUnlocked) {
        await matchRef.update({ chatUnlocked: true });
      }
      // Phase 9.5 c40 — chats/{matchId} sibling créé s'il manque (legacy).
      if (!chatSnap.exists) {
        await chatRef.set({
          chatId: deterministicMatchId,
          participants: sortedUids,
          lastMessage: '',
          lastMessageAt: FieldValue.serverTimestamp(),
          unreadCount: { [sortedUids[0]]: 0, [sortedUids[1]]: 0 },
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return NextResponse.json(
        { ok: true, mutual: true, matchId: deterministicMatchId, alreadyExisted: true },
        { status: 200 },
      );
    }

    // 5. Create match doc avec ID déterministe (Admin SDK bypass rules).
    await matchRef.set({
      matchId: deterministicMatchId,
      userIds: sortedUids,
      status: 'accepted',
      initiatedBy: 'mutual',
      chatUnlocked: true,
      activityId: '',
      sport: '',
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      createdAt: FieldValue.serverTimestamp(),
    });

    // 5-bis. Phase 9.5 c40 — créer chats/{matchId} sibling (architecture
    // historique services/firestore.ts createMatch:193). Indispensable pour
    // que les rules messages/ check chats/{chatId}.participants succeed.
    await chatRef.set({
      chatId: deterministicMatchId,
      participants: sortedUids,
      lastMessage: '',
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadCount: { [sortedUids[0]]: 0, [sortedUids[1]]: 0 },
      createdAt: FieldValue.serverTimestamp(),
    });

    // 6. Push notif → deferred c38b
    return NextResponse.json(
      { ok: true, mutual: true, matchId: deterministicMatchId, alreadyExisted: false },
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
