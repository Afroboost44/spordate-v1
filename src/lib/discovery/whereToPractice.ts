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
  /** R3c — droit d'entrée déjà tranché en amont (offres Afroboost). */
  estDejaEligible?: boolean;
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
 *
 * BUG #69 — Si `boostedActivityIds` est fourni (Set d'IDs d'activités), une
 * activité est aussi considérée boostée si SON id y figure (modèle per-activity).
 * Sans ce param : fallback comportement historique (partner-level seul).
 *
 * R3c — `estDejaEligible` : un élément peut arriver AVEC son droit d'entrée
 * déjà tranché ailleurs. C'est le cas des offres Afroboost, dont l'éligibilité
 * dépend de règles que ce helper ne connaît pas et ne doit pas apprendre
 * (type métier, propriétaire admin vs partenaire, boost R3b-2 visant
 * précisément cette offre). Le refiltrer ici, ce serait dupliquer la décision
 * à deux endroits — exactement la divergence que les fix #146/#155/#186/#203/
 * #204 ont passé leur temps à réparer.
 *
 * Ce drapeau ne CONTOURNE rien : il est posé par `elementsAfroboostAPratiquer`,
 * qui n'admet que les offres ayant franchi toutes les portes. Une activité
 * native ne le porte jamais, et reste donc soumise aux deux jeux de boosts.
 */
export function groupBoostedActivitiesByCity<T extends ActivityLike & { id?: string }>(
  activities: readonly T[],
  boostedPartnerIds: ReadonlySet<string>,
  opts: GroupOptions & { boostedActivityIds?: ReadonlySet<string> } = {},
): Array<CityGroup<T>> {
  const max = opts.max ?? 50;
  const boostedActivityIds = opts.boostedActivityIds;
  // R3c — la sortie anticipée doit aussi compter les éléments déjà éligibles :
  // une offre admin Afroboost entre SANS le moindre boost, et le raccourci
  // « aucun boost donc rien à montrer » la ferait disparaître.
  const hasAnyBoost =
    boostedPartnerIds.size > 0 ||
    (boostedActivityIds?.size ?? 0) > 0 ||
    activities.some((a) => a?.estDejaEligible === true);
  if (max <= 0 || activities.length === 0 || !hasAnyBoost) {
    return [];
  }

  // Map: cityKey (lowercased trimmed) → { displayCity, activities[] }
  const buckets = new Map<string, { displayCity: string; activities: T[] }>();
  let totalKept = 0;

  for (const activity of activities) {
    if (totalKept >= max) break;
    if (!activity.isActive) continue;
    // BUG #69 — accepte aussi si l'activity est explicitement boostée par son id
    // R3c — ou si son droit d'entrée a déjà été tranché en amont.
    const isActBoosted =
      activity.estDejaEligible === true ||
      (activity.id && boostedActivityIds?.has(activity.id)) ||
      boostedPartnerIds.has(activity.partnerId);
    if (!isActBoosted) continue;
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
