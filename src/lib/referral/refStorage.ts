/**
 * Phase A — Capture & persistance du code de parrainage `?ref=CODE` côté client.
 *
 * Flow couvert :
 *   1. Visiteur arrive avec `https://spordateur.com/?ref=CODE` ou `/signup?ref=CODE`.
 *   2. Les pages landing/signup appellent `saveReferralCode(code)` pour persister en
 *      localStorage (TTL 30 jours).
 *   3. Au moment de la création du user Firestore (AuthContext.ensureUserProfile),
 *      `readReferralCode()` est lu et passé comme `referredBy` dans le doc user.
 *      Puis `clearReferralCode()` pour éviter une double-attribution.
 *   4. À chaque checkout (`/api/checkout`), le caller envoie
 *      `resolveActiveReferralCode(userProfile?.referredBy)` dans le body → propagé
 *      à Stripe metadata.referralCode → webhook → processCommission.
 *
 * Pures : storage injectable pour testabilité, SSR-safe (no-op si pas de window).
 *
 * @module
 */

export const REFERRAL_STORAGE_KEY = 'spordateur_ref';

/** TTL 30 jours — assez large pour que le user revienne plus tard sans perdre l'attribution. */
export const REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Sous-ensemble Storage utilisé — facilite l'injection dans les tests. */
export interface RefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredRef {
  code: string;
  expiresAt: number;
}

interface StorageOpts {
  /** Date.now() à injecter pour les tests (par défaut Date.now()). */
  now?: number;
  /**
   * Storage à utiliser. `undefined` → fallback `window.localStorage` (browser).
   * `null` → no-op (SSR-safe explicit).
   */
  storage?: RefStorage | null;
}

function getDefaultStorage(): RefStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Safari private mode, etc. — pas d'accès localStorage → fallback null.
    return null;
  }
}

function resolveStorage(opts: StorageOpts): RefStorage | null {
  if (opts.storage === null) return null;
  return opts.storage ?? getDefaultStorage();
}

/**
 * Persiste le code de parrainage avec TTL 30j. No-op si :
 *  - code vide / whitespace / non-string
 *  - storage indisponible (SSR / private mode)
 */
export function saveReferralCode(code: string, opts: StorageOpts = {}): void {
  const storage = resolveStorage(opts);
  if (!storage) return;
  if (typeof code !== 'string') return;
  const trimmed = code.trim();
  if (!trimmed) return;
  const payload: StoredRef = {
    code: trimmed,
    expiresAt: (opts.now ?? Date.now()) + REFERRAL_TTL_MS,
  };
  try {
    storage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode → silent */
  }
}

/**
 * Retourne le code persisté s'il est encore valide (TTL non dépassé), sinon null.
 * Auto-supprime l'entrée si expirée.
 */
export function readReferralCode(opts: StorageOpts = {}): string | null {
  const storage = resolveStorage(opts);
  if (!storage) return null;
  try {
    const raw = storage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredRef> | null;
    if (
      !data ||
      typeof data.code !== 'string' ||
      typeof data.expiresAt !== 'number'
    ) {
      return null;
    }
    const now = opts.now ?? Date.now();
    if (now > data.expiresAt) {
      try {
        storage.removeItem(REFERRAL_STORAGE_KEY);
      } catch {
        /* silent */
      }
      return null;
    }
    return data.code || null;
  } catch {
    return null;
  }
}

/** Supprime l'entrée persistée (à appeler après consommation au signup). */
export function clearReferralCode(opts: StorageOpts = {}): void {
  const storage = resolveStorage(opts);
  if (!storage) return;
  try {
    storage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* silent */
  }
}

/**
 * Résout le code de parrainage actif pour un user.
 * Priorité :
 *  1. `user.referredBy` (déjà persisté en Firestore) — source de vérité long-terme
 *  2. localStorage `spordateur_ref` — capture transitoire pré-signup
 *  3. '' (aucune attribution)
 *
 * À utiliser dans le body de chaque appel `/api/checkout`.
 */
export function resolveActiveReferralCode(
  userReferredBy: string | null | undefined,
  opts: StorageOpts = {},
): string {
  if (typeof userReferredBy === 'string' && userReferredBy.trim().length > 0) {
    return userReferredBy.trim();
  }
  return readReferralCode(opts) ?? '';
}
