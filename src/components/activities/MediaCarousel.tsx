/**
 * Phase 9.5 c4 — <MediaCarousel> rendering pour /activities/[id].
 *
 * BUG #17 — refacto grille statique → shadcn Carousel (embla-carousel-react)
 * pour avoir le swipe touch natif sur mobile (UX standard). L'ancienne version
 * était une simple grid (1col mobile, 2col tablet, 3col desktop) sans
 * navigation possible — l'utilisateur voyait juste tous les medias empilés
 * verticalement sur mobile.
 *
 * Désormais :
 *  - Mobile (< sm)  : 1 item par viewport, swipe horizontal natif (embla)
 *  - Tablet (sm-lg) : 2 items par viewport, swipe + flèches
 *  - Desktop (lg+)  : 3 items par viewport, swipe + flèches
 *  - Si 1 seul item : pas de swipe ni flèches (layout pleine largeur via
 *    computeMediaCarouselLayout)
 *
 * Render media (inchangé Phase 9.5 c4) :
 *  - type='image' → <img> regular
 *  - type='video' provider='youtube' → <iframe> youtube embed
 *  - provider='vimeo' → <iframe> vimeo player
 *  - provider='drive' → <iframe> drive preview
 *
 * Q3=A no autoplay (iframe src sans `&autoplay=1`).
 *
 * Charte stricte black/#D91CD2/white.
 */

'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Play, X } from 'lucide-react';
import type { MediaItem } from '@/types/firestore';
import { resolveMediaImageSrc } from '@/lib/activities/media';
import { computeMediaCarouselLayout } from '@/lib/activities/mediaCarouselLayout';
import { parseVideoUrl } from '@/lib/activities/mediaParser';
import { formatImageCounter } from '@/lib/activities/imageCounter';
import {
  extractDriveFileId,
  buildDriveThumbnailUrl,
  buildDriveViewerUrl,
} from '@/lib/media/driveThumbnail';
import { isStorageVideoUrl } from '@/lib/media/driveMigration';
import { buildYoutubeDetailEmbedUrl } from '@/lib/media/youtubeEmbed';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from '@/components/ui/carousel';
import AdaptiveFullscreenVideo from '@/components/media/AdaptiveFullscreenVideo';
import { useLanguage } from '@/context/LanguageContext';

export interface MediaCarouselProps {
  items: MediaItem[];
  /** Optional className wrapper (override layout). */
  className?: string;
}

export function MediaCarousel({ items, className = '' }: MediaCarouselProps) {
  const { t } = useLanguage();
  // BUG #33 — setApi + currentSlide pour piloter counter + dots (pattern aligné
  // fix #29 LISTE). Embla expose selectedScrollSnap() qui retourne l'index du
  // slide leftmost visible. useEffect attach un listener sur 'select'.
  const [api, setApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);
  // Fix bandes noires + son page À propos — état lightbox plein écran pour
  // les vidéos Storage. URL du media en cours = ouvert, null = fermé. On
  // réutilise AdaptiveFullscreenVideo (mêmes règles ratio-aware + audio que
  // la page Activités listing).
  const [fullscreenVideoSrc, setFullscreenVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    setCurrentSlide(api.selectedScrollSnap());
    const onSelect = () => setCurrentSlide(api.selectedScrollSnap());
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  if (items.length === 0) return null;

  const layout = computeMediaCarouselLayout(items.length);

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <Carousel
        setApi={setApi}
        opts={{
          align: 'start',
          loop: false,
          // Embla : drag/swipe activé par défaut, watchDrag=true (no override).
        }}
        className="w-full relative"
      >
        <CarouselContent className="-ml-3">
          {items.map((item, i) => (
            <CarouselItem
              key={`${item.url}-${i}`}
              className={`pl-3 ${layout.itemBasis}`}
            >
              <MediaItemRender
                item={item}
                priority={i === 0}
                onOpenFullscreen={(url) => setFullscreenVideoSrc(url)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        {/* BUG #17 — flèches : visibles md+ uniquement (mobile = swipe seul) */}
        {layout.showArrows && (
          <>
            <CarouselPrevious className="hidden md:inline-flex -left-4 bg-black/60 border-white/15 text-white hover:bg-accent/20 hover:border-accent/40" />
            <CarouselNext className="hidden md:inline-flex -right-4 bg-black/60 border-white/15 text-white hover:bg-accent/20 hover:border-accent/40" />
            {/* BUG #33 — Counter badge "‹ X/Y ›" bottom-right pour rendre
                explicite qu'il y a plusieurs medias à swiper (Bassi : "l'user
                peut oublier qu'il existe d'autres image et vidéo"). Pattern
                identique fix #29 LISTE. Pointer-events-none + select-none. */}
            <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-0.5 rounded-full z-10 pointer-events-none select-none flex items-center gap-1">
              <ChevronLeft className="h-3 w-3 opacity-60" />
              <span>{formatImageCounter(currentSlide, items.length)}</span>
              <ChevronRight className="h-3 w-3 opacity-60" />
            </div>
          </>
        )}
      </Carousel>
      {/* BUG #33 — Dots cliquables sous le carousel pour navigation explicite
          + indication visuelle de position. Pattern identique fix #29. */}
      {layout.showArrows && (
        <div className="flex justify-center gap-1.5">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => api?.scrollTo(i)}
              aria-label={`Aller au média ${i + 1}`}
              className={`w-2 h-2 rounded-full transition-all shadow-sm ${i === currentSlide ? 'bg-accent w-5' : 'bg-white/40 hover:bg-white/70'}`}
            />
          ))}
        </div>
      )}
      {/* Lightbox plein écran ratio-aware (parité page Activités listing) :
          ouvre AdaptiveFullscreenVideo dans un overlay fixed pour la vidéo
          choisie. Fix bandes noires + son sur page À propos. */}
      {fullscreenVideoSrc !== null && (
        <div
          className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
          role="dialog"
          aria-label={t('activities_fullscreen_preview_aria')}
        >
          <button
            type="button"
            onClick={() => setFullscreenVideoSrc(null)}
            className="absolute top-4 left-4 z-30 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm"
            aria-label={t('fullscreen_close')}
            title={t('fullscreen_close')}
          >
            <X className="h-6 w-6" />
          </button>
          <AdaptiveFullscreenVideo
            src={fullscreenVideoSrc}
            autoPlay
            onClose={() => setFullscreenVideoSrc(null)}
          />
        </div>
      )}
    </section>
  );
}

function MediaItemRender({
  item,
  priority,
  onOpenFullscreen,
}: {
  item: MediaItem;
  priority?: boolean;
  /** Fix page À propos — callback pour ouvrir AdaptiveFullscreenVideo en
   *  lightbox ratio-aware (parité page Activités listing). Si non fourni,
   *  le bouton plein écran n'est pas rendu (compat futurs call-sites). */
  onOpenFullscreen?: (url: string) => void;
}) {
  const { t } = useLanguage();
  if (item.type === 'video') {
    // BUG #30 étape 3 — Vidéo migrée Drive→Storage par Cloud Function : render
    // HTML5 <video> natif (zéro redirection externe, contrôles browser standard,
    // playsinline iOS). Détecté par URL firebasestorage.googleapis.com +
    // extension video (.mp4 .webm .mov…).
    // BUG #60 — Même branche pour upload partner direct (source='upload') :
    // certains fichiers uploadés perdent leur extension dans le slug → on ne
    // peut pas se fier à `isStorageVideoUrl` seul. `source==='upload'` suffit.
    if (item.source === 'upload' || isStorageVideoUrl(item.url)) {
      return (
        <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-zinc-950">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={item.url}
            controls
            preload="metadata"
            playsInline
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
          {/* Fix page À propos — bouton plein écran ratio-aware (UX parité
              page Activités listing). Le HTML5 <video controls> fullscreen
              natif force le 16:9 → bandes noires latérales sur 9:16. Notre
              AdaptiveFullscreenVideo gère 9:16 / 16:9 / mobile / desktop +
              son utilisateur-gesture débloqué. */}
          {onOpenFullscreen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onOpenFullscreen(item.url);
              }}
              className="absolute bottom-2 right-2 z-10 inline-flex items-center justify-center h-8 w-8 p-0 bg-black/60 backdrop-blur-sm text-white rounded-full hover:bg-black/80 transition-colors"
              aria-label={t('activities_display_fullscreen_aria')}
              title={t('activities_fullscreen')}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      );
    }
    // BUG #26 bis + #28 — Drive refuse le framing (CSP frame-ancestors).
    // L'iframe résultant tombe en chrome-error://chromewebdata/ qui intercepte
    // les touch events → swipe embla bloqué + vidéo non lisible. Fix : rendre
    // une thumbnail + Play overlay + onClick window.open(viewer URL) en
    // nouvelle tab. Drive viewer natif gère mieux la lecture mobile que
    // n'importe quel embed iframe custom.
    // NB : ce fallback ne se déclenche que pendant la fenêtre Cloud Function
    // migrateDriveVideosTrigger en cours (cold start 5-10s post-save). Une fois
    // migré, l'item devient provider='direct' + url=Storage → branche au-dessus.
    if (item.provider === 'drive') {
      // MediaItem n'a pas de champ videoId persisté — extraire depuis url ou embedUrl.
      const fileId = extractDriveFileId(item.url) || extractDriveFileId(item.embedUrl);
      if (fileId) {
        const thumbUrl = buildDriveThumbnailUrl(fileId);
        const viewerUrl = buildDriveViewerUrl(fileId);
        return (
          <button
            type="button"
            onClick={() => window.open(viewerUrl, '_blank', 'noopener,noreferrer')}
            aria-label="Ouvrir la vidéo Google Drive dans un nouvel onglet"
            className="relative aspect-video w-full rounded-lg overflow-hidden border border-white/10 bg-zinc-950 group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
              loading={priority ? 'eager' : 'lazy'}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
              <div className="bg-black/60 rounded-full p-3 backdrop-blur-sm border border-white/20">
                <Play className="h-7 w-7 text-accent fill-accent" aria-hidden="true" />
              </div>
            </div>
          </button>
        );
      }
      // fileId pas extractible → fallback iframe (cas legacy / URL malformée)
    }
    // BUG #30 Étape 1 — YouTube DÉTAIL : params minimal-branding (modestbranding,
    // rel=0, iv_load_policy=3, disablekb, fs, playsinline) pour réduire les
    // redirections externes et garder l'utilisateur dans Spordateur. Le bare
    // embedUrl (sans params) montrait suggestions + annotations + raccourcis YT.
    // Vimeo : bare embedUrl déjà minimal côté player. Drive : géré branche above.
    let embedSrc: string | null = null;
    if (item.provider === 'youtube') {
      const parsed = parseVideoUrl(item.url);
      const videoId = parsed?.videoId;
      embedSrc = buildYoutubeDetailEmbedUrl(videoId) || item.embedUrl || item.url || null;
    } else {
      embedSrc = item.embedUrl || item.url || null;
    }
    if (!embedSrc) return null;
    return (
      <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-zinc-950">
        <iframe
          src={embedSrc}
          title={`Vidéo ${item.provider ?? ''}`.trim()}
          className="absolute inset-0 w-full h-full"
          frameBorder="0"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading={priority ? 'eager' : 'lazy'}
        />
      </div>
    );
  }

  // type === 'image'
  // Fallback chain : image custom/CDN → miniature YouTube extraite → logo Spordateur.
  // (avant : <img src={item.url}> brut → lien YouTube = image cassée / placeholder random)
  return (
    <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-zinc-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolveMediaImageSrc(item.url)}
        alt=""
        className="w-full h-full object-cover"
        loading={priority ? 'eager' : 'lazy'}
      />
    </div>
  );
}
