/**
 * Genkit AI configuration + rate limiting (Phase 8 sub-chantier 0 commit 3/3).
 *
 * Doctrine §C.Q1 / §9.quinquies : Genkit + Gemini 2.5 Flash, FR uniquement Phase 8.
 * Doctrine Q4=A : rate limit per-user 10 calls/min sliding window 60s, in-memory
 * (Phase 8 simple, Firestore-backed Phase 9 si scale).
 *
 * Disclosed CGU §7.quater + Privacy §5 (commit 1/3 d54c7a9). Opt-out user via
 * UserProfile.aiSuggestionsOptIn (commit 2/3 ab46dd9).
 */

import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// =====================================================================
// Genkit instance (config initiale conservée — additif rate limit ci-dessous)
// =====================================================================

export const ai = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-2.5-flash',
});

// =====================================================================
// Rate limiter per-user (Phase 8 — doctrine Q4=A)
// =====================================================================

/** Phase 8 — fenêtre coulissante 60s, max 10 appels Genkit/user/minute. */
export const RATE_LIMIT_MAX_CALLS = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** AiError typée — code = 'rate-limit-exceeded' bloque côté caller. */
export class AiError extends Error {
  public readonly code: 'rate-limit-exceeded' | 'unknown';
  constructor(code: 'rate-limit-exceeded' | 'unknown', message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

/** Map<userId, callTimestamps[]> in-memory. Cleared on process restart (acceptable
 *  Phase 8 — Firestore-backed Phase 9 si scale dépasse 1 process Node). */
const _callsByUser: Map<string, number[]> = new Map();

/** DI seam pour tests : surchage de Date.now (cohérent pattern __set*ForTesting). */
type NowFn = () => number;
let _nowFn: NowFn = () => Date.now();

/**
 * Vérifie + enregistre un appel Genkit pour un user.
 * Throws AiError('rate-limit-exceeded') si > RATE_LIMIT_MAX_CALLS dans la fenêtre.
 * Pure function — appelable depuis n'importe quel call-site flow.
 */
export function checkRateLimit(userId: string): void {
  const now = _nowFn();
  const recent = (_callsByUser.get(userId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_CALLS) {
    throw new AiError(
      'rate-limit-exceeded',
      `Rate limit exceeded for user ${userId} (max ${RATE_LIMIT_MAX_CALLS}/min, window ${RATE_LIMIT_WINDOW_MS}ms).`,
    );
  }
  recent.push(now);
  _callsByUser.set(userId, recent);
}

/**
 * Wrapper appliquant checkRateLimit avant l'appel asynchrone fn.
 * Pattern recommandé pour tous les flows Phase 8 (anti-leak, suggestions).
 *
 * @example
 *   const result = await wrapAiCall(userId, () => ai.generate({ ... }));
 */
export async function wrapAiCall<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  checkRateLimit(userId);
  return fn();
}

// =====================================================================
// DI seams pour tests unitaires (cf. src/ai/__tests__/genkit.test.ts)
// =====================================================================

/** Surcharge le now() interne — null pour reset Date.now standard. */
export function __setNowFnForTesting(fn: NowFn | null): void {
  _nowFn = fn ?? (() => Date.now());
}

/** Reset le store rate limiter (G3 reset après expiration fenêtre). */
export function __resetRateLimitForTesting(): void {
  _callsByUser.clear();
}
