/**
 * BUG #36 COMMIT 1 — Helpers purs activity_invite (chat).
 *
 * 3 helpers :
 *  - buildActivityInvitePayload : construit le ChatMessage shape pour send
 *  - validateInviteStatusTransition : transitions lifecycle autorisées
 *  - isInviteExpired : check 24h avant nextSessionAt OU session passée
 *
 * Le storage utilise un message Firestore chats/{matchId}/messages/{id} avec
 * type='activity_invite' + invite={...} + inviteStatus='pending'.
 * Rules : create par sender (gratuit, pas de check credits), update status
 * par receiver (pending→accepted/declined) ou system (pending→expired).
 *
 * @module
 */

import type { ActivityInviteMode, InviteStatus, ActivityInviteData } from '@/types/firestore';

// =====================================================================
// buildActivityInvitePayload
// =====================================================================

export interface BuildInviteInput {
  senderId: string;
  activityId: string;
  activityTitle: string;
  inviteMode: ActivityInviteMode;
  /** Optionnel — session ID de la prochaine session future. */
  nextSessionId?: string;
  /** Optionnel — timestamp prochaine session (pour expired check). */
  nextSessionAt?: Date | { toDate(): Date } | null;
  /** Optionnel — dénormalisé snapshot. */
  activityCity?: string;
  activitySport?: string;
  activityImageUrl?: string;
}

/**
 * Payload prêt à passer à addDoc(chats/{matchId}/messages/{auto}).
 * Le caller ajoute `createdAt: serverTimestamp()` au write final (impossible
 * de mettre serverTimestamp dans un helper pur — pas serializable).
 */
export interface ActivityInvitePayload {
  senderId: string;
  text: string;
  type: 'activity_invite';
  readBy: string[];
  invite: ActivityInviteData;
  inviteStatus: InviteStatus;
}

export function buildActivityInvitePayload(input: BuildInviteInput): ActivityInvitePayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextSessionAtConverted = input.nextSessionAt
    ? // best-effort cast vers Timestamp-like (sera réinjecté à l'arrivée par caller si Date)
      (input.nextSessionAt as any)
    : undefined;

  // BUG #36 hotfix — Firestore refuse les `undefined` dans les docs. activityTitle
  // est dénormalisé snapshot mais peut arriver undefined/empty (legacy activities
  // sans champ title). Fallback 'Activité' pour ne JAMAIS bloquer le send.
  const safeTitle = (input.activityTitle ?? '').trim() || 'Activité';

  // Build invite avec ONLY les champs définis (skip undefined → Firestore-safe).
  const invite: ActivityInviteData = {
    activityId: input.activityId,
    inviteMode: input.inviteMode,
    activityTitle: safeTitle,
  };
  if (input.nextSessionId) invite.nextSessionId = input.nextSessionId;
  if (nextSessionAtConverted) invite.nextSessionAt = nextSessionAtConverted;
  if (input.activityCity) invite.activityCity = input.activityCity;
  if (input.activitySport) invite.activitySport = input.activitySport;
  if (input.activityImageUrl) invite.activityImageUrl = input.activityImageUrl;

  return {
    senderId: input.senderId,
    text: '',
    type: 'activity_invite',
    readBy: [input.senderId],
    invite,
    inviteStatus: 'pending',
  };
}

// =====================================================================
// validateInviteStatusTransition
// =====================================================================

export interface TransitionContext {
  /** True si auth.uid !== senderId (receiver tries to update). */
  isReceiver: boolean;
  /** True si appel system (Cloud Function expiration cron). Default false. */
  isSystem?: boolean;
}

/**
 * Vrai si la transition `from → to` est autorisée selon le contexte.
 *
 *  Règles :
 *   - from doit être 'pending' (immutable une fois finalisé)
 *   - to ≠ from (no-op interdit)
 *   - pending → accepted/declined : isReceiver required (sender peut pas s'auto-accepter)
 *   - pending → expired : isSystem required (cron, pas client)
 */
export function validateInviteStatusTransition(
  from: InviteStatus,
  to: InviteStatus,
  ctx: TransitionContext,
): boolean {
  if (from !== 'pending') return false;
  if (to === from) return false;
  if (to === 'accepted' || to === 'declined') {
    return ctx.isReceiver === true;
  }
  if (to === 'expired') {
    return ctx.isSystem === true;
  }
  return false;
}

// =====================================================================
// isInviteExpired
// =====================================================================

/** Fenêtre avant nextSessionAt sous laquelle l'invite est considérée expirée. */
export const INVITE_EXPIRY_HOURS_BEFORE_SESSION = 24;

interface InviteExpiryInput {
  /** nextSessionAt en Timestamp (Firestore) OU Date OU null/undefined. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextSessionAt?: any;
}

/**
 * Vrai si l'invite est considérée expirée à `nowMs` :
 *  - nextSessionAt absent → false (pas d'expiration possible)
 *  - nextSessionAt déjà passé → true
 *  - nextSessionAt dans <24h → true
 */
export function isInviteExpired(invite: InviteExpiryInput, nowMs: number): boolean {
  const sessionAt = invite.nextSessionAt;
  if (!sessionAt) return false;
  // Support Date OR Firestore Timestamp (toMillis() ou toDate())
  let sessionMs: number;
  if (sessionAt instanceof Date) {
    sessionMs = sessionAt.getTime();
  } else if (typeof sessionAt === 'object' && sessionAt && typeof sessionAt.toMillis === 'function') {
    sessionMs = sessionAt.toMillis();
  } else if (typeof sessionAt === 'object' && sessionAt && typeof sessionAt.toDate === 'function') {
    sessionMs = sessionAt.toDate().getTime();
  } else {
    return false; // shape inconnue → defensive
  }
  const expiryThreshold = sessionMs - INVITE_EXPIRY_HOURS_BEFORE_SESSION * 3600 * 1000;
  return nowMs >= expiryThreshold;
}
