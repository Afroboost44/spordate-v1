/**
 * Phase 9.5 c4 — <MediaCarousel> rendering pour /activities/[id].
 *
 * Render :
 *  - type='image' → <img> regular
 *  - type='video' provider='youtube' → <iframe> youtube embed
 *  - provider='vimeo' → <iframe> vimeo player
 *  - provider='drive' → <iframe> drive preview
 *
 * Q3=A no autoplay (iframe src sans `&autoplay=1`).
 *
 * Backward compat : caller passe MediaItem[] obtenu via getMediaItems(activity).
 *
 * Layout : grid responsive (mobile 1col, tablet 2col, desktop 3col cap).
 * Charte stricte black/#D91CD2/white.
 */

import type { MediaItem } from '@/types/firestore';

export interface MediaCarouselProps {
  items: MediaItem[];
  /** Optional className wrapper (override layout). */
  className?: string;
}

export function MediaCarousel({ items, className = '' }: MediaCarouselProps) {
  if (items.length === 0) return null;

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item, i) => (
          <MediaItemRender key={`${item.url}-${i}`} item={item} priority={i === 0} />
        ))}
      </div>
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
  return (
    <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-zinc-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.url}
        alt=""
        className="w-full h-full object-cover"
        loading={priority ? 'eager' : 'lazy'}
      />
    </div>
  );
}
