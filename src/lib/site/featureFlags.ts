/**
 * Phase 9.5 c8 — Feature flags central (settings/features Firestore doc).
 * Phase 9.5 c21 — discoveryMode 3-state (disabled / participants-only / open-to-all)
 *               + backward compat boolean discoveryEnabled (legacy c8).
 *
 * Doctrine launch :
 *  - discoveryMode='disabled' par défaut (page Rencontres cachée)
 *  - L'admin peut activer via /admin/manage → tab Site → radio 3 options :
 *    1. 'disabled' : page cachée
 *    2. 'participants-only' : page visible, users filtrés par partners opt-in
 *    3. 'open-to-all' : page visible, tous users (legacy comportement)
 *
 * Backward compat c8 : si Firestore contient encore discoveryEnabled boolean
 * (pas encore migré), on map true → 'open-to-all', false → 'disabled'.
 *
 * @module
 */

// =====================================================================
// Types
// =====================================================================

export type DiscoveryMode = 'disabled' | 'participants-only' | 'open-to-all';

export interface FeatureFlags {
  /** Phase 9.5 c21 — mode 3-state pour /discovery. */
  discoveryMode: DiscoveryMode;
  /**
   * Backward compat c8 — boolean dérivé (true si mode !== 'disabled').
   * @deprecated Utiliser `discoveryMode` directement. Conservé pour ne pas casser
   * les consumers c8 (Header navigation, /discovery redirect) durant migration.
   */
  discoveryEnabled: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  discoveryMode: 'disabled',
  discoveryEnabled: false,
};

/**
 * Phase 9.5 c21 — Normalise Firestore raw data → FeatureFlags.
 *
 * Backward compat : si `discoveryMode` absent mais `discoveryEnabled` présent
 * (legacy c8 Firestore docs pas encore migrés), dérive mode depuis boolean :
 *   - true  → 'open-to-all' (préserve comportement legacy)
 *   - false → 'disabled'
 *
 * Si NI `discoveryMode` NI `discoveryEnabled` → 'disabled' (default launch).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeFlags(raw: any): FeatureFlags {
  if (!raw) return DEFAULT_FLAGS;
  let mode: DiscoveryMode;
  if (raw.discoveryMode === 'open-to-all' || raw.discoveryMode === 'participants-only' || raw.discoveryMode === 'disabled') {
    mode = raw.discoveryMode;
  } else if (raw.discoveryEnabled === true) {
    // Legacy c8 boolean true → 'open-to-all' (préserve comportement)
    mode = 'open-to-all';
  } else {
    mode = 'disabled';
  }
  return {
    discoveryMode: mode,
    discoveryEnabled: mode !== 'disabled',
  };
}

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
    const data = snap.exists ? snap.data() : null;
    _cachedFlags = normalizeFlags(data);
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
