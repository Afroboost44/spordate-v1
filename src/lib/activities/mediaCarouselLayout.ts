/**
 * BUG #17 — Helper pur layout pour MediaCarousel (page /activities/[id]).
 *
 * Avant : MediaCarousel était une grille statique CSS (1col mobile, 2col tablet,
 * 3col desktop). Pas de swipe mobile, pas de flèches — l'utilisateur voyait
 * juste tous les medias empilés. UX non standard mobile.
 *
 * Désormais : MediaCarousel utilise shadcn Carousel (embla-carousel-react) qui
 * gère le swipe touch natif. Ce helper centralise la décision basis (CSS class
 * appliquée à chaque CarouselItem pour contrôler combien fit par viewport) +
 * showArrows (flèches desktop, cachées si 1 seul item car rien à faire défiler).
 *
 * @module
 */

export interface MediaCarouselLayout {
  /** Classes Tailwind appliquées à <CarouselItem className=...>. */
  itemBasis: string;
  /** True si on doit rendre les <CarouselPrevious/>/<CarouselNext/> (desktop). */
  showArrows: boolean;
}

const SINGLE_ITEM_LAYOUT: MediaCarouselLayout = {
  itemBasis: 'basis-full',
  showArrows: false,
};

const MULTI_ITEM_LAYOUT: MediaCarouselLayout = {
  // 1col mobile (full), 2col tablet (sm), 3col desktop (lg) — cohérent grille originale
  itemBasis: 'basis-full sm:basis-1/2 lg:basis-1/3',
  showArrows: true,
};

/**
 * Décide le layout du carousel media selon le nombre d'items :
 *  - 0 ou 1 item → basis-full + pas de flèches (rien à faire défiler)
 *  - 2+ items → responsive 1/2/3 + flèches (utilisateur peut naviguer)
 */
export function computeMediaCarouselLayout(itemsCount: number): MediaCarouselLayout {
  if (!Number.isFinite(itemsCount) || itemsCount <= 1) {
    return SINGLE_ITEM_LAYOUT;
  }
  return MULTI_ITEM_LAYOUT;
}
