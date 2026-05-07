/**
 * Phase 8 sub-chantier 5 commit 1/5 — recomputeSanctionAfterReportCancel.
 *
 * Comble le TODO Phase 7 cancelNoShow.ts L83 :
 *   « Phase 7 edge case : si une UserSanction a été déclenchée par ce report,
 *     elle reste active (pas de recompute). Phase 8 polish pourra recompute
 *     threshold + désactiver auto. »
 *
 * Phase 8 doctrine §F MVP rétention SC5 (Q5=C synchrone helper testable
 * emulator, pas de CF deploy needed).
 *
 * Logique :
 *   1. Read sanction par sanctionId
 *   2. Skip si reason !== 'no_show_threshold' (cancelNoShow scope partner_no_show)
 *   3. Skip si !isActive (déjà overturned/expired/désactivée)
 *   4. Filter triggeringReportIds minus cancelledReportId
 *   5. Si reportId pas dans triggeringReportIds → no-op
 *   6. Compute new level via computeNoShowThresholdAction(filtered.length)
 *   7. newLevel === currentLevel → update triggeringReportIds seulement
 *   8. newLevel === null → désactive sanction (isActive=false)
 *   9. newLevel < currentLevel → downgrade level + endsAt recomputed + triggeringReportIds
 *
 * Audit : log info + warn (pas de adminAction écrit — caller cancelNoShow log déjà
 * via console). AdminActionType extension Phase 9 si dashboard recompute history requis.
 */

import { Timestamp, collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import type { SanctionLevel, UserSanction } from '@/types/firestore';
import { computeNoShowThresholdAction, getReportsDb } from './_internal';

export interface RecomputeSanctionInput {
  /** UserSanction document id à recompute. */
  sanctionId: string;
  /** ID du report annulé à retirer de triggeringReportIds. */
  cancelledReportId: string;
}

export type RecomputeReason =
  | 'sanction-not-found'
  | 'reason-not-no-show'
  | 'already-inactive'
  | 'report-not-in-triggering'
  | 'level-preserved'
  | 'disabled-no-triggering'
  | 'downgraded'
  | 'upgrade-skipped';

export interface RecomputeSanctionResult {
  updated: boolean;
  newLevel: SanctionLevel | null;
  reason: RecomputeReason;
}

/** Ordre niveaux sanction (du plus léger au plus lourd) — pour comparaison downgrade. */
const LEVEL_RANK: Record<SanctionLevel, number> = {
  warning: 0,
  suspension_7d: 1,
  suspension_30d: 2,
  ban_permanent: 3,
};

export async function recomputeSanctionAfterReportCancel(
  input: RecomputeSanctionInput,
): Promise<RecomputeSanctionResult> {
  const fbDb = getReportsDb();
  const ref = doc(fbDb, 'userSanctions', input.sanctionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { updated: false, newLevel: null, reason: 'sanction-not-found' };
  }
  const sanction = snap.data() as UserSanction;

  if (sanction.reason !== 'no_show_threshold') {
    return { updated: false, newLevel: sanction.level, reason: 'reason-not-no-show' };
  }
  if (!sanction.isActive) {
    return { updated: false, newLevel: sanction.level, reason: 'already-inactive' };
  }

  const before = sanction.triggeringReportIds ?? [];
  const filtered = before.filter((id) => id !== input.cancelledReportId);
  if (filtered.length === before.length) {
    return { updated: false, newLevel: sanction.level, reason: 'report-not-in-triggering' };
  }

  const recomputed = computeNoShowThresholdAction(filtered.length);
  const newLevel = recomputed.level;

  // Cas 1 : level inchangé → just update triggeringReportIds (audit propre)
  if (newLevel === sanction.level) {
    await updateDoc(ref, { triggeringReportIds: filtered });
    return { updated: true, newLevel, reason: 'level-preserved' };
  }

  // Cas 2 : plus aucun trigger → désactive
  if (newLevel === null) {
    await updateDoc(ref, {
      isActive: false,
      triggeringReportIds: filtered,
    });
    return { updated: true, newLevel: null, reason: 'disabled-no-triggering' };
  }

  // Cas 3 : downgrade level (annulation ne peut qu'alléger ; upgrade = bug logic)
  const currentRank = LEVEL_RANK[sanction.level];
  const newRank = LEVEL_RANK[newLevel];
  if (newRank > currentRank) {
    console.warn('[recomputeSanctionAfterReportCancel] upgrade impossible — preserving level', {
      sanctionId: input.sanctionId,
      currentLevel: sanction.level,
      newLevel,
      filtered,
    });
    await updateDoc(ref, { triggeringReportIds: filtered });
    return { updated: true, newLevel: sanction.level, reason: 'upgrade-skipped' };
  }

  // Recompute endsAt si nouvelle suspension_*
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    level: newLevel,
    triggeringReportIds: filtered,
  };
  if (newLevel === 'suspension_7d' || newLevel === 'suspension_30d') {
    const days = newLevel === 'suspension_7d' ? 7 : 30;
    const startsAtMs = sanction.startsAt?.toMillis?.() ?? Date.now();
    update.endsAt = Timestamp.fromMillis(startsAtMs + days * 24 * 60 * 60 * 1000);
  }

  await updateDoc(ref, update);
  return { updated: true, newLevel, reason: 'downgraded' };
}

/**
 * Trouve la sanction active d'un user déclenchée par un reportId donné.
 *
 * Utilise l'index existant `userSanctions: userId+isActive+createdAt DESC`
 * (déclaré Phase 7) — pas besoin d'array-contains index supplémentaire car
 * filtrage triggeringReportIds.includes() côté client après query.
 *
 * Retourne null si aucune sanction active ne référence ce reportId.
 */
export async function findActiveSanctionTriggeredByReport(
  reportedId: string,
  reportId: string,
): Promise<UserSanction | null> {
  if (!reportedId || !reportId) return null;
  const fbDb = getReportsDb();
  const snap = await getDocs(
    query(
      collection(fbDb, 'userSanctions'),
      where('userId', '==', reportedId),
      where('isActive', '==', true),
    ),
  );
  for (const d of snap.docs) {
    const s = d.data() as UserSanction;
    if ((s.triggeringReportIds ?? []).includes(reportId)) {
      return s;
    }
  }
  return null;
}
