/**
 * Spordateur — Phase 5
 * <UpcomingSessionsWidget> — Widget compact "Prochaines sessions" pour dashboards.
 *
 * Server Component (statique, optimisable LCP, hérite des cards SessionCard qui sont
 * elles-mêmes Server-friendly).
 *
 * Tactique 8 anti-ghost-town : afficher 2-3 sessions avec un mix de remplissage
 * (pas tout à "1 place restante", pas tout vide). Ce widget orchestre l'affichage
 * compact mais ne génère PAS de scarcity factice : le sous-titre par défaut est
 * neutre. Le parent peut injecter un sous-titre urgent UNIQUEMENT si les données
 * le justifient (ex: toutes les sessions affichées sont >70% remplies réellement).
 *
 * Contexte d'usage Phase 7 (le widget est créé Phase 5, consommé Phase 7) :
 * - Dashboard /profile (encart "Tes prochaines sessions")
 * - Page /activities/[activityId] (encart "Prochaines dates de ce cours")
 * - Pas consommé sur /sessions home (qui utilise SessionCard direct en grid pleine largeur)
 *
 * Comportement :
 * - sessions.length === 0 → return null (pas de double-empty, le parent gère via
 *   EmptyStateSessions si pertinent)
 * - sessions.length > 0 → header (titre + sous-titre) + liste cards empilées + lien "Voir toutes"
 *
 * Tri : le parent doit fournir sessions déjà triées startAt asc (cohérent service Phase 2
 * getUpcomingSessions). Le widget ne re-trie pas pour éviter le coût.
 *
 * Charte stricte :
 * - H3 (le widget vit dans une page ayant H1+H2 ailleurs)
 * - Cards empilées gap-3 (densité dashboard)
 * - Lien "Voir toutes" en accent #D91CD2 + ArrowRight
 * - Pas de border externe (s'intègre dans le layout du parent)
 *
 * Accessibilité :
 * - <section aria-labelledby="upcoming-sessions-widget-heading">
 * - Lien aria-label complet pour SR
 *
 * Usage :
 *   <UpcomingSessionsWidget sessions={upcoming} />
 *   <UpcomingSessionsWidget sessions={upcoming} limit={5} cardVariant="full" />
 *   <UpcomingSessionsWidget
 *     sessions={upcoming}
 *     activitiesMap={activities}
 *     subtitle="Réserve avant que ça remplisse."   // override urgent UNIQUEMENT si données réelles >70% fill
 *   />
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SessionCard } from './SessionCard';
import type { Session, Activity } from '@/types/firestore';

const DEFAULT_SUBTITLE = 'Choisis ta prochaine date.';

export interface UpcomingSessionsWidgetProps {
  /** Sessions à afficher (depuis getUpcomingSessions Phase 2). Trié startAt asc par le parent. */
  sessions: Session[];
  /** Map activityId → Activity (pour récupérer thumbnailMedia). Optionnel. */
  activitiesMap?: Map<string, Pick<Activity, 'thumbnailMedia'>>;
  /** Nombre max de sessions affichées. Défaut 3. */
  limit?: number;
  /** Titre. Défaut 'Prochaines sessions'. */
  title?: string;
  /**
   * Sous-titre. Défaut "Choisis ta prochaine date." (neutre, action-oriented).
   *
   * ⚠️ Le parent peut injecter une variante urgente UNIQUEMENT si les données
   * le justifient (ex: toutes les sessions affichées >70% remplies). Sinon
   * laisser le défaut neutre — éviter la fake-urgency Tactique 8.
   */
  subtitle?: string;
  /** Lien "Voir toutes". Défaut '/sessions'. */
  viewAllHref?: string;
  /** Si false, masque le header (titre + sous-titre). Défaut true. */
  showHeader?: boolean;
  /** Variant card sous-jacent. Défaut 'compact' (densité dashboard). */
  cardVariant?: 'full' | 'compact';
  className?: string;
}

export function UpcomingSessionsWidget({
  sessions,
  activitiesMap,
  limit = 3,
  title = 'Prochaines sessions',
  subtitle = DEFAULT_SUBTITLE,
  viewAllHref = '/sessions',
  showHeader = true,
  cardVariant = 'compact',
  className = '',
}: UpcomingSessionsWidgetProps) {
  if (sessions.length === 0) return null;

  const displayed = sessions.slice(0, limit);

  return (
    <section
      aria-labelledby="upcoming-sessions-widget-heading"
      className={`flex flex-col gap-4 ${className}`}
    >
      {showHeader && (
        <header className="flex flex-col gap-1">
          <h3
            id="upcoming-sessions-widget-heading"
            className="text-lg sm:text-xl text-white font-light leading-tight"
          >
            {title}
          </h3>
          <p className="text-sm text-white/70 font-light">{subtitle}</p>
        </header>
      )}

      <ul className="flex flex-col gap-3 list-none p-0 m-0">
        {displayed.map((session) => {
          const media = activitiesMap?.get(session.activityId)?.thumbnailMedia;
          return (
            <li key={session.sessionId}>
              <SessionCard
                session={session}
                variant={cardVariant}
                media={media}
              />
            </li>
          );
        })}
      </ul>

      <Link
        href={viewAllHref}
        aria-label="Voir toutes les sessions"
        className="inline-flex items-center gap-1.5 self-start text-sm text-[#D91CD2] font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded"
      >
        <span>Voir toutes</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
