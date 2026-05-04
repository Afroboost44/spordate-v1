/**
 * Phase 7 sub-chantier 3 commit 5/5 — page /partner/sessions/[sessionId]/check-in.
 *
 * UI partner mobile pour marquer no-shows post-session (doctrine §D.5).
 * Q1 décision : page dédiée (vs section dashboard) — discoverable + lien direct.
 *
 * Validation côté client :
 *  - AuthGuard (logged)
 *  - user.uid === activity.partnerId (sinon redirect /partner/dashboard)
 *
 * Logique fetch (parallèle au mount) :
 *  - session by sessionId
 *  - activity for partnerId verification
 *  - bookings confirmed sur sessionId (participants list)
 *  - reports existants source='partner_no_show' AND sessionId (pour hasNoShow flag)
 *  - users for displayName + photoURL batch
 *
 * Render :
 *  - Header titre session + date + back link /partner/dashboard
 *  - Si session.endAt + 30min > now → message "Check-in disponible {time}"
 *  - Sinon NoShowCheckInList avec onMarkNoShow + onCancelNoShow handlers
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  cancelNoShow as cancelNoShowService,
  markNoShow as markNoShowService,
  NO_SHOW_GRACE_MINUTES,
  ReportError,
} from '@/lib/reports';
import {
  NoShowCheckInList,
  type NoShowParticipant,
} from '@/components/reports/NoShowCheckInList';
import type { Activity, Booking, Report, Session, UserProfile } from '@/types/firestore';

function formatSessionDate(session: Session | null): string {
  if (!session?.startAt?.toDate) return '';
  return session.startAt.toDate().toLocaleDateString('fr-CH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatGraceLeft(graceEndMs: number): string {
  const remainingMs = graceEndMs - Date.now();
  if (remainingMs <= 0) return 'maintenant';
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return `dans ${minutes} min`;
}

function PartnerCheckInContent() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { user } = useAuth();
  const { toast } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [participants, setParticipants] = useState<NoShowParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const loadCheckInData = useCallback(async () => {
    if (!user?.uid || !sessionId || !db) return;
    setLoading(true);
    try {
      // 1. Fetch session
      const sessionSnap = await getDoc(doc(db, 'sessions', sessionId));
      if (!sessionSnap.exists()) {
        toast({
          title: 'Session introuvable',
          description: `sessionId=${sessionId}`,
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
      const sessionData = sessionSnap.data() as Session;
      setSession(sessionData);

      // 2. Fetch activity + verify partnerId
      const activitySnap = await getDoc(doc(db, 'activities', sessionData.activityId));
      if (!activitySnap.exists()) {
        toast({ title: 'Activity introuvable', variant: 'destructive' });
        setLoading(false);
        return;
      }
      const activityData = activitySnap.data() as Activity;
      setActivity(activityData);

      if (activityData.partnerId !== user.uid) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      // 3. Fetch bookings confirmed + existing partner_no_show reports en parallèle
      const [bookingsSnap, reportsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'bookings'),
            where('sessionId', '==', sessionId),
          ),
        ),
        getDocs(
          query(
            collection(db, 'reports'),
            where('sessionId', '==', sessionId),
          ),
        ),
      ]);

      const confirmedBookings = bookingsSnap.docs
        .map((d) => d.data() as Booking)
        .filter((b) => b.status === 'confirmed');

      const noShowReports = reportsSnap.docs
        .map((d) => d.data() as Report)
        .filter((r) => r.source === 'partner_no_show');

      // Batch fetch user profiles
      const uniqueUserIds = Array.from(new Set(confirmedBookings.map((b) => b.userId)));
      const userProfilesMap = new Map<string, UserProfile>();
      await Promise.all(
        uniqueUserIds.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db!, 'users', uid));
            if (snap.exists()) userProfilesMap.set(uid, snap.data() as UserProfile);
          } catch {
            // skip
          }
        }),
      );

      // Build participants list with hasNoShow flag
      const list: NoShowParticipant[] = confirmedBookings.map((b) => {
        const profile = userProfilesMap.get(b.userId);
        const noShowReport = noShowReports.find((r) => r.reportedId === b.userId);
        const noShowAgeMs = noShowReport?.createdAt?.toMillis
          ? Date.now() - noShowReport.createdAt.toMillis()
          : undefined;
        return {
          userId: b.userId,
          displayName: profile?.displayName || b.userId,
          photoURL: profile?.photoURL,
          hasNoShow: !!noShowReport,
          noShowReportId: noShowReport?.reportId,
          noShowAgeMs,
        };
      });
      setParticipants(list);
    } catch (err) {
      console.error('[PartnerCheckIn] load error', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les données check-in.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [user?.uid, sessionId, toast]);

  useEffect(() => {
    loadCheckInData();
  }, [loadCheckInData]);

  const handleMarkNoShow = useCallback(
    async (userId: string) => {
      if (!user?.uid || !sessionId) return;
      try {
        await markNoShowService({
          partnerId: user.uid,
          sessionId,
          userId,
        });
        toast({
          title: 'No-show enregistré',
          description: 'Le participant a été notifié par email.',
        });
        await loadCheckInData();
      } catch (err) {
        let title = 'Erreur';
        let description = err instanceof Error ? err.message : 'Marquage échoué';
        if (err instanceof ReportError) {
          switch (err.code) {
            case 'grace-period-active':
              title = 'Grâce active';
              description = 'Attends 30 min après la fin de la session pour marquer un no-show.';
              break;
            case 'duplicate-no-show':
              title = 'Déjà marqué';
              description = 'Ce participant est déjà marqué no-show.';
              break;
            case 'not-confirmed-booker':
              title = 'Booking non confirmé';
              description = 'Ce participant n\'a pas de booking confirmé sur cette session.';
              break;
            case 'not-partner':
              title = 'Non autorisé';
              description = 'Tu n\'es pas le partenaire de cette activity.';
              break;
            default:
              description = `Code : ${err.code}`;
          }
        }
        toast({ title, description, variant: 'destructive' });
      }
    },
    [user?.uid, sessionId, toast, loadCheckInData],
  );

  const handleCancelNoShow = useCallback(
    async (reportId: string) => {
      if (!user?.uid) return;
      try {
        await cancelNoShowService({ partnerId: user.uid, reportId });
        toast({
          title: 'No-show annulé',
          description: 'Le marquage a été retiré.',
        });
        await loadCheckInData();
      } catch (err) {
        let title = 'Erreur';
        let description = err instanceof Error ? err.message : 'Annulation échouée';
        if (err instanceof ReportError) {
          switch (err.code) {
            case 'cancel-window-closed':
              title = 'Délai dépassé';
              description = 'L\'annulation n\'est plus possible (>24h).';
              break;
            default:
              description = `Code : ${err.code}`;
          }
        }
        toast({ title, description, variant: 'destructive' });
      }
    },
    [user?.uid, toast, loadCheckInData],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-white/30 motion-safe:animate-spin" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 gap-4">
        <p className="text-white/70 font-light text-lg">Accès refusé</p>
        <p className="text-white/50 font-light text-sm text-center max-w-sm">
          Tu n&apos;es pas le partenaire de cette session.
        </p>
        <Button
          variant="ghost"
          onClick={() => router.push('/partner/dashboard')}
          className="text-white/70"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour dashboard
        </Button>
      </div>
    );
  }

  if (!session || !activity) return null;

  const sessionEndMs = session.endAt?.toMillis?.() ?? 0;
  const graceEndMs = sessionEndMs + NO_SHOW_GRACE_MINUTES * 60 * 1000;
  const inGrace = Date.now() < graceEndMs;

  return (
    <div className="min-h-screen bg-black">
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-[#D91CD2]"
          onClick={() => router.push('/partner/dashboard')}
          aria-label="Retour dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-white font-light text-lg flex-1 truncate">Check-in no-show</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40 font-light mb-1">
            Session
          </p>
          <p className="text-base text-white font-light">{activity.title || 'Session'}</p>
          <p className="text-xs text-white/50 font-light">{formatSessionDate(session)}</p>
        </div>

        {inGrace ? (
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center">
            <p className="text-sm text-white font-light mb-1">Check-in pas encore disponible</p>
            <p className="text-xs text-white/50 font-light">
              Tu pourras marquer les no-shows {formatGraceLeft(graceEndMs)} (grâce {NO_SHOW_GRACE_MINUTES} min après fin de session).
            </p>
          </div>
        ) : (
          <NoShowCheckInList
            participants={participants}
            onMarkNoShow={handleMarkNoShow}
            onCancelNoShow={handleCancelNoShow}
          />
        )}
      </div>
    </div>
  );
}

export default function PartnerCheckInPage() {
  return (
    <AuthGuard>
      <PartnerCheckInContent />
    </AuthGuard>
  );
}
