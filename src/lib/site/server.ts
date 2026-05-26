/**
 * Fix FOUC home — Server-side fetch du document `settings/site` (string fields)
 * pour SSR-render la home avec les vraies valeurs admin dès le premier paint.
 *
 * Avant ce helper : `src/app/page.tsx` était un client component qui partait
 * d'un `useState({ heroImage: 'unsplash...', primaryColor: 'var(--accent-color)',
 * ...textes par défaut })` puis subscribe Firestore en `useEffect`. Pendant
 * 500ms-1.5s, l'utilisateur voyait l'ancien hero / l'ancienne couleur, puis le
 * setState client écrasait avec la vraie config → flash visuel.
 *
 * Avec ce helper, le Server Component `app/page.tsx` lit settings/site via
 * Admin SDK (bypass rules), passe l'objet en prop initiale au client component,
 * qui l'utilise comme valeur initiale du `useState`. Premier paint = bonne
 * image + bonne couleur, zéro FOUC.
 *
 * Cache : revalidateTag('theme:site') purge après save admin via
 * `/api/admin/site/revalidate`. Sans purge, fallback `revalidate: 60` pour
 * limiter les reads Firestore.
 *
 * @module
 */
import { unstable_cache } from 'next/cache';
import { getAdminDb } from '@/lib/firebase/admin';

/** Sous-ensemble string-only de `settings/site` consommé par la landing. */
export type ServerSiteConfig = Record<string, string>;

async function fetchSiteConfig(): Promise<ServerSiteConfig> {
  try {
    const db = await getAdminDb();
    const snap = await db.collection('settings').doc('site').get();
    if (!snap.exists) return {};
    const data = snap.data() ?? {};
    // Filtre uniquement les champs string (brand est un sous-objet, géré
    // ailleurs via getServerBrand). La home consomme exclusivement des
    // strings : heroImage, heroTitle1/2/3, primaryColor, step*, etc.
    const out: ServerSiteConfig = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // Silent fallback — server fetch peut échouer en local sans .env Admin SDK.
    return {};
  }
}

const getCachedSiteConfig = unstable_cache(
  fetchSiteConfig,
  ['site-config-strings'],
  {
    revalidate: 60,
    tags: ['theme:site'],
  },
);

/**
 * Lit settings/site (champs string only) côté serveur. Cached 60s, purgeable
 * via `revalidateTag('theme:site')`.
 *
 * Retourne `{}` si Firestore unreachable / pas de doc → le caller doit fournir
 * des fallbacks (cf. DEFAULT_SITE dans LandingPageClient).
 */
export async function getServerSiteConfig(): Promise<ServerSiteConfig> {
  return getCachedSiteConfig();
}
