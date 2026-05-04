/**
 * Phase 7 sub-chantier 4 commit 1/4 — resolveAppeal.
 *
 * Admin résout un appel filé par user (appealUsed=true).
 * Doctrine §F : 1× per niveau, admin SLA 7j.
 *
 * Validations :
 *  - admin role (defense complémentaire à rule)
 *  - sanction existe
 *  - sanction.appealUsed === true (un appel a été filé)
 *  - sanction.appealResolvedAt absent (anti-double resolution)
 *
 * Update :
 *  - appealResolvedBy = adminId
 *  - appealResolvedAt = serverTimestamp
 *  - appealDecision = 'upheld' | 'overturned'
 *  - Si overturned → isActive=false (la sanction est annulée)
 *  - Note admin optionnelle stockée dans appealNote (concat ou remplace ?
 *    décision Phase 7 : remplace — la note user reste dans appealNote initial,
 *    on ajoute une "decisionNote" séparée si besoin Phase 8 polish)
 *
 * Best-effort : pas de sendEmail Phase 7 (l'admin répond directement à l'email
 * reply user — flow doctrine §F).
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { UserSanction } from '@/types/firestore';
import { ReportError, getReportsDb, isAdminRole } from './_internal';

export type AppealDecision = 'upheld' | 'overturned';

export interface ResolveAppealInput {
  adminId: string;
  sanctionId: string;
  decision: AppealDecision;
  /** Note admin sur la décision (optionnelle, pour audit). */
  decisionNote?: string;
}

export async function resolveAppeal(input: ResolveAppealInput): Promise<void> {
  if (!input.adminId || !input.sanctionId) {
    throw new ReportError('invalid-uid', {
      adminId: input.adminId,
      sanctionId: input.sanctionId,
    });
  }
  if (input.decision !== 'upheld' && input.decision !== 'overturned') {
    throw new ReportError('invalid-decision', { decision: input.decision });
  }

  const isAdmin = await isAdminRole(input.adminId);
  if (!isAdmin) {
    throw new ReportError('not-admin', { adminId: input.adminId });
  }

  const fbDb = getReportsDb();
  const ref = doc(fbDb, 'userSanctions', input.sanctionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReportError('sanction-not-found', { sanctionId: input.sanctionId });
  }
  const sanction = snap.data() as UserSanction;

  if (sanction.appealUsed !== true) {
    throw new ReportError('appeal-not-filed', { sanctionId: input.sanctionId });
  }
  if (sanction.appealResolvedAt) {
    throw new ReportError('appeal-already-resolved', {
      sanctionId: input.sanctionId,
      previousDecision: sanction.appealDecision,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    appealResolvedBy: input.adminId,
    appealResolvedAt: serverTimestamp(),
    appealDecision: input.decision,
  };

  // Si overturn → désactiver la sanction
  if (input.decision === 'overturned') {
    update.isActive = false;
  }

  // Note admin appended à appealNote (séparateur explicite — note user préservée)
  if (input.decisionNote) {
    const previousNote = sanction.appealNote ?? '';
    update.appealNote = previousNote
      ? `${previousNote}\n\n[Admin ${input.adminId}] ${input.decisionNote}`
      : `[Admin ${input.adminId}] ${input.decisionNote}`;
  }

  await updateDoc(ref, update);
}
