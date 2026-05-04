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
import { sendEmail } from '@/lib/email/sendEmail';
import { logAdminAction } from '@/lib/admin-actions';
import { ReportError, fetchReportEmailContext, getReportsDb, isAdminRole } from './_internal';

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

  // Phase 7 sub-chantier 5 commit 2/3 — audit trail
  await logAdminAction({
    adminId: input.adminId,
    actionType: 'sanction_overturn',
    targetType: 'sanction',
    targetId: input.sanctionId,
    reason: input.reason,
  });

  // Phase 7 sub-chantier 5 commit 1/3 — best-effort sendEmail userSanctionOverturned
  try {
    const ctx = await fetchReportEmailContext({ userId: sanction.userId });
    if (ctx.email) {
      await sendEmail({
        to: ctx.email,
        templateName: 'userSanctionOverturned',
        templateData: {
          userName: ctx.displayName,
          level: sanction.level,
          adminNote: input.reason,
        },
      });
    }
  } catch (err) {
    console.warn('[overturnSanction] sendEmail userSanctionOverturned failed (non-blocking)', {
      sanctionId: input.sanctionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
