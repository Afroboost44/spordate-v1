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
import { useLanguage } from '@/context/LanguageContext';
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
import { CoInscribedWarning } from '@/components/partner/CoInscribedWarning';
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

function formatGraceLeft(graceEndMs: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const remainingMs = graceEndMs - Date.now();
  if (remainingMs <= 0) return t('partner_checkin_grace_now');
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return t('partner_checkin_grace_in_min', { minutes });
}

function PartnerCheckInContent() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

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
          title: t('partner_checkin_toast_session_not_found'),
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
        toast({ title: t('partner_checkin_toast_activity_not_found'), variant: 'destructive' });
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
        title: t('partner_checkin_error'),
        description: t('partner_checkin_load_error_desc'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [user?.uid, sessionId, toast, t]);

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
          title: t('partner_checkin_toast_marked_title'),
          description: t('partner_checkin_toast_marked_desc'),
        });
        await loadCheckInData();
      } catch (err) {
        let title = t('partner_checkin_error');
        let description = err instanceof Error ? err.message : t('partner_checkin_mark_failed');
        if (err instanceof ReportError) {
          switch (err.code) {
            case 'grace-period-active':
              title = t('partner_checkin_err_grace_title');
              description = t('partner_checkin_err_grace_desc');
              break;
            case 'duplicate-no-show':
              title = t('partner_checkin_err_dup_title');
              description = t('partner_checkin_err_dup_desc');
              break;
            case 'not-confirmed-booker':
              title = t('partner_checkin_err_notconf_title');
              description = t('partner_checkin_err_notconf_desc');
              break;
            case 'not-partner':
              title = t('partner_checkin_err_notpartner_title');
              description = t('partner_checkin_err_notpartner_desc');
              break;
            default:
              description = `Code : ${err.code}`;
          }
        }
        toast({ title, description, variant: 'destructive' });
      }
    },
    [user?.uid, sessionId, toast, loadCheckInData, t],
  );

  const handleCancelNoShow = useCallback(
    async (reportId: string) => {
      if (!user?.uid) return;
      try {
        await cancelNoShowService({ partnerId: user.uid, reportId });
        toast({
          title: t('partner_checkin_toast_canceled_title'),
          description: t('partner_checkin_toast_canceled_desc'),
        });
        await loadCheckInData();
      } catch (err) {
        let title = t('partner_checkin_error');
        let description = err instanceof Error ? err.message : t('partner_checkin_cancel_failed');
        if (err instanceof ReportError) {
          switch (err.code) {
            case 'cancel-window-closed':
              title = t('partner_checkin_err_window_title');
              description = t('partner_checkin_err_window_desc');
              break;
            default:
              description = `Code : ${err.code}`;
          }
        }
        toast({ title, description, variant: 'destructive' });
      }
    },
    [user?.uid, toast, loadCheckInData, t],
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
        <p className="text-white/70 font-light text-lg">{t('partner_checkin_access_denied')}</p>
        <p className="text-white/50 font-light text-sm text-center max-w-sm">
          {t('partner_checkin_not_partner_desc')}
        </p>
        <Button
          variant="ghost"
          onClick={() => router.push('/partner/dashboard')}
          className="text-white/70"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> {t('partner_checkin_back_dashboard')}
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
          className="h-8 w-8 text-gray-400 hover:text-accent"
          onClick={() => router.push('/partner/dashboard')}
          aria-label={t('partner_checkin_back_dashboard')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-white font-light text-lg flex-1 truncate">{t('partner_checkin_header_title')}</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40 font-light mb-1">
            {t('partner_checkin_session_label')}
          </p>
          <p className="text-base text-white font-light">{activity.title || t('partner_checkin_session_fallback')}</p>
          <p className="text-xs text-white/50 font-light">{formatSessionDate(session)}</p>
        </div>

        {/* Phase 7 sub-chantier 4 commit 3/4 — warning co-inscrits bloqués sur cette session */}
        {user?.uid && (
          <div className="mb-4">
            <CoInscribedWarning partnerId={user.uid} sessionFilter={sessionId} />
          </div>
        )}

        {inGrace ? (
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center">
            <p className="text-sm text-white font-light mb-1">{t('partner_checkin_grace_title')}</p>
            <p className="text-xs text-white/50 font-light">
              {t('partner_checkin_grace_desc', { when: formatGraceLeft(graceEndMs, t), minutes: NO_SHOW_GRACE_MINUTES })}
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
