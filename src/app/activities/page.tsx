"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, ChevronLeft, ChevronRight, Play, Video, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import BackButton from '@/components/BackButton';
import { getMediaItems } from '@/lib/activities/media';
import { getVideoThumbnailChain, getVideoEmbedUrl } from '@/lib/activities/mediaParser';
import type { MediaItem } from '@/types/firestore';
import { ReserveButtonListing } from '@/components/activities/ReserveButtonListing';
import { ShareButton } from '@/components/activities/ShareButton';
import { formatScheduledLabel } from '@/lib/activities/scheduled';

interface ActivityCard {
  activityId: string;
  title: string;
  name?: string;
  description: string;
  sport: string;
  price: number;
  duration: number;
  schedule: string;
  imageUrl?: string;
  images?: string[];
  /** Phase 9.5 c5 — rich media items pour rendu unifié image+video card listing. */
  mediaUrls?: import('@/types/firestore').MediaItem[];
  city: string;
  partnerName: string;
  partnerId: string;
  /** Phase 9.5 c11 — Prochaine séance planifiée (countdown auto si défini). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduledAt?: any;
}

// Données Afroboost en dur (fallback si Firestore pas configuré ou vide)
const AFROBOOST_FALLBACK: ActivityCard[] = [
  {
    activityId: 'afroboost-1',
    title: 'Afroboost — Cours collectif',
    description: 'Danse afro & cardio intense. Énergie pure, bonne humeur garantie.',
    sport: 'Afroboost',
    price: 25,
    duration: 60,
    schedule: 'Mar 19h · Jeu 19h · Sam 10h',
    imageUrl: 'https://picsum.photos/seed/afroboost-class/800/600',
    city: 'Genève',
    partnerName: 'Afroboost Genève',
    partnerId: 'afroboost',
  },
];

/**
 * Phase 9.5 c6 — Video iframe autoplay+loop+mute toggle + IntersectionObserver perf.
 *
 * Behavior :
 *  - Mount iframe seulement quand visible viewport (threshold 0.5)
 *  - Pause via postMessage quand sort viewport (économie ressource)
 *  - Volume toggle button top-right corner (Volume2/VolumeX) avec stopPropagation
 *  - Card click → /activities/[id] reste functional (iframe pointer-events: none)
 */
/**
 * Phase 9.5 c10.A — fallback thumbnail chain pour vidéos non-embeddable
 * (Drive ou YouTube avec embed restreint). Chain hq→mq→default + placeholder
 * Video icon si toute la chain 404 (vidéos supprimées/privées).
 *
 * Pas de raw href text affiché (cosmetic regression c4 corrigée).
 */
function CardVideoFallbackThumb({ item }: { item: MediaItem }) {
  const chain = getVideoThumbnailChain(item);
  const [idx, setIdx] = useState(0);
  const exhausted = idx >= chain.length;

  return (
    <div className="absolute inset-0 w-full h-full bg-zinc-900 flex items-center justify-center">
      {!exhausted ? (
        <img
          src={chain[idx]}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <Video className="h-12 w-12 text-white/30" aria-hidden="true" />
      )}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="bg-black/50 rounded-full p-3 backdrop-blur-sm">
          <Play className="h-7 w-7 text-[#D91CD2] fill-[#D91CD2]" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function CardVideoEmbed({ item }: { item: MediaItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [muted, setMuted] = useState(true);

  // IntersectionObserver : mount iframe only when visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
          } else {
            // Pause via postMessage YouTube/Vimeo API quand sort viewport
            const iframe = iframeRef.current;
            if (iframe?.contentWindow) {
              if (item.provider === 'youtube') {
                iframe.contentWindow.postMessage(
                  '{"event":"command","func":"pauseVideo","args":""}',
                  '*',
                );
              } else if (item.provider === 'vimeo') {
                iframe.contentWindow.postMessage(
                  JSON.stringify({ method: 'pause' }),
                  '*',
                );
              }
            }
          }
        });
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.provider]);

  const embedUrl = getVideoEmbedUrl(item, { autoplay: true, muted: true, loop: true });
  // Si Drive ou autre non-embeddable → fallback thumbnail c5 + chain hq→mq→default (c10.A)
  if (!embedUrl) {
    return <CardVideoFallbackThumb item={item} />;
  }

  const handleToggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      setMuted((m) => !m);
      return;
    }
    const newMuted = !muted;
    if (item.provider === 'youtube') {
      const cmd = newMuted ? 'mute' : 'unMute';
      iframe.contentWindow.postMessage(
        `{"event":"command","func":"${cmd}","args":""}`,
        '*',
      );
    } else if (item.provider === 'vimeo') {
      iframe.contentWindow.postMessage(
        JSON.stringify({ method: 'setMuted', value: newMuted }),
        '*',
      );
    }
    setMuted(newMuted);
  };

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full bg-zinc-900">
      {isVisible && (
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title=""
          frameBorder={0}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="w-full h-full pointer-events-none"
          loading="lazy"
        />
      )}
      {/* Volume toggle — z-10 + stopPropagation pour ne pas naviguer card click */}
      <button
        type="button"
        onClick={handleToggleMute}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[#D91CD2] hover:text-white hover:bg-[#D91CD2]/80 transition-colors"
        aria-label={muted ? 'Activer le son' : 'Couper le son'}
      >
        {muted ? (
          <VolumeX className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/** Phase 9.5 c5 + c6 — render media item card preview (image OR video autoplay loop muted toggle) */
function CardMediaSlide({ item, fallbackSeed }: { item: MediaItem; fallbackSeed: string }) {
  if (item.type === 'video') {
    return <CardVideoEmbed item={item} />;
  }
  // type='image' OR fallback
  return (
    <img
      src={item.url || `https://picsum.photos/seed/${fallbackSeed}/800/600`}
      alt=""
      className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
    />
  );
}

function ActivityCardComponent({ activity }: { activity: ActivityCard }) {
  const [imgIndex, setImgIndex] = useState(0);
  // Phase 9.5 c5 — unified media items via getMediaItems (rich type — image+video).
  // Fallback : seed picsum si zéro media.
  const mediaItems = getMediaItems({
    mediaUrls: activity.mediaUrls,
    images: activity.images,
  });
  const items: MediaItem[] = mediaItems.length > 0
    ? mediaItems
    : [{
        url: activity.imageUrl || `https://picsum.photos/seed/${activity.sport}/800/600`,
        type: 'image',
        source: 'url',
      }];
  const hasMultiple = items.length > 1;

  return (
    <Card className="overflow-hidden bg-card border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20 transition-all duration-300 transform hover:-translate-y-2">
      <div className="relative h-56 w-full group">
        <BackButton fallbackUrl="/" />
        <CardMediaSlide item={items[imgIndex]} fallbackSeed={activity.sport} />
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
          {activity.duration || 60} min
        </div>
        {hasMultiple && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setImgIndex(i => i === 0 ? items.length - 1 : i - 1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setImgIndex(i => i === items.length - 1 ? 0 : i + 1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {items.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setImgIndex(i); }}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${i === imgIndex ? 'bg-white w-3' : 'bg-white/50'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <CardContent className="p-5">
        <h3 className="text-lg font-bold mb-1">{activity.title}</h3>
        {activity.description && (
          <p className="text-foreground/50 text-sm mb-2 line-clamp-2">{activity.description}</p>
        )}
        {/* Phase 9.5 c11 — date prochaine séance si scheduledAt défini, sinon fallback schedule legacy */}
        <p className="text-xs text-[#D91CD2] mb-1 font-medium">
          {activity.scheduledAt
            ? `Prochaine séance : ${formatScheduledLabel(activity)}`
            : 'Date à venir'}
        </p>
        <p className="text-xs text-foreground/30 mb-4">{activity.schedule}</p>
        <div className="flex justify-between items-center">
          <p className="text-xl font-bold text-[#D91CD2]">
            {activity.price === 0 ? 'Gratuit' : `${activity.price} CHF`}
          </p>
          <div className="flex items-center gap-2">
            {/* Phase 9.5 c10.B — Share standalone (Like + Comment viendront 10.C/10.D via SocialBar) */}
            <ShareButton
              activity={{
                activityId: activity.activityId,
                title: activity.title,
                name: activity.name,
              }}
            />
            <ReserveButtonListing
              activity={{
                activityId: activity.activityId,
                title: activity.title,
                price: activity.price,
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!db || !isFirebaseConfigured) {
        setActivities(AFROBOOST_FALLBACK);
        setLoading(false);
        return;
      }
      try {
        // Try with orderBy first, fallback without if index not ready
        let snap;
        try {
          const q = query(
            collection(db, 'activities'),
            where('isActive', '==', true),
            orderBy('createdAt', 'desc')
          );
          snap = await getDocs(q);
        } catch {
          // Index might not be ready, retry without orderBy
          console.warn('[Activities] Index not ready, fetching without orderBy');
          const q = query(
            collection(db, 'activities'),
            where('isActive', '==', true)
          );
          snap = await getDocs(q);
        }
        const data = snap.docs.map(d => {
          const raw = d.data();
          return {
            activityId: d.id,
            title: raw.title || raw.name || '',
            description: raw.description || '',
            sport: raw.sport || '',
            price: raw.price || 0,
            duration: raw.duration || 60,
            schedule: raw.schedule
              ? (Array.isArray(raw.schedule)
                  ? raw.schedule.map((s: any) => `${s.day} ${s.start}`).join(' · ')
                  : raw.schedule)
              : '',
            imageUrl: raw.images?.[0] || raw.imageUrl || '',
            images: raw.images || (raw.imageUrl ? [raw.imageUrl] : []),
            // Phase 9.5 c5 — preserve rich mediaUrls (image+video) pour rendu card unifié
            mediaUrls: raw.mediaUrls,
            city: raw.city || '',
            partnerName: raw.partnerName || '',
            partnerId: raw.partnerId || '',
            // Phase 9.5 c11 — date prochaine séance (countdown auto sur free booking)
            scheduledAt: raw.scheduledAt ?? null,
          } as ActivityCard;
        });
        setActivities(data.length > 0 ? data : AFROBOOST_FALLBACK);
      } catch (err) {
        console.error('[Activities] Error loading:', err);
        setActivities(AFROBOOST_FALLBACK);
      }
      setLoading(false);
    };
    load();
  }, []);

  // Group activities by partner
  const partnerGroups = activities.reduce((acc, act) => {
    const key = act.partnerName || 'Autre';
    if (!acc[key]) acc[key] = [];
    acc[key].push(act);
    return acc;
  }, {} as Record<string, ActivityCard[]>);

  const partnerNames = Object.keys(partnerGroups);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Generic page header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl font-headline">
          Activités
        </h1>
        <p className="mt-4 text-gray-400 md:text-xl">
          Découvre les cours proposés par nos partenaires — Réserve ta session et vis l&apos;expérience.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
        </div>
      ) : (
        <div className="space-y-16">
          {partnerNames.map((partnerName) => {
            const partnerActivities = partnerGroups[partnerName];
            const city = partnerActivities[0]?.city;

            return (
              <section key={partnerName}>
                {/* Partner header */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-white">{partnerName}</h2>
                    {city && (
                      <p className="text-sm text-white/40 flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" /> {city}
                      </p>
                    )}
                  </div>
                  <Badge className="bg-[#D91CD2]/10 text-[#D91CD2] border-[#D91CD2]/30 text-xs">
                    {partnerActivities.length} activité{partnerActivities.length > 1 ? 's' : ''}
                  </Badge>
                </div>

                {/* Activities grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {partnerActivities.map((activity) => (
                    <ActivityCardComponent key={activity.activityId} activity={activity} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-16 text-center border-t border-white/5 pt-12">
        <p className="text-white/30 text-sm max-w-lg mx-auto">
          Les réservations incluent l&apos;accès au studio et l&apos;encadrement par un coach professionnel.
          Vous êtes partenaire ? <Link href="/partner/register" className="text-[#D91CD2] hover:underline">Rejoignez le réseau Spordateur</Link>.
        </p>
      </div>
    </div>
  );
}
