/**
 * Phase 9 sub-chantier 4 commit 2/6 — Genkit flow `moderateReview` (IA-assistée queue admin).
 *
 * Architecture cohérente anti-leak SC2 c2/6 :
 *   1. Hash SHA-256 (rating + comment + activityTitle) → cache lookup 24h
 *   2. wrapAiCall(reviewerHashId) — rate limit 10/user/min (genkit.ts SC0)
 *   3. ai.generate Gemini Flash + SYSTEM_PROMPT_FR few-shot calibration
 *   4. Parse JSON strict {civility, factuality, recommendation, motive} → ModerateReviewOutput
 *   5. Cache write + return
 *
 * Doctrine SC4 :
 *  - Q3=A confirmé : admin keep final decision (IA = suggestion uniquement, no auto-action Phase 9)
 *  - Q5 fallback : Gemini error OU JSON malformed → recommendation='borderline' + motive='ai-error'
 *  - Cohérent §C.Q2 logs IA hashés (jamais contenu raw — caller passe reviewerHashId)
 *  - FR uniquement Phase 9 (DE/IT Phase 10+)
 *
 * DI seam pattern cohérent anti-leak : `__setReviewModeratorGenerateFnForTesting`,
 * `__resetReviewModeratorCacheForTesting`, `__setReviewModeratorNowFnForTesting`.
 */

import { ai, wrapAiCall, AiError } from '../genkit';
import type { ModerateReviewInput, ModerateReviewOutput } from '../types';

// =====================================================================
// Constants
// =====================================================================

/** Cache TTL 24h (cohérent anti-leak §C). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Version modèle hardcodée — bump à chaque calibration prompt. */
export const MODEL_VERSION = 'gemini-2.5-flash-2026-05';

// =====================================================================
// Cache 24h in-memory hash exact (cohérent anti-leak)
// =====================================================================

interface CacheEntry {
  result: ModerateReviewOutput;
  expiresAt: number;
}

const _cache: Map<string, CacheEntry> = new Map();

type NowFn = () => number;
let _nowFn: NowFn = () => Date.now();

function getCached(hash: string): ModerateReviewOutput | null {
  const entry = _cache.get(hash);
  if (!entry) return null;
  if (_nowFn() >= entry.expiresAt) {
    _cache.delete(hash);
    return null;
  }
  return entry.result;
}

function setCached(hash: string, result: ModerateReviewOutput): void {
  _cache.set(hash, { result, expiresAt: _nowFn() + CACHE_TTL_MS });
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// =====================================================================
// Generate function (DI seam pour mock Gemini en tests)
// =====================================================================

type GenerateFn = (prompt: string) => Promise<string>;

const defaultGenerateFn: GenerateFn = async (prompt: string) => {
  const result = await ai.generate({ prompt });
  return result.text ?? '';
};

let _generateFn: GenerateFn = defaultGenerateFn;

/** @internal — DI seam pour mocker ai.generate en tests unitaires. */
export function __setReviewModeratorGenerateFnForTesting(fn: GenerateFn | null): void {
  _generateFn = fn ?? defaultGenerateFn;
}

/** Reset cache pour tests (déterminisme entre cas). */
export function __resetReviewModeratorCacheForTesting(): void {
  _cache.clear();
}

/** Surcharge now() pour tests (expiration cache 24h simulation). */
export function __setReviewModeratorNowFnForTesting(fn: NowFn | null): void {
  _nowFn = fn ?? (() => Date.now());
}

// =====================================================================
// System prompt FR strict (doctrine SC4)
// =====================================================================

const SYSTEM_PROMPT_FR = `Tu es modérateur de reviews pour Spordateur, plateforme suisse de matching sportif.
Doctrine SC4 Phase 9 : ton rôle est d'évaluer la civility et la factuality d'une review 1-2★ AVANT publication.
L'admin garde la décision finale (Q3=A) — ton output est une SUGGESTION pour accélérer le triage.

CONTEXTE : reviews 1-2★ passent en queue admin (status='pending', anonymized=true). Tu reçois rating + comment
+ activityTitle optionnel. Tu retournes 2 scores normalisés [0,1] + recommendation + motive court FR.

CRITÈRES :
- civility 1.0 = parfaitement civil (ex: critique honnête, ton respectueux)
- civility 0.0 = insulte / slur / harassment / propos haineux
- factuality 1.0 = critique factuelle vérifiable (ex: "instructeur arrivé 15min en retard")
- factuality 0.0 = opinion infondée / diffamation / accusation sans preuve

RECOMMENDATION :
- "publish" : civility ≥ 0.7 AND factuality ≥ 0.5 (review utile, pas de risque)
- "reject" : civility < 0.3 OR contenu insultant/diffamatoire (admin = action protection)
- "borderline" : entre les deux (admin doit trancher)

FORMAT DE RÉPONSE OBLIGATOIRE (JSON STRICT, aucun texte avant/après) :
{"civility": 0.0 à 1.0, "factuality": 0.0 à 1.0, "recommendation": "publish"|"reject"|"borderline", "motive": "court FR ≤ 100 chars"}

EXEMPLES :
Review (rating=2): "Cours pas top, instructeur pas très clair sur les pas, je m'attendais à mieux."
→ {"civility": 0.95, "factuality": 0.7, "recommendation": "publish", "motive": "Critique civile et factuelle"}

Review (rating=1): "Quel arnaqueur ce coach, vraiment nul, à éviter."
→ {"civility": 0.4, "factuality": 0.2, "recommendation": "borderline", "motive": "Opinion forte sans détails vérifiables"}

Review (rating=1): "[Insulte raciste] gros [slur], c'est de la merde."
→ {"civility": 0.05, "factuality": 0.0, "recommendation": "reject", "motive": "Insulte / slur — non publiable"}

Review (rating=2): "Studio froid, vestiaires sales, prix élevé pour la qualité."
→ {"civility": 0.95, "factuality": 0.85, "recommendation": "publish", "motive": "Critique factuelle constructive"}

ANALYSE LA REVIEW SUIVANTE :
`;

function buildPrompt(input: ModerateReviewInput): string {
  const titleCtx = input.activityTitle ? ` (activité: "${input.activityTitle}")` : '';
  return `${SYSTEM_PROMPT_FR}\nReview (rating=${input.rating}${titleCtx}): "${input.comment}"`;
}

// =====================================================================
// Main flow
// =====================================================================

/**
 * Phase 9 SC4 c2/6 — runReviewModerator.
 *
 * Pipeline :
 *   1. Cache lookup hash exact (skip Gemini si hit, doctrine §C cache 24h)
 *   2. wrapAiCall(reviewerHashId) — propagation AiError 'rate-limit-exceeded' au caller
 *   3. ai.generate Gemini Flash → JSON strict → ModerateReviewOutput
 *   4. Q5 fallback : Gemini fail OU JSON malformed → motive='ai-error', recommendation='borderline'
 *   5. Cache write + return
 *
 * @param input ModerateReviewInput
 * @returns ModerateReviewOutput (toujours — fallback borderline si error)
 */
export async function runReviewModerator(
  input: ModerateReviewInput,
): Promise<ModerateReviewOutput> {
  const { rating, comment, activityTitle, reviewerHashId } = input;

  // 1. Cache lookup (avant rate limit — cache hits ne consomment pas slot)
  const hashSrc = `${rating}|${comment}|${activityTitle ?? ''}`;
  const hash = await sha256Hex(hashSrc);
  const cached = getCached(hash);
  if (cached) return cached;

  let result: ModerateReviewOutput;

  try {
    // 2. wrapAiCall — rate limit propagation AiError au caller
    const rawText = await wrapAiCall(reviewerHashId, () => _generateFn(buildPrompt(input)));

    // 3. Parse JSON strict
    const parsed = JSON.parse(rawText.trim());

    if (
      typeof parsed.civility !== 'number' ||
      parsed.civility < 0 ||
      parsed.civility > 1 ||
      typeof parsed.factuality !== 'number' ||
      parsed.factuality < 0 ||
      parsed.factuality > 1 ||
      typeof parsed.recommendation !== 'string' ||
      !['publish', 'reject', 'borderline'].includes(parsed.recommendation) ||
      typeof parsed.motive !== 'string'
    ) {
      throw new Error('Invalid JSON structure or out-of-range fields from Gemini');
    }

    result = {
      civility: parsed.civility,
      factuality: parsed.factuality,
      recommendation: parsed.recommendation as 'publish' | 'reject' | 'borderline',
      motive: parsed.motive.slice(0, 100),
      modelVersion: MODEL_VERSION,
    };
  } catch (err) {
    // Rate limit → propagation au caller (cohérent anti-leak)
    if (err instanceof AiError) throw err;

    // Q5 fallback : Gemini error / JSON malformed → borderline (admin tranche)
    console.warn('[review-moderator] Gemini fail or parse error:', err);
    result = {
      civility: 0.5,
      factuality: 0.5,
      recommendation: 'borderline',
      motive: 'ai-error',
      modelVersion: MODEL_VERSION,
    };
  }

  // Cache write (même les erreurs sont cachées 24h pour éviter spam Gemini, cohérent anti-leak)
  setCached(hash, result);
  return result;
}
