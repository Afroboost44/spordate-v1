/**
 * Spordateur — Phase 7 sub-chantier 1 commit 3/6
 * <ReviewsList> — liste de reviews avec anonymisation graduée et 2 variants.
 *
 * Variants :
 * - 'profile' : moyenne globale + StarRating + "(X avis)" + 3 plus récentes
 * - 'activity' : liste paginée (par défaut 10 par page)
 *
 * Anonymisation graduée (cohérent doctrine §9.sexies C.1 + service Phase 7 commit 2/6) :
 * - anonymized=false (note 3-5★) : avatar + prénom du reviewer
 * - anonymized=true (note 1-2★) : avatar générique + "Membre Spordateur"
 *
 * Date relative : il y a Xh / il y a Xj / il y a X mois
 *
 * Charte stricte : background black, accent #D91CD2, text white/70 secondaire.
 */

'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { Review } from '@/types/firestore';
import { StarRating } from './StarRating';
import { EmptyReviewsState } from './EmptyReviewsState';

export interface ReviewerProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
}

export interface ReviewsListProps {
  reviews: Review[];
  variant: 'profile' | 'activity';
  /** Map reviewerId → ReviewerProfile pour afficher avatar/nom (anonymized=false uniquement). */
  reviewerProfiles?: Map<string, ReviewerProfile>;
  /** Nombre max de reviews affichées (variant='profile'). Défaut 3. */
  maxDisplay?: number;
  /** Page size pour pagination (variant='activity'). Défaut 10. */
  pageSize?: number;
  className?: string;
}

function formatRelativeDate(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'à l\'instant';
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `il y a ${diffD}j`;
  const diffM = Math.floor(diffD / 30);
  if (diffM < 12) return `il y a ${diffM} mois`;
  const diffY = Math.floor(diffM / 12);
  return `il y a ${diffY} an${diffY > 1 ? 's' : ''}`;
}

function ReviewItem({
  review,
  reviewerProfile,
}: {
  review: Review;
  reviewerProfile?: ReviewerProfile;
}) {
  const date = review.createdAt.toDate();
  const isAnonymized = review.anonymized;
  const displayName = isAnonymized
    ? 'Membre Spordateur'
    : reviewerProfile?.displayName ?? 'Membre Spordateur';

  return (
    <article className="flex flex-col gap-3 py-4 border-b border-white/10 last:border-0">
      <header className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {!isAnonymized && reviewerProfile?.photoURL && (
            <AvatarImage src={reviewerProfile.photoURL} alt={displayName} />
          )}
          <AvatarFallback className="bg-white/10 text-white/70">
            {isAnonymized ? (
              <UserIcon className="h-5 w-5" aria-hidden="true" />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
          <p className="text-sm text-white font-medium truncate">{displayName}</p>
          <p className="text-xs text-white/50 font-light">{formatRelativeDate(date)}</p>
        </div>
        <StarRating value={review.rating} size="sm" showValue={false} />
      </header>
      <p className="text-sm text-white/80 font-light leading-relaxed whitespace-pre-line">
        {review.comment}
      </p>
    </article>
  );
}

export function ReviewsList({
  reviews,
  variant,
  reviewerProfiles,
  maxDisplay = 3,
  pageSize = 10,
  className = '',
}: ReviewsListProps) {
  const [page, setPage] = useState(0);

  if (reviews.length === 0) {
    return <EmptyReviewsState variant={variant} className={className} />;
  }

  // Variant profile : moyenne + 3 dernières + total
  if (variant === 'profile') {
    const avg =
      reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    const displayed = reviews.slice(0, maxDisplay);
    return (
      <section className={`flex flex-col gap-4 ${className}`}>
        <header className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
          <StarRating value={avg} size="md" showValue precision={1} />
          <span className="text-xs text-white/60 font-light tabular-nums">
            {reviews.length} avis
          </span>
        </header>
        <div className="flex flex-col">
          {displayed.map((review) => (
            <ReviewItem
              key={review.reviewId}
              review={review}
              reviewerProfile={reviewerProfiles?.get(review.reviewerId)}
            />
          ))}
        </div>
        {reviews.length > maxDisplay && (
          <p className="text-xs text-white/50 font-light text-center">
            + {reviews.length - maxDisplay} autres avis
          </p>
        )}
      </section>
    );
  }

  // Variant activity : pagination
  const totalPages = Math.ceil(reviews.length / pageSize);
  const start = page * pageSize;
  const displayed = reviews.slice(start, start + pageSize);

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-col">
        {displayed.map((review) => (
          <ReviewItem
            key={review.reviewId}
            review={review}
            reviewerProfile={reviewerProfiles?.get(review.reviewerId)}
          />
        ))}
      </div>
      {totalPages > 1 && (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Pagination des avis"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="border-white/10 text-white hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
            Précédent
          </Button>
          <span className="text-xs text-white/50 font-light tabular-nums">
            Page {page + 1} sur {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="border-white/10 text-white hover:bg-white/5 disabled:opacity-30"
          >
            Suivant
            <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </section>
  );
}
