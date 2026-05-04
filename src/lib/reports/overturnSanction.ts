/**
 * Phase 7 sub-chantier 4 commit 1/4 — overturnSanction.
 *
 * Admin annule une UserSanction active (independent du flow appeal).
 * Cas d'usage : admin review queue, décide qu'une sanction auto-trigger
 * était abusive ou erronée.
 *
 * Update : isActive=false + appealResolvedBy=adminId + appealResolvedAt + appealDecision='overturned'.
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler.
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { UserSanction } from '@/types/firestore';
import { ReportError, getReportsDb, isAdminRole } from './_internal';

export interface OverturnSanctionInput {
  adminId: string;
  sanctionId: string;
  /** Note admin motivant l'overturn (recommandé pour audit). */
  reason?: string;
}

export async function overturnSanction(input: OverturnSanctionInput): Promise<void> {
  if (!input.adminId || !input.sanctionId) {
    throw new ReportError('invalid-uid', {
      adminId: input.adminId,
      sanctionId: input.sanctionId,
    });
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

  if (sanction.isActive !== true) {
    throw new ReportError('not-sanction-active', {
      sanctionId: input.sanctionId,
      currentIsActive: sanction.isActive,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    isActive: false,
    appealResolvedBy: input.adminId,
    appealResolvedAt: serverTimestamp(),
    appealDecision: 'overturned',
  };
  if (input.reason) update.appealNote = input.reason;

  await updateDoc(ref, update);
}
