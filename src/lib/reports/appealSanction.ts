/**
 * Phase 7 sub-chantier 3 commit 3/5 — appealSanction.
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
 * Ce service stocke appealUsed + appealNote pour tracking. Le résolveur (admin)
 * traitera via update sanction côté admin dashboard sub-chantier 4 (appealResolvedBy/At/Decision).
 *
 * Best-effort wire email notification admin → TODO commit 5/5.
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import type { UserSanction } from '@/types/firestore';
import { APPEAL_NOTE_MIN_LENGTH, ReportError, getReportsDb } from './_internal';

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

  // TODO commit 5/5 : best-effort sendEmail admin notification "Appeal filed"
  //   → contact@spordateur.com avec sanctionId, userId, level, note pour traitement humain.
}
