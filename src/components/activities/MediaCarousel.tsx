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

import { Play } from 'lucide-react';
import type { MediaItem } from '@/types/firestore';
import { resolveMediaImageSrc } from '@/lib/activities/media';
import { computeMediaCarouselLayout } from '@/lib/activities/mediaCarouselLayout';
import { parseVideoUrl } from '@/lib/activities/mediaParser';
import {
  extractDriveFileId,
  buildDriveThumbnailUrl,
  buildDriveViewerUrl,
} from '@/lib/media/driveThumbnail';
import { buildYoutubeDetailEmbedUrl } from '@/lib/media/youtubeEmbed';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel';

export interface MediaCarouselProps {
  items: MediaItem[];
  /** Optional className wrapper (override layout). */
  className?: string;
}

export function MediaCarousel({ items, className = '' }: MediaCarouselProps) {
  if (items.length === 0) return null;

  const layout = computeMediaCarouselLayout(items.length);

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <Carousel
        opts={{
          align: 'start',
          loop: false,
          // Embla : drag/swipe activé par défaut, watchDrag=true (no override).
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-3">
          {items.map((item, i) => (
            <CarouselItem
              key={`${item.url}-${i}`}
              className={`pl-3 ${layout.itemBasis}`}
            >
              <MediaItemRender item={item} priority={i === 0} />
            </CarouselItem>
          ))}
        </CarouselContent>
        {/* BUG #17 — flèches : visibles md+ uniquement (mobile = swipe seul) */}
        {layout.showArrows && (
          <>
            <CarouselPrevious className="hidden md:inline-flex -left-4 bg-black/60 border-white/15 text-white hover:bg-[#D91CD2]/20 hover:border-[#D91CD2]/40" />
            <CarouselNext className="hidden md:inline-flex -right-4 bg-black/60 border-white/15 text-white hover:bg-[#D91CD2]/20 hover:border-[#D91CD2]/40" />
          </>
        )}
      </Carousel>
    </section>
  );
}

function MediaItemRender({
  item,
  priority,
}: {
  item: MediaItem;
  priority?: boolean;
}) {
  if (item.type === 'video') {
    // BUG #26 bis + #28 — Drive refuse le framing (CSP frame-ancestors).
    // L'iframe résultant tombe en chrome-error://chromewebdata/ qui intercepte
    // les touch events → swipe embla bloqué + vidéo non lisible. Fix : rendre
    // une thumbnail + Play overlay + onClick window.open(viewer URL) en
    // nouvelle tab. Drive viewer natif gère mieux la lecture mobile que
    // n'importe quel embed iframe custom.
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
                <Play className="h-7 w-7 text-[#D91CD2] fill-[#D91CD2]" aria-hidden="true" />
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
