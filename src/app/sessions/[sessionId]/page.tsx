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
import { getBookingAdmin } from '@/services/firestore-admin';
import { SessionHero } from '@/components/sessions/SessionHero';
import { SessionDetailsPanel } from '@/components/sessions/SessionDetailsPanel';
import { PricingTimeline } from '@/components/sessions/PricingTimeline';
import { SessionTSActions } from '@/components/sessions/SessionTSActions';
import { ParticipantsList } from '@/components/sessions/ParticipantsList';
import { BookingPendingHero } from '@/components/sessions/BookingPendingHero';
import { SessionSuccessToast } from '@/components/sessions/SessionSuccessToast';
import { computeBundledCredits } from '@/lib/billing/creditRules';
import { getMediaItems } from '@/lib/activities/media';
import { getVideoThumbnailChain, getVideoEmbedUrl } from '@/lib/activities/mediaParser';
import type { MediaItem } from '@/types/firestore';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * Phase 9.5 c14/c16/c18 — derive media + fallback chain pour SessionHero.
 *
 * Priorité :
 *  1. activity.mediaUrls[0] type='video' (YouTube/Vimeo) → iframe embed autoplay
 *     (c18 BUG J — vidéo prime sur thumbnail pour engagement)
 *  2. activity.thumbnailMedia (champ legacy explicit) si défini
 *  3. activity.mediaUrls[0] type='image' → { type:'image', url }
 *  4. activity.mediaUrls[0] type='video' sans embedUrl (Drive non-embeddable)
 *     → thumbnail YouTube chain hq → mq → default
 *  5. fallback undefined → SessionHero affiche placeholder Picsum
 *
 * Returns { media, imageUrlFallbacks } pour passer au SessionHero qui passe
 * à SessionMediaPlayer.
 */
function deriveSessionHeroMedia(
  activity: { thumbnailMedia?: { type: 'image' | 'video'; url: string; posterUrl?: string }; mediaUrls?: MediaItem[]; images?: string[] } | null,
): {
  media: {
    type: 'image' | 'video';
    url: string;
    posterUrl?: string;
    embedUrl?: string;
    provider?: 'youtube' | 'vimeo' | 'drive' | 'direct';
  } | undefined;
  imageUrlFallbacks: string[];
} {
  if (!activity) return { media: undefined, imageUrlFallbacks: [] };

  const items = getMediaItems({ mediaUrls: activity.mediaUrls, images: activity.images });
  const first = items[0];

  // Priorité 1 — vidéo embeddable (YouTube/Vimeo) → iframe (BUG J c18)
  if (first?.type === 'video') {
    const embed = getVideoEmbedUrl(first, { autoplay: true, muted: true, loop: true });
    if (embed) {
      return {
        media: {
          type: 'video',
          url: first.url,
          embedUrl: embed,
          provider: first.provider as 'youtube' | 'vimeo' | 'drive' | 'direct' | undefined,
        },
        imageUrlFallbacks: [],
      };
    }
    // video non-embeddable (Drive) → fallback thumbnail chain
    const chain = getVideoThumbnailChain(first);
    if (chain.length > 0) {
      return {
        media: { type: 'image', url: chain[0] },
        imageUrlFallbacks: chain.slice(1),
      };
    }
  }

  // Priorité 2 — thumbnailMedia legacy
  if (activity.thumbnailMedia?.url) {
    return { media: activity.thumbnailMedia, imageUrlFallbacks: [] };
  }

  // Priorité 3 — première image
  if (first?.type === 'image') {
    return { media: { type: 'image', url: first.url }, imageUrlFallbacks: [] };
  }

  return { media: undefined, imageUrlFallbacks: [] };
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

  // Phase 9.5 c14 BUG2 + c16 BUG G — preview via deriveSessionHeroMedia (chain fallback)
  const { media: previewMedia } = deriveSessionHeroMedia(activity);
  const ogImage = previewMedia?.url
    ? [
        {
          url: previewMedia.url,
          width: 1200,
          height: 630,
          alt: session.title,
        },
      ]
    : undefined;

  const twitterImage = previewMedia?.url ? [previewMedia.url] : undefined;

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

  // Phase 9.5 c8 BUG 2 : si pas de session avec cet id, fallback sur Booking
  // (free booking → bookingId-as-id, pas de session formelle planifiée).
  if (!session) {
    const booking = await getBookingAdmin(sessionId).catch((err) => {
      console.error('[SessionDetailPage] getBookingAdmin fallback failed', err);
      return null;
    });
    if (!booking) notFound();

    const bookingActivity = await getActivity(booking.activityId).catch(() => null);
    let creditsGranted = 0;
    if (bookingActivity) {
      try {
        creditsGranted = computeBundledCredits(bookingActivity);
      } catch {
        creditsGranted = 0;
      }
    }

    return (
      <div className="bg-black text-white">
        <SessionSuccessToast creditsGranted={creditsGranted} />
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <BookingPendingHero
            booking={booking}
            activity={bookingActivity}
            creditsGranted={creditsGranted}
          />
        </div>
      </div>
    );
  }

  const activity = await getActivity(session.activityId).catch((err) => {
    console.error('[SessionDetailPage] getActivity failed', err);
    return null;
  });

  // Phase initiale au SSR (countdown re-tick côté client via CountdownHero)
  const phase = getChatPhase(session, new Date());

  return (
    <div className="bg-black text-white">
      <SessionSuccessToast
        creditsGranted={(() => {
          if (!activity) return 0;
          try { return computeBundledCredits(activity); } catch { return 0; }
        })()}
      />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col gap-10 sm:gap-12">
        {/* ============= LIEN RETOUR ============= */}
        <Link
          href="/activities"
          className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded self-start"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Voir toutes les activités</span>
        </Link>

        {/* ============= HERO ============= */}
        {/* Phase 9.5 c14 BUG2 + c16 BUG G : derive media + fallback chain
            (sessions auto-créées Phase 9.5 c11 n'ont pas thumbnailMedia → fallback mediaUrls → YouTube chain) */}
        {(() => {
          const { media: heroMedia, imageUrlFallbacks } = deriveSessionHeroMedia(activity);
          return (
            <SessionHero
              session={session}
              phase={phase}
              media={heroMedia}
              imageUrlFallbacks={imageUrlFallbacks}
              partnerName={activity?.partnerName}
              activityPrice={activity?.price}
            />
          );
        })()}

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

        {/* ============= PARTICIPANTS LIST — Phase 9 sub-chantier 1 commit 1/5 ============= */}
        {/* Client island : visibilité gradée selon viewer (past session = public,
            partner / admin / participant confirmé = autorisé, sinon hidden silent).
            Comble Différé Phase 9 ligne 890 architecture.md. */}
        <ParticipantsList sessionId={sessionId} />

        {/* ============= SÉCURITÉ T&S — Phase 7 sub-chantier 6 commit 2/2 ============= */}
        {/* Doctrine §9.sexies E "card session entry point" — wire le partner. */}
        {activity?.partnerId && (
          <SessionTSActions
            partnerId={activity.partnerId}
            partnerName={activity.partnerName ?? ''}
          />
        )}
      </div>
    </div>
  );
}
