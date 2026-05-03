/**
 * Spordateur — Phase 5
 * <PastSessionsGallery> — Tactique 3 anti-ghost-town : preuve d'historique réel.
 *
 * Server Component (statique, optimisable LCP).
 *
 * ⚠️ DOCTRINE NO-FAKE-CONTENT : n'affiche QUE des photos réelles d'anciens événements
 * Afroboost. Aucun fallback mock. Si <minToShow vraies photos disponibles, le composant
 * retourne null (la section disparaît proprement).
 * Cf. architecture.md §9.ter Tactique 3 + LCD Suisse Art. 3 (publicité trompeuse) +
 * risque réputationnel sur plateforme dating-adjacent.
 *
 * Source de données :
 * - Par défaut : PAST_AFROBOOST_SESSIONS depuis /src/data/past-afroboost-sessions.ts
 * - Override possible via prop `sessions` (utile pour storybook / tests / variantes)
 *
 * Tri : par date ISO descendante (plus récentes en premier). Lexical sort sur
 * YYYY-MM-DD = chronologique, pas besoin de Date object.
 *
 * Charte stricte :
 * - Card non-cliquable (pas de page détail des sessions terminées en Phase 5)
 * - Badge sport top-left en accent #D91CD2
 * - Footer : sport + ville (icône MapPin) + date FR formatée
 * - border-white/10, rounded-xl, overflow-hidden, bg-black/40
 *
 * Layout responsive : 1 col mobile / 2 cols tablet / 3 cols desktop.
 *
 * Accessibilité :
 * - <h2> hiérarchie (l'H1 est dans la page parent)
 * - aria-labelledby sur <section>
 * - alt text obligatoire sur les images (interface l'impose)
 *
 * Usage :
 *   <PastSessionsGallery />                              // utilise PAST_AFROBOOST_SESSIONS
 *   <PastSessionsGallery sessions={customList} />        // override (storybook/tests)
 *   <PastSessionsGallery limit={9} minToShow={6} />      // grilles plus exigeantes
 */

import Image from 'next/image';
import { MapPin } from 'lucide-react';
import {
  PAST_AFROBOOST_SESSIONS,
  type PastAfroboostSession,
} from '@/data/past-afroboost-sessions';

export interface PastSessionsGalleryProps {
  /** Sessions à afficher. Défaut PAST_AFROBOOST_SESSIONS (source réelle). */
  sessions?: PastAfroboostSession[];
  /** Seuil minimum pour afficher la section. Défaut 3 (en dessous → return null).
   *  Forcé à au moins 1 (un minToShow=0 serait dégénéré). */
  minToShow?: number;
  /** Nombre max d'items affichés. Défaut 7 (= total disponible au launch).
   *  Ajuster quand le stock dépasse 12. */
  limit?: number;
  /** Si false, masque le titre + sous-titre. Défaut true. */
  showHeader?: boolean;
  className?: string;
}

/**
 * Formate une date ISO YYYY-MM-DD vers display FR-CH compact ("Sept. 2024").
 * Timezone Europe/Zurich pour cohérence SSR/CSR avec les autres composants.
 */
function formatPastDate(isoDate: string): string {
  const date = new Date(isoDate);
  const fmt = new Intl.DateTimeFormat('fr-CH', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Zurich',
  });
  const str = fmt.format(date); // "sept. 2024"
  return str.charAt(0).toUpperCase() + str.slice(1); // "Sept. 2024"
}

export function PastSessionsGallery({
  sessions,
  minToShow,
  limit,
  showHeader = true,
  className = '',
}: PastSessionsGalleryProps) {
  const items = sessions ?? PAST_AFROBOOST_SESSIONS;
  const threshold = Math.max(minToShow ?? 3, 1);

  // Doctrine no-fake-content : seuil non atteint → masquer la section
  if (items.length < threshold) return null;

  // Tri par date desc (lexical YYYY-MM-DD = chronologique)
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const displayed = sorted.slice(0, limit ?? 7);

  return (
    <section
      className={`flex flex-col gap-5 ${className}`}
      aria-labelledby="past-sessions-heading"
    >
      {showHeader && (
        <header className="flex flex-col gap-1">
          <h2
            id="past-sessions-heading"
            className="text-xl sm:text-2xl text-white font-light"
          >
            Ils l&apos;ont déjà vécu
          </h2>
          <p className="text-sm text-white/70 font-light">
            Sessions Afroboost — l&apos;origine de Spordate.
          </p>
        </header>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0">
        {displayed.map((item) => (
          <li
            key={item.photoSrc}
            className="relative rounded-xl overflow-hidden border border-white/10 bg-black/40"
          >
            <div className="relative w-full aspect-video bg-black">
              <Image
                src={item.photoSrc}
                alt={item.alt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover"
                loading="lazy"
              />
              <span className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] uppercase tracking-wider text-[#D91CD2] font-light">
                {item.sport}
              </span>
            </div>
            <div className="flex flex-col gap-1 p-3">
              <p className="flex items-center gap-1.5 text-sm text-white font-medium leading-tight">
                <span>{item.sport}</span>
                <span className="text-white/20" aria-hidden="true">·</span>
                <MapPin className="h-3 w-3 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
                <span className="text-white/70 font-light">{item.city}</span>
              </p>
              <p className="text-xs text-white/40 font-light tabular-nums">
                {formatPastDate(item.date)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
