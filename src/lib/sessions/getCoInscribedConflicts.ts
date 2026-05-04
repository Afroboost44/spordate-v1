/**
 * Phase 7 sub-chantier 4 commit 1/4 — getCoInscribedConflicts.
 *
 * Détecte les "warning partner co-inscrits" doctrine §9.sexies E :
 *   *"Si déjà inscrits à une même session : warning au partner pour gestion physique séparée"*
 *
 * Logique :
 *  1. Query sessions futures du partner (where partnerId, endAt > now)
 *  2. Pour chaque session : query bookings confirmés → liste uids participants
 *  3. Pour chaque paire d'uids dans la même session : check isBlocked (mutuel)
 *  4. Retourne liste des conflits {sessionId, sessionTitle, startAt, userA, userB}
 *
 * Performance : O(n²) par session sur les paires, mais n typique <20 (taille
 * session moyenne). Phase 9 polish : pré-fetch tous les blocks impliquant les
 * bookers du partner en 1 query, puis croisement in-memory.
 *
 * ⚠️ Caller responsibility : vérifier que le caller est bien le partnerId
 *    (UI partner dashboard / check-in page filtrent par user.uid déjà).
 *
 * Note tests : nécessite injection __setSessionsLibDbForTesting + __setBlocksDbForTesting
 *    (cross-module DI seam — isBlocked use blocks DI seam).
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import type { Activity, Booking, Session } from '@/types/firestore';
import { isBlocked } from '@/lib/blocks';
import { getSessionsLibDb } from './_internal';

export interface CoInscribedConflict {
  sessionId: string;
  sessionTitle: string;
  startAt: Timestamp;
  /** Paire mutuellement bloquée (ordre stable lexicographique pour dedup). */
  userA: string;
  userB: string;
}

export interface GetCoInscribedConflictsOptions {
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export async function getCoInscribedConflicts(
  partnerId: string,
  opts: GetCoInscribedConflictsOptions = {},
): Promise<CoInscribedConflict[]> {
  if (!partnerId) return [];
  const now = opts.now ?? new Date();
  const fbDb = getSessionsLibDb();

  // 1. Sessions futures du partner (endAt > now)
  const sessionsSnap = await getDocs(
    query(collection(fbDb, 'sessions'), where('partnerId', '==', partnerId)),
  );
  const futureSessions = sessionsSnap.docs
    .map((d) => d.data() as Session)
    .filter((s) => s.endAt?.toMillis?.() > now.getTime());

  if (futureSessions.length === 0) return [];

  // Cache title per activity (évite refetch si plusieurs sessions sur même activity)
  const activityTitleCache = new Map<string, string>();
  async function fetchActivityTitle(activityId: string): Promise<string> {
    if (activityTitleCache.has(activityId)) return activityTitleCache.get(activityId)!;
    try {
      const snap = await getDoc(doc(fbDb, 'activities', activityId));
      if (snap.exists()) {
        const title = (snap.data() as Activity).title ?? '';
        activityTitleCache.set(activityId, title);
        return title;
      }
    } catch {
      // skip
    }
    activityTitleCache.set(activityId, '');
    return '';
  }

  const conflicts: CoInscribedConflict[] = [];

  for (const session of futureSessions) {
    // 2. Bookings confirmés
    const bookingsSnap = await getDocs(
      query(collection(fbDb, 'bookings'), where('sessionId', '==', session.sessionId)),
    );
    const confirmedUids = bookingsSnap.docs
      .map((d) => d.data() as Booking)
      .filter((b) => b.status === 'confirmed')
      .map((b) => b.userId);

    if (confirmedUids.length < 2) continue;

    // 3. Check pairs mutuellement bloquées
    const sessionTitle = await fetchActivityTitle(session.activityId);
    for (let i = 0; i < confirmedUids.length; i++) {
      for (let j = i + 1; j < confirmedUids.length; j++) {
        const a = confirmedUids[i];
        const b = confirmedUids[j];
        try {
          const blocked = await isBlocked(a, b);
          if (blocked) {
            // Ordre lexicographique pour dedup paire
            const [userA, userB] = a < b ? [a, b] : [b, a];
            conflicts.push({
              sessionId: session.sessionId,
              sessionTitle,
              startAt: session.startAt,
              userA,
              userB,
            });
          }
        } catch (err) {
          console.warn('[getCoInscribedConflicts] isBlocked check failed (skip pair)', {
            sessionId: session.sessionId,
            userA: a,
            userB: b,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return conflicts;
}
