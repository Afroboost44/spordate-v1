/**
 * Phase 8 sub-chantier 2 commit 2/6 — Anti-leak Layer 2 IA classifier (Genkit Gemini Flash).
 *
 * Doctrine §C : architecture hybride regex L1 (SC1, déterministe) + IA L2 contextuelle
 * (ce module). Appel UNIQUEMENT si regex L1 ambigu (score=0.5 single-cat) — cf. Q4=A.
 *
 * Doctrine §C.Q1 ✅ Genkit + Gemini 2.5 Flash (instance partagée src/ai/genkit.ts).
 * Doctrine §C.Q2 ✅ logs IA = score + motif + hash (jamais contenu) — wired SC1 aiScanLogs/.
 * Doctrine §C.Q3 ✅ FR uniquement Phase 8 (system prompt FR strict).
 * Doctrine §C cache 24h ✅ in-memory Map keyed sur SHA-256 exact (Q3=A).
 * Doctrine §B.Q4 ✅ précision target 92-95% (mesurable via "ce flag est faux" SC2 commit 4/6).
 *
 * Q5=A IA error fallback ✅ : Gemini fail OU JSON malformed → motive='ai-error', flagged=false
 *   (caller sendMessage commit 3/6 préserve le verdict L1 si motive='ai-error').
 *
 * Rate limiting via wrapAiCall (SC0) — 10 calls/user/min, propagation AiError au caller.
 */

import { ai, wrapAiCall, AiError } from '../genkit';
import type { AntiLeakInput, AntiLeakOutput } from '../types';

// =====================================================================
// Cache 24h in-memory (doctrine §C cache 24h hash exact, Q3=A)
// =====================================================================

/** Phase 8 SC2 — cache TTL 24h (doctrine §C). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  result: AntiLeakOutput;
  expiresAt: number;
}

const _cache: Map<string, CacheEntry> = new Map();

/** DI seam pour tests : surcharge Date.now (cohérent pattern genkit.ts). */
type NowFn = () => number;
let _nowFn: NowFn = () => Date.now();

function getCached(hash: string): AntiLeakOutput | null {
  const entry = _cache.get(hash);
  if (!entry) return null;
  if (_nowFn() >= entry.expiresAt) {
    _cache.delete(hash);
    return null;
  }
  return entry.result;
}

function setCached(hash: string, result: AntiLeakOutput): void {
  _cache.set(hash, { result, expiresAt: _nowFn() + CACHE_TTL_MS });
}

/**
 * SHA-256 hex via Web Crypto (Node 20+ + browsers). Cohérent sha256Hex côté
 * sendMessage SC1 — même hash pour même message = cache cross-call déterministe.
 */
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

/**
 * @internal — DI seam pour mocker ai.generate en tests unitaires
 * (cf. src/ai/flows/__tests__/anti-leak-classifier.test.ts).
 * Ne JAMAIS appeler depuis le code de production.
 */
export function __setGenerateFnForTesting(fn: GenerateFn | null): void {
  _generateFn = fn ?? defaultGenerateFn;
}

/** Reset cache pour tests (déterminisme entre cas). */
export function __resetCacheForTesting(): void {
  _cache.clear();
}

/** Surcharge now() pour tests (expiration cache 24h simulation). */
export function __setNowFnForTesting(fn: NowFn | null): void {
  _nowFn = fn ?? (() => Date.now());
}

// =====================================================================
// System prompt FR strict (doctrine §C.Q3)
// =====================================================================

/** Prompt FR strict (doctrine §C.Q3 — DE/IT Phase 10+).
 *  Few-shot examples couvrent les 5 catégories L1 SC1 + cas ambigus pour calibration. */
const SYSTEM_PROMPT_FR = `Tu es un classificateur anti-leak pour Spordateur, plateforme suisse de matching sportif.
Doctrine §C Phase 8 : ton rôle est d'identifier UNIQUEMENT les tentatives de partage de coordonnées personnelles
(numéro de téléphone, email, handle réseau social, plateforme de messagerie tierce) dans un message FR.

CONTEXTE : tu reçois un message issu d'un chat post-session entre 2 utilisateurs. La plateforme veut que les
échanges restent on-platform pour la rétention. Une tentative de leak = likely=1. Une mention bénigne = likely=0.

FORMAT DE RÉPONSE OBLIGATOIRE (JSON STRICT, aucun texte avant/après) :
{"likely": 0 ou 1, "motive": "phone"|"email"|"handle"|"domain"|"platform"|"unknown", "confidence": 0.0 à 1.0}

EXEMPLES :
Message: "appelle-moi 079 123 45 67"
→ {"likely": 1, "motive": "phone", "confidence": 0.95}

Message: "écris-moi sur instagram @samuel"
→ {"likely": 1, "motive": "handle", "confidence": 0.9}

Message: "DM moi sur Telegram"
→ {"likely": 1, "motive": "platform", "confidence": 0.9}

Message: "j'ai mangé 555 calories"
→ {"likely": 0, "motive": "unknown", "confidence": 0.95}

Message: "salut, on se voit jeudi ?"
→ {"likely": 0, "motive": "unknown", "confidence": 0.99}

Message: "@samedi je suis libre"
→ {"likely": 0, "motive": "unknown", "confidence": 0.85}

ANALYSE LE MESSAGE SUIVANT :
`;

// =====================================================================
// Main classifier
// =====================================================================

/**
 * Phase 8 SC2 — classifyMessageL2.
 *
 * Pipeline :
 *   1. Hash SHA-256 messageContent → cache lookup 24h (skip Gemini si hit)
 *   2. wrapAiCall(userId) — rate limit propagation AiError au caller
 *   3. ai.generate Gemini Flash avec SYSTEM_PROMPT_FR + few-shot
 *   4. Parse JSON strict {likely, motive, confidence} → mapping AntiLeakOutput
 *   5. Cache write + return
 *
 * Erreurs (Q5=A defensive) :
 *   - Gemini API throw → motive='ai-error', flagged=false (caller préserve L1)
 *   - JSON malformed → motive='ai-error', flagged=false
 *   - AiError 'rate-limit-exceeded' → re-throw (caller décide)
 *
 * @param input AntiLeakInput {messageContent, chatId, userId}
 * @returns AntiLeakOutput {riskScore ∈[0,1], flagged, reason?, technicalMotive?}
 */
export async function classifyMessageL2(input: AntiLeakInput): Promise<AntiLeakOutput> {
  const { messageContent, userId } = input;

  // 1. Cache lookup (avant rate limit — cache hits ne consomment pas slot)
  const hash = await sha256Hex(messageContent);
  const cached = getCached(hash);
  if (cached) return cached;

  let result: AntiLeakOutput;

  try {
    // 2. wrapAiCall — rate limit propagation AiError au caller
    const rawText = await wrapAiCall(userId, () =>
      _generateFn(`${SYSTEM_PROMPT_FR}\n${messageContent}`),
    );

    // 3. Parse JSON strict
    const parsed = JSON.parse(rawText.trim());

    if (
      typeof parsed.likely !== 'number' ||
      ![0, 1].includes(parsed.likely) ||
      typeof parsed.motive !== 'string' ||
      typeof parsed.confidence !== 'number' ||
      parsed.confidence < 0 ||
      parsed.confidence > 1
    ) {
      throw new Error('Invalid JSON structure or out-of-range fields from Gemini');
    }

    const flagged = parsed.likely === 1;
    // riskScore mapping cohérent avec L1 SC1 [0,1] :
    // - likely=1 → riskScore = confidence (high = high risk)
    // - likely=0 → riskScore = 1 - confidence (high confidence clean = low risk)
    const riskScore = flagged ? parsed.confidence : 1 - parsed.confidence;

    result = {
      riskScore,
      flagged,
      reason: flagged ? `Détection IA: ${parsed.motive}` : undefined,
      technicalMotive: flagged ? 'ai-leak-likely' : 'ai-leak-unlikely',
    };
  } catch (err) {
    // Rate limit → propagation au caller
    if (err instanceof AiError) throw err;

    // Q5=A defensive : preserve flagged=false, motive='ai-error'
    // Caller sendMessage commit 3/6 détectera 'ai-error' et préservera le verdict L1.
    console.warn('[anti-leak-classifier] Gemini fail or parse error:', err);
    result = {
      riskScore: 0,
      flagged: false,
      technicalMotive: 'ai-error',
    };
  }

  // Cache write (même les erreurs sont cachées 24h pour éviter de spammer Gemini sur les
  // mêmes messages problématiques — défensif coût)
  setCached(hash, result);
  return result;
}
