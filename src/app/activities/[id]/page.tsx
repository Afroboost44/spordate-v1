/**
 * Spordateur — Phase 7 sub-chantier 1 commit 3/6
 * /activities/[id] — Page détail activité avec Reviews.
 *
 * Server Component (async, fetch SSR). Pattern cohérent /sessions/[sessionId]/page.tsx
 * (Phase 5).
 *
 * Sections :
 * 1. Lien retour "← Toutes les activités"
 * 2. Header : titre + sport + ville + partner
 * 3. Description (si fournie)
 * 4. Section "Avis" : ReviewsList variant='activity' avec pagination
 *
 * Phase 7 commit 3/6 : page minimale focalisée sur Reviews.
 * Phase 9 polish enrichira (calendrier sessions, photos, partner info détaillée, etc.).
 *
 * Pas de bouton "Laisser un avis" intégré dans cette page côté Server Component
 * (ReviewForm est Client + nécessite useState). Le bouton sera ajouté Phase 7
 * commit 6/6 polish OU via un Client wrapper sub-section. Pour l'instant, l'invite
 * à reviewer apparaîtra naturellement sur la page Profile de l'autre participant
 * (commit 4/6 ou 6/6).
 *
 * SEO/OG :
 * - generateMetadata dynamique : titre + description = "{title} à {city}"
 * - 404 si activity introuvable
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { getActivity, getNextFutureSessionForActivity } from '@/services/firestore';
import { getReviewsByActivity, getReviewerProfiles } from '@/lib/reviews';
import { getMediaItems } from '@/lib/activities/media';
import { MediaCarousel } from '@/components/activities/MediaCarousel';
import { ActivityVenueDetails } from '@/components/activities/ActivityVenueDetails';
import { ActivityStoreOffer } from '@/components/activities/ActivityStoreOffer';
import { ShareButton } from '@/components/activities/ShareButton';
import { ReviewsList } from '@/components/reviews/ReviewsList';
import { ReviewTrigger } from '@/components/reviews/ReviewTrigger';
import { ActivityInviteSection } from '@/components/activities/ActivityInviteSection';
import { InvitedActivityBanner } from '@/components/activities/InvitedActivityBanner';
import { LocalizedActivityTitle, LocalizedActivityDescription } from '@/components/activities/LocalizedActivityText';
import { BackToChatLink } from '@/components/activities/BackToChatLink';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

// ISR 60s (cohérent /sessions/page.tsx)
export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const activity = await getActivity(id).catch(() => null);
  if (!activity) {
    return {
      title: 'Activité introuvable — Spordateur',
      robots: { index: false },
    };
  }

  const description = `${activity.sport} à ${activity.city}. Sport pour de vraies rencontres en Suisse romande.`;
  return {
    title: `${activity.title} — Spordateur`,
    description,
    openGraph: {
      title: activity.title,
      description,
      type: 'website',
      locale: 'fr_CH',
    },
  };
}

export default async function ActivityDetailPage({ params, searchParams }: PageProps) {
  const search = searchParams ? await searchParams : {};
  const fromInvite = search?.fromInvite === 'chat';
  const { id } = await params;

  const activity = await getActivity(id).catch((err) => {
    console.error('[ActivityDetailPage] getActivity failed', err);
    return null;
  });

  if (!activity) notFound();

  // Phase 9.5 hotfix — parallel SSR queries (avant: séquentielles ~400ms / après: ~250ms).
  // getReviewsByActivity + getNextFutureSessionForActivity sont indépendantes (n'utilisent que `id`).
  // getReviewerProfiles dépend du résultat reviews → reste séquentielle après ce Promise.all.
  const [reviews, nextSession] = await Promise.all([
    getReviewsByActivity(id, { limit: 50 }).catch((err) => {
      console.error('[ActivityDetailPage] getReviewsByActivity failed', err);
      return [];
    }),
    getNextFutureSessionForActivity(id).catch((err) => {
      console.error('[ActivityDetailPage] getNextFutureSessionForActivity failed', err);
      return null;
    }),
  ]);

  // Phase 7 commit 4/6 : résoudre les profils reviewers nominatifs (3-5★)
  // Dépend de reviews → reste séquentielle (mais batch interne via Promise.all sur N uids).
  const reviewerProfiles = await getReviewerProfiles(reviews).catch((err) => {
    console.error('[ActivityDetailPage] getReviewerProfiles failed', err);
    return new Map();
  });

  return (
    <div className="bg-black text-white min-h-screen">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col gap-8 sm:gap-10">
        {/* Lien retour — si arrivé depuis modal chat (fromInvite=chat),
            propose un retour direct au chat (history.back côté Client). Sinon
            retour standard vers /activities. */}
        {fromInvite ? (
          <BackToChatLink />
        ) : (
          <Link
            href="/activities"
            className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded self-start"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Toutes les activités</span>
          </Link>
        )}

        {/* BUG #36 C3 — Banner visible si user arrive depuis invite acceptée (?inviteId=X) */}
        <InvitedActivityBanner />

        {/* Header */}
        <header className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-[0.2em] text-accent font-light">
            {activity.sport}
          </span>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl sm:text-4xl text-white font-light leading-tight flex-1">
              {/* Fix #181 — Titre localisé selon user.language (fallback FR si vide) */}
              <LocalizedActivityTitle activity={activity} />
            </h1>
            {/* Phase 9.5 c10.B — ShareButton sur page détail (Like + Comment via SocialBar 10.D) */}
            <ShareButton
              activity={{
                activityId: activity.activityId,
                title: activity.title,
              }}
              className="flex-shrink-0 mt-1"
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm text-white/70 font-light">
            <p className="flex items-center gap-2">
              <MapPin
                className="h-4 w-4 text-accent flex-shrink-0"
                aria-hidden="true"
              />
              <span>{activity.city}</span>
            </p>
            {activity.partnerName && (
              <p className="flex items-center gap-2">
                <Building2
                  className="h-4 w-4 text-accent flex-shrink-0"
                  aria-hidden="true"
                />
                <span>{activity.partnerName}</span>
              </p>
            )}
          </div>
        </header>

        {/* Phase 9.5 c4 — Media carousel (images + video embeds) */}
        {(() => {
          const items = getMediaItems(activity);
          if (items.length === 0) return null;
          return <MediaCarousel items={items} />;
        })()}

        {/* Description */}
        {activity.description && (
          <section
            aria-labelledby="activity-desc-heading"
            className="flex flex-col gap-3"
          >
            <h2
              id="activity-desc-heading"
              className="text-lg sm:text-xl text-white font-light"
            >
              À propos
            </h2>
            {/* Fix #181 — Description localisée selon user.language (fallback FR) */}
            <LocalizedActivityDescription activity={activity} />
          </section>
        )}

        {/* BUG #57 — Bloc "Cadre & Ambiance" (bar/club/restaurant uniquement).
            Le composant rend null si activity.venueDetails est absent ou vide. */}
        <ActivityVenueDetails details={activity.venueDetails} />

        {/* BUG #58 — Bloc "Avantages partenaire" (sports-store uniquement).
            Le composant rend null si activity.storeOffer est absent ou vide. */}
        <ActivityStoreOffer offer={activity.storeOffer} />

        {/* Phase 9 SC1 c3/5 — Inviter un match (client island, silent hide si non-eligible) */}
        <ActivityInviteSection
          activityId={id}
          sessionId={nextSession?.sessionId}
        />

        {/* Reviews section */}
        <section
          aria-labelledby="activity-reviews-heading"
          className="flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2
              id="activity-reviews-heading"
              className="text-lg sm:text-xl text-white font-light"
            >
              Avis
            </h2>
            {/* Phase 7 commit 4/6 : ReviewTrigger Client island avec eligibility check */}
            <ReviewTrigger
              activityId={id}
              revieweeId={activity.partnerId}
              revieweeName={activity.partnerName}
              className="text-sm"
            />
          </div>
          <ReviewsList
            reviews={reviews}
            variant="activity"
            reviewerProfiles={reviewerProfiles}
          />
        </section>
      </div>
    </div>
  );
}
