/**
 * Phase 9.5 c11.1 — Timestamp helpers (SSR→Client serialization safe).
 *
 * CONTEXTE :
 * Quand un Server Component passe un Firestore Timestamp à un Client Component
 * via props, Next.js sérialise la classe Timestamp en `{seconds, nanoseconds}`
 * pendant l'hydratation. Le Timestamp perd alors ses méthodes `.toMillis()` et
 * `.toDate()`. Tout `client.toMillis()` / `client.toDate()` crashe alors avec
 * "TypeError: e.toMillis is not a function".
 *
 * Ces helpers gèrent les 4 formats input :
 *  - Firestore Timestamp class (méthodes toMillis/toDate intactes)
 *  - Date instance native
 *  - epoch ms (number)
 *  - Sérialisé JSON `{seconds, nanoseconds}` (post-SSR)
 *
 * Usage côté Client Component qui reçoit des Timestamps via props :
 *   const ms = tsToMs(review.createdAt);
 *   const date = tsToDate(review.createdAt);
 *
 * @module
 */

/**
 * Convertit un Timestamp/Date/number/sérialisé en epoch ms.
 *
 * @returns ms epoch ; 0 si non-convertible (avec console.warn defensive)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tsToMs(raw: any): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (typeof raw.seconds === 'number') {
    const nanos = typeof raw.nanoseconds === 'number' ? raw.nanoseconds : 0;
    return raw.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  if (typeof console !== 'undefined') {
    console.warn('[tsToMs] unsupported timestamp shape', raw);
  }
  return 0;
}

/**
 * Convertit un Timestamp/Date/number/sérialisé en Date.
 *
 * @returns Date instance ; null si non-convertible
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tsToDate(raw: any): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw.toDate === 'function') return raw.toDate();
  if (typeof raw.toMillis === 'function') return new Date(raw.toMillis());
  if (typeof raw.seconds === 'number') {
    const nanos = typeof raw.nanoseconds === 'number' ? raw.nanoseconds : 0;
    return new Date(raw.seconds * 1000 + Math.floor(nanos / 1_000_000));
  }
  if (typeof raw === 'number') return new Date(raw);
  return null;
}
