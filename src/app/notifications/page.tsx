/**
 * Phase 9 sub-chantier 3 commit 4/5 — Page notifications réelle (Firestore-backed).
 *
 * Phase 1 mock supprimé — wire le composant <NotificationsList /> qui consomme
 * /notifications via realtime onSnapshot + helpers markRead.ts via /api/notifications.
 */

import { NotificationsList } from '@/components/notifications/NotificationsList';

export default function NotificationsPage() {
  return <NotificationsList />;
}
