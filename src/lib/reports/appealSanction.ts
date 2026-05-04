/**
 * Phase 7 sub-chantier 3 commit 3/5 — appealSanction.
 * Sub-chantier 5 commit 1/3 — wire sendEmail appealAcknowledgment (Q9).
 *
 * User file un appel sur sa sanction. Doctrine §F : 1× par niveau.
 *
 * Validations :
 *  - sanction existe + sanction.userId == input.userId (anti-spoofing)
 *  - sanction.appealable === true (warning level pas appealable)
 *  - sanction.appealUsed !== true (1× per niveau enforcement)
 *  - appealNote.length >= APPEAL_NOTE_MIN_LENGTH (20 chars)
 *
 * Update sanction : appealUsed=true + appealNote (cohérent rule update owner).
 *
 * Note doctrine §F : appel formellement par email reply à contact@spordateur.com.
 * Ce service stocke appealUsed + appealNote pour tracking. L'admin résout via
 * resolveAppeal (sub-chantier 4) qui wire appealResolved email post-décision.
 *
 * Sub-chantier 5 commit 1/3 : wire confirmation in-app appealAcknowledgment (template
 * existant non utilisé jusqu'ici) — UX transparency post-filing.
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import type { SanctionLevel, UserSanction } from '@/types/firestore';
import { sendEmail } from '@/lib/email/sendEmail';
import {
  APPEAL_NOTE_MIN_LENGTH,
  ReportError,
  fetchReportEmailContext,
  getReportsDb,
} from './_internal';

const SANCTION_LEVEL_LABEL_FR: Record<SanctionLevel, string> = {
  warning: 'Avertissement',
  suspension_7d: 'Suspension 7 jours',
  suspension_30d: 'Suspension 30 jours',
  ban_permanent: 'Bannissement permanent',
};

const APPEAL_SLA_DAYS = 7;

export interface AppealSanctionInput {
  /** UID du user qui file l'appel (doit == sanction.userId). */
  userId: string;
  sanctionId: string;
  /** Note motivant l'appel (≥20 chars, cohérent rule update). */
  appealNote: string;
}

export async function appealSanction(input: AppealSanctionInput): Promise<void> {
  if (!input.userId || !input.sanctionId) {
    throw new ReportError('invalid-uid', {
      userId: input.userId,
      sanctionId: input.sanctionId,
    });
  }
  if (input.appealNote.length < APPEAL_NOTE_MIN_LENGTH) {
    throw new ReportError('appeal-note-too-short', {
      length: input.appealNote.length,
      min: APPEAL_NOTE_MIN_LENGTH,
    });
  }

  const fbDb = getReportsDb();
  const ref = doc(fbDb, 'userSanctions', input.sanctionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReportError('sanction-not-found', { sanctionId: input.sanctionId });
  }
  const sanction = snap.data() as UserSanction;

  if (sanction.userId !== input.userId) {
    throw new ReportError('not-sanction-owner', {
      sanctionId: input.sanctionId,
      sanctionUserId: sanction.userId,
      callerId: input.userId,
    });
  }
  if (sanction.appealable !== true) {
    throw new ReportError('not-appealable', {
      sanctionId: input.sanctionId,
      level: sanction.level,
    });
  }
  if (sanction.appealUsed === true) {
    throw new ReportError('appeal-already-used', { sanctionId: input.sanctionId });
  }

  await updateDoc(ref, {
    appealUsed: true,
    appealNote: input.appealNote,
  });

  console.info('[appealSanction] appel filed', {
    sanctionId: input.sanctionId,
    userId: input.userId,
    noteLength: input.appealNote.length,
  });

  // Phase 7 sub-chantier 5 commit 1/3 — best-effort sendEmail appealAcknowledgment
  // Confirmation in-app du filing (UX transparency, SLA admin 7j mentionné).
  try {
    const ctx = await fetchReportEmailContext({ userId: input.userId });
    if (ctx.email) {
      const receivedAt = new Date().toLocaleDateString('fr-CH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      await sendEmail({
        to: ctx.email,
        templateName: 'appealAcknowledgment',
        templateData: {
          userName: ctx.displayName,
          banLevelLabel: SANCTION_LEVEL_LABEL_FR[sanction.level],
          receivedAt,
          slaDays: APPEAL_SLA_DAYS,
        },
      });
    }
  } catch (err) {
    console.warn('[appealSanction] sendEmail appealAcknowledgment failed (non-blocking)', {
      sanctionId: input.sanctionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
