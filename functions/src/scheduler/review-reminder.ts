/**
 * Spordateur — Phase 8 sub-chantier 5 commit 2/5
 * Cloud Functions Scheduler — review reminder 48h post-session.
 *
 * Q1=A : pattern Option β cohérent refresh-pricing.ts Phase 6 :
 *   CF Scheduler horaire trigger Vercel route handler via Bearer ${CRON_SECRET}.
 *   La logique Firestore reste côté Vercel (Admin SDK in route handler) pour
 *   cohérence stack + observabilité (Vercel logs + Resend metrics).
 *
 * Cadence : every 60 minutes Europe/Zurich. Window 24h (48h..72h post-session)
 * → marge horaire confortable, pas de réveil user nuit suisse.
 *
 * Configuration runtime :
 *   - Secret CRON_SECRET (partagé avec refresh-pricing.ts) — set via
 *     `firebase functions:secrets:set CRON_SECRET --project spordate-prod`
 *   - Param SPORDATEUR_BASE_URL — défaut 'https://spordateur.com'
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:reviewReminderCron --project spordate-prod
 *
 * Comble Différé Phase 8 ligne 885 architecture.md.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

const cronSecret = defineSecret('CRON_SECRET');
const baseUrl = defineString('SPORDATEUR_BASE_URL', {
  default: 'https://spordateur.com',
});

const LOG_PREFIX = '[review-reminder:cron-trigger]';

export const reviewReminderCron = onSchedule(
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
    const url = `${baseUrl.value()}/api/cron/review-reminder`;

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
