/**
 * Phase 9.5 c10.B — Pure share helpers (testables sans DOM).
 *
 * Extraits de <ShareButton> pour pouvoir tester unitairement la logique
 * (priorité Web Share API, fallback clipboard, payload shape).
 *
 * @module
 */

export interface ShareActivityRef {
  activityId: string;
  title?: string;
  name?: string;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unsupported';

/**
 * Construit l'URL canonique d'une activité.
 * Utilise window.location.origin si dispo (browser), sinon process.env.NEXT_PUBLIC_APP_URL,
 * sinon fallback hard-coded production.
 */
export function buildShareUrl(activityId: string): string {
  let origin = '';
  if (typeof window !== 'undefined' && window.location?.origin) {
    origin = window.location.origin;
  } else if (process.env.NEXT_PUBLIC_APP_URL) {
    origin = process.env.NEXT_PUBLIC_APP_URL;
  } else {
    origin = 'https://spordateur.com';
  }
  return `${origin.replace(/\/$/, '')}/activities/${activityId}`;
}

/**
 * Construit le payload Web Share API à partir d'une activité.
 * Title fallback : title → name → 'Activité Spordateur'.
 */
export function buildSharePayload(
  activity: ShareActivityRef,
  url: string,
): SharePayload {
  const label = activity.title || activity.name || 'Activité Spordateur';
  return {
    title: `Spordateur — ${label}`,
    text: `Découvre cette activité : ${label}`,
    url,
  };
}

interface PerformShareOpts {
  /** navigator object (window.navigator OU mock pour tests) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigatorObj?: any;
  payload: SharePayload;
}

/**
 * Tente Web Share API en premier, fallback clipboard, ultime fallback "unsupported".
 *
 * Returns :
 *  - 'shared' : navigator.share a réussi (OS native)
 *  - 'copied' : navigator.clipboard.writeText a réussi (fallback)
 *  - 'cancelled' : user a fermé la sheet OS native (AbortError) — silent côté UX
 *  - 'unsupported' : ni share ni clipboard dispo (caller affiche message)
 */
export async function performShare(opts: PerformShareOpts): Promise<ShareResult> {
  const { navigatorObj, payload } = opts;
  if (!navigatorObj) return 'unsupported';

  // Priorité 1 — Web Share API (mobile iOS/Android, Edge desktop)
  if (typeof navigatorObj.share === 'function') {
    try {
      await navigatorObj.share(payload);
      return 'shared';
    } catch (err) {
      // AbortError : user a fermé la sheet OS → silent (pas un fail)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const name = (err as any)?.name;
      if (name === 'AbortError') return 'cancelled';
      // Sinon fallthrough vers clipboard fallback
    }
  }

  // Priorité 2 — Clipboard API
  if (navigatorObj.clipboard?.writeText) {
    try {
      await navigatorObj.clipboard.writeText(payload.url);
      return 'copied';
    } catch (err) {
      console.warn('[performShare] clipboard fail', err);
      return 'unsupported';
    }
  }

  return 'unsupported';
}
