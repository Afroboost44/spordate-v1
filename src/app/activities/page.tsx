"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, ChevronLeft, ChevronRight, Play, Video, Volume2, VolumeX, Info, Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from "firebase/firestore";
import { useAuth } from '@/context/AuthContext';
import BackButton from '@/components/BackButton';
import { CheckCircle } from 'lucide-react';
import { getMediaItems } from '@/lib/activities/media';
import { getVideoThumbnailChain, getVideoEmbedUrl } from '@/lib/activities/mediaParser';
import type { MediaItem, Session } from '@/types/firestore';
import { getBookingPriceCHF } from '@/lib/booking/price';
import { ReserveButtonListing } from '@/components/activities/ReserveButtonListing';
// BUG #49 v4 — embla carousel remplacé par CSS scroll-snap natif (cf. plus bas).
import { ShareButton } from '@/components/activities/ShareButton';
import { formatScheduledLabel } from '@/lib/activities/scheduled';
import { formatImageCounter } from '@/lib/activities/imageCounter';
import { isStorageVideoUrl } from '@/lib/media/driveMigration';

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
          <Play className="h-7 w-7 text-accent fill-accent" aria-hidden="true" />
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
        className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/60 backdrop-blur-sm text-accent hover:text-white hover:bg-accent/80 transition-colors"
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

/**
 * BUG #52 v3 — Lightbox plein écran SWIPABLE (Browser Fullscreen API + scroll-snap).
 *
 * Affiche TOUS les items du carousel en horizontal scroll-snap → l'user peut
 * swiper droite/gauche en plein écran sans devoir fermer + ré-ouvrir.
 *
 * - mount : requestFullscreen() + scroll instant vers initialIndex.
 * - landscape lock si vidéo (UX YouTube/TikTok).
 * - Escape OU tap croix → ferme.
 */
function FullscreenLightbox({
  items,
  initialIndex,
  onClose,
}: {
  items: MediaItem[];
  initialIndex: number;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    const el = containerRef.current;
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => undefined);
    }
    // Scroll instant vers l'item initial (sans animation) APRÈS mount.
    requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (sc) {
        sc.scrollTo({ left: initialIndex * sc.clientWidth, behavior: 'instant' as ScrollBehavior });
      }
    });
    // Landscape lock si l'item courant est vidéo. Reset à chaque scroll.
    const lockOrientationForCurrent = (idx: number) => {
      const it = items[idx];
      if (!it) return;
      if (it.type === 'video' && screen.orientation && 'lock' in screen.orientation) {
        // @ts-expect-error — lock() existe Android Chrome
        screen.orientation.lock('landscape').catch(() => undefined);
      } else if (screen.orientation && 'unlock' in screen.orientation) {
        try { screen.orientation.unlock(); } catch { /* silent */ }
      }
    };
    lockOrientationForCurrent(initialIndex);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const onFsChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      if (screen.orientation && 'unlock' in screen.orientation) {
        try { screen.orientation.unlock(); } catch { /* silent */ }
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [onClose, items, initialIndex]);

  // Sync currentIndex depuis scrollLeft uniquement (PAS de relock orientation
  // par slide — sinon swipe video→image fait tourner l'écran de force et
  // l'expérience est désagréable). L'orientation est fixée UNE seule fois
  // au mount selon l'item initial, l'user peut tourner le tel manuellement.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx === currentIndex) return;
    setCurrentIndex(idx);
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black overflow-hidden"
      role="dialog"
      aria-label="Aperçu plein écran"
    >
      {/* X fermer déplacé top-LEFT pour ne pas cacher le bouton volume du
          CardVideoEmbed (qui est top-right). */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 left-4 z-20 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm"
        aria-label="Fermer"
      >
        <X className="h-6 w-6" />
      </button>
      {/* Counter X/N en haut */}
      {items.length > 1 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 bg-white/10 backdrop-blur-sm text-white text-sm px-3 py-1 rounded-full pointer-events-none">
          {currentIndex + 1} / {items.length}
        </div>
      )}
      {/* Scroll-snap horizontal — un slide = un viewport */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="w-full h-full flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            className="w-full h-full flex-shrink-0 snap-center flex items-center justify-center"
            style={{ scrollSnapStop: 'always' }}
          >
            {item.type === 'video' ? (
              // BUG #60 — Idem CardMediaSlide : upload partner sans extension
              // dans le path → fallback iframe inutile. <video> direct si upload.
              item.source === 'upload' || isStorageVideoUrl(item.url) ? (
                <video
                  src={item.url}
                  controls
                  autoPlay={i === currentIndex}
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full relative">
                  <CardVideoEmbed item={item} />
                </div>
              )
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt=""
                draggable={false}
                className="w-full h-full object-cover pointer-events-none select-none"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phase 9.5 c5 + c6 — render media item card preview (image OR video autoplay loop muted toggle) */
function CardMediaSlide({ item, fallbackSeed }: { item: MediaItem; fallbackSeed: string }) {
  if (item.type === 'video') {
    // BUG #30 étape 3 — Vidéo migrée Drive→Storage : HTML5 <video> natif sans
    // controls (preview muted loop comme YouTube/Vimeo CardVideoEmbed) pour
    // garder le pattern "hover preview" sur les cards LISTE.
    //
    // BUG #60 — Régression "play icon sans preview" sur card listing après
    // upload partner. Avant : on s'appuyait uniquement sur isStorageVideoUrl
    // (extension `.mp4`/.webm/.mov dans le path). Si le fichier original n'a
    // pas d'extension (ou qu'elle disparaît au slugify), `<video>` n'était
    // jamais rendu et on fallback sur CardVideoFallbackThumb (icône play seule).
    // Fix : tout MediaItem `source==='upload'` ou URL Storage → <video> HTML5
    // direct. Le navigateur sniffe le content-type retourné par Storage.
    if (item.source === 'upload' || isStorageVideoUrl(item.url)) {
      return (
        <video
          src={item.url}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover bg-zinc-950 pointer-events-none"
        />
      );
    }
    return <CardVideoEmbed item={item} />;
  }
  // type='image' OR fallback
  // BUG #49 fix — pointer-events-none + draggable=false : sans ça, l'<img>
  // capture le touch sur mobile (browser image-drag/save gesture) et BLOQUE
  // la détection swipe embla. Cohérent avec <video pointer-events-none>.
  return (
    <img
      src={item.url || `https://picsum.photos/seed/${fallbackSeed}/800/600`}
      alt=""
      draggable={false}
      className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none select-none"
    />
  );
}

function ActivityCardComponent({
  activity,
  existingBookingId,
  nextSessionId,
  nextSession,
}: {
  activity: ActivityCard;
  /** Phase 9.5 c16 BUG F — bookingId du user pour cette activity (si réservée < 24h). */
  existingBookingId?: string;
  /** Phase 9.5 c30 BUG GG — sessionId de la prochaine séance future, forward au
   *  ReserveButtonListing pour route vers /sessions/{id} au lieu de /activities/{id}. */
  nextSessionId?: string;
  /** Fix B post-B2 — Session de référence (next future). Permet d'afficher
   *  le prix EFFECTIVEMENT chargé (computePricingTier sur pricingTiers de la
   *  session, donc respecte les overrides per-session du partner via B2)
   *  au lieu d'Activity.price (vitrine) qui peut diverger. */
  nextSession?: Session;
}) {
  const router = useRouter();
  // BUG #23 — mini-carousel via shadcn Carousel (embla). setApi pour sync dots +
  // arrows custom. Embla gère le swipe touch natif sans handler manuel + il
  // distingue tap (=click bubble → Link nav) vs drag (=scroll, pas de click).
  // BUG #49 v4 — abandon de embla pour CSS scroll-snap natif. Embla refusait
  // de capturer les touch events sur Samsung Chrome mobile (PC OK). CSS scroll-snap
  // est universel mobile, zéro JS pour le swipe (navigateur natif).
  const carouselScrollRef = useRef<HTMLDivElement>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  // BUG #52 — fullscreen lightbox état : null = fermé, sinon le MediaItem affiché.
  // BUG #52 v3 — fullscreen ouvre maintenant un carousel swipable. État = index
  // de l'item à afficher au départ (ou null = fermé). Le user peut swiper entre
  // les items DANS le plein écran (cohérent UX Facebook/Instagram).
  const [fullscreenStartIndex, setFullscreenStartIndex] = useState<number | null>(null);
  const detailHref = `/activities/${activity.activityId}`;

  // Sync currentSlide depuis scrollLeft natif (debounce via rAF pour perf).
  const handleCarouselScroll = () => {
    const el = carouselScrollRef.current;
    if (!el) return;
    const slideWidth = el.clientWidth;
    if (slideWidth === 0) return;
    const idx = Math.round(el.scrollLeft / slideWidth);
    setCurrentSlide(idx);
  };

  // Programmatic scroll vers slide N (utilisé par arrows + dots).
  const scrollToSlide = (i: number) => {
    const el = carouselScrollRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
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

  // CSS scroll-snap : currentSlide synchronisé via onScroll (cf. handleCarouselScroll).

  return (
    <Card
      // BUG #20 — id pour hash scroll auto depuis /activities#activity-{id}
      // (modal "Où pratiquer ?" redirige ici, browser scroll-into-view natif).
      id={`activity-${activity.activityId}`}
      className={`overflow-hidden bg-card transition-all duration-300 transform hover:-translate-y-2 scroll-mt-24 ${
        existingBookingId
          ? 'border-accent/60 shadow-lg shadow-accent/20'
          : 'border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20'
      }`}
    >
      {/* BUG #49 v3 — l'image n'est PLUS le déclencheur de navigation : conflit
          insoluble onClick vs embla swipe sur mobile. La navigation se fait via :
          (1) le titre cliquable plus bas (Link), (2) le badge "Voir détail"
          overlay bottom-left de l'image (Link aussi, stopPropagation). Le wrapper
          du carousel est juste un div neutre → embla capture sans entrave. */}
      <div className="block">
        <div
          className="relative h-56 w-full group"
          style={{ touchAction: 'pan-y pinch-zoom' }}
        >
          <BackButton fallbackUrl="/" />
          {/* BUG #23 — shadcn Carousel (embla) : swipe touch natif mobile + drag
              desktop. Embla distingue tap (click bubble vers Link parent → nav
              vers /activities/[id], fix #21) vs drag (scroll horizontal, no
              click) → préserve les deux comportements naturellement.
              BUG #49 fix mobile swipe — touchAction: 'pan-y pinch-zoom' +
              dragThreshold abaissé à 5 (default 10). pan-y solo bloquait
              embla de capturer un swipe pas parfaitement horizontal au début,
              forçant l'user à essayer plusieurs fois. Avec pinch-zoom permis
              ET threshold bas, embla intercepte plus vite et plus permissif. */}
          {/* BUG #49 v4 — CSS scroll-snap natif au lieu d'embla. Marche sur
              100% des mobiles (Samsung Chrome, iOS Safari, etc.) sans JS pour
              le swipe. overflow-x-auto + snap-x mandatory = scroll horizontal
              snappable. Hide scrollbar via inline styles cross-browser. */}
          <div
            ref={carouselScrollRef}
            onScroll={handleCarouselScroll}
            className="absolute inset-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <style>{`.spordateur-carousel-scroll::-webkit-scrollbar { display: none; }`}</style>
            {items.map((item, i) => (
              <div
                key={i}
                className="relative h-full flex-shrink-0 basis-full snap-center spordateur-carousel-scroll"
                style={{ scrollSnapStop: 'always' }}
              >
                <CardMediaSlide item={item} fallbackSeed={activity.sport} />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
            {activity.duration || 60} min
          </div>
          {/* BUG #49 v3 — "Voir détail" en bas-gauche (Link → navigation). */}
          <Link
            href={detailHref}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-2 left-2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-0.5 rounded-full select-none hover:bg-black/80 transition-colors"
          >
            <Info className="h-3 w-3 opacity-80" />
            <span>Voir détail</span>
          </Link>
          {/* BUG #52 — bouton "Plein écran" en haut-droite, à GAUCHE du
              volume toggle (right-12 = 48px laisse la place au volume du
              CardVideoEmbed à right-2). Quand existingBookingId, le badge
              "Déjà réservée" prend right-3 → on décale Plein écran à
              right-[6.5rem] pour pas chevaucher. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setFullscreenStartIndex(currentSlide); }}
            className="absolute top-3 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-1 rounded-full hover:bg-black/80 transition-colors"
            aria-label="Afficher en plein écran"
            style={{ right: existingBookingId ? '7rem' : '3rem' }}
          >
            <Maximize2 className="h-3 w-3" />
            <span>Plein écran</span>
          </button>
          {/* Phase 9.5 c16 BUG F — badge "Déjà réservée" si user a un booking actif */}
          {existingBookingId && (
            <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 bg-accent text-white text-xs px-3 py-1 rounded-full font-medium shadow-lg">
              <CheckCircle className="h-3.5 w-3.5" />
              Déjà réservée
            </div>
          )}
          {hasMultiple && (
            <>
              {/* BUG #29 — Counter "X/Y" bottom-right pour rendre explicite
                  qu'il y a plusieurs images à swiper (avant : seul indice =
                  petits dots discrets, l'user pensait devoir double-cliquer).
                  Position bottom-right pour éviter conflit avec badge
                  "Déjà réservée" (top-right) + dots (bottom-center).
                  Pointer-events-none (info pure, pas clickable). */}
              <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-0.5 rounded-full z-10 pointer-events-none select-none flex items-center gap-1">
                <ChevronLeft className="h-3 w-3 opacity-60" />
                <span>{formatImageCounter(currentSlide, items.length)}</span>
                <ChevronRight className="h-3 w-3 opacity-60" />
              </div>
              {/* Arrows custom (vs CarouselPrevious/Next) pour préserver style
                  opacity-0 group-hover existant + position. stopPropagation
                  empêche le click du Link parent (fix #21). */}
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); scrollToSlide(Math.max(0, currentSlide - 1)); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label="Image précédente"
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); scrollToSlide(Math.min(items.length - 1, currentSlide + 1)); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label="Image suivante"
                type="button"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {/* BUG #29 — dots un peu plus visibles : w-2 (était w-1.5),
                  inactif opacity 70 (était 50). Touch target restant fin. */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                {items.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); scrollToSlide(i); }}
                    aria-label={`Aller à l'image ${i + 1}`}
                    type="button"
                    className={`w-2 h-2 rounded-full transition-all shadow-sm ${i === currentSlide ? 'bg-white w-5' : 'bg-white/70 hover:bg-white/90'}`}
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
        <p className="text-xs text-accent mb-4 font-medium">
          {activity.scheduledAt
            ? `Prochaine séance : ${formatScheduledLabel(activity)}`
            : 'Date à venir'}
        </p>
        <div className="flex justify-between items-center">
          {/* Fix B post-B2 — Prix effectif via getBookingPriceCHF (Fix A) :
              priorité session.pricingTiers (respecte les overrides per-session
              du partner), fallback Activity.price si pas de session future. */}
          {(() => {
            const effectivePriceCHF = getBookingPriceCHF({
              session: nextSession ?? null,
              activity: { price: activity.price },
              now: new Date(),
              isDuo: false,
            });
            return (
              <p className="text-xl font-bold text-accent">
                {effectivePriceCHF === 0 ? 'Gratuit' : `${effectivePriceCHF} CHF`}
              </p>
            );
          })()}
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
                className="bg-accent hover:bg-accent/90 text-white text-sm font-semibold px-4"
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
                  // Fix B post-B2 — passe le prix effectif (session OU fallback
                  // activity) pour cohérence avec le label CHF affiché.
                  price: getBookingPriceCHF({
                    session: nextSession ?? null,
                    activity: { price: activity.price },
                    now: new Date(),
                    isDuo: false,
                  }),
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
      {/* BUG #52 v2 — VRAI plein écran via Browser Fullscreen API.
          Quand fullscreenItem est set : on appelle requestFullscreen() sur le
          modal au mount → ça hide la URL bar Chrome, le bottom nav Spordateur,
          et même la system status bar Android. Sortie via Escape ou tap croix
          → exitFullscreen() puis state cleanup. */}
      {fullscreenStartIndex !== null && (
        <FullscreenLightbox
          items={items}
          initialIndex={fullscreenStartIndex}
          onClose={() => setFullscreenStartIndex(null)}
        />
      )}
    </Card>
  );
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityCard[]>([]);
  // Phase 9.5 c30 BUG GG — Map activityId → Session (la prochaine future).
  // Fix B post-B2 : stocke maintenant la Session complète (au lieu du sessionId
  // seul) pour que la card calcule le prix effectif via getBookingPriceCHF
  // (respecte les overrides per-session du partner).
  const [nextSessionByActivity, setNextSessionByActivity] = useState<Record<string, Session>>({});
  const [loading, setLoading] = useState(true);
  // BUG #83 — Recherche par ville/pays sur la page activités.
  // Pour le MVP : un input texte qui filtre sur city+address de chaque activity.
  const [citySearch, setCitySearch] = useState('');
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
          const map: Record<string, Session> = {};
          sessionsSnap.docs.forEach((sd) => {
            const sdata = sd.data() as Session;
            const aid = sdata?.activityId as string | undefined;
            if (aid && !map[aid]) {
              map[aid] = { ...sdata, sessionId: sd.id };
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
  // BUG #83 — Filtre par ville pour la barre de recherche en haut de page.
  // L'utilisateur tape une ville → on filtre les activités sur city
  // (case+trim insensible). Si vide → toutes les activités.
  const filteredActivities = activities.filter((act) => {
    if (!citySearch.trim()) return true;
    const q = citySearch.trim().toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const address = (act as any).address as string | undefined;
    return (
      (act.city || '').toLowerCase().includes(q) ||
      (address || '').toLowerCase().includes(q)
    );
  });
  const partnerGroups = filteredActivities.reduce((acc, act) => {
    const key = act.partnerName || 'Autre';
    if (!acc[key]) acc[key] = [];
    acc[key].push(act);
    return acc;
  }, {} as Record<string, ActivityCard[]>);

  const partnerNames = Object.keys(partnerGroups);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Generic page header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl font-headline">
          Activités
        </h1>
        <p className="mt-4 text-gray-400 md:text-xl">
          Découvre les cours proposés par nos partenaires — Réserve ta session et vis l&apos;expérience.
        </p>
      </div>

      {/* BUG #83 — Recherche par ville/pays. Input texte qui filtre les
          activités sur city+address en live. Si une seule ville présente
          dans la base, l'utilisateur voit déjà toutes les activités de
          cette ville par défaut (filtre vide). */}
      <div className="max-w-md mx-auto mb-10">
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-accent" aria-hidden="true" />
          <input
            type="search"
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
            placeholder="Rechercher par ville ou pays…"
            className="w-full pl-10 pr-4 py-3 rounded-full bg-zinc-900 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-accent/40 focus:bg-zinc-900/80 transition-colors"
            aria-label="Filtrer les activités par ville ou pays"
          />
          {citySearch && (
            <button
              type="button"
              onClick={() => setCitySearch('')}
              aria-label="Effacer la recherche"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-accent animate-spin" />
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
                  <Badge className="bg-accent/10 text-accent border-accent/30 text-xs">
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
                      nextSessionId={nextSessionByActivity[activity.activityId]?.sessionId}
                      nextSession={nextSessionByActivity[activity.activityId]}
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
          Vous êtes partenaire ? <Link href="/partner/register" className="text-accent hover:underline">Rejoignez le réseau Spordateur</Link>.
        </p>
      </div>
    </div>
  );
}
