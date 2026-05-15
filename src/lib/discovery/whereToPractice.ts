/**
 * BUG #10 — Helper pur pour le modal "Où pratiquer ?".
 *
 * Group les activités boostées par ville. Une activité est considérée "boostée"
 * si son `partnerId` est présent dans `boostedPartnerIds` (= snapshot de la
 * collection `boosts` filtrée sur active=true + expiresAt>now, calculé par
 * src/app/discovery/page.tsx).
 *
 * Convention de normalisation des villes :
 *  - trim + lowercase pour matcher (anti "Genève" / "geneve" / " GENÈVE ")
 *  - city affichée = première variante rencontrée dans l'ordre `activities[]`
 *    avec sa casse d'origine (premier hit gagne)
 *  - city vide / whitespace / undefined → activité skip
 *
 * Tri sortie : villes triées alpha (Intl.Collator français) pour stabilité.
 *
 * @module
 */

export interface ActivityLike {
  activityId: string;
  partnerId: string;
  city?: string;
  isActive: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface CityGroup<T extends ActivityLike = ActivityLike> {
  /** Forme d'affichage (casse + accents originaux du premier hit). */
  city: string;
  activities: T[];
}

export interface GroupOptions {
  /** Cap total d'activités retournées (across toutes les villes). Défaut 50. */
  max?: number;
}

/**
 * Filtre les activités au partenaire boosté + active, group par ville
 * (case+trim insensible), trie villes alpha, cap au total `max`.
 */
export function groupBoostedActivitiesByCity<T extends ActivityLike>(
  activities: readonly T[],
  boostedPartnerIds: ReadonlySet<string>,
  opts: GroupOptions = {},
): Array<CityGroup<T>> {
  const max = opts.max ?? 50;
  if (max <= 0 || activities.length === 0 || boostedPartnerIds.size === 0) {
    return [];
  }

  // Map: cityKey (lowercased trimmed) → { displayCity, activities[] }
  const buckets = new Map<string, { displayCity: string; activities: T[] }>();
  let totalKept = 0;

  for (const activity of activities) {
    if (totalKept >= max) break;
    if (!activity.isActive) continue;
    if (!boostedPartnerIds.has(activity.partnerId)) continue;
    const rawCity = (activity.city ?? '').trim();
    if (!rawCity) continue;
    // Normalize: lowercase + strip diacritics → "Genève" / "geneve" / " GENÈVE " match
    const key = rawCity
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { displayCity: rawCity, activities: [] };
      buckets.set(key, bucket);
    }
    bucket.activities.push(activity);
    totalKept++;
  }

  const collator = new Intl.Collator('fr', { sensitivity: 'base' });
  return Array.from(buckets.values())
    .map(b => ({ city: b.displayCity, activities: b.activities }))
    .sort((a, b) => collator.compare(a.city, b.city));
}
