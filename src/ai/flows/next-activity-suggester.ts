/**
 * Phase 8 sub-chantier 3 commit 2/6 — Next-activity suggester (Genkit Gemini Flash).
 *
 * Doctrine §D : après une session, l'IA suggère 1-3 activities suivantes dans le chat
 * post-event sous forme de message bot avec boutons quick-book. Cadence max 1/72h
 * (enforced server-side par /api/suggest-activities commit 3/6).
 *
 * Doctrine §D.Q1 ✅ default-on opt-in implicite (UserProfile.aiSuggestionsOptIn SC0)
 * Doctrine §D.Q2 ✅ cadence 1/72h (Chat.lastSuggestionAt server-side check)
 * Doctrine §D.Q3 ✅ gratuit Phase 8 (pas de quota premium)
 * Doctrine §D.Q4 ✅ inline bot card (Q11=A doctrine literal)
 * Doctrine §D consensus opt-out ✅ (commit 3/6 API route check both participants)
 * Doctrine §C.Q3 ✅ FR uniquement Phase 8 (system prompt FR strict, cohérent SC2)
 *
 * Q4=A simple filter : catalog pré-filtré server-side city + sport + future, IA pick top 3
 * Q5=A IA error fallback ✅ : Gemini fail OU JSON malformed → suggestions=[] empty
 *   (caller API route skip bot message persistence si empty — pas de spam UX)
 * Q8=A cache séparé ✅ : Map indépendant de anti-leak (input/output différents)
 * Q9=A Admin SDK bypass ✅ : flow appelé serveur-only via /api/suggest-activities
 *
 * Rate limiting via wrapAiCall (SC0) — 10 calls/user/min, propagation AiError au caller.
 */

import { ai, wrapAiCall, AiError } from '../genkit';
import type { SuggestionInput, SuggestionOutput } from '../types';

// =====================================================================
// Cache 24h in-memory (cohérent anti-leak-classifier mais Map séparé Q8=A)
// =====================================================================

/** Phase 8 SC3 — cache TTL 24h (doctrine §D cohérent §C). */
export const SUGGEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SuggestCacheEntry {
  result: SuggestionOutput;
  expiresAt: number;
}

const _suggestCache: Map<string, SuggestCacheEntry> = new Map();

/** DI seam pour tests : surcharge Date.now (cohérent pattern genkit.ts + SC2 classifier). */
type NowFn = () => number;
let _suggestNowFn: NowFn = () => Date.now();

function getSuggestCached(hash: string): SuggestionOutput | null {
  const entry = _suggestCache.get(hash);
  if (!entry) return null;
  if (_suggestNowFn() >= entry.expiresAt) {
    _suggestCache.delete(hash);
    return null;
  }
  return entry.result;
}

function setSuggestCached(hash: string, result: SuggestionOutput): void {
  _suggestCache.set(hash, { result, expiresAt: _suggestNowFn() + SUGGEST_CACHE_TTL_MS });
}

/**
 * SHA-256 hex via Web Crypto (Node 20+ + browsers). Cache key = hash de
 * JSON stringify(chatHistory + activitiesCatalog) — déterministe pour same input.
 */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// =====================================================================
// Generate function (DI seam pour mock Gemini en tests, séparé de classifier)
// =====================================================================

type GenerateFn = (prompt: string) => Promise<string>;

const defaultSuggestGenerateFn: GenerateFn = async (prompt: string) => {
  const result = await ai.generate({ prompt });
  return result.text ?? '';
};

let _suggestGenerateFn: GenerateFn = defaultSuggestGenerateFn;

/**
 * @internal — DI seam pour mocker ai.generate en tests unitaires
 * (cf. src/ai/flows/__tests__/next-activity-suggester.test.ts).
 * Ne JAMAIS appeler depuis le code de production.
 */
export function __setSuggestGenerateFnForTesting(fn: GenerateFn | null): void {
  _suggestGenerateFn = fn ?? defaultSuggestGenerateFn;
}

/** Reset cache pour tests (déterminisme entre cas, séparé de anti-leak cache). */
export function __resetSuggestCacheForTesting(): void {
  _suggestCache.clear();
}

/** Surcharge now() pour tests (expiration cache 24h simulation). */
export function __setSuggestNowFnForTesting(fn: NowFn | null): void {
  _suggestNowFn = fn ?? (() => Date.now());
}

// =====================================================================
// System prompt FR strict (doctrine §D + §C.Q3 cohérent SC2)
// =====================================================================

/** Prompt FR strict (doctrine §C.Q3 — DE/IT Phase 10+).
 *  Few-shot examples couvrent : matching parfait, no match, ambigu, catalog vide. */
const SUGGEST_SYSTEM_PROMPT_FR = `Tu es un assistant Spordateur, plateforme suisse de matching sportif.
Doctrine §D Phase 8 : ton rôle est de suggérer 0 à 3 activités du catalog qui correspondent aux préférences
exprimées par 2 utilisateurs ayant matché et discuté ensemble. Le but : leur proposer un prochain rendez-vous
sportif sur la plateforme.

CONTEXTE : tu reçois un historique de chat (dernières conversations) + un catalog d'activités pré-filtrées
par ville + sport-affinité + futures. Tu dois sélectionner 0-3 activityId du catalog. Si aucune activité ne
correspond clairement aux discussions, retourne suggestions: []. Ne jamais inventer un activityId hors catalog.

FORMAT DE RÉPONSE OBLIGATOIRE (JSON STRICT, aucun texte avant/après) :
{"suggestions": [{"activityId": "<from catalog>", "reason": "<≤80 chars FR>"}]}

CONTRAINTES :
- 0 à 3 suggestions max (jamais plus)
- reason en français ≤ 80 caractères
- activityId DOIT être présent dans le catalog input
- Si catalog vide ou no match → {"suggestions": []}

EXEMPLES :

Catalog: [{activityId: "act_yoga_lausanne", title: "Yoga Lausanne", sport: "yoga", city: "Lausanne"}]
Chat: ["alice: super cours, à refaire ?", "bob: oui yoga c'était top"]
→ {"suggestions": [{"activityId": "act_yoga_lausanne", "reason": "Vous avez aimé le yoga ensemble — voici la prochaine session"}]}

Catalog: [{activityId: "act_padel_geneve", title: "Padel Genève", sport: "padel", city: "Genève"}, {activityId: "act_yoga_lausanne", title: "Yoga Lausanne", sport: "yoga", city: "Lausanne"}]
Chat: ["alice: trop fun le padel", "bob: à quand la revanche ?"]
→ {"suggestions": [{"activityId": "act_padel_geneve", "reason": "Pour ta revanche padel à Genève"}]}

Catalog: []
Chat: ["alice: salut", "bob: hello"]
→ {"suggestions": []}

Catalog: [{activityId: "act_dance_zurich", title: "Salsa Zurich", sport: "salsa", city: "Zurich"}]
Chat: ["alice: il pleut aujourd'hui", "bob: ouais lol"]
→ {"suggestions": []}

ANALYSE LE CONTEXTE SUIVANT :
`;

// =====================================================================
// Main flow
// =====================================================================

/**
 * Phase 8 SC3 — suggestActivitiesL3.
 *
 * Pipeline :
 *   1. Hash SHA-256 JSON(chatHistory + activitiesCatalog) → cache lookup 24h
 *   2. wrapAiCall(rateLimitUserId) — rate limit propagation AiError au caller
 *   3. ai.generate Gemini Flash avec SUGGEST_SYSTEM_PROMPT_FR + context inputs
 *   4. Parse JSON strict {suggestions: [{activityId, reason}]} avec validation activityId in catalog
 *   5. Cache write + return
 *
 * Erreurs (Q5=A defensive) :
 *   - Gemini API throw → suggestions=[] (caller API route skip bot persistence)
 *   - JSON malformed → suggestions=[]
 *   - Suggestion avec activityId hors catalog → drop silencieux (filter post-parse)
 *   - AiError 'rate-limit-exceeded' → re-throw (caller décide)
 *
 * @param input SuggestionInput {chatHistory, participantUids, activitiesCatalog, rateLimitUserId}
 * @returns SuggestionOutput {suggestions: Array<{activityId, reason}>} (0-3)
 */
export async function suggestActivitiesL3(input: SuggestionInput): Promise<SuggestionOutput> {
  const { chatHistory, activitiesCatalog, rateLimitUserId } = input;

  // 1. Cache lookup (avant rate limit — cache hits ne consomment pas slot)
  // Hash basé sur chatHistory + activitiesCatalog (skip participantUids car bruit ID)
  const cacheKey = JSON.stringify({
    history: chatHistory.map((m) => ({ s: m.senderId, t: m.text })),
    catalog: activitiesCatalog.map((a) => ({ id: a.activityId, sp: a.sport, c: a.city })),
  });
  const hash = await sha256Hex(cacheKey);
  const cached = getSuggestCached(hash);
  if (cached) return cached;

  let result: SuggestionOutput;

  // Build context for Gemini (concise FR pour économiser tokens)
  const chatContext = chatHistory
    .map((m) => `${m.senderId.slice(0, 8)}: ${m.text}`)
    .join('\n');
  const catalogContext = JSON.stringify(
    activitiesCatalog.map((a) => ({
      activityId: a.activityId,
      title: a.title,
      sport: a.sport,
      city: a.city,
    })),
  );

  try {
    // 2. wrapAiCall — rate limit propagation AiError au caller
    const rawText = await wrapAiCall(rateLimitUserId, () =>
      _suggestGenerateFn(
        `${SUGGEST_SYSTEM_PROMPT_FR}\nCatalog: ${catalogContext}\nChat:\n${chatContext}`,
      ),
    );

    // 3. Parse JSON strict
    const parsed = JSON.parse(rawText.trim());

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      throw new Error('Invalid JSON structure: missing suggestions array');
    }

    // 4. Filter & validate suggestions (max 3, activityId must exist in catalog, reason ≤80 chars)
    const catalogIds = new Set(activitiesCatalog.map((a) => a.activityId));
    const validSuggestions = parsed.suggestions
      .filter(
        (s: unknown): s is { activityId: string; reason: string } =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as { activityId?: unknown }).activityId === 'string' &&
          typeof (s as { reason?: unknown }).reason === 'string' &&
          catalogIds.has((s as { activityId: string }).activityId),
      )
      .slice(0, 3)
      .map((s: { activityId: string; reason: string }) => ({
        activityId: s.activityId,
        // Truncate reason ≤ 80 chars (defense if Gemini exceeds)
        reason: s.reason.length > 80 ? s.reason.slice(0, 80) : s.reason,
      }));

    result = { suggestions: validSuggestions };
  } catch (err) {
    // Rate limit → propagation au caller
    if (err instanceof AiError) throw err;

    // Q5=A defensive : Gemini fail OU JSON malformed → empty suggestions
    // Caller /api/suggest-activities skip bot persistence si empty (pas de spam UX)
    console.warn('[next-activity-suggester] Gemini fail or parse error:', err);
    result = { suggestions: [] };
  }

  // Cache write (même les erreurs/empty sont cachées 24h pour éviter retry spam Gemini)
  setSuggestCached(hash, result);
  return result;
}
