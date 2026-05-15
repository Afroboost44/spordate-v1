/**
 * Phase B — Modèle commission paramétrable par user × slot (creator | invite).
 *
 * Un user peut recevoir une commission de deux origines :
 *  - slot 'creator' : quelqu'un a acheté via son lien créateur (creator dashboard).
 *  - slot 'invite'  : quelqu'un a acheté via son lien d'invitation (profile parrainage).
 *
 * Pour chaque slot, l'admin choisit :
 *  - mode 'percent'    : % du montant d'achat → CHF dans creator.pendingPayout
 *                        (auto-create creator doc si invité user uniquement)
 *  - mode 'free-class' : N crédits 'creator_voucher_class' offerts au bénéficiaire
 *
 * Defaults rétro-compat avec le comportement avant Phase B :
 *  - creator : { mode: 'percent', value: 10 }   ← matchait creators.commissionRate || 0.10
 *  - invite  : { mode: 'free-class', value: 1 } ← matchait REFERRAL_BONUS_CREDITS = 1
 *
 * Pures (no Firestore, no DOM) → testables unit.
 *
 * @module
 */

export type CommissionMode = 'percent' | 'free-class';

export interface CommissionConfig {
  mode: CommissionMode;
  /**
   * For 'percent'    : pourcentage entier 0-100 (10 = 10%).
   * For 'free-class' : nombre de cours offerts par achat déclencheur (≥ 0).
   */
  value: number;
}

export interface UserCommission {
  creator: CommissionConfig;
  invite: CommissionConfig;
}

export type CommissionSlot = 'creator' | 'invite';

export const DEFAULT_CREATOR_COMMISSION: CommissionConfig = { mode: 'percent', value: 10 };
export const DEFAULT_INVITE_COMMISSION: CommissionConfig = { mode: 'free-class', value: 1 };

function defaultForSlot(slot: CommissionSlot): CommissionConfig {
  return slot === 'creator' ? DEFAULT_CREATOR_COMMISSION : DEFAULT_INVITE_COMMISSION;
}

/**
 * Lit la config commission pour un user + slot, avec defaults et sanitization.
 *  - user vide / pas de `commission` / slot manquant → default du slot
 *  - mode non reconnu → fallback 'percent' (mode principal)
 *  - value non-number / NaN / négative → default value du mode (10 ou 1)
 */
export function resolveUserCommission(
  user: { commission?: Partial<UserCommission> } | null | undefined,
  slot: CommissionSlot,
): CommissionConfig {
  const raw = user?.commission?.[slot];
  const def = defaultForSlot(slot);
  if (!raw || typeof raw !== 'object') return def;

  const mode: CommissionMode =
    raw.mode === 'percent' || raw.mode === 'free-class' ? raw.mode : 'percent';

  const defaultValueForMode = mode === 'percent' ? 10 : 1;
  const value =
    typeof raw.value === 'number' && Number.isFinite(raw.value) && raw.value >= 0
      ? raw.value
      : defaultValueForMode;

  return { mode, value };
}

/**
 * Calcule la commission CHF (centimes) pour un mode 'percent'.
 * @param amount montant d'achat en centimes CHF
 * @param value  pourcentage entier (10 = 10%)
 * @returns centimes CHF arrondis (0 si inputs invalides ou ≤ 0)
 */
export function computePercentCommission(amount: number, value: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(amount * (value / 100));
}

/**
 * Calcule le nombre de crédits 'free-class' à octroyer pour un mode 'free-class'.
 * Phase B MVP : value = nombre de cours offerts directement par achat déclencheur.
 * @param value valeur de la config (≥ 0). Floats → floor.
 * @returns entier ≥ 0
 */
export function computeFreeClassCredits(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
