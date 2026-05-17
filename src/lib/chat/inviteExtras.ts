/**
 * BUG #36 COMMIT 3 — Helpers extras (rate limit + Duo metadata + expiration).
 *
 *  - checkInviteRateLimit : soft limit 10/jour, toast warning sans hard block
 *  - buildDuoInviteMetadata : Stripe metadata pour mode Duo (cohérent fix #c47)
 *  - findExpiredInvites : Cloud Function expiration cron — filter messages
 *    activity_invite pending dont nextSessionAt est dans <24h
 *
 * @module
 */

import { INVITE_EXPIRY_HOURS_BEFORE_SESSION } from './activityInvite';

// =====================================================================
// checkInviteRateLimit
// =====================================================================

/** Soft limit invites/jour par sender (décision Q-F Bassi). */
export const INVITE_DAILY_LIMIT = 10;

export interface RateLimitResult {
  /** True = laisse passer (soft). Toujours true tant qu'on est pas absurde. */
  allowed: boolean;
  /** Message warning à afficher en toast si dépassement (info pure). */
  message?: string;
}

/**
 * Soft limit : laisse toujours passer, mais warn si > limit.
 * @param countToday nombre d'invites déjà envoyées aujourd'hui par le sender
 * @param limit défaut 10
 */
export function checkInviteRateLimit(countToday: number, limit: number = INVITE_DAILY_LIMIT): RateLimitResult {
  if (countToday > limit) {
    return {
      allowed: true,
      message: `Tu as déjà envoyé ${countToday} invitations aujourd'hui (max recommandé ${limit}). Évite le spam pour respecter les autres.`,
    };
  }
  return { allowed: true };
}

// =====================================================================
// buildDuoInviteMetadata
// =====================================================================

export interface DuoInviteMetadataInput {
  activityId: string;
  /** sessionId optionnel — si présent, mode='session' Stripe utilise cette session. */
  sessionId?: string;
  matchId: string;
  senderUid: string;
  receiverUid: string;
}

/** Stripe metadata limit : tous les values doivent être strings et < 500 chars. */
export interface DuoInviteMetadata {
  /** Marqueur pour webhook : ce paiement vient d'un invite duo. */
  activityInviteMode: 'duo';
  activityInviteMatchId: string;
  activityInviteSenderUid: string;
  activityInviteReceiverUid: string;
  activityInviteActivityId: string;
  activityInviteSessionId?: string;
  /** Alias pour réuse fix Phase 9.5 c47 BUG B : webhook crée le 2e booking via inviteeUid. */
  inviteeUid: string;
  /** Alias pour réuse fix Phase 9.5 c45 BUG 1 : checkout calcule unit_amount × 2 + bundle credits × 2. */
  isDuoTicket: 'true';
}

export function buildDuoInviteMetadata(input: DuoInviteMetadataInput): DuoInviteMetadata {
  const out: DuoInviteMetadata = {
    activityInviteMode: 'duo',
    activityInviteMatchId: input.matchId,
    activityInviteSenderUid: input.senderUid,
    activityInviteReceiverUid: input.receiverUid,
    activityInviteActivityId: input.activityId,
    inviteeUid: input.receiverUid,
    isDuoTicket: 'true',
  };
  if (input.sessionId) {
    out.activityInviteSessionId = input.sessionId;
  }
  return out;
}

// =====================================================================
// findExpiredInvites
// =====================================================================

interface MaybeMessage {
  messageId?: string;
  type?: string;
  inviteStatus?: string;
  invite?: {
    nextSessionAt?: Date | { toMillis?: () => number; toDate?: () => Date } | null;
  };
}

function toMs(input: unknown): number | null {
  if (!input) return null;
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'object' && input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = input as any;
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.toDate === 'function') return obj.toDate().getTime();
  }
  return null;
}

/**
 * Retourne les messageIds des invites pending dont la session est proche
 * (≤ 24h) OU déjà passée. Le caller (CF cron) update inviteStatus='expired'
 * pour chacun via Admin SDK.
 *
 * Skip si :
 *  - type != 'activity_invite'
 *  - inviteStatus != 'pending'
 *  - invite.nextSessionAt absent
 *  - nextSessionAt > now + 24h (encore dans la fenêtre)
 */
export function findExpiredInvites(messages: ReadonlyArray<MaybeMessage>, nowMs: number): string[] {
  const expiredIds: string[] = [];
  const expiryThresholdMs = nowMs + INVITE_EXPIRY_HOURS_BEFORE_SESSION * 3600 * 1000;
  for (const msg of messages) {
    if (msg.type !== 'activity_invite') continue;
    if (msg.inviteStatus !== 'pending') continue;
    const sessionMs = toMs(msg.invite?.nextSessionAt);
    if (sessionMs === null) continue;
    if (sessionMs > expiryThresholdMs) continue;
    if (msg.messageId) expiredIds.push(msg.messageId);
  }
  return expiredIds;
}
