/**
 * Spordateur — Phase 8 sub-chantier 5 commit 3/5
 * Cloud Functions Scheduler — purge audit trail + anonymise banlist > 24 mois.
 *
 * Q1=A pattern Option β cohérent refresh-pricing.ts + review-reminder.ts :
 *   CF Scheduler weekly trigger Vercel route handler via Bearer ${CRON_SECRET}.
 *
 * Q7=A weekly Friday 03:00 Europe/Zurich :
 *   - Volume faible (audit trail + banlist) → batch petit, pas d'urgence quotidienne
 *   - Friday 03:00 = off-peak utilisateurs CH (low blast-radius si bug)
 *   - Cohérent timezone Europe/Zurich (Phase 6 Anti-Cheat + SC5 c2/5)
 *
 * Configuration runtime :
 *   - Secret CRON_SECRET (partagé) — set via firebase functions:secrets:set
 *   - Param SPORDATEUR_BASE_URL — défaut 'https://spordateur.com'
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:purgeOldDataCron --project spordate-prod
 *
 * Comble Différés Phase 8 lignes 882-883 architecture.md.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

const cronSecret = defineSecret('CRON_SECRET');
const baseUrl = defineString('SPORDATEUR_BASE_URL', {
  default: 'https://spordateur.com',
});

const LOG_PREFIX = '[purge-old-data:cron-trigger]';

export const purgeOldDataCron = onSchedule(
  {
    // Cron syntax : minute hour dayOfMonth month dayOfWeek
    // → Friday at 03:00 Europe/Zurich
    schedule: '0 3 * * 5',
    timeZone: 'Europe/Zurich',
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [cronSecret],
  },
  async (event) => {
    const start = Date.now();
    const url = `${baseUrl.value()}/api/cron/purge-old-data`;

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
