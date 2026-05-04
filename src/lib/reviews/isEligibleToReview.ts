/**
 * Spordateur — Phase 7 sub-chantier 1 commit 4/6
 * isEligibleToReview — vérification d'éligibilité utilisateur à laisser un avis
 * sur (activityId, revieweeId).
 *
 * Réutilise les helpers internes du commit 2/6 (findLatestSharedPastSession,
 * reviewAlreadyExists). Pure read function — ne mute pas Firestore.
 *
 * Consommée par :
 * - ReviewTrigger Client (commit 4/6) pour conditional rendering du bouton
 * - Phase 8+ admin UI pour audit éligibilité
 *
 * Logique (cohérent createReview commit 2/6) :
 * 1. self-review : userId === revieweeId → ineligible
 * 2. already-reviewed : 1 review max par (activityId, reviewerId)
 * 3. activity-not-found : activity inexistante → 'no-shared-session' (defensive)
 * 4. no-shared-session : reviewer + reviewee n'ont pas partagé de session passée
 * 5. cooling-off-active : now < session.endAt + 24h
 * 6. window-closed : now > session.endAt + 7j
 * 7. eligible : tous checks OK → eligible=true
 */

import { Timestamp, doc, getDoc } from 'firebase/firestore';
import type { Activity } from '@/types/firestore';
import {
  COOLING_OFF_HOURS,
  REVIEW_WINDOW_DAYS,
  findLatestSharedPastSession,
  getReviewsDb,
  reviewAlreadyExists,
} from './_internal';

export type EligibilityReason =
  | 'self-review'
  | 'already-reviewed'
  | 'no-shared-session'
  | 'cooling-off-active'
  | 'window-closed';

export interface IsEligibleToReviewInput {
  userId: string;
  activityId: string;
  revieweeId: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: EligibilityReason;
  /** Set si reason='cooling-off-active' (date à laquelle la review devient possible). */
  cooldownEndsAt?: Timestamp;
  /** Set si eligible OU reason='window-closed' (date de fermeture de la fenêtre 7j). */
  windowEndsAt?: Timestamp;
}

export async function isEligibleToReview(
  input: IsEligibleToReviewInput,
): Promise<EligibilityResult> {
  const now = input.now ?? new Date();

  // 1. self-review (court-circuit avant les queries)
  if (input.userId === input.revieweeId) {
    return { eligible: false, reason: 'self-review' };
  }

  // 2. already-reviewed
  if (await reviewAlreadyExists(input.activityId, input.userId)) {
    return { eligible: false, reason: 'already-reviewed' };
  }

  // 3. activity lookup pour récupérer partnerId (nécessaire pour findLatestSharedPastSession)
  const fbDb = getReviewsDb();
  const actSnap = await getDoc(doc(fbDb, 'activities', input.activityId));
  if (!actSnap.exists()) {
    return { eligible: false, reason: 'no-shared-session' };
  }
  const activity = actSnap.data() as Activity;

  // 4. session partagée la plus récente passée
  const sharedSession = await findLatestSharedPastSession(
    input.activityId,
    input.userId,
    input.revieweeId,
    activity.partnerId,
    now,
  );
  if (!sharedSession) {
    return { eligible: false, reason: 'no-shared-session' };
  }

  // 5. cooling-off + 6. window
  const endsAtMs = sharedSession.endAt.toMillis();
  const cooldownEndsAt = Timestamp.fromMillis(
    endsAtMs + COOLING_OFF_HOURS * 60 * 60 * 1000,
  );
  const windowEndsAt = Timestamp.fromMillis(
    endsAtMs + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const nowMs = now.getTime();

  if (nowMs < cooldownEndsAt.toMillis()) {
    return { eligible: false, reason: 'cooling-off-active', cooldownEndsAt, windowEndsAt };
  }
  if (nowMs > windowEndsAt.toMillis()) {
    return { eligible: false, reason: 'window-closed', windowEndsAt };
  }

  // 7. éligible
  return { eligible: true, cooldownEndsAt, windowEndsAt };
}
