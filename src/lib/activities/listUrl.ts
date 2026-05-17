/**
 * BUG #20 — URL builder pour la page liste activités.
 *
 * Avec activityId : retourne `/activities#activity-{id}`. Le hash déclenche
 * un auto-scroll du browser vers l'élément `id="activity-{id}"` rendu sur
 * /activities (via la prop `id` sur la Card). Permet le flow demandé par
 * Bassi : modal "Où pratiquer ?" → page liste centrée sur l'activité choisie
 * → click miniature → page détail (BUG #21).
 *
 * Sans activityId : retourne `/activities` (entrée standard de la liste).
 *
 * @module
 */

export function buildActivityListUrl(activityId: string | null | undefined): string {
  const id = (activityId ?? '').trim();
  if (!id) return '/activities';
  return `/activities#activity-${id}`;
}
