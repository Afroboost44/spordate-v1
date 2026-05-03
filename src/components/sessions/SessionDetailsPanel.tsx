/**
 * Spordateur — Phase 5
 * <SessionDetailsPanel> — Panneau "Détails" de la page session.
 *
 * Server Component (pas de 'use client') — contenu statique, formaté côté serveur
 * via Intl.DateTimeFormat avec timeZone Europe/Zurich (déterministe, pas de drift
 * SSR/CSR).
 *
 * Affiche 4 lignes maximum (icône + label + valeur) :
 * - Date  → "Mardi 14 mai à 17h00" (toujours affichée, Session.startAt obligatoire)
 * - Durée → "60 minutes" (depuis Activity.duration, masquée si absente)
 * - Adresse → Activity.address (masquée si absente)
 * - Crédits chat inclus → "50 crédits" (Activity.chatCreditsBundle ?? 50, toujours affichée)
 *
 * Activity passé optionnel + champs optionnels : si la fetch parent ne ramène pas
 * l'activity (cas dégradé), on n'affiche que la date + crédits par défaut, plutôt
 * que de crasher.
 *
 * Charte stricte :
 * - <dl> sémantique (key-value pairs, lu correctement par SR)
 * - Icône #D91CD2, label white/40 uppercase tracking, valeur white font-light
 * - Border-bottom white/5 entre lignes (séparation discrète)
 * - tabular-nums sur les chiffres (durée, crédits) — alignement vertical
 *
 * Accessibilité :
 * - <h2> hiérarchie (H1 est dans SessionHero)
 * - aria-labelledby sur <section>
 * - <dt> / <dd> sémantique liste de définitions
 *
 * Usage :
 *   <SessionDetailsPanel session={session} activity={activity} />
 */

import { Calendar, Clock, MapPin, MessageCircle } from 'lucide-react';
import type { Session } from '@/types/firestore';

export interface SessionDetailsPanelProps {
  session: Pick<Session, 'startAt'>;
  /** Activity parent. Optionnel — si absent, seules date + crédits par défaut sont affichées. */
  activity?: {
    address?: string;
    duration?: number; // minutes
    chatCreditsBundle?: number;
  };
  className?: string;
}

/**
 * Formate Session.startAt vers "Mardi 14 mai à 17h00" (fr-CH, Europe/Zurich).
 *
 * Timezone explicite Europe/Zurich (Spordateur = produit suisse, garantit
 * cohérence SSR/CSR quel que soit le serveur Vercel utilisé).
 */
function formatSessionDate(startAt: Session['startAt']): string {
  const date = startAt.toDate();
  const dateFmt = new Intl.DateTimeFormat('fr-CH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Zurich',
  });
  const timeFmt = new Intl.DateTimeFormat('fr-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });
  const dateStr = dateFmt.format(date);
  const timeStr = timeFmt.format(date).replace(':', 'h');
  // Capitalisation du jour de la semaine
  const capitalized = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  return `${capitalized} à ${timeStr}`;
}

interface DetailRow {
  Icon: typeof Calendar;
  label: string;
  value: string;
  isNumeric?: boolean;
}

export function SessionDetailsPanel({
  session,
  activity,
  className = '',
}: SessionDetailsPanelProps) {
  const credits = activity?.chatCreditsBundle ?? 50;

  // Construction des lignes (filtrage des optionnelles si absentes)
  const rows: DetailRow[] = [
    { Icon: Calendar, label: 'Date', value: formatSessionDate(session.startAt) },
  ];
  if (activity?.duration !== undefined && activity.duration > 0) {
    rows.push({
      Icon: Clock,
      label: 'Durée',
      value: `${activity.duration} minutes`,
      isNumeric: true,
    });
  }
  if (activity?.address) {
    rows.push({ Icon: MapPin, label: 'Adresse', value: activity.address });
  }
  rows.push({
    Icon: MessageCircle,
    label: 'Crédits chat inclus',
    value: `${credits} crédits`,
    isNumeric: true,
  });

  return (
    <section
      className={`flex flex-col gap-3 ${className}`}
      aria-labelledby="session-details-heading"
    >
      <h2
        id="session-details-heading"
        className="text-base sm:text-lg text-white font-light"
      >
        Détails
      </h2>
      <dl className="flex flex-col">
        {rows.map(({ Icon, label, value, isNumeric }) => (
          <div
            key={label}
            className="flex gap-3 items-start py-3 border-b border-white/5 last:border-0"
          >
            <Icon
              className="h-4 w-4 text-[#D91CD2] flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <dt className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-light">
                {label}
              </dt>
              <dd
                className={`text-sm text-white font-light ${isNumeric ? 'tabular-nums' : ''}`}
              >
                {value}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
