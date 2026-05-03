/**
 * Spordateur — Cloud Functions entry point.
 *
 * Re-exports les Cloud Functions exposées au runtime. Chaque export ici devient
 * une fonction déployable individuellement via `firebase deploy --only functions:<name>`.
 *
 * Phase 6 :
 *   - refreshPricingCron : scheduler 15 min anti-cheat pricing tier+price
 *
 * Phase 7+ (à venir) :
 *   - notifyChatOpening : trigger T-2h avant session.startAt
 *   - sendDailyDigest  : daily summary partner emails
 *   - etc.
 */

export { refreshPricingCron } from './scheduler/refresh-pricing';
