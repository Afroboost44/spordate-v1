/**
 * Spordateur — BUG #36 COMMIT 3 — Cron expiration activity_invite.
 *
 * Scheduled Cloud Function v2 : toutes les 1h, scanne les messages
 * collectionGroup('messages') filtrés type='activity_invite' + inviteStatus=
 * 'pending'. Pour chacun dont `invite.nextSessionAt` est <24h dans le futur
 * (ou passé), update inviteStatus='expired' via Admin SDK (bypass rules
 * client qui n'autorisent qu'inviteStatus accepted/declined par receiver).
 *
 * Helper de filtering inline (duplicate de src/lib/chat/inviteExtras.ts —
 * rootDir différents). Tests source de vérité côté frontend.
 *
 * Cadence 60min Europe/Zurich. Granularité acceptable :
 *  - Window expiration = 24h avant session
 *  - 1h précision OK (un invite est rendu "expired" max 1h après la
 *    fenêtre des 24h)
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:expireActivityInvitesCron --project spordate-prod
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

const LOG_PREFIX = '[expire-activity-invites]';

if (!getApps().length) initializeApp();

// =====================================================================
// Helpers inline (duplicate src/lib/chat/inviteExtras.ts — tests source là-bas)
// =====================================================================

const INVITE_EXPIRY_HOURS_BEFORE_SESSION = 24;

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

function shouldExpire(msg: MaybeMessage, nowMs: number): boolean {
  if (msg.type !== 'activity_invite') return false;
  if (msg.inviteStatus !== 'pending') return false;
  const sessionMs = toMs(msg.invite?.nextSessionAt);
  if (sessionMs === null) return false;
  const expiryThresholdMs = nowMs + INVITE_EXPIRY_HOURS_BEFORE_SESSION * 3600 * 1000;
  return sessionMs <= expiryThresholdMs;
}

// =====================================================================
// Cloud Function entry
// =====================================================================

export const expireActivityInvitesCron = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Europe/Zurich',
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    // Query collectionGroup('messages') où type='activity_invite' AND
    // inviteStatus='pending'. Pas de where('invite.nextSessionAt', '<=')
    // car nested field index n'est pas auto-créé — on filtre côté code.
    const snap = await db
      .collectionGroup('messages')
      .where('type', '==', 'activity_invite')
      .where('inviteStatus', '==', 'pending')
      .get();

    if (snap.empty) {
      logger.info(`${LOG_PREFIX} no pending activity_invite, skip`);
      return;
    }

    const toExpire: Array<FirebaseFirestore.DocumentReference> = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as MaybeMessage;
      if (shouldExpire(data, nowMs)) {
        toExpire.push(docSnap.ref);
      }
    }

    if (toExpire.length === 0) {
      logger.info(`${LOG_PREFIX} scanned ${snap.size} pending, 0 in expiry window`);
      return;
    }

    logger.info(`${LOG_PREFIX} expiring ${toExpire.length} invites (scanned ${snap.size})`);

    // Batch update (max 500 ops par batch)
    const CHUNK = 450;
    let updated = 0;
    for (let i = 0; i < toExpire.length; i += CHUNK) {
      const batch = db.batch();
      const slice = toExpire.slice(i, i + CHUNK);
      for (const ref of slice) {
        batch.update(ref, {
          inviteStatus: 'expired',
          inviteExpiredAt: FieldValue.serverTimestamp(),
        });
        updated++;
      }
      await batch.commit();
    }

    logger.info(`${LOG_PREFIX} done, updated ${updated} invites to expired`);
  },
);
