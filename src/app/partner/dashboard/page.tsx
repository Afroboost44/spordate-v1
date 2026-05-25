"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Wallet, BarChart, Loader2, Users, Bell, UserX, ChevronRight } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, where, getDocs, getDoc, doc, orderBy, limit, onSnapshot, Timestamp
} from 'firebase/firestore';
import type { Session, Activity } from '@/types/firestore';
import { CoInscribedWarning } from '@/components/partner/CoInscribedWarning';
import { PartnerDiscoveryOptInCard } from '@/components/partner/PartnerDiscoveryOptInCard';
import { useLanguage } from '@/context/LanguageContext';

interface RecentSessionForCheckIn {
  sessionId: string;
  activityId: string;
  title: string;
  endAt: Timestamp;
}

export default function PartnerDashboardPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ activities: 0, bookings: 0, revenue: 0 });
  const [recentBookings, setRecentBookings] = useState<any[]>([]);
  const [recentSessionsForCheckIn, setRecentSessionsForCheckIn] = useState<RecentSessionForCheckIn[]>([]);

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }

    const load = async () => {
      try {
        // Fix #174 — Résoudre le partnerId correctement avant de query activities.
        // 3 conventions historiques cohérentes avec /partner/wallet :
        //   1. Direct : partners/{user.uid} (legacy)
        //   2. Prefix : partners/partner-{user.uid} (convention post-#124)
        //   3. Email fallback : partners where email == user.email
        // Avant : query 'partnerId == user.uid' renvoyait toujours 0 activités si
        // le partner doc avait l'ID prefixé → dashboard montrait 0 réservations
        // alors que le wallet trouvait 1+ transactions. Maintenant on aligne.
        let resolvedPartnerId = user.uid;
        const directSnap = await getDoc(doc(db!, 'partners', user.uid));
        if (!directSnap.exists()) {
          const prefixedSnap = await getDoc(doc(db!, 'partners', `partner-${user.uid}`));
          if (prefixedSnap.exists()) {
            resolvedPartnerId = `partner-${user.uid}`;
          } else if (user.email) {
            const emailQ = query(
              collection(db!, 'partners'),
              where('email', '==', user.email),
              limit(1),
            );
            const emailSnap = await getDocs(emailQ);
            if (!emailSnap.empty) {
              resolvedPartnerId = emailSnap.docs[0].id;
            }
          }
        }

        // Count activities — utilise le partnerId résolu (peut être user.uid OU
        // partner-{uid} OU l'id retrouvé par email).
        const actQ = query(collection(db!, 'activities'), where('partnerId', '==', resolvedPartnerId));
        const actSnap = await getDocs(actQ);
        const activities = actSnap.docs.map(d => ({ ...d.data(), activityId: d.id })) as Activity[];

        // Count bookings for this partner's activities
        const actIds = actSnap.docs.map(d => d.id);
        let totalBookings = 0;
        let totalRevenue = 0;
        const bookings: any[] = [];

        if (actIds.length > 0) {
          // Firestore 'in' query supports max 30 items
          const batchIds = actIds.slice(0, 30);
          const bookQ = query(
            collection(db!, 'bookings'),
            where('activityId', 'in', batchIds),
            orderBy('createdAt', 'desc'),
            limit(10)
          );
          const bookSnap = await getDocs(bookQ);
          totalBookings = bookSnap.size;
          bookSnap.forEach(d => {
            const data = d.data();
            totalRevenue += data.amount || 0;
            bookings.push(data);
          });

          // Phase 7 sub-chantier 3 commit 5/5 : Fetch sessions terminées dernières 24h pour check-in no-show
          try {
            const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
            const partnerQ = query(
              collection(db!, 'sessions'),
              where('partnerId', '==', user.uid),
            );
            const sessSnap = await getDocs(partnerQ);
            const sessions: RecentSessionForCheckIn[] = [];
            const activityTitleMap = new Map(activities.map(a => [a.activityId, a.title || 'Session']));
            sessSnap.forEach(d => {
              const s = d.data() as Session;
              const endMs = s.endAt?.toMillis?.() ?? 0;
              if (endMs >= cutoffMs && endMs <= Date.now()) {
                sessions.push({
                  sessionId: s.sessionId,
                  activityId: s.activityId,
                  title: activityTitleMap.get(s.activityId) || 'Session',
                  endAt: s.endAt,
                });
              }
            });
            sessions.sort((a, b) => b.endAt.toMillis() - a.endAt.toMillis());
            setRecentSessionsForCheckIn(sessions);
          } catch (e) {
            console.warn('[PartnerDashboard] check-in sessions fetch failed (non-blocking)', e);
          }
        }

        setStats({
          activities: actSnap.size,
          bookings: totalBookings,
          revenue: totalRevenue,
        });
        setRecentBookings(bookings.slice(0, 5));
      } catch (err) {
        console.error('[PartnerDashboard] load error:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-light text-white tracking-tight flex items-center gap-3">
          <BarChart className="h-6 w-6 text-accent" />
          {t('partner_dashboard_title')}
        </h1>
        <p className="text-sm text-white/40 mt-1">{t('partner_dashboard_subtitle')}</p>
      </div>

      {/* Phase 7 sub-chantier 4 commit 3/4 — warning co-inscrits bloqués (doctrine §9.sexies E) */}
      {user?.uid && <CoInscribedWarning partnerId={user.uid} />}

      {/* Phase 9.5 c21 — toggle opt-in Rencontres (visible UNIQUEMENT si admin mode='participants-only') */}
      <PartnerDiscoveryOptInCard />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-white/40 uppercase tracking-wider">{t('partner_dashboard_activities_published')}</span>
            </div>
            <p className="text-3xl font-light text-white">{stats.activities}</p>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <CalendarCheck className="h-4 w-4 text-green-400" />
              <span className="text-xs text-white/40 uppercase tracking-wider">{t('partner_dashboard_bookings')}</span>
            </div>
            <p className="text-3xl font-light text-white">{stats.bookings}</p>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-4 w-4 text-accent" />
              <span className="text-xs text-white/40 uppercase tracking-wider">{t('partner_dashboard_revenue')}</span>
            </div>
            <p className="text-3xl font-light text-white">{stats.revenue.toFixed(2)} <span className="text-base text-white/40">CHF</span></p>
          </CardContent>
        </Card>
      </div>

      {/* Phase 7 sub-chantier 3 commit 5/5 — Sessions à check-in (no-show marquage) */}
      {recentSessionsForCheckIn.length > 0 && (
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-light text-white flex items-center gap-2">
              <UserX className="h-4 w-4 text-accent" />
              {t('partner_dashboard_checkin_noshow_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentSessionsForCheckIn.map((s) => (
                <Link
                  key={s.sessionId}
                  href={`/partner/sessions/${s.sessionId}/check-in`}
                  className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5 hover:border-accent/40 hover:bg-white/5 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{s.title}</p>
                    <p className="text-xs text-white/40">
                      {t('partner_dashboard_finished')} {s.endAt.toDate().toLocaleString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-white/30 shrink-0" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent bookings */}
      <Card className="bg-[#1A1A1A] border-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-light text-white flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" />
            {t('partner_dashboard_recent_bookings')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentBookings.length === 0 ? (
            <p className="text-sm text-white/30 py-4 text-center">{t('partner_dashboard_no_bookings')}</p>
          ) : (
            <div className="space-y-3">
              {recentBookings.map((b, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5">
                  <div>
                    <p className="text-sm text-white">{b.sport || t('partner_dashboard_activity')}</p>
                    <p className="text-xs text-white/30">
                      {b.ticketType === 'duo' ? t('partner_dashboard_duo') : t('partner_dashboard_solo')} · {b.userId?.substring(0, 8)}...
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-accent font-medium">{b.amount || 0} CHF</p>
                    <Badge className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">{t('partner_dashboard_confirmed')}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
