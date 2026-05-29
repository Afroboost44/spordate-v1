/**
 * Accent feature Phase 2 — Favicon dynamique.
 *
 * Next.js icon.tsx convention : génère le favicon dynamiquement.
 *
 * Fix #207 — Bug favicon "carré rose" : ce fichier est consommé par Next.js
 * à l'URL `/icon` (généré au build/SSR). Avant ce fix, il rendait toujours
 * le placeholder neutre rose accent même quand l'admin avait uploadé un
 * logo custom dans settings/site.brand. Le RootLayout injecte bien des
 * <link rel="icon"> custom mais certains navigateurs (Chrome desktop sur
 * un nouvel onglet, Edge…) requêtent ce `/icon` en parallèle et l'utilisent
 * en priorité → onglet affichant le carré rose au lieu du logo Bassi.
 *
 * Fix : si l'admin a uploadé un brand custom (icon32Url ou icon192Url dispo
 * dans settings/site.brand → Firestore), on renvoie un Response qui fetch
 * le PNG depuis Firebase Storage et le stream tel quel (PRÉSERVE la
 * transparence native du PNG uploadé, aucune réécriture canvas).
 *
 * Sinon (premier déploiement, pas encore d'upload admin) → on rend le
 * placeholder neutre rose accent comme avant (carré uni #D91CD2, aucun
 * motif "S").
 *
 * Runtime : nodejs (firebase-admin nécessaire pour read Firestore).
 * Cache : revalidate=60s — propagation rapide après save admin.
 *
 * @module
 */

import { ImageResponse } from 'next/og';
import { getServerBrand } from '@/lib/brand/server';

export const runtime = 'nodejs';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';
export const revalidate = 60;

const FALLBACK_HEX = '#D91CD2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;

async function getAdminDb() {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
      initializeApp({
        credential: cert(
          parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0],
        ),
      });
    } else {
      initializeApp({
        projectId: (
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude'
        ).trim(),
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

async function getAccentColor(): Promise<string> {
  try {
    const db = await getAdminDb();
    const snap = await db.collection('settings').doc('site').get();
    const hex = snap.data()?.primaryColor as string | undefined;
    if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      return hex;
    }
  } catch (err) {
    console.warn('[icon.tsx] Firestore read failed, fallback charte:', err instanceof Error ? err.message : err);
  }
  return FALLBACK_HEX;
}

/**
 * Fix #207 — Si brand custom uploadé → fetch + stream le PNG storage.
 * Sinon → ImageResponse placeholder neutre.
 *
 * On préfère icon32Url (taille native pour favicon). À défaut, on remonte
 * sur icon192Url puis icon512Url (le navigateur downscale tout seul).
 */
export default async function Icon() {
  // 1. Brand custom prioritaire — bug favicon rose résolu.
  try {
    const brand = await getServerBrand();
    const customUrl = brand?.icon32Url || brand?.icon192Url || brand?.icon512Url;
    if (customUrl) {
      const res = await fetch(customUrl, { next: { revalidate: 60 } });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return new Response(buf, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=60, s-maxage=60',
          },
        });
      }
    }
  } catch (err) {
    console.warn('[icon.tsx] Brand custom fetch failed, fallback placeholder:', err instanceof Error ? err.message : err);
  }

  // 2. Fallback placeholder neutre (aucun brand uploadé encore).
  // Fix #209 (Hypothèse E) — on garantit un PNG OPAQUE (aucun pixel alpha)
  // via background-color noir sous le carré accent. Si jamais l'ImageResponse
  // produisait du semi-transparent en bord, le fond noir est composé dessous
  // → aucun risque que le launcher Android ajoute un fond blanc système.
  const color = await getAccentColor();
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            backgroundColor: color,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
