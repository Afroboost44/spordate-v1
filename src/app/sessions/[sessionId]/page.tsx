/**
 * Spordateur — Phase 5
 * /sessions/[sessionId] — Page détail d'une session.
 *
 * Server Component (async, fetch SSR). ISR via revalidate=30 (countdown precision
 * + currentTier/currentPrice fraîcheur sans flooder Firestore).
 *
 * Architecture :
 * - SSR avec generateMetadata dynamique (SEO/OG par session, partage social riche)
 * - Phase initiale "snapshotted" au SSR via getChatPhase(session, new Date())
 * - Countdown live via CountdownHero (Client component interne)
 * - Phase 7 path : Client wrapper avec subscribeToSession + useSessionWindow pour
 *   transitions phase live (chat-open → started, etc.) sans refresh
 *
 * Sections (top → bottom) :
 * 1. Lien retour "← Toutes les sessions"
 * 2. SessionHero (média + countdown + ReserveButton phase-aware)
 * 3. Grid Détails (date/durée/adresse/crédits) + PricingTimeline progressive
 * 4. À propos de cette session (activity.description, si fournie)
 *
 * Doctrine wording : description metadata neutre ("Sport pour de vraies rencontres
 * en Suisse romande") — vrai à 0/12/100 sessions, cohérent /sessions home.
 *
 * 404 :
 * - Session inexistante → notFound() (page 404 native Next.js)
 * - generateMetadata pour 404 : robots index: false (évite indexation)
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import {
  getSession,
  getActivity,
  getChatPhase,
} from '@/services/firestore';
import { SessionHero } from '@/components/sessions/SessionHero';
import { SessionDetailsPanel } from '@/components/sessions/SessionDetailsPanel';
import { PricingTimeline } from '@/components/sessions/PricingTimeline';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

// ISR 30s (équilibre fraîcheur tier/price vs coût Firestore)
export const revalidate = 30;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { sessionId } = await params;

  // Fetch parallèle session + activity (Next.js dedupe, pas de coût supplémentaire si
  // la page principale les refetch — c'est le même getSession/getActivity)
  const session = await getSession(sessionId).catch(() => null);

  if (!session) {
    return {
      title: 'Session introuvable — Spordateur',
      robots: { index: false }, // 404 pas indexée
    };
  }

  const activity = await getActivity(session.activityId).catch(() => null);

  const description = `${session.sport} à ${session.city}. Sport pour de vraies rencontres en Suisse romande.`;

  // Image preview si activity.thumbnailMedia existe (Phase 5 : pas de fallback /og-default.jpg)
  const ogImage = activity?.thumbnailMedia?.url
    ? [
        {
          url: activity.thumbnailMedia.url,
          width: 1200,
          height: 630,
          alt: session.title,
        },
      ]
    : undefined;

  const twitterImage = activity?.thumbnailMedia?.url
    ? [activity.thumbnailMedia.url]
    : undefined;

  return {
    title: `${session.title} — Spordateur`,
    description,
    openGraph: {
      title: session.title,
      description,
      type: 'website',
      locale: 'fr_CH',
      images: ogImage,
    },
    twitter: {
      card: 'summary_large_image',
      title: session.title,
      description,
      images: twitterImage,
    },
  };
}

export default async function SessionDetailPage({ params }: PageProps) {
  const { sessionId } = await params;

  const session = await getSession(sessionId).catch((err) => {
    console.error('[SessionDetailPage] getSession failed', err);
    return null;
  });

  if (!session) notFound();

  const activity = await getActivity(session.activityId).catch((err) => {
    console.error('[SessionDetailPage] getActivity failed', err);
    return null;
  });

  // Phase initiale au SSR (countdown re-tick côté client via CountdownHero)
  const phase = getChatPhase(session, new Date());

  return (
    <div className="bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col gap-10 sm:gap-12">
        {/* ============= LIEN RETOUR ============= */}
        <Link
          href="/sessions"
          className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded self-start"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Toutes les sessions</span>
        </Link>

        {/* ============= HERO ============= */}
        <SessionHero
          session={session}
          phase={phase}
          media={activity?.thumbnailMedia}
          partnerName={activity?.partnerName}
        />

        {/* ============= DÉTAILS + PRICING (2 cols desktop, stacked mobile) ============= */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          <SessionDetailsPanel
            session={session}
            activity={activity ?? undefined}
          />
          <PricingTimeline
            activeTier={session.currentTier}
            tiers={session.pricingTiers}
          />
        </div>

        {/* ============= À PROPOS (si activity.description existe) ============= */}
        {activity?.description && (
          <section
            aria-labelledby="activity-desc-heading"
            className="flex flex-col gap-3"
          >
            <h2
              id="activity-desc-heading"
              className="text-xl sm:text-2xl text-white font-light"
            >
              À propos de cette session
            </h2>
            <p className="text-base text-white/80 font-light leading-relaxed whitespace-pre-line">
              {activity.description}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
