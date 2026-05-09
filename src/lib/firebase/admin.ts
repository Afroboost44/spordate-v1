/**
 * Phase 9.5 c9.1 — Lazy-init central pour firebase-admin Firestore (server-only).
 *
 * Pattern inline jusqu'ici dupliqué dans /api/checkout, verifyAuth, connectHelpers,
 * featureFlags, /api/admin/* ... Centralisé pour cohérence + tests.
 *
 * Usage (server components, API routes, cron jobs, Cloud Functions adjacents) :
 *   const db = await getAdminDb();
 *   const snap = await db.collection('bookings').doc(id).get();
 *
 * Bypass des Firestore rules (Admin SDK) — n'utiliser QUE pour :
 *  - SSR pages avec ownership check post-fetch (defense-in-depth)
 *  - API routes avec verifyAuth + isAdmin gating
 *  - Cron jobs trustés
 *
 * @module
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;

/**
 * Lazy-init Firebase Admin SDK + Firestore.
 *
 * Utilise FIREBASE_SERVICE_ACCOUNT_KEY si présente, sinon fallback ADC
 * (Application Default Credentials — service account auto-injecté
 * par Vercel/GCP quand running dans un env GCP-aware).
 *
 * @returns Firestore Admin instance (singleton)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAdminDb(): Promise<any> {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

/** @internal — DI seam pour tests (override avec mock Firestore). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setAdminDbForTesting(mock: any | null): void {
  _adminDb = mock;
}
