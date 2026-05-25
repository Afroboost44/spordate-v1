'use client';

/**
 * Fix #181 — Client islands pour afficher le titre + la description d'une
 * activité dans la langue de l'utilisateur (lit useLanguage).
 *
 * Pourquoi 2 composants séparés :
 *  - /activities/[id]/page.tsx est un Server Component (async, fetch SSR)
 *    qui ne peut PAS appeler le hook useLanguage. On crée des Client islands
 *    minimaux pour les zones de texte traduisibles, le reste de la page
 *    reste SSR (SEO + perf).
 *
 * Fallback : si la traduction est absente/vide pour la langue active, on
 * retombe sur le FR (champ d'origine `title` ou `description`). Cf. helper
 * lib/activities/getLocalizedActivity.ts.
 */

import { useLanguage } from '@/context/LanguageContext';
import {
  getActivityTitleLocalized,
  getActivityDescriptionLocalized,
} from '@/lib/activities/getLocalizedActivity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActivityLike = any;

interface LocalizedTitleProps {
  activity: ActivityLike;
  className?: string;
}

export function LocalizedActivityTitle({ activity, className }: LocalizedTitleProps) {
  const { language } = useLanguage();
  return <>{getActivityTitleLocalized(activity, language) || ''}</>;
}

interface LocalizedDescriptionProps {
  activity: ActivityLike;
  className?: string;
}

export function LocalizedActivityDescription({
  activity,
  className,
}: LocalizedDescriptionProps) {
  const { language } = useLanguage();
  const text = getActivityDescriptionLocalized(activity, language);
  if (!text) return null;
  return (
    <p className={className ?? 'text-base text-white/80 font-light leading-relaxed whitespace-pre-line'}>
      {text}
    </p>
  );
}
