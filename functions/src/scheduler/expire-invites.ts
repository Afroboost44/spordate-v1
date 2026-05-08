/**
 * Spordateur — Phase 9 sub-chantier 1 commit 4/5
 * Cloud Functions Scheduler — expire invites pending dont expiresAt est passée.
 *
 * Comble Différé Phase 9 SC4 close-out (architecture.md ligne 1334) :
 *   « ⏭️ Cron `expireInvitesIfDue()` deployment Cloud Functions Scheduler »
 *
 * Pattern Option β cohérent refresh-pricing.ts Phase 6 + SC5 c2/5 review-reminder :
 *   CF Scheduler horaire trigger Vercel route handler via Bearer ${CRON_SECRET}.
 *   La logique Firestore reste côté Vercel (Admin SDK in route handler) — cohérence
 *   stack + observabilité (Vercel logs) + pagination cursor SC0 c1/X.
 *
 * Cadence : every 60 minutes Europe/Zurich. Granularity acceptable :
 *  - Invites Phase 8 SC4 ont expiresAt = Min(now+7j, sessionStart-1h)
 *  - 1h précision = OK (un invite expiré rendu "expired" max 1h après sa date)
 *
 * Configuration runtime :
 *   - Secret CRON_SECRET (partagé) — set via firebase functions:secrets:set
 *   - Param SPORDATEUR_BASE_URL — défaut 'https://spordateur.com'
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:expireInvitesCron --project spordate-prod
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

const cronSecret = defineSecret('CRON_SECRET');
const baseUrl = defineString('SPORDATEUR_BASE_URL', {
  default: 'https://spordateur.com',
});

const LOG_PREFIX = '[expire-invites:cron-trigger]';

export const expireInvitesCron = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Europe/Zurich',
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [cronSecret],
  },
  async (event) => {
    const start = Date.now();
    const url = `${baseUrl.value()}/api/cron/expire-invites`;

    logger.info(LOG_PREFIX, {
      event: 'trigger-started',
      scheduleTime: event.scheduleTime,
      url,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cronSecret.value()}`,
          'Content-Type': 'application/json',
        },
      });

      const durationMs = Date.now() - start;

      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable body>');
        logger.error(LOG_PREFIX, {
          event: 'trigger-failed',
          status: response.status,
          statusText: response.statusText,
          body: body.slice(0, 500),
          durationMs,
        });
        return;
      }

      const result = await response.json().catch(() => ({}));
      logger.info(LOG_PREFIX, {
        event: 'trigger-success',
        durationMs,
        result,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(LOG_PREFIX, {
        event: 'trigger-exception',
        error: errMsg,
        durationMs: Date.now() - start,
      });
    }
  },
);
