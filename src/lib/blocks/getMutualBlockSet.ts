/**
 * Phase 7 sub-chantier 2 commit 2/4 — getMutualBlockSet.
 *
 * Combine getBlockedByMe + getBlockingMe en un Set<string> contenant tous les
 * uids "à filtrer" pour un user donné (mutuelle invisibilité doctrine §9.sexies E).
 *
 * Usage UI :
 *   const blockedSet = await getMutualBlockSet(currentUid);
 *   const visibleConvos = matches.filter(m => !blockedSet.has(otherUid));
 *
 * Performance : 2 queries en parallèle. Pour MVP Phase 7, accepter filter
 * client-side (≤50 docs typique). Refactor query-level différé Phase 9 si
 * scale > 1000 users actifs (cf. décision Q2 architecture.md).
 */

import { getBlockedByMe } from './getBlockedByMe';
import { getBlockingMe } from './getBlockingMe';

export async function getMutualBlockSet(uid: string): Promise<Set<string>> {
  if (!uid) return new Set();
  const [blocked, blocking] = await Promise.all([
    getBlockedByMe(uid),
    getBlockingMe(uid),
  ]);
  const set = new Set<string>();
  for (const b of blocked) set.add(b.blockedId);
  for (const b of blocking) set.add(b.blockerId);
  return set;
}
