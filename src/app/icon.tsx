/**
 * Accent feature Phase 2 — Favicon dynamique.
 *
 * Next.js icon.tsx convention : génère le favicon dynamiquement via
 * ImageResponse (next/og). Le favicon suit la couleur admin configurée
 * dans settings/site.primaryColor (Firestore, propagation realtime).
 *
 * Output : PNG 32×32 rasterisé depuis du JSX SVG par Satori.
 * Runtime : nodejs (firebase-admin nécessaire pour read Firestore).
 * Cache : revalidate=60s (1 min) — propagation rapide après save admin
 * sans hammer Firestore à chaque request.
 *
 * Fallback : si Firestore unreachable ou settings absent → charte default
 * #D91CD2 (cohérent globals.css :root et public/favicon.ico static).
 *
 * Shape : logo "S" Spordateur (path courbe + 2 cercles) repris du composant
 * SpordateurLogo + offline.html. Stroke + fill cercles utilisent la couleur
 * d'accent dynamique.
 *
 * @module
 */

import { ImageResponse } from 'next/og';

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

export default async function Icon() {
  const color = await getAccentColor();
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: 'transparent',
        }}
      >
        <svg viewBox="0 0 32 32" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M20.5 8C20.5 8 22.5 8 22.5 10.5C22.5 13 18 13.5 16 14.5C14 15.5 9.5 16 9.5 19.5C9.5 23 13 24 13 24"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="16" cy="7.5" r="2" fill={color} fillOpacity="0.6" />
          <circle cx="16" cy="24.5" r="2" fill={color} fillOpacity="0.6" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
