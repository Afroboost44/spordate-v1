/**
 * Phase 7 sub-chantier 3 commit 3/5 — triggerAutoSanction.
 *
 * Extract de `_triggerSanctionStub` (commit 2/5) vers service public propre.
 * Crée une UserSanction Firestore cohérente avec rule create commit 1/5.
 *
 * Inputs :
 *  - userId : cible de la sanction (doit être != caller, enforcé rule)
 *  - level : warning | suspension_7d | suspension_30d | ban_permanent
 *  - reason : reports_threshold | no_show_threshold | manual_admin
 *  - triggeringReportIds : IDs reports qui ont déclenché (audit + anti-recompute)
 *  - refundDue (optionnel) : flag refund partner pour no-show level 3 (Q7)
 *  - createdBy (optionnel) : admin uid si reason='manual_admin'
 *
 * Calculs internes :
 *  - endsAt = startsAt + 7j ou 30j (suspension_*) ; null pour warning + ban_permanent
 *  - appealable = level !== 'warning' (doctrine §F)
 *  - appealUsed = false (initial)
 *  - isActive = true
 *
 * Best-effort side-effects :
 *  - sendEmail userSanctionNotice (TODO commit 5/5 — template à créer)
 *  - denorm UserProfile.activeSanction* : NON écrit Phase 7 (Q3 décision — rule
 *    users update reste owner+admin only). Phase 8 polish via Cloud Function.
 *    Log warning ici pour traçabilité.
 *
 * Retourne sanctionId créé.
 */

import { Timestamp, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { SanctionLevel, SanctionReason } from '@/types/firestore';
import { getReportsDb } from './_internal';

export interface TriggerAutoSanctionInput {
  userId: string;
  level: SanctionLevel;
  reason: SanctionReason;
  triggeringReportIds: string[];
  /** Flag refund partner (Q7 doctrine §D.5 niveau 3 no-show). */
  refundDue?: boolean;
  /** Admin uid si reason='manual_admin'. */
  createdBy?: string;
}

export async function triggerAutoSanction(
  input: TriggerAutoSanctionInput,
): Promise<string> {
  const fbDb = getReportsDb();
  const ref = doc(collection(fbDb, 'userSanctions'));
  const sanctionId = ref.id;

  const isWarning = input.level === 'warning';
  const isPermanent = input.level === 'ban_permanent';

  // endsAt computed côté client pour cosmétique + tests predictable.
  // Production : Cloud Function pourrait basculer sur serverTimestamp + offset.
  let endsAt: Timestamp | undefined;
  if (!isWarning && !isPermanent) {
    const days = input.level === 'suspension_7d' ? 7 : 30;
    endsAt = Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    sanctionId,
    userId: input.userId,
    level: input.level,
    reason: input.reason,
    triggeringReportIds: input.triggeringReportIds,
    startsAt: serverTimestamp(),
    appealable: !isWarning, // doctrine §F : warning = pas une sanction au sens appel
    appealUsed: false,
    isActive: true,
    createdAt: serverTimestamp(),
  };
  if (endsAt) payload.endsAt = endsAt;
  if (input.refundDue === true) payload.refundDue = true;
  if (input.createdBy) payload.createdBy = input.createdBy;

  await setDoc(ref, payload);

  // TODO commit 5/5 : best-effort sendEmail userSanctionNotice
  //   (template à créer dans src/lib/email/templates.ts) avec :
  //   - userName, level, reason, endsAt, appealable, contactEmail
  //   try { await sendEmail({ to: userEmail, templateName: 'userSanctionNotice', ... }); }
  //   catch (err) { console.warn('[triggerAutoSanction] email failed', err); }

  // Q3 décision : denorm UserProfile activeSanction* NON écrit Phase 7
  // (rule users update reste owner+admin only). Cloud Function Phase 8 fera ce wire.
  // Log info pour traçabilité audit Phase 7.
  console.info('[triggerAutoSanction] sanction créée — denorm UserProfile différée Phase 8', {
    sanctionId,
    userId: input.userId,
    level: input.level,
    reason: input.reason,
  });

  return sanctionId;
}
