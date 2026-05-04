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
import { getActivity } from '@/services/firestore';
import { getReviewsByActivity } from '@/lib/reviews';
import { ReviewsList } from '@/components/reviews/ReviewsList';

interface PageProps {
  params: Promise<{ id: string }>;
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

export default async function ActivityDetailPage({ params }: PageProps) {
  const { id } = await params;

  const activity = await getActivity(id).catch((err) => {
    console.error('[ActivityDetailPage] getActivity failed', err);
    return null;
  });

  if (!activity) notFound();

  const reviews = await getReviewsByActivity(id, { limit: 50 }).catch((err) => {
    console.error('[ActivityDetailPage] getReviewsByActivity failed', err);
    return [];
  });

  return (
    <div className="bg-black text-white min-h-screen">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col gap-8 sm:gap-10">
        {/* Lien retour */}
        <Link
          href="/activities"
          className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded self-start"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Toutes les activités</span>
        </Link>

        {/* Header */}
        <header className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-[0.2em] text-[#D91CD2] font-light">
            {activity.sport}
          </span>
          <h1 className="text-3xl sm:text-4xl text-white font-light leading-tight">
            {activity.title}
          </h1>
          <div className="flex flex-col gap-1.5 text-sm text-white/70 font-light">
            <p className="flex items-center gap-2">
              <MapPin
                className="h-4 w-4 text-[#D91CD2] flex-shrink-0"
                aria-hidden="true"
              />
              <span>{activity.city}</span>
            </p>
            {activity.partnerName && (
              <p className="flex items-center gap-2">
                <Building2
                  className="h-4 w-4 text-[#D91CD2] flex-shrink-0"
                  aria-hidden="true"
                />
                <span>{activity.partnerName}</span>
              </p>
            )}
          </div>
        </header>

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
            <p className="text-base text-white/80 font-light leading-relaxed whitespace-pre-line">
              {activity.description}
            </p>
          </section>
        )}

        {/* Reviews section */}
        <section
          aria-labelledby="activity-reviews-heading"
          className="flex flex-col gap-4"
        >
          <h2
            id="activity-reviews-heading"
            className="text-lg sm:text-xl text-white font-light"
          >
            Avis
          </h2>
          <ReviewsList reviews={reviews} variant="activity" />
        </section>
      </div>
    </div>
  );
}
