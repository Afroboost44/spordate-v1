/**
 * Fix #204 — Service UNIFIÉ pour récupérer les activités actuellement boostées.
 *
 * Problème historique (récurrent — fix #146, #155, #186, #203, #204) :
 *  - Le modal "Où pratiquer ?" (discovery/page.tsx) avait sa propre query
 *    `boosts` + `activities` + filtre custom.
 *  - Le modal "Choisir une activité" (ActivitySelectorModal.tsx) faisait une
 *    query brute `where('isActive','==',true)` SANS filtre boost → affichait
 *    TOUTES les activités (bug "activité non boostée visible").
 *  - Résultat : 2 fenêtres pour la même intention métier mais 2 listes
 *    différentes pour les mêmes données (bug "incohérence" #3).
 *
 * Solution : UN SEUL service que les 2 modals doivent utiliser. Il :
 *  1. Lit `boosts` (active === true ET expiresAt > now()).
 *  2. Sépare boosts per-activity (avec activityId) vs legacy partner (sans).
 *  3. Lit `activities` (isActive === true).
 *  4. Filtre : ne garde QUE celles dont id ∈ boostedActivityIds OU partnerId
 *     ∈ boostedPartnerIds.
 *  5. Retourne l'OBJET activité COMPLET (jamais cherry-pick) pour que les
 *     call sites puissent appeler `getActivityThumbnail(activity)` selon la
 *     règle CLAUDE.md §9.ter.
 *
 * RÈGLE DURE — toute query Firestore vers `boosts` pour filtrer une UI doit
 * passer par ce service. Test anti-régression :
 *   tests/admin/boosted-cards-data-source.test.js
 *
 * @module
 */

import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  orderBy,
  limit as fsLimit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BoostedActivity = Record<string, any> & {
  id: string;
  partnerId?: string;
  isActive?: boolean;
};

export interface GetBoostedActivitiesFilters {
  /** Filtre client-side sur city (case + accents insensitive). */
  city?: string;
  /** Filtre client-side sur sport (exact match, case insensitive). */
  sport?: string;
  /** Cap résultat. Défaut 100 (chaque modal n'affiche pas plus). */
  max?: number;
}

export interface GetBoostedActivitiesResult {
  activities: BoostedActivity[];
  /** Sets exposés pour cas où le caller doit afficher "n boosts actifs". */
  boostedActivityIds: Set<string>;
  boostedPartnerIds: Set<string>;
}

/**
 * Normalise une string pour comparaison ville/sport (lowercase + remove accents).
 */
function normalize(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Retourne les activités actuellement boostées (active + non-expired).
 *
 * Une activité est "boostée" si :
 *   - son `id` est dans le set boostedActivityIds (boost per-activity, nouveau modèle), OU
 *   - son `partnerId` est dans le set boostedPartnerIds (boost legacy partner-level)
 *
 * Retourne l'objet activité COMPLET (tous les champs Firestore) — les call
 * sites passent ensuite cet objet directement à `getActivityThumbnail(act)`.
 *
 * Si Firestore n'est pas configuré OU aucun boost actif, retourne `{ activities: [] }`.
 * AUCUN fallback "afficher toutes les activités" — la règle est stricte :
 * pas de boost → pas d'affichage dans les modals dédiés.
 */
export async function getBoostedActivities(
  filters: GetBoostedActivitiesFilters = {},
): Promise<GetBoostedActivitiesResult> {
  const max = filters.max ?? 100;
  const empty: GetBoostedActivitiesResult = {
    activities: [],
    boostedActivityIds: new Set<string>(),
    boostedPartnerIds: new Set<string>(),
  };
  if (!db) return empty;

  // 1. Charge les boosts actifs (active === true ET expiresAt > now).
  let boostedActivityIds = new Set<string>();
  let boostedPartnerIds = new Set<string>();
  try {
    const now = Timestamp.now();
    const boostsRef = collection(db, 'boosts');
    const q = query(
      boostsRef,
      where('active', '==', true),
      where('expiresAt', '>', now),
    );
    const snap = await getDocs(q);
    snap.forEach((doc) => {
      const data = doc.data() as {
        activityId?: string;
        partnerId?: string;
      };
      if (data.activityId) {
        boostedActivityIds.add(data.activityId);
      } else if (data.partnerId) {
        boostedPartnerIds.add(data.partnerId);
      }
    });
  } catch (err) {
    console.warn('[getBoostedActivities] failed to load boosts:', err);
    return empty;
  }

  // Aucune entrée boostée → retour direct (pas d'affichage).
  if (boostedActivityIds.size === 0 && boostedPartnerIds.size === 0) {
    return empty;
  }

  // 2. Charge les activities actives. On charge tout (cap 500 défensif) puis
  //    on filtre côté client : la query Firestore composite IN avec 2 sets ne
  //    serait pas faisable directement (limite IN 30 valeurs + besoin de OR
  //    entre id et partnerId qui n'est pas supporté).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allActivities: any[] = [];
  try {
    let snap;
    try {
      const q = query(
        collection(db, 'activities'),
        where('isActive', '==', true),
        orderBy('createdAt', 'desc'),
        fsLimit(500),
      );
      snap = await getDocs(q);
    } catch {
      const q = query(
        collection(db, 'activities'),
        where('isActive', '==', true),
        fsLimit(500),
      );
      snap = await getDocs(q);
    }
    allActivities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[getBoostedActivities] failed to load activities:', err);
    return empty;
  }

  // 3. Filtre : ne garde QUE les activités effectivement boostées (per-activity
  //    ou via partner legacy). Préserve l'objet COMPLET pour getActivityThumbnail.
  const cityFilter = normalize(filters.city);
  const sportFilter = normalize(filters.sport);
  const result: BoostedActivity[] = [];
  for (const act of allActivities) {
    const isBoosted =
      (act.id && boostedActivityIds.has(act.id)) ||
      (act.partnerId && boostedPartnerIds.has(act.partnerId));
    if (!isBoosted) continue;
    if (cityFilter && normalize(act.city) !== cityFilter) continue;
    if (sportFilter && normalize(act.sport) !== sportFilter) continue;
    result.push(act);
    if (result.length >= max) break;
  }

  return {
    activities: result,
    boostedActivityIds,
    boostedPartnerIds,
  };
}
