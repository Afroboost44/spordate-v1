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
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Search, Loader2, MapPin, Calendar } from 'lucide-react';
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
import { displayActivityTitle } from '@/lib/chat/activityInvite';
import type { Activity } from '@/types/firestore';

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
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [search, setSearch] = useState('');
  const [filterSport, setFilterSport] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');

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
            <Calendar className="h-5 w-5 text-[#D91CD2]" />
            Choisir une activité
          </DialogTitle>
          <DialogDescription className="text-white/40 text-xs">
            Sélectionne l&apos;activité à laquelle tu veux inviter.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher..."
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
                  className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterSport === '' ? 'bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2]' : 'bg-white/5 border-white/10 text-white/50'}`}
                >Tous sports</button>
                {sportOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilterSport(s)}
                    className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterSport === s ? 'bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2]' : 'bg-white/5 border-white/10 text-white/50'}`}
                  >{s}</button>
                ))}
              </div>
            )}
            {cityOptions.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setFilterCity('')}
                  className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterCity === '' ? 'bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2]' : 'bg-white/5 border-white/10 text-white/50'}`}
                >Toutes villes</button>
                {cityOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilterCity(c)}
                    className={`flex-shrink-0 text-[10px] px-2 py-1 rounded-full border transition ${filterCity === c ? 'bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2]' : 'bg-white/5 border-white/10 text-white/50'}`}
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
              <Loader2 className="h-6 w-6 text-[#D91CD2] animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-white/30 text-sm">Aucune activité trouvée.</p>
          ) : (
            filtered.map((a) => {
              const imageUrl = a.images?.[0] || (a.mediaUrls?.find((m) => m.type === 'image')?.url ?? '');
              return (
                <button
                  key={a.activityId}
                  type="button"
                  onClick={() =>
                    onSelect({
                      activityId: a.activityId,
                      // BUG #38 : fallback chain user-meaningful via displayActivityTitle
                      activityTitle: displayActivityTitle({ title: a.title, sport: a.sport, city: a.city }),
                      activityCity: a.city || undefined,
                      activitySport: a.sport || undefined,
                      activityImageUrl: imageUrl || undefined,
                    })
                  }
                  className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:border-[#D91CD2]/40 hover:bg-[#D91CD2]/5 transition active:scale-[0.98]"
                >
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveMediaImageSrc(imageUrl)}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#D91CD2] to-[#E91E63] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {a.title?.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      {displayActivityTitle({ title: a.title, sport: a.sport, city: a.city })}
                    </p>
                    <p className="text-[11px] text-white/40 truncate flex items-center gap-1">
                      {a.sport && <span>{a.sport}</span>}
                      {a.city && (
                        <>
                          {a.sport && <span>·</span>}
                          <MapPin className="h-3 w-3" />
                          {a.city}
                        </>
                      )}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
