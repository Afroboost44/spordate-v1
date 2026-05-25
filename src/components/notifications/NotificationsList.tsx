/**
 * Phase 9 sub-chantier 3 commit 4/5 — Liste notifications réelle (Firestore-backed).
 *
 * Remplace le mock initialNotifications de src/app/notifications/page.tsx.
 *
 * Pipeline :
 *   1. Realtime listener Firestore /notifications where userId=uid + orderBy createdAt desc
 *   2. Client-side filter dismissedAt==null (UI masque les soft-delete)
 *   3. Per notification : icon by type + title + body + relative time + bouton "X" dismiss
 *   4. Click body → navigate clickUrl si présent (data.clickUrl ou data.activityId, data.bookingId)
 *   5. Auto mark-read au mount via markAllNotificationsRead (Q5 cohérent vu sur cette page = lu)
 *   6. "Tout marquer comme lu" button explicite → markAllNotificationsRead
 *
 * Best-effort : si update API fail (offline, 403…) → toast destructive, no rollback hard
 * (le user re-load la page → state correct).
 */

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { Bell, X, Heart, CheckCircle, Clock, DollarSign, MessageSquare, Sparkles } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Notification, NotificationType } from '@/types/firestore';
import { hardDeleteNotification, NotificationError } from '@/lib/notifications/hardDelete';

function iconForType(type: NotificationType) {
  switch (type) {
    case 'payment':
      return <DollarSign className="h-6 w-6 text-green-400" />;
    case 'match':
      return <Heart className="h-6 w-6 text-rose-500 fill-rose-500" />;
    case 'booking':
      return <CheckCircle className="h-6 w-6 text-cyan-400" />;
    case 'message':
      return <MessageSquare className="h-6 w-6 text-accent" />;
    case 'promo':
      return <Sparkles className="h-6 w-6 text-yellow-400" />;
    case 'system':
    default:
      return <Clock className="h-6 w-6 text-gray-500" />;
  }
}

function relativeTime(
  ts: Timestamp | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
  language: string,
): string {
  if (!ts || typeof ts.toMillis !== 'function') return '';
  const diffMs = Date.now() - ts.toMillis();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return t('notif_relative_seconds', { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t('notif_relative_minutes', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('notif_relative_hours', { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('notif_relative_days', { n: d });
  const date = ts.toDate();
  const locale = language === 'de' ? 'de-CH' : language === 'en' ? 'en-GB' : 'fr-CH';
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
}

function clickUrlFromData(notif: Notification): string | null {
  const d = notif.data || {};
  if (d.clickUrl) return d.clickUrl;
  if (d.activityId) return `/activities/${d.activityId}`;
  if (d.bookingId) return `/sessions/${d.bookingId}`;
  if (d.matchId) return '/discovery';
  return null;
}

async function callPatch(notificationId: string, action: 'mark-read' | 'dismiss', token: string) {
  const res = await fetch(`/api/notifications/${notificationId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action }),
  });
  return res;
}

async function callMarkAllRead(token: string) {
  const res = await fetch('/api/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'mark-all-read' }),
  });
  return res;
}

export function NotificationsList() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid || !db) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Notification[] = [];
        snap.forEach((d) => {
          const data = d.data() as Notification;
          if (data.dismissedAt) return; // soft-delete hidden
          items.push(data);
        });
        setNotifications(items);
        setLoading(false);
      },
      (err) => {
        console.warn('[NotificationsList] onSnapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.uid]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.readAt && !n.isRead).length,
    [notifications],
  );

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    // Phase 9.5 c52 — optimistic UI : flag local notifs comme lues
    // immédiatement, puis fire API. Listener Firestore confirme dans le snapshot
    // suivant. Si API fail, revert + toast (rare car endpoint c52 = Admin SDK).
    const snapshotBefore = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      const token = await user.getIdToken();
      const res = await callMarkAllRead(token);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        title: t('notif_marked_read_toast_title'),
        description: t('notif_marked_read_toast_desc'),
        className: 'bg-[#1A1A1A] border-accent/40 text-white',
      });
    } catch (err) {
      console.warn('[NotificationsList] markAllRead failed:', err);
      setNotifications(snapshotBefore); // revert
      toast({
        title: t('notif_error_title'),
        description: t('notif_mark_read_failed_desc'),
        variant: 'destructive',
      });
    }
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!user) return;
    const url = clickUrlFromData(notif);
    // Best-effort mark-read avant nav
    try {
      const token = await user.getIdToken();
      await callPatch(notif.notificationId, 'mark-read', token);
    } catch (err) {
      console.warn('[NotificationsList] markRead on click failed (silent):', err);
    }
    if (url) router.push(url);
  };

  const handleDismiss = async (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    // BUG #9 — hard-delete direct via Firebase Web SDK (rules autorisent l'owner).
    // Remplace l'ancien call à /api/notifications/[id] DELETE qui dépendait de
    // FIREBASE_SERVICE_ACCOUNT_KEY + verifyIdToken Admin SDK — fragiles en prod.
    // Optimistic UI immédiat ; revert si Firestore refuse.
    if (!notif.notificationId) {
      console.warn('[NotificationsList] notif sans notificationId, skip', notif);
      return;
    }
    const snapshotBefore = notifications;
    setNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
    try {
      await hardDeleteNotification(notif.notificationId);
    } catch (err) {
      console.warn('[NotificationsList] hardDelete failed:', err);
      setNotifications(snapshotBefore); // revert
      const isPermDenied = err instanceof NotificationError && err.code === 'forbidden';
      toast({
        title: t('notif_error_title'),
        description: isPermDenied
          ? t('notif_perm_denied_desc')
          : t('notif_dismiss_failed_desc'),
        variant: 'destructive',
      });
    }
  };

  if (!user) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Bell className="mx-auto h-12 w-12 mb-4" />
        <p>{t('notif_login_required')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <h1 className="text-4xl font-bold flex items-center gap-3 font-headline">
          {t('notif_page_title')}
          {unreadCount > 0 && (
            <div className="relative">
              <Bell className="h-8 w-8 text-accent" />
              <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-white font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </div>
          )}
        </h1>
        <Button
          variant="outline"
          onClick={handleMarkAllAsRead}
          disabled={unreadCount === 0}
          className="border-accent/40 text-accent hover:bg-accent/10"
        >
          {t('notif_mark_all_read_button')}
        </Button>
      </header>

      {loading && (
        <div className="text-center py-16 text-white/40">{t('common_loading')}</div>
      )}

      {!loading && notifications.length === 0 && (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border/20 rounded-lg">
          <Bell className="mx-auto h-12 w-12 mb-4" />
          <h3 className="text-xl font-semibold">{t('notif_empty_title')}</h3>
          <p>{t('notif_empty_subtitle')}</p>
        </div>
      )}

      <div className="space-y-3">
        {notifications.map((notif) => {
          const unread = !notif.readAt && !notif.isRead;
          const url = clickUrlFromData(notif);
          return (
            <Card
              key={notif.notificationId}
              className={cn(
                'bg-card border-border/20 shadow-lg transition-all duration-300',
                url ? 'cursor-pointer hover:bg-card/80 hover:border-accent/30' : '',
                !unread && 'opacity-60 hover:opacity-100',
              )}
              onClick={() => url && handleNotificationClick(notif)}
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className="relative mt-1">
                  {iconForType(notif.type)}
                  {unread && (
                    <span className="absolute -top-1 -left-1 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-base">{notif.title}</h3>
                  <p className="text-foreground/70 text-sm">{notif.body}</p>
                  <p className="text-xs text-white/30 mt-1">
                    {relativeTime(notif.createdAt, t, language)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDismiss(notif, e)}
                  className="p-1 text-white/40 hover:text-accent transition-colors"
                  aria-label={t('notif_dismiss_aria')}
                >
                  <X className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
