/**
 * Fix B Option 3 — Validation pure de la date d'une session partner.
 *
 * Règles :
 *  - Doit être finite et numérique (defensive against NaN/Infinity)
 *  - Doit être dans le futur strict (startAtMs > nowMs)
 *  - Max 1 an dans le futur (inclusive — anti-typo si user entre 2125
 *    accidentellement)
 *
 * Utilisé par CreateSessionModal + SessionEditModal côté client, ET côté
 * server par les endpoints POST/PATCH session pour double-validation.
 *
 * @module
 */

export type SessionDateInvalidReason = 'invalid-date' | 'past' | 'too-far';

export interface SessionDateValidationResult {
  valid: boolean;
  reason?: SessionDateInvalidReason;
}

const MAX_FUTURE_MS = 365 * 24 * 3600 * 1000; // 1 an

export function validateSessionDate(startAtMs: number, nowMs: number): SessionDateValidationResult {
  if (!Number.isFinite(startAtMs) || typeof startAtMs !== 'number') {
    return { valid: false, reason: 'invalid-date' };
  }
  if (startAtMs <= nowMs) {
    return { valid: false, reason: 'past' };
  }
  if (startAtMs - nowMs > MAX_FUTURE_MS) {
    return { valid: false, reason: 'too-far' };
  }
  return { valid: true };
}
