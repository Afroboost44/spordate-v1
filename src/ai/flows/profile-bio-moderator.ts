/**
 * Phase 9 sub-chantier 4 commit 5/6 — Genkit flow `runProfileBioModerator` (IA bio scan).
 *
 * Architecture cohérente review-moderator SC4 c2/6 :
 *   1. Hash SHA-256 (bio) → cache lookup 24h
 *   2. wrapAiCall(userHashId) — rate limit 10/user/min (genkit.ts SC0)
 *   3. ai.generate Gemini Flash + SYSTEM_PROMPT_FR few-shot calibration
 *   4. Parse JSON strict {toxicity, profanity, contactLeak, recommendation, motive} → ModerateProfileBioOutput
 *   5. Cache write + return
 *
 * Doctrine SC4 :
 *  - Q3=A confirmé : admin keep final decision (flag = signal admin uniquement, no auto-action Phase 9)
 *  - Q4=B fire-and-forget client-side (cohérent /api/anti-leak SC2 hotfix isolation Genkit)
 *  - Q7=A flag silent + admin queue (bio reste visible — no UX disruption Phase 9)
 *  - Fallback Gemini error / JSON malformed → recommendation='approve' (default permissif Phase 9)
 *  - Cohérent §C.Q2 logs IA hashés (caller passe userHashId)
 *  - FR uniquement Phase 9 (DE/IT Phase 10+)
 *
 * DI seam pattern cohérent review-moderator SC4 c2/6 : `__setProfileBioModeratorGenerateFnForTesting`,
 * `__resetProfileBioModeratorCacheForTesting`, `__setProfileBioModeratorNowFnForTesting`.
 */

import { ai, wrapAiCall, AiError } from '../genkit';
import type { ModerateProfileBioInput, ModerateProfileBioOutput } from '../types';

// =====================================================================
// Constants
// =====================================================================

/** Cache TTL 24h (cohérent review-moderator SC4 c2/6). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Version modèle hardcodée — bump à chaque calibration prompt. */
export const MODEL_VERSION = 'gemini-2.5-flash-bio-2026-05';

// =====================================================================
// Cache 24h in-memory hash exact
// =====================================================================

interface CacheEntry {
  result: ModerateProfileBioOutput;
  expiresAt: number;
}

const _cache: Map<string, CacheEntry> = new Map();

type NowFn = () => number;
let _nowFn: NowFn = () => Date.now();

function getCached(hash: string): ModerateProfileBioOutput | null {
  const entry = _cache.get(hash);
  if (!entry) return null;
  if (_nowFn() >= entry.expiresAt) {
    _cache.delete(hash);
    return null;
  }
  return entry.result;
}

function setCached(hash: string, result: ModerateProfileBioOutput): void {
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
export function __setProfileBioModeratorGenerateFnForTesting(fn: GenerateFn | null): void {
  _generateFn = fn ?? defaultGenerateFn;
}

/** Reset cache pour tests (déterminisme entre cas). */
export function __resetProfileBioModeratorCacheForTesting(): void {
  _cache.clear();
}

/** Surcharge now() pour tests (expiration cache 24h simulation). */
export function __setProfileBioModeratorNowFnForTesting(fn: NowFn | null): void {
  _nowFn = fn ?? (() => Date.now());
}

// =====================================================================
// System prompt FR strict (doctrine SC4)
// =====================================================================

const SYSTEM_PROMPT_FR = `Tu es modérateur bio profil pour Spordateur, plateforme suisse de matching sportif.
Doctrine SC4 Phase 9 : ton rôle est d'évaluer la bio user pour 3 risques distincts AVANT publication continue.

CONTEXTE : bio profil ≤ 500 chars, public sur le profil. Risques modération :
1. toxicity (insultes, slurs, harassment, propos haineux/discriminatoires)
2. profanity (vulgarité non-haineuse — moins grave mais peut nuire au climat)
3. contactLeak (numéros de téléphone, emails, handles réseaux sociaux, plateformes tierces)

CRITÈRES SCORES [0..1] :
- toxicity 0.0 = bio civile / 1.0 = insulte ou slur évidents
- profanity 0.0 = bio courtoise / 1.0 = vulgarité crasse
- contactLeak 0.0 = aucune coordonnée / 1.0 = email/phone/handle évident

RECOMMENDATION :
- "approve" : tous scores < 0.3 (bio acceptable telle quelle)
- "flag" : au moins un score ≥ 0.3 (admin investigue manuellement, bio reste visible Q7=A)

FORMAT DE RÉPONSE OBLIGATOIRE (JSON STRICT, aucun texte avant/après) :
{"toxicity": 0.0 à 1.0, "profanity": 0.0 à 1.0, "contactLeak": 0.0 à 1.0, "recommendation": "approve"|"flag", "motive": "court FR ≤ 100 chars"}

EXEMPLES :
Bio: "Coach yoga depuis 5 ans, basée Genève. Passion: bien-être."
→ {"toxicity": 0.0, "profanity": 0.0, "contactLeak": 0.0, "recommendation": "approve", "motive": "Bio civile et professionnelle"}

Bio: "Sportif passionné. Contactez-moi 079 123 45 67 ou test@gmail.com."
→ {"toxicity": 0.0, "profanity": 0.0, "contactLeak": 0.95, "recommendation": "flag", "motive": "Coordonnées partagées (téléphone + email)"}

Bio: "[Slur raciste], j'aime le sport."
→ {"toxicity": 0.95, "profanity": 0.5, "contactLeak": 0.0, "recommendation": "flag", "motive": "Insulte / slur — non publiable"}

Bio: "Putain de bonne forme aujourd'hui!"
→ {"toxicity": 0.05, "profanity": 0.45, "contactLeak": 0.0, "recommendation": "flag", "motive": "Vulgarité légère, admin tranche"}

ANALYSE LA BIO SUIVANTE :
`;

function buildPrompt(input: ModerateProfileBioInput): string {
  return `${SYSTEM_PROMPT_FR}\nBio: "${input.bio}"`;
}

// =====================================================================
// Main flow
// =====================================================================

/**
 * Phase 9 SC4 c5/6 — runProfileBioModerator.
 *
 * Pipeline :
 *   1. Cache lookup hash exact (skip Gemini si hit, doctrine cache 24h)
 *   2. wrapAiCall(userHashId) — propagation AiError 'rate-limit-exceeded' au caller
 *   3. ai.generate Gemini Flash → JSON strict → ModerateProfileBioOutput
 *   4. Fallback : Gemini fail OU JSON malformed → motive='ai-error', recommendation='approve' (Phase 9 permissif)
 *   5. Cache write + return
 *
 * @param input ModerateProfileBioInput
 * @returns ModerateProfileBioOutput (toujours — fallback approve si error)
 */
export async function runProfileBioModerator(
  input: ModerateProfileBioInput,
): Promise<ModerateProfileBioOutput> {
  const { bio, userHashId } = input;

  if (!bio || bio.length === 0) {
    return {
      toxicity: 0,
      profanity: 0,
      contactLeak: 0,
      recommendation: 'approve',
      motive: 'empty-bio',
      modelVersion: MODEL_VERSION,
    };
  }

  // 1. Cache lookup (avant rate limit — cache hits ne consomment pas slot)
  const hash = await sha256Hex(bio);
  const cached = getCached(hash);
  if (cached) return cached;

  let result: ModerateProfileBioOutput;

  try {
    // 2. wrapAiCall — rate limit propagation AiError au caller
    const rawText = await wrapAiCall(userHashId, () => _generateFn(buildPrompt(input)));

    // 3. Parse JSON strict
    const parsed = JSON.parse(rawText.trim());

    if (
      typeof parsed.toxicity !== 'number' ||
      parsed.toxicity < 0 ||
      parsed.toxicity > 1 ||
      typeof parsed.profanity !== 'number' ||
      parsed.profanity < 0 ||
      parsed.profanity > 1 ||
      typeof parsed.contactLeak !== 'number' ||
      parsed.contactLeak < 0 ||
      parsed.contactLeak > 1 ||
      typeof parsed.recommendation !== 'string' ||
      !['approve', 'flag'].includes(parsed.recommendation) ||
      typeof parsed.motive !== 'string'
    ) {
      throw new Error('Invalid JSON structure or out-of-range fields from Gemini');
    }

    result = {
      toxicity: parsed.toxicity,
      profanity: parsed.profanity,
      contactLeak: parsed.contactLeak,
      recommendation: parsed.recommendation as 'approve' | 'flag',
      motive: parsed.motive.slice(0, 100),
      modelVersion: MODEL_VERSION,
    };
  } catch (err) {
    // Rate limit → propagation au caller (cohérent review-moderator)
    if (err instanceof AiError) throw err;

    // Fallback : Gemini error / JSON malformed → approve (default permissif Phase 9)
    console.warn('[profile-bio-moderator] Gemini fail or parse error:', err);
    result = {
      toxicity: 0,
      profanity: 0,
      contactLeak: 0,
      recommendation: 'approve',
      motive: 'ai-error',
      modelVersion: MODEL_VERSION,
    };
  }

  // Cache write (même les erreurs sont cachées 24h pour éviter spam Gemini, cohérent review-moderator)
  setCached(hash, result);
  return result;
}
