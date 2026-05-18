/**
 * Phase 9 sub-chantier 3 commit 4/5 — Badge counter notifications unread (header).
 *
 * Client component avec realtime listener Firestore :
 *   query /notifications where userId=uid AND isRead==false → live count
 *
 * Affichage :
 *   - count === 0 → Bell sans badge
 *   - count > 0 → Bell + pastille rouge "N" (max "9+")
 * Click → navigate vers /notifications.
 *
 * Note : on filtre `isRead==false` (legacy) côté query plutôt que `readAt==null`
 * pour rester compat avec les notifs créées avant Phase 9 SC3 c4/5. Côté écriture,
 * markRead.ts set les deux (isRead=true ET readAt=serverTimestamp), donc le
 * comportement converge.
 *
 * Charte stricte : Bell text-foreground/70, pastille bg-accent text-white.
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export function NotificationBadge() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.uid || !db) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('isRead', '==', false),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        // Filtre dismissedAt côté client (le composé index n'a pas de dismissedAt)
        let count = 0;
        snap.forEach((d) => {
          const data = d.data();
          if (!data.dismissedAt) count++;
        });
        setUnreadCount(count);
      },
      (err) => {
        console.warn('[NotificationBadge] onSnapshot error:', err);
      },
    );
    return () => unsub();
  }, [user?.uid]);

  const display = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <Button variant="ghost" size="icon" asChild>
      <Link href="/notifications">
        <div className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
              {display}
            </span>
          )}
        </div>
        <span className="sr-only">
          Notifications{unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}
        </span>
      </Link>
    </Button>
  );
}
