/**
 * Spordateur — Phase 6 anti-cheat
 * Cloud Functions Scheduler — refresh pricing tier+price toutes les 15 min.
 *
 * ⚠️ FAILURE MODE — Couplage Vercel : si /api/cron/refresh-pricing est down,
 * le scheduler retry (Cloud Scheduler back-off jusqu'à ~2h selon config) mais
 * peut échouer définitivement. Failure mode acceptable Phase 6 (launch, 0 users).
 * Migration vers Option α (Functions self-contained avec Firebase Admin SDK)
 * si incidents Vercel observés Phase 7+.
 *
 * Architecture (Option β — trigger-only) :
 *   Cloud Functions Scheduler (15 min, Europe/Zurich)
 *      ↓ HTTPS POST + Authorization: Bearer ${CRON_SECRET}
 *   /api/cron/refresh-pricing (Next.js route handler)
 *      ↓ refreshAllOpenSessionsPricing()  (helper, src/services/anti-cheat/)
 *      ↓ Firestore Admin SDK update
 *
 * Configuration runtime :
 *   - Secret CRON_SECRET — set via :
 *     firebase functions:secrets:set CRON_SECRET --project spordate-prod
 *     (Cloud Secret Manager backed, jamais loggué, accessible via cronSecret.value())
 *   - Param SPORDATEUR_BASE_URL — défaut 'https://spordateur.com', override possible
 *     via Firebase Console (Functions → Configuration) ou redeploy avec env var.
 *
 * Logging : préfixe [anti-cheat:cron-trigger] (distinct du helper [anti-cheat:cron]).
 * Format JSON via firebase-functions logger → Cloud Logging structured automatiquement.
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions --project spordate-prod
 *
 * Cf. architecture.md §10 Phase 6 + audit Phase 6 mai 2026.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

const cronSecret = defineSecret('CRON_SECRET');
const baseUrl = defineString('SPORDATEUR_BASE_URL', {
  default: 'https://spordateur.com',
});

const LOG_PREFIX = '[anti-cheat:cron-trigger]';

export const refreshPricingCron = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Europe/Zurich',
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [cronSecret],
  },
  async (event) => {
    const start = Date.now();
    // limit=80 : mitigation Vercel Hobby 10s timeout (80 sessions × ~100ms ≈ 8s, marge sécurité).
    // Ajuster ↑ si Vercel Pro (60s) ou ↓ si latence helper plus haute en prod observée.
    const url = `${baseUrl.value()}/api/cron/refresh-pricing?limit=80`;

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
