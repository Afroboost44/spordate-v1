/**
 * Spordateur — Phase 5
 * /sessions — Page publique principale (discovery + anti-ghost-town).
 *
 * Server Component (async, fetch SSR). ISR via revalidate=60.
 *
 * Sections (top → bottom, ordre anti-ghost-town optimal) :
 * 1. PAGE HERO : H1 "Sessions à venir" + subtitle brand-positioning + InterestCounter
 * 2. GRID SESSIONS : grid de SessionCard — OU EmptyStateSessions si sessions=[]
 * 3. VILLES À VENIR (Tactique 4 + 6) : 3 WaitlistCityCard depuis MOCK_WAITLIST_CITIES
 * 4. ILS L'ONT DÉJÀ VÉCU (Tactique 3) : PastSessionsGallery (4 Neuchâtel réelles)
 * 5. NOTRE HISTOIRE (Tactique 7) : HeroStorySection avec copy validé Bassi
 *
 * Wording brand-truth :
 * - Hero subtitle neutre ("Du sport pour de vraies rencontres") — vrai à 0/12/100 sessions
 * - Villes à venir : "Spordateur arrive à..." (pas "des partenaires ouvrent" qui implique
 *   activité partenaires non vraie au launch)
 *
 * Stratégie fetch :
 * - getUpcomingSessions() avale les erreurs et retourne [] (cf. service Phase 2).
 *   Phase 5 ne distingue donc pas empty vs error → toujours variant="empty".
 * - getActivity(id) appelé en parallèle (Promise.all + .catch(() => null)) pour
 *   construire activitiesMap (thumbnails). Erreur partielle = dégradation gracieuse.
 *
 * Pas de filtres city/sport Phase 5 (KISS). Phase 7 : searchParams ?city= ?sport=.
 *
 * Métadata : gérée par /sessions/layout.tsx (diff #15), pas de redéclaration ici.
 *
 * Comportement runtime au launch (sessions=[]) :
 * Hero → EmptyState ("Les prochaines sessions arrivent") → Villes à venir →
 * Past Gallery (4 Neuchâtel) → Hero Story. La page reste dense malgré 0 session.
 */

import { getUpcomingSessions, getActivity } from '@/services/firestore';
import { SessionCard } from '@/components/sessions/SessionCard';
import { EmptyStateSessions } from '@/components/sessions/EmptyStateSessions';
import { InterestCounter } from '@/components/sessions/InterestCounter';
import { WaitlistCityCard } from '@/components/sessions/WaitlistCityCard';
import { PastSessionsGallery } from '@/components/sessions/PastSessionsGallery';
import { HeroStorySection } from '@/components/sessions/HeroStorySection';
import { MOCK_WAITLIST_CITIES, MOCK_INTEREST_COUNT } from '@/lib/sessions-mock';
import type { Session, Activity } from '@/types/firestore';

// ISR : revalidate la page toutes les 60s (équilibre fraîcheur countdown vs coût Firestore)
export const revalidate = 60;

// Copy "Notre histoire" validé par Bassi (cf. JSDoc HeroStorySection)
const HERO_STORY_TITLE = 'Notre histoire';

const HERO_STORY_PARAGRAPHS = [
  "Spordateur est née à Genève en 2026 d'une conviction simple : le sport est le meilleur prétexte pour faire de vraies rencontres.",
  "Plutôt que de scroller des profils anonymes, viens bouger en groupe, transpirer, rire — et rencontrer naturellement les gens qui partagent ton énergie.",
  "On commence avec Afroboost, l'origine du concept. Lausanne, Zürich et Bern arrivent au fur et à mesure que des partenaires sportifs nous rejoignent.",
];

const HERO_STORY_PHOTO = {
  src: '/past-sessions/1.jpg',
  alt: "Cours Afroboost Silent en plein air aux Jeunes-Rives de Neuchâtel",
};

export default async function SessionsPage() {
  // 1. Fetch sessions (service swallow errors → [] sur erreur)
  let sessions: Session[] = [];
  try {
    sessions = await getUpcomingSessions({ limit: 12 });
  } catch (err) {
    console.error('[SessionsPage] getUpcomingSessions failed', err);
  }

  // 2. Fetch activities concernées en parallèle (pour thumbnails)
  const activitiesMap = new Map<string, Pick<Activity, 'thumbnailMedia'>>();
  if (sessions.length > 0) {
    const uniqueActivityIds = [...new Set(sessions.map((s) => s.activityId))];
    const activities = await Promise.all(
      uniqueActivityIds.map((id) =>
        getActivity(id).catch((err) => {
          console.error(`[SessionsPage] getActivity(${id}) failed`, err);
          return null;
        }),
      ),
    );
    activities.forEach((a) => {
      if (a) {
        activitiesMap.set(a.activityId, { thumbnailMedia: a.thumbnailMedia });
      }
    });
  }

  return (
    <div className="bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col gap-12 sm:gap-16">
        {/* ============= HERO ============= */}
        <header className="flex flex-col gap-4">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl text-white font-light leading-tight">
            Sessions à venir
          </h1>
          <p className="text-base sm:text-lg text-white/70 font-light max-w-2xl">
            Du sport pour de vraies rencontres en Suisse romande. Pas de swipe, du sport ensemble.
          </p>
          <InterestCounter count={MOCK_INTEREST_COUNT} />
        </header>

        {/* ============= GRID SESSIONS / EMPTY STATE ============= */}
        {sessions.length === 0 ? (
          <EmptyStateSessions variant="empty" />
        ) : (
          <section aria-labelledby="upcoming-sessions-heading">
            <h2 id="upcoming-sessions-heading" className="sr-only">
              Liste des prochaines sessions
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0">
              {sessions.map((session) => (
                <li key={session.sessionId}>
                  <SessionCard
                    session={session}
                    media={activitiesMap.get(session.activityId)?.thumbnailMedia}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ============= VILLES À VENIR (Tactiques 4 + 6) ============= */}
        <section
          aria-labelledby="waitlist-cities-heading"
          className="flex flex-col gap-5"
        >
          <header className="flex flex-col gap-1">
            <h2
              id="waitlist-cities-heading"
              className="text-2xl sm:text-3xl text-white font-light"
            >
              Villes à venir
            </h2>
            <p className="text-sm sm:text-base text-white/70 font-light">
              Spordateur arrive à Lausanne, Zürich et Bern. Inscris-toi pour être prévenu·e dès la première session de ta ville.
            </p>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MOCK_WAITLIST_CITIES.map((city) => (
              <WaitlistCityCard
                key={city.city}
                city={city.city}
                expectedDate={city.expectedDate}
                interested={city.interested}
              />
            ))}
          </div>
        </section>

        {/* ============= ILS L'ONT DÉJÀ VÉCU (Tactique 3) ============= */}
        <PastSessionsGallery />

        {/* ============= NOTRE HISTOIRE (Tactique 7) ============= */}
        <HeroStorySection
          title={HERO_STORY_TITLE}
          paragraphs={HERO_STORY_PARAGRAPHS}
          heroPhoto={HERO_STORY_PHOTO}
        />
      </div>
    </div>
  );
}
