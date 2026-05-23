/**
 * Phase 9 sub-chantier 1 commit 3/5 — GET /api/users/me/matches.
 *
 * Comble Différé Phase 9 (architecture.md ligne 1333) :
 *   « ⏳ /activities/[id] dropdown matches invite trigger »
 *
 * Endpoint Bearer auth pour récupérer les matches accepted du viewer + load
 * otherUser PII minimal. Filtre out les blocks (cohérent doctrine §E Phase 7).
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid (sinon 401)
 *   2. Admin SDK query matches where userIds array-contains uid AND status='accepted'
 *   3. For each match : resolve otherUserId (userIds[0] if !==uid else userIds[1])
 *   4. Filter blocks : skip si block existe (uid blocked otherUser OR vice versa)
 *   5. Load otherUser PII minimal (uid + displayName + photoURL)
 *   6. Return { matches: [{matchId, otherUser}] }
 *
 * Privacy : PII minimisation cohérent doctrine LPD/nLPD (uid + name + photoURL only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent SC4+SC5 pattern)
// =====================================================================

interface OtherUserOut {
  uid: string;
  displayName: string;
  photoURL?: string;
}

interface MatchOut {
  matchId: string;
  otherUser: OtherUserOut;
}

export async function GET(request: NextRequest) {
  try {
    // 1. Verify Bearer
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const db = await getAdminDb();

    // 2. Query matches accepted contenant uid
    const matchesSnap = await db
      .collection('matches')
      .where('userIds', 'array-contains', uid)
      .where('status', '==', 'accepted')
      .get();

    if (matchesSnap.empty) {
      return NextResponse.json({ matches: [] }, { status: 200 });
    }

    // 3+4. Pour chaque match : extract otherUserId + filter blocks
    interface RawMatch {
      matchId?: string;
      userIds: string[];
    }
    type AdminDocSnap = { id: string; data: () => RawMatch };
    const candidates: Array<{ matchId: string; otherUserId: string }> = matchesSnap.docs
      .map((d: AdminDocSnap) => {
        const data = d.data();
        const ids = data.userIds ?? [];
        const otherUserId = ids.find((id) => id !== uid);
        if (!otherUserId) return null;
        return { matchId: data.matchId ?? d.id, otherUserId };
      })
      .filter((c: { matchId: string; otherUserId: string } | null): c is { matchId: string; otherUserId: string } => c !== null);

    // Filter blocks : exclude si match avec un user blocké OU qui a bloqué viewer
    // Cohérent doctrine §E Phase 7 : invisibilité mutuelle.
    const filteredCandidates: Array<{ matchId: string; otherUserId: string }> = [];
    for (const c of candidates) {
      const blockId1 = `${uid}_${c.otherUserId}`;
      const blockId2 = `${c.otherUserId}_${uid}`;
      const [b1, b2] = await Promise.all([
        db.collection('blocks').doc(blockId1).get(),
        db.collection('blocks').doc(blockId2).get(),
      ]);
      if (b1.exists || b2.exists) continue;
      filteredCandidates.push(c);
    }

    // 5. Load otherUser PII minimal (Promise.all)
    const matches: MatchOut[] = [];
    await Promise.all(
      filteredCandidates.map(async (c) => {
        const userSnap = await db.collection('users').doc(c.otherUserId).get();
        if (!userSnap.exists) return;
        const data = userSnap.data();
        // Skip si user anonymisé (Phase 8 SC5 c3/5 banlist anonymization)
        if (data?.anonymizedAt) return;
        matches.push({
          matchId: c.matchId,
          otherUser: {
            uid: c.otherUserId,
            displayName: (data?.displayName as string | undefined) || 'Membre',
            photoURL: (data?.photoURL as string | undefined) || undefined,
          },
        });
      }),
    );

    return NextResponse.json(
      {
        matches,
        count: matches.length,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/users/me/matches] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
