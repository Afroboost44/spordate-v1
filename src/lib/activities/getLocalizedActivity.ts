/**
 * Fix #177 — Helpers pour lire le titre et la description d'une Activity dans
 * la langue de l'utilisateur, avec fallback automatique sur le FR.
 *
 * Convention de stockage Firestore (cf. types/firestore.ts Activity) :
 *   activities/{id}.title          (FR — toujours présent, requis)
 *   activities/{id}.description    (FR — toujours présent, requis)
 *   activities/{id}.translations.en.title       (EN — optionnel)
 *   activities/{id}.translations.en.description (EN — optionnel)
 *   activities/{id}.translations.de.title       (DE — optionnel)
 *   activities/{id}.translations.de.description (DE — optionnel)
 *
 * Lecture :
 *   - Si lang === 'fr' ou champ traduit absent/vide → retourne FR
 *   - Sinon retourne la traduction
 *
 * Usage côté composant :
 *   import { useLanguage } from '@/context/LanguageContext';
 *   import { getActivityTitleLocalized } from '@/lib/activities/getLocalizedActivity';
 *   const { language } = useLanguage();
 *   <h2>{getActivityTitleLocalized(activity, language)}</h2>
 *
 * @module
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActivityLike = any;
type Lang = 'fr' | 'en' | 'de';

export function getActivityTitleLocalized(activity: ActivityLike, lang: Lang | string): string {
  if (!activity) return '';
  const fallback = activity.title || activity.name || '';
  if (!lang || lang === 'fr') return fallback;
  const tr = activity.translations;
  if (!tr) return fallback;
  if (lang === 'en' && tr.en?.title && tr.en.title.trim()) return tr.en.title;
  if (lang === 'de' && tr.de?.title && tr.de.title.trim()) return tr.de.title;
  return fallback;
}

export function getActivityDescriptionLocalized(
  activity: ActivityLike,
  lang: Lang | string,
): string {
  if (!activity) return '';
  const fallback = activity.description || '';
  if (!lang || lang === 'fr') return fallback;
  const tr = activity.translations;
  if (!tr) return fallback;
  if (lang === 'en' && tr.en?.description && tr.en.description.trim()) return tr.en.description;
  if (lang === 'de' && tr.de?.description && tr.de.description.trim()) return tr.de.description;
  return fallback;
}
