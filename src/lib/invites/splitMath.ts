/**
 * Phase 9 sub-chantier 2 commit 2/6 — Helper pure computeSplitAmounts.
 *
 * Doctrine §E.Q1 Phase 9 (votes Q1=A / Q4=B / Q5=A) :
 *   - Mode 'individual' (Phase 8 SC4 legacy) : invité paye 100% (inviter ne paye rien)
 *   - Mode 'split' (Phase 9 SC2) : inviter paye splitInviterRatio (10-90%), invité le reste
 *   - Mode 'gift' (Phase 9 SC2) : inviter paye 100%, invité paye 0
 *
 * Application fee Spordate (Q4=B) : 5% flat Phase 9 (configurable env var
 * `SPORDATE_INVITE_FEE_PCT`). Appliquée sur chaque part pour modes Split (cohérent
 * destination charges multi-payment), sur la totalité pour Individual + Gift (1
 * payment unique).
 *
 * Round-up resolution (anti orphan cent) : pour Split, inviterCents = round(total * ratio),
 * inviteeCents = totalCents - inviterCents. Garantit `inviterCents + inviteeCents === totalCents`.
 */

/**
 * Application fee % Spordate (Q4=B Phase 9 SC2 — 5% flat, configurable env).
 * Lazy resolution pour permettre tuning sans redeploy.
 */
export function getApplicationFeePct(): number {
  const raw = process.env.SPORDATE_INVITE_FEE_PCT;
  if (!raw) return 5;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
    console.warn('[splitMath] SPORDATE_INVITE_FEE_PCT invalide, fallback 5%', { raw });
    return 5;
  }
  return parsed;
}

/** Min split ratio (Q5=A 10%) — anti zero-split (= individual sinon). */
export const MIN_SPLIT_RATIO = 0.1;
/** Max split ratio (Q5=A 90%) — anti 100% split (= gift sinon). */
export const MAX_SPLIT_RATIO = 0.9;

export type SplitMathErrorCode =
  | 'invalid-mode'
  | 'invalid-ratio'
  | 'invalid-total'
  | 'ratio-required';

export class SplitMathError extends Error {
  public readonly code: SplitMathErrorCode;
  constructor(code: SplitMathErrorCode, message: string) {
    super(message);
    this.name = 'SplitMathError';
    this.code = code;
  }
}

import type { InviteMode } from '@/types/firestore';

export interface ComputeSplitInput {
  /** Total session price en CHF centimes (server-recomputed anti-cheat). */
  totalCents: number;
  /** Mode invite (default 'individual' si absent). */
  mode: InviteMode;
  /** Ratio inviter [0.1, 0.9] (Q5=A). Required pour mode='split'. */
  splitInviterRatio?: number;
}

export interface ComputeSplitOutput {
  /** Montant inviter en CHF centimes. 0 pour mode='individual'. */
  inviterCents: number;
  /** Montant invité en CHF centimes. 0 pour mode='gift'. */
  inviteeCents: number;
  /** Application fee Spordate sur la part inviter (CHF centimes).
   *  0 pour mode='individual' (pas de pre-pay inviter). */
  inviterFeeCents: number;
  /** Application fee Spordate sur la part invité (CHF centimes).
   *  0 pour mode='gift' (pas de payment invité). */
  inviteeFeeCents: number;
}

/**
 * Compute amounts split selon le mode.
 *
 * Validation :
 *  - mode in enum (sinon SplitMathError 'invalid-mode')
 *  - totalCents > 0 + integer (sinon 'invalid-total')
 *  - splitInviterRatio in [0.1, 0.9] pour mode='split' (sinon 'invalid-ratio'/'ratio-required')
 *
 * Round-up resolution split : inviterCents = Math.round(total * ratio),
 * inviteeCents = total - inviterCents. Garantit somme exacte.
 *
 * Application fee :
 *  - 'individual' : fee uniquement sur invitee (1 payment)
 *  - 'split' : fee sur chaque part (2 payments destination charges)
 *  - 'gift' : fee uniquement sur inviter (1 payment)
 */
export function computeSplitAmounts(input: ComputeSplitInput): ComputeSplitOutput {
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    throw new SplitMathError('invalid-total', `totalCents doit être int > 0 (reçu: ${input.totalCents})`);
  }

  const feePct = getApplicationFeePct();
  const computeFee = (amountCents: number): number =>
    Math.round((amountCents * feePct) / 100);

  switch (input.mode) {
    case 'individual': {
      // Invité paye 100% (cohérent Phase 8 SC4 legacy). Inviter ne paye rien.
      return {
        inviterCents: 0,
        inviteeCents: input.totalCents,
        inviterFeeCents: 0,
        inviteeFeeCents: computeFee(input.totalCents),
      };
    }

    case 'split': {
      if (input.splitInviterRatio === undefined || input.splitInviterRatio === null) {
        throw new SplitMathError(
          'ratio-required',
          'splitInviterRatio requis pour mode=split',
        );
      }
      const ratio = input.splitInviterRatio;
      if (!Number.isFinite(ratio) || ratio < MIN_SPLIT_RATIO || ratio > MAX_SPLIT_RATIO) {
        throw new SplitMathError(
          'invalid-ratio',
          `splitInviterRatio doit être ∈ [${MIN_SPLIT_RATIO}, ${MAX_SPLIT_RATIO}] (reçu: ${ratio})`,
        );
      }
      const inviterCents = Math.round(input.totalCents * ratio);
      const inviteeCents = input.totalCents - inviterCents; // garantit somme exacte
      return {
        inviterCents,
        inviteeCents,
        inviterFeeCents: computeFee(inviterCents),
        inviteeFeeCents: computeFee(inviteeCents),
      };
    }

    case 'gift': {
      // Inviter paye 100%. Invité paye 0.
      return {
        inviterCents: input.totalCents,
        inviteeCents: 0,
        inviterFeeCents: computeFee(input.totalCents),
        inviteeFeeCents: 0,
      };
    }

    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new SplitMathError('invalid-mode', `mode invalide: ${(input as any).mode}`);
    }
  }
}
