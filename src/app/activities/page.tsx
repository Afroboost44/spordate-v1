"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, ChevronLeft, ChevronRight, Play, Video, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from "firebase/firestore";
import { useAuth } from '@/context/AuthContext';
import BackButton from '@/components/BackButton';
import { CheckCircle } from 'lucide-react';
import { getMediaItems } from '@/lib/activities/media';
import { getVideoThumbnailChain, getVideoEmbedUrl } from '@/lib/activities/mediaParser';
import type { MediaItem } from '@/types/firestore';
import { ReserveButtonListing } from '@/components/activities/ReserveButtonListing';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
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
  // BUG #26 bis + #28 — Drive force fallback thumbnail : l'embed iframe
  // /preview est CSP-blocked (frame-ancestors) → iframe en chrome-error://
  // chromewebdata/ qui intercepte touch events embla → swipe mobile bloqué.
  // CardVideoFallbackThumb rend la thumbnail (drive.google.com/thumbnail).
  // L'autre non-embeddable (provider unknown) garde le même fallback.
  if (!embedUrl || item.provider === 'drive') {
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

function ActivityCardComponent({
  activity,
  existingBookingId,
  nextSessionId,
}: {
  activity: ActivityCard;
  /** Phase 9.5 c16 BUG F — bookingId du user pour cette activity (si réservée < 24h). */
  existingBookingId?: string;
  /** Phase 9.5 c30 BUG GG — sessionId de la prochaine séance future, forward au
   *  ReserveButtonListing pour route vers /sessions/{id} au lieu de /activities/{id}. */
  nextSessionId?: string;
}) {
  const router = useRouter();
  // BUG #23 — mini-carousel via shadcn Carousel (embla). setApi pour sync dots +
  // arrows custom. Embla gère le swipe touch natif sans handler manuel + il
  // distingue tap (=click bubble → Link nav) vs drag (=scroll, pas de click).
  const [api, setApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);
  const detailHref = `/activities/${activity.activityId}`;
  const goToDetail = () => router.push(detailHref);
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

  // Sync currentSlide with embla API (pour highlight le dot actif).
  useEffect(() => {
    if (!api) return;
    setCurrentSlide(api.selectedScrollSnap());
    const onSelect = () => setCurrentSlide(api.selectedScrollSnap());
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  return (
    <Card
      // BUG #20 — id pour hash scroll auto depuis /activities#activity-{id}
      // (modal "Où pratiquer ?" redirige ici, browser scroll-into-view natif).
      id={`activity-${activity.activityId}`}
      className={`overflow-hidden bg-card transition-all duration-300 transform hover:-translate-y-2 scroll-mt-24 ${
        existingBookingId
          ? 'border-[#D91CD2]/60 shadow-lg shadow-[#D91CD2]/20'
          : 'border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20'
      }`}
    >
      {/* BUG #21 — image cliquable vers /activities/[id]
          BUG #26 — onClick div role=link au lieu de <Link> (<a> tag) :
          le tag <a> a un comportement natif touch sur mobile (iOS long-press
          preview, Chrome link drag) qui interfère avec embla swipe. Un div
          n'a aucun comportement natif sur touch → embla peut capturer
          librement les pointer events. Tap court (sans drag) → onClick →
          router.push. Drag (embla intercepte) → no click → swipe slide.
          Accessibilité : role=link + tabIndex=0 + onKeyDown Enter/Space. */}
      <div
        role="link"
        tabIndex={0}
        aria-label={`Voir le détail de ${activity.title}`}
        onClick={goToDetail}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            goToDetail();
          }
        }}
        className="block hover:opacity-95 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2]/40"
      >
        <div className="relative h-56 w-full group" style={{ touchAction: 'pan-y' }}>
          <BackButton fallbackUrl="/" />
          {/* BUG #23 — shadcn Carousel (embla) : swipe touch natif mobile + drag
              desktop. Embla distingue tap (click bubble vers Link parent → nav
              vers /activities/[id], fix #21) vs drag (scroll horizontal, no
              click) → préserve les deux comportements naturellement. */}
          <Carousel
            setApi={setApi}
            opts={{ align: 'start', loop: false, watchDrag: hasMultiple }}
            className="absolute inset-0"
          >
            <CarouselContent className="ml-0 h-full">
              {items.map((item, i) => (
                <CarouselItem key={i} className="pl-0 basis-full h-56">
                  <CardMediaSlide item={item} fallbackSeed={activity.sport} />
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
            {activity.duration || 60} min
          </div>
          {/* Phase 9.5 c16 BUG F — badge "Déjà réservée" si user a un booking actif */}
          {existingBookingId && (
            <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 bg-[#D91CD2] text-white text-xs px-3 py-1 rounded-full font-medium shadow-lg">
              <CheckCircle className="h-3.5 w-3.5" />
              Déjà réservée
            </div>
          )}
          {hasMultiple && (
            <>
              {/* Arrows custom (vs CarouselPrevious/Next) pour préserver style
                  opacity-0 group-hover existant + position. stopPropagation
                  empêche le click du Link parent (fix #21). */}
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); api?.scrollPrev(); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label="Image précédente"
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); api?.scrollNext(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label="Image suivante"
                type="button"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                {items.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); api?.scrollTo(i); }}
                    aria-label={`Aller à l'image ${i + 1}`}
                    type="button"
                    className={`w-1.5 h-1.5 rounded-full transition-all ${i === currentSlide ? 'bg-white w-3' : 'bg-white/50'}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <CardContent className="p-5">
        {/* Titre cliquable aussi vers /activities/[id] (BUG #21, séparé du Link
            wrapping media pour éviter nested-link avec Reserve bouton ci-dessous). */}
        <Link
          href={`/activities/${activity.activityId}`}
          className="inline-block hover:opacity-90 transition"
        >
          <h3 className="text-lg font-bold mb-1">{activity.title}</h3>
        </Link>
        {activity.description && (
          <p className="text-foreground/50 text-sm mb-2 line-clamp-2">{activity.description}</p>
        )}
        {/* Phase 9.5 c33 BUG#1 — affichage simplifié : uniquement scheduledAt (le champ
            schedule texte libre est obsolète, retiré du formulaire partner). Backward-
            compat : si Activity legacy a schedule mais pas scheduledAt, on affiche
            "Date à venir" plutôt que le texte schedule non structuré. */}
        <p className="text-xs text-[#D91CD2] mb-4 font-medium">
          {activity.scheduledAt
            ? `Prochaine séance : ${formatScheduledLabel(activity)}`
            : 'Date à venir'}
        </p>
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
            {existingBookingId ? (
              /* Phase 9.5 c16 BUG F — lien direct vers réservation existante (skip flow réservation) */
              <Button
                asChild
                className="bg-[#D91CD2] hover:bg-[#D91CD2]/90 text-white text-sm font-semibold px-4"
              >
                <Link href={`/sessions/${existingBookingId}?status=success`}>
                  Voir ma réservation →
                </Link>
              </Button>
            ) : (
              <ReserveButtonListing
                activity={{
                  activityId: activity.activityId,
                  title: activity.title,
                  price: activity.price,
                  // Phase 9.5 c42 — passe scheduledAt pour aligner le gate du
                  // bouton avec le texte "Prochaine séance" affiché. Si défini
                  // et futur, le bouton est activé même sans nextSessionId.
                  scheduledAt: activity.scheduledAt,
                }}
                nextSessionId={nextSessionId}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityCard[]>([]);
  // Phase 9.5 c30 BUG GG — Map activityId → sessionId de la prochaine séance future.
  // Permet à ReserveButtonListing (paid flow) de router vers /sessions/{nextSessionId}
  // au lieu de /activities/{activityId} (page sans countdown ni tabs prix).
  const [nextSessionByActivity, setNextSessionByActivity] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Phase 9.5 c16 BUG F — map activityId → bookingId pour les bookings actifs (< 24h) du user.
  // Single-query batch au mount (limit 50, ordered DESC) pour éviter N×M queries.
  const { user } = useAuth();
  const [activeBookings, setActiveBookings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) {
      setActiveBookings({});
      return;
    }
    const fbDb = db;
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    (async () => {
      try {
        const q = query(
          collection(fbDb, 'bookings'),
          where('userId', '==', user.uid),
          where('createdAt', '>=', Timestamp.fromMillis(cutoffMs)),
          orderBy('createdAt', 'desc'),
          limit(50),
        );
        const snap = await getDocs(q);
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as { activityId?: string };
          if (data.activityId && !map[data.activityId]) {
            map[data.activityId] = d.id;
          }
        });
        setActiveBookings(map);
      } catch (err) {
        // Fallback gracieux : si index pas prêt OU permission denied, ignore (pas de marquage UI)
        console.warn('[Activities] active bookings fetch failed (silent):', err);
        setActiveBookings({});
      }
    })();
  }, [user]);

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

        // Phase 9.5 c30 BUG GG — charge les sessions futures pour mapper
        // activityId → nextSessionId. Une seule query ordonnée par startAt asc :
        // la première occurrence de chaque activityId est la séance la plus proche.
        try {
          const sessionsQ = query(
            collection(db, 'sessions'),
            where('startAt', '>', Timestamp.now()),
            orderBy('startAt', 'asc'),
            limit(200),
          );
          const sessionsSnap = await getDocs(sessionsQ);
          const map: Record<string, string> = {};
          sessionsSnap.docs.forEach((sd) => {
            const sdata = sd.data();
            const aid = sdata?.activityId as string | undefined;
            if (aid && !map[aid]) {
              map[aid] = sd.id;
            }
          });
          setNextSessionByActivity(map);
        } catch (sessErr) {
          console.warn('[Activities] nextSession load failed:', sessErr);
          // Non-bloquant : sans la map, le bouton sera désactivé "Pas de session
          // planifiée" pour les activités payantes — comportement correct.
        }
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
                    <ActivityCardComponent
                      key={activity.activityId}
                      activity={activity}
                      existingBookingId={activeBookings[activity.activityId]}
                      nextSessionId={nextSessionByActivity[activity.activityId]}
                    />
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
