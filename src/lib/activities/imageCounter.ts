/**
 * BUG #29 — Helper pur formatImageCounter pour indiquer la position dans
 * un mini-carousel d'image (X/Y badge en haut-droite de la card LISTE).
 *
 * Defensive sur tous inputs (NaN, négatifs, out-of-range clamp).
 * Retourne null si rien à afficher (1 item ou 0 → pas de hint nécessaire).
 *
 * @module
 */

/**
 * @returns "currentIndex+1/total" (1-based) ou null si pas pertinent
 */
export function formatImageCounter(currentIndex: number, total: number): string | null {
  if (!Number.isFinite(currentIndex) || !Number.isFinite(total)) return null;
  if (total <= 1) return null;
  const clampedIndex = Math.max(0, Math.min(total - 1, Math.floor(currentIndex)));
  return `${clampedIndex + 1}/${total}`;
}
