/**
 * Accent feature Phase 2 — Favicon dynamique.
 *
 * Next.js icon.tsx convention : génère le favicon dynamiquement via
 * ImageResponse (next/og). Le favicon suit la couleur admin configurée
 * dans settings/site.primaryColor (Firestore, propagation realtime).
 *
 * Output : PNG 32×32 rasterisé depuis du JSX par Satori.
 * Runtime : nodejs (firebase-admin nécessaire pour read Firestore).
 * Cache : revalidate=60s (1 min) — propagation rapide après save admin
 * sans hammer Firestore à chaque request.
 *
 * Fallback : si Firestore unreachable ou settings absent → charte default
 * #D91CD2.
 *
 * Fix #206 — ON N'AFFICHE PLUS LE "S" SPORDATEUR. Bassi a demandé la
 * suppression totale et définitive de l'ancien logo "S". Cette icon.tsx
 * rend désormais un carré uni de la couleur d'accent (placeholder neutre),
 * SANS aucun motif ni path. Si l'admin uploade un brand custom, le
 * layout.tsx injecte des <link rel="icon"> explicites qui prennent priorité
 * sur ce fichier.
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
  // Fix #206 — Placeholder neutre : carré uni couleur d'accent, AUCUN motif.
  // L'ancien rendu (path "S" + 2 cercles) a été supprimé définitivement.
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: color,
        }}
      />
    ),
    { ...size },
  );
}
