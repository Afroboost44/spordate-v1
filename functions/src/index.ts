/**
 * Spordateur — Cloud Functions entry point.
 *
 * Re-exports les Cloud Functions exposées au runtime. Chaque export ici devient
 * une fonction déployable individuellement via `firebase deploy --only functions:<name>`.
 *
 * Phase 6 :
 *   - refreshPricingCron : scheduler 15 min anti-cheat pricing tier+price
 *
 * Phase 8 SC5 :
 *   - reviewReminderCron (c2/5) : scheduler 60 min review reminder 48h post-session
 *   - denormActiveSanctionTrigger (c2/5) : onWrite userSanctions → denorm users.activeSanction*
 *   - purgeOldDataCron (c3/5) : weekly Friday 03:00 → purge adminActions + anonymise banlist > 24mo
 *
 * Phase 9 SC1 :
 *   - expireInvitesCron (c4/5) : scheduler 60 min batch invites pending expirés → 'expired'
 *
 * Phase 9 SC3 :
 *   - sessionRemindersCron (c1/5) : scheduler 60 min rappels J-1 + T-0 (email + push Phase 9 SC3 c2)
 *
 * Phase 9+ (différé) :
 *   - notifyChatOpening : trigger T-2h avant session.startAt
 *   - sendDailyDigest  : daily summary partner emails
 */

export { refreshPricingCron } from './scheduler/refresh-pricing';
export { reviewReminderCron } from './scheduler/review-reminder';
export { purgeOldDataCron } from './scheduler/purge-old-data';
export { expireInvitesCron } from './scheduler/expire-invites';
export { sessionRemindersCron } from './scheduler/session-reminders';
export { denormActiveSanctionTrigger } from './triggers/denorm-active-sanction';
export { migrateDriveVideosTrigger } from './triggers/migrate-drive-videos';
