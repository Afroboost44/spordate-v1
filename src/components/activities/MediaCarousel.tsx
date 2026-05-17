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

import type { MediaItem } from '@/types/firestore';
import { resolveMediaImageSrc } from '@/lib/activities/media';
import { computeMediaCarouselLayout } from '@/lib/activities/mediaCarouselLayout';
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
    const embedSrc = item.embedUrl || item.url;
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
