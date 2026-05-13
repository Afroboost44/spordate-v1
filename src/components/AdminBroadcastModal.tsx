/**
 * Phase 9.5 c52 BUG 3 — Modal popup fullscreen obligatoire pour les notifications
 * type='admin-broadcast' envoyées par /admin/manage Notifs.
 *
 * Comportement :
 *  - Realtime listener Firestore : notifications where userId=user.uid
 *    AND type='admin-broadcast' AND isRead=false (limit 1, orderBy createdAt desc)
 *  - Si une notif unread est trouvée → Dialog fullscreen affiché
 *  - Click "OK compris" → PATCH /api/notifications/{id} action=mark-read
 *  - Dialog fermé + listener pickup le isRead=true → cache jusqu'au prochain broadcast
 *
 * Monté globalement dans layout.tsx (root) → couvre toutes les pages
 * sauf /admin/* (l'admin n'a pas besoin de voir ses propres broadcasts).
 *
 * Charte stricte : Dialog black bg, accent #D91CD2, full visibility forced.
 */

'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { Megaphone, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import type { Notification } from '@/types/firestore';

export default function AdminBroadcastModal() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [activeNotif, setActiveNotif] = useState<Notification | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Skip sur /admin/* (l'admin n'a pas besoin de voir ses propres broadcasts)
  const isAdminPage = pathname?.startsWith('/admin');

  useEffect(() => {
    if (!user?.uid || !db || isAdminPage) {
      setActiveNotif(null);
      return;
    }
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('type', '==', 'admin-broadcast'),
      where('isRead', '==', false),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        let next: Notification | null = null;
        snap.forEach((d) => {
          const data = d.data() as Notification;
          if (data.dismissedAt) return; // soft-delete → skip
          if (!next) next = data;
        });
        setActiveNotif(next);
      },
      (err) => {
        console.warn('[AdminBroadcastModal] listener error', err);
      },
    );
    return () => unsub();
  }, [user?.uid, isAdminPage]);

  const handleAck = async () => {
    if (!user || !activeNotif || submitting) return;
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/notifications/${activeNotif.notificationId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'mark-read' }),
      });
      if (!res.ok) {
        console.warn('[AdminBroadcastModal] mark-read non-OK', res.status);
      }
      // Optimistic close — le snapshot listener confirmera l'isRead=true
      setActiveNotif(null);
    } catch (err) {
      console.warn('[AdminBroadcastModal] ack failed (silent)', err);
      setActiveNotif(null); // close même si fail, user a vu le message
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeNotif) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) handleAck(); }}>
      <DialogContent
        className="bg-black border border-[#D91CD2]/40 text-white max-w-md p-0 overflow-hidden"
        // Empêche fermeture par Escape ou click outside — broadcast obligatoire
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="bg-gradient-to-b from-[#D91CD2]/30 to-transparent p-6 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D91CD2] to-[#E91E63] flex items-center justify-center">
              <Megaphone className="h-5 w-5 text-white" />
            </div>
            <span className="text-xs uppercase tracking-[0.18em] text-[#D91CD2] font-semibold">
              Annonce Spordateur
            </span>
          </div>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white leading-tight">
              {activeNotif.title}
            </DialogTitle>
            {activeNotif.body && (
              <DialogDescription className="text-white/80 text-sm leading-relaxed pt-2 whitespace-pre-line">
                {activeNotif.body}
              </DialogDescription>
            )}
          </DialogHeader>
        </div>
        <DialogFooter className="p-6 pt-2">
          <Button
            onClick={handleAck}
            disabled={submitting}
            className="w-full h-12 bg-gradient-to-br from-[#D91CD2] to-[#E91E63] text-white font-semibold disabled:opacity-70"
          >
            {submitting ? 'Validation…' : 'OK, compris'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
