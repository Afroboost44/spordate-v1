"use client";

/**
 * Fix B B1 — Page liste sessions futures du partenaire.
 *
 * Affiche les sessions à venir groupées par activité. Pour chaque session :
 *  - date / heure
 *  - prix effectif via getBookingPriceCHF (= computePricingTier(session))
 *  - badge "OFFERT" si price === 0
 *  - bouton "Modifier le prix" (stub B1 → toast ; B2 : ouvre SessionPricingModal)
 *
 * Sessions passées : non affichées dans MVP (Bassi : "Sessions passées grisées
 * + lecture seule" → reportée si user demande).
 *
 * @module
 */

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  limit,
} from 'firebase/firestore';
import { Calendar, Loader2, Gift, Edit3, ArrowLeft, Lock, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { getBookingPriceCHF } from '@/lib/booking/price';
import { groupSessionsByActivity } from '@/lib/partner/sessionsList';
import type { Activity, Session } from '@/types/firestore';

interface ActivityLite {
  activityId: string;
  title: string;
  price: number;
  defaultPricingTiers?: Activity['defaultPricingTiers'];
}

export default function PartnerSessionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [activitiesById, setActivitiesById] = useState<Map<string, ActivityLite>>(new Map());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const fbDb = db!;
        // 1. Activities du partenaire
        const actQ = query(collection(fbDb, 'activities'), where('partnerId', '==', user.uid));
        const actSnap = await getDocs(actQ);
        if (cancelled) return;
        const actMap = new Map<string, ActivityLite>();
        actSnap.docs.forEach((d) => {
          const data = d.data() as Activity;
          actMap.set(d.id, {
            activityId: d.id,
            title: data.title ?? '',
            price: typeof data.price === 'number' ? data.price : 0,
            defaultPricingTiers: data.defaultPricingTiers,
          });
        });
        setActivitiesById(actMap);

        // 2. Sessions futures par activité (parallèle).
        const nowTs = Timestamp.now();
        const allSessions: Session[] = [];
        await Promise.all(
          Array.from(actMap.keys()).map(async (activityId) => {
            try {
              const sessQ = query(
                collection(fbDb, 'sessions'),
                where('activityId', '==', activityId),
                where('startAt', '>', nowTs),
                orderBy('startAt', 'asc'),
                limit(50),
              );
              const sessSnap = await getDocs(sessQ);
              sessSnap.docs.forEach((d) => allSessions.push({ ...(d.data() as Session), sessionId: d.id }));
            } catch (err) {
              console.warn('[PartnerSessions] sessions query failed for', activityId, err);
            }
          }),
        );
        if (cancelled) return;
        setSessions(allSessions);
      } catch (err) {
        console.warn('[PartnerSessions] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const groups = useMemo(() => groupSessionsByActivity(sessions), [sessions]);

  const handleEditPrice = () => {
    toast({
      title: 'Édition du prix bientôt disponible',
      description: 'La modal d\'édition arrive dans le prochain déploiement.',
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-light tracking-tight">Mes sessions futures</h1>
          <p className="text-sm text-white/40 mt-1 font-light">
            Pilote le prix de chaque session individuellement. Override possible tant qu&apos;aucune
            réservation n&apos;a encore été prise.
          </p>
        </div>
        <Button asChild variant="ghost" className="text-white/50 hover:text-white">
          <Link href="/partner/offers">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour aux offres
          </Link>
        </Button>
      </div>

      {/* Empty state */}
      {groups.size === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <Calendar className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/60 font-light">Aucune session future programmée.</p>
          <p className="text-xs text-white/30 font-light mt-2">
            Crée une session depuis{' '}
            <Link href="/partner/offers" className="text-[#D91CD2] hover:underline">
              /partner/offers
            </Link>{' '}
            (ajoute une date à ton activité).
          </p>
        </div>
      )}

      {/* Groups */}
      <div className="space-y-6">
        {Array.from(groups.entries()).map(([activityId, sess]) => {
          const activity = activitiesById.get(activityId);
          if (!activity) return null;
          return (
            <div key={activityId} className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#D91CD2]/15 flex items-center justify-center flex-shrink-0">
                  <Building className="h-4 w-4 text-[#D91CD2]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{activity.title || 'Activité'}</p>
                  <p className="text-[11px] text-white/40 font-light">
                    Prix par défaut : <span className="text-white/60">{activity.price} CHF</span>
                    {' '}· {sess.length} session{sess.length > 1 ? 's' : ''} à venir
                  </p>
                </div>
              </div>
              <div className="divide-y divide-white/5">
                {sess.map((s) => {
                  const effectivePriceCHF = getBookingPriceCHF({
                    session: s,
                    activity: { price: activity.price } as Activity,
                    now,
                    isDuo: false,
                  });
                  const isFree = effectivePriceCHF === 0;
                  const isFrozen = (s.currentParticipants ?? 0) > 0;
                  const startDate = s.startAt && typeof s.startAt.toDate === 'function' ? s.startAt.toDate() : null;
                  return (
                    <div key={s.sessionId} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Calendar className="h-4 w-4 text-white/30 flex-shrink-0" />
                          <span className="text-sm text-white/80 font-light">
                            {startDate
                              ? startDate.toLocaleString('fr-FR', {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </span>
                          {isFree && (
                            <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px]">
                              <Gift className="h-3 w-3 mr-1" />
                              OFFERT
                            </Badge>
                          )}
                          {!isFree && (
                            <span className="text-sm font-medium text-[#D91CD2]">{effectivePriceCHF} CHF</span>
                          )}
                          {isFrozen && (
                            <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]">
                              <Lock className="h-3 w-3 mr-1" />
                              {s.currentParticipants} réservation{s.currentParticipants > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleEditPrice}
                        disabled={isFrozen}
                        className="text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-40"
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1.5" />
                        Modifier le prix
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
