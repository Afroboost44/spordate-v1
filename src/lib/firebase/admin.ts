/**
 * Phase 9.5 c9.1 — Lazy-init central pour firebase-admin (server-only).
 * Cleanup phase auth defensive : intègre parseServiceAccountKeyDefensive
 * (verifyAuth.ts) pour gérer le format .env Vercel CLI corrompu en local
 * (newlines littéraux dans private_key qui cassent JSON.parse natif).
 *
 * Pattern inline auparavant dupliqué dans 25+ endpoints. Centralisé pour
 * cohérence + fix défensif local.
 *
 * Usage (server components, API routes, cron jobs) :
 *   const db = await getAdminDb();
 *   const snap = await db.collection('bookings').doc(id).get();
 *
 *   const auth = await getAdminAuth();
 *   await auth.verifyIdToken(token);
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
 * Init idempotent du Firebase Admin App. Réutilise l'app existante si déjà
 * initialisée (getApps().length check). Utilise parseServiceAccountKeyDefensive
 * pour gérer le cas .env Vercel CLI corrompu.
 */
async function ensureAdminApp() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const apps = getApps();
  if (apps.length > 0) return apps[0];

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
    return initializeApp({
      credential: cert(
        parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0],
      ),
    });
  }

  return initializeApp({
    projectId: (
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      'spordateur-claude'
    ).trim(),
  });
}

/**
 * Lazy-init Firebase Admin SDK + Firestore.
 *
 * Utilise FIREBASE_SERVICE_ACCOUNT_KEY si présente (parsée défensivement
 * pour supporter le format .env Vercel CLI avec newlines littéraux),
 * sinon fallback ADC (Application Default Credentials — service account
 * auto-injecté par Vercel/GCP quand running dans un env GCP-aware).
 *
 * @returns Firestore Admin instance (singleton)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAdminDb(): Promise<any> {
  if (_adminDb) return _adminDb;
  await ensureAdminApp();
  const { getFirestore } = await import('firebase-admin/firestore');
  _adminDb = getFirestore();
  return _adminDb;
}

/**
 * Lazy-init Firebase Admin SDK + Auth.
 * Same defensive parse pattern que getAdminDb.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAdminAuth(): Promise<any> {
  await ensureAdminApp();
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth();
}

/** @internal — DI seam pour tests (override avec mock Firestore). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setAdminDbForTesting(mock: any | null): void {
  _adminDb = mock;
}
