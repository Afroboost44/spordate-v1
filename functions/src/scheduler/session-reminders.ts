/**
 * Spordateur — Phase 9 sub-chantier 3 commit 1/5
 * Cloud Functions Scheduler — session reminders J-1 + T-0.
 *
 * Pattern Option β cohérent refresh-pricing.ts Phase 6 + SC5 c2/5 review-reminder
 * + SC1 c4/5 expire-invites :
 *   CF Scheduler horaire trigger Vercel route handler via Bearer ${CRON_SECRET}.
 *
 * Cadence : every 60 minutes Europe/Zurich.
 * Window cohérent route handler :
 *   - Q1=B J-1 : sessionDate ∈ (now+18h, now+30h)
 *   - Q2=A T-0 : sessionDate ∈ (now+30min, now+90min)
 *
 * Configuration runtime :
 *   - Secret CRON_SECRET (partagé) — set via firebase functions:secrets:set
 *   - Param SPORDATEUR_BASE_URL — défaut 'https://spordateur.com'
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:sessionRemindersCron --project spordate-prod
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

const cronSecret = defineSecret('CRON_SECRET');
const baseUrl = defineString('SPORDATEUR_BASE_URL', {
  default: 'https://spordateur.com',
});

const LOG_PREFIX = '[session-reminders:cron-trigger]';

export const sessionRemindersCron = onSchedule(
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
    const url = `${baseUrl.value()}/api/cron/session-reminders`;

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
