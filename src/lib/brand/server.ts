/**
 * Fix #128 — Server-side helper pour lire settings/site.brand au SSR.
 *
 * Le RootLayout (server component) appelle getServerBrand() et injecte des
 * <link> tags explicites dans <head> pour favicon, apple-touch-icon, etc.
 * Ces liens écrasent les défauts statiques de public/icons/ et la metadata
 * Next.js → le navigateur utilise les logos uploadés par l'admin.
 *
 * Utilise Firebase Admin SDK (bypass rules), avec unstable_cache 60s pour
 * limiter les reads Firestore par requête SSR. Trade-off : update admin
 * met jusqu'à 60s à apparaître sur nouveaux SSR ; les pages déjà ouvertes
 * gardent l'ancien favicon jusqu'au reload — acceptable.
 *
 * @module
 */

import { unstable_cache } from 'next/cache';
import { getAdminDb } from '@/lib/firebase/admin';
import type { BrandLogos } from '@/lib/brand/generateLogos';

async function fetchBrand(): Promise<BrandLogos | null> {
  try {
    const db = await getAdminDb();
    const snap = await db.collection('settings').doc('site').get();
    if (!snap.exists) return null;
    const data = snap.data();
    const brand = data?.brand;
    if (!brand || typeof brand !== 'object') return null;
    // On retourne tel quel : le caller (layout) vérifie chaque URL avant d'injecter le link.
    return brand as BrandLogos;
  } catch {
    return null;
  }
}

const getCachedBrand = unstable_cache(fetchBrand, ['site-brand-logos'], {
  revalidate: 60,
  tags: ['theme:site', 'brand:logos'],
});

/**
 * Récupère le sous-document brand depuis settings/site (server-side, cached 60s).
 * Retourne null si aucune génération admin n'a encore été faite.
 */
export async function getServerBrand(): Promise<BrandLogos | null> {
  return getCachedBrand();
}
