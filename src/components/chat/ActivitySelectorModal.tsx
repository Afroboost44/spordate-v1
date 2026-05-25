/**
 * BUG #36 COMMIT 2 — Modal selection activité pour invite.
 *
 * Liste les activités actives avec filtres sport/ville + search. Click card
 * → onSelect callback. Caller (chat page) enchaîne vers InviteModeModal.
 *
 * @module
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Search, Loader2, MapPin, Calendar, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { db } from '@/lib/firebase';
import { resolveMediaImageSrc } from '@/lib/activities/media';
// Fix #153 — getActivityThumbnail = helper unique (chaîne thumbnailUrl →
// mediaItems image → video thumb → imageUrl legacy). Remplace la chaîne
// copiée-collée incomplète qui manquait thumbnailUrl + imageUrl.
import { getActivityThumbnail } from '@/lib/activities/getActivityThumbnail';
import { displayActivityTitle } from '@/lib/chat/activityInvite';
import { getNextFutureSessionForActivity } from '@/services/firestore';
import { getBookingPriceCHF } from '@/lib/booking/price';
import { useLanguage } from '@/context/LanguageContext';
import type { Activity, Session } from '@/types/firestore';

export interface ActivitySelectorPick {
  activityId: string;
  activityTitle: string;
  activityCity?: string;
  activitySport?: string;
  activityImageUrl?: string;
}

interface ActivitySelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (pick: ActivitySelectorPick) => void;
}

export function ActivitySelectorModal({ open, onOpenChange, onSelect }: ActivitySelectorModalProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [search, setSearch] = useState('');
  const [filterSport, setFilterSport] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  // Fix UX — prefetch sessions futures pour afficher le prix effectif sur
  // chaque card (cohérent avec Discovery Step 1 + /activities cards).
  const [sessionsByActivityId, setSessionsByActivityId] = useState<Record<string, Session>>({});

  useEffect(() => {
    if (!open || !db) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const fbDb = db;
        const q = query(
          collection(fbDb, 'activities'),
          where('isActive', '==', true),
          limit(50),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const items: Activity[] = snap.docs.map((d) => ({ ...(d.data() as Activity), activityId: d.id }));
        setActivities(items);

        // Prefetch sessions in parallel — non-bloquant pour l'affichage de la liste.
        Promise.all(
          items.map((a) =>
            getNextFutureSessionForActivity(a.activityId)
              .then((s) => ({ id: a.activityId, session: s }))
              .catch(() => ({ id: a.activityId, session: null })),
          ),
        ).then((results) => {
          if (cancelled) return;
          setSessionsByActivityId((prev) => {
            const next = { ...prev };
            results.forEach((r) => {
              if (r.session) next[r.id] = r.session;
            });
            return next;
          });
        });
      } catch (err) {
        console.warn('[ActivitySelectorModal] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleDiscover = (activityId: string) => {
    onOpenChange(false);
    router.push(`/activities/${activityId}?fromInvite=chat`);
  };

  // Reset filters quand modal se ferme
  useEffect(() => {
    if (!open) {
      setSearch('');
      setFilterSport('');
      setFilterCity('');
    }
  }, [open]);

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) if (a.sport) set.add(a.sport);
    return Array.from(set).sort();
  }, [activities]);

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) if (a.city) set.add(a.city);
    return Array.from(set).sort();
  }, [activities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (filterSport && a.sport !== filterSport) return false;
      if (filterCity && a.city !== filterCity) return false;
      if (q && !(a.title?.toLowerCase().includes(q) || a.sport?.toLowerCase().includes(q) || a.city?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activities, filterSport, filterCity, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Calendar className="h-5 w-5 text-accent" />
            {t('activity_selector_title')}
          </DialogTitle>
          <DialogDescription className="text-white/40 text-xs">
            {t('activity_selector_description')}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('activity_selector_search_placeholder')}
            className="pl-9 bg-zinc-900 border-white/10 text-white text-sm"
          />
        </div>

        {/* Filters sport + ville */}
        {(sportOptions.length > 0 || cityOptions.length > 0) && (
          <div className="space-y-2 mt-2">
            {sportOptions.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setFilterSport('')}
                  className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterSport === '' ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/50'}`}
                >{t('activity_selector_all_sports')}</button>
                {sportOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilterSport(s)}
                    className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterSport === s ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/50'}`}
                  >{s}</button>
                ))}
              </div>
            )}
            {cityOptions.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setFilterCity('')}
                  className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterCity === '' ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/50'}`}
                >{t('activity_selector_all_cities')}</button>
                {cityOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilterCity(c)}
                    className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterCity === c ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/50'}`}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Liste activités */}
        <div className="mt-3 space-y-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-white/30 text-sm">{t('activity_selector_no_results')}</p>
          ) : (
            filtered.map((a) => {
              // Fix #153 — Une seule source de vérité : helper getActivityThumbnail
              // (chaîne complète : thumbnailUrl explicite → images[0] legacy →
              // mediaItems image → video thumbnail → imageUrl legacy si image-like).
              // Plus de copie-coller de chain entre composants. Plus de "thumbnailUrl
              // qui revient à zéro à chaque refactor".
              //
              // Fix #203 + CLAUDE.md §11 — RÈGLE DURE : on passe TOUJOURS l'activité
              // COMPLÈTE au helper. JAMAIS de cherry-pick { thumbnailUrl, mediaItems...}.
              // Le helper scan TOUS les champs (mediaItems, mediaUrls, images, imageUrl,
              // thumbnailUrl, posterUrl, coverImage, scan exhaustif champs string).
              // Cherry-pick = bug récurrent — la miniature qui marche partout sauf ici.
              const imageUrl = getActivityThumbnail(a) || '';
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const aName = (a as any).name as string | undefined;
              const cardTitle = displayActivityTitle({ title: a.title, name: aName, sport: a.sport, city: a.city });
              // cardTitle uses the helper chain : title → name → sport·city → sport → 'Activité'
              const effectivePriceCHF = getBookingPriceCHF({
                session: sessionsByActivityId[a.activityId] ?? null,
                activity: { price: a.price },
                now: new Date(),
                isDuo: false,
              });
              const pick = () =>
                onSelect({
                  activityId: a.activityId,
                  // BUG #38 : fallback chain user-meaningful via displayActivityTitle
                  activityTitle: cardTitle,
                  activityCity: a.city || undefined,
                  activitySport: a.sport || undefined,
                  activityImageUrl: imageUrl || undefined,
                });
              return (
                <div
                  key={a.activityId}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:border-accent/40 hover:bg-accent/5 transition"
                >
                  <button
                    type="button"
                    onClick={pick}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left active:scale-[0.99] transition"
                    aria-label={t('activity_selector_aria_select', { title: cardTitle })}
                  >
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveMediaImageSrc(imageUrl)}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {cardTitle.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{cardTitle}</p>
                      <p className="text-[11px] text-white/40 truncate flex items-center gap-1">
                        {a.sport && <span>{a.sport}</span>}
                        {a.city && (
                          <>
                            {a.sport && <span>·</span>}
                            <MapPin className="h-3 w-3" />
                            {a.city}
                          </>
                        )}
                        <span className="ml-auto text-accent font-medium">
                          {effectivePriceCHF === 0 ? t('activity_selector_free') : `${effectivePriceCHF} CHF`}
                        </span>
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDiscover(a.activityId)}
                    className="flex-shrink-0 h-9 px-2.5 rounded-lg text-[11px] text-white/60 hover:text-white hover:bg-white/5 flex items-center gap-1 transition"
                    aria-label={t('activity_selector_aria_discover', { title: cardTitle })}
                  >
                    <Info className="h-3.5 w-3.5" />
                    {t('activity_selector_discover')}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
