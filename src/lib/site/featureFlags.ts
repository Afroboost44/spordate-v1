/**
 * Phase 9.5 c8 — Feature flags central (settings/features Firestore doc).
 *
 * Doctrine launch :
 *  - discoveryEnabled : false par défaut (page Rencontres cachée)
 *  - L'admin peut activer via /admin/manage → tab Site → toggle Rencontres
 *
 * Cache server :
 *  - getFeatureFlagsAdmin() : lazy + 60s in-memory TTL
 *  - invalidateFeatureFlagsCache() : appelé après write admin (toggle)
 *
 * Le hook client `useFeatureFlags` est dans `./useFeatureFlags` (séparation
 * imposée par Next.js 15 pour éviter mix client/server dans un même module).
 *
 * @module
 */

// =====================================================================
// Types
// =====================================================================

export interface FeatureFlags {
  /** Active la page /discovery (Rencontres) + nav item header. Default false (launch). */
  discoveryEnabled: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  discoveryEnabled: false,
};

// =====================================================================
// Server-side cache (Admin SDK paths)
// =====================================================================

let _cachedFlags: FeatureFlags | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60 * 1000;

/**
 * Server-side flag read avec cache 60s in-memory. Utilisé par les API routes
 * qui doivent décider serveur (ex: /api/admin/site/discovery-toggle audit, ou
 * SSR redirect /discovery → /activities).
 *
 * @param db firebase-admin Firestore (caller passe son instance lazy-init)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getFeatureFlagsAdmin(db: any): Promise<FeatureFlags> {
  if (_cachedFlags && Date.now() - _cacheTs < CACHE_TTL_MS) return _cachedFlags;
  try {
    const snap = await db.collection('settings').doc('features').get();
    const data = snap.exists ? (snap.data() as Partial<FeatureFlags>) : null;
    _cachedFlags = {
      discoveryEnabled: data?.discoveryEnabled === true,
    };
    _cacheTs = Date.now();
    return _cachedFlags;
  } catch (err) {
    console.warn('[getFeatureFlagsAdmin] read failed, fallback DEFAULT_FLAGS', err);
    return DEFAULT_FLAGS;
  }
}

/** @internal — invalide cache après write admin (toggle). */
export function invalidateFeatureFlagsCache(): void {
  _cachedFlags = null;
  _cacheTs = 0;
}
