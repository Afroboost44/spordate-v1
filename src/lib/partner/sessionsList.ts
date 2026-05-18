/**
 * Fix B B1 — Helper pur pour la page /partner/sessions/.
 *
 * Group les sessions du partenaire par activité. Tri stable :
 *  - Les groupes apparaissent dans l'ordre où la 1ère session de chaque
 *    activityId est rencontrée dans l'input.
 *  - Au sein d'un groupe, les sessions sont triées par startAt asc
 *    (chronologique).
 *
 * Acceptable pour MVP : input ≤ 100 sessions (un partenaire moyen).
 *
 * @module
 */

import type { Session } from '@/types/firestore';

export function groupSessionsByActivity(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!s || !s.activityId) continue;
    const existing = groups.get(s.activityId);
    if (existing) {
      existing.push(s);
    } else {
      groups.set(s.activityId, [s]);
    }
  }
  // Tri intra-groupe par startAt asc.
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const aMs = typeof a.startAt?.toMillis === 'function' ? a.startAt.toMillis() : 0;
      const bMs = typeof b.startAt?.toMillis === 'function' ? b.startAt.toMillis() : 0;
      return aMs - bMs;
    });
  }
  return groups;
}
