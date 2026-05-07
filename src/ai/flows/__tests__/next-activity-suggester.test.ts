/**
 * Tests Phase 8 sub-chantier 3 commit 2/6 — Next-activity suggester (pure unit, mock Gemini).
 *
 * Exécution :
 *   npm run test:next-activity-suggester
 *   (équivalent : npx tsx src/ai/flows/__tests__/next-activity-suggester.test.ts)
 *
 * Pure unit — pas d'emulator. Mock _suggestGenerateFn via __setSuggestGenerateFnForTesting.
 * Cache séparé de anti-leak-classifier (Q8=A) — pas de pollution cross-flow.
 *
 * Couverture (10 cas SUG1-SUG10) :
 *
 *   SUG1  happy path 3 activities matching → 3 suggestions FR
 *   SUG2  empty catalog → suggestions=[] empty
 *   SUG3  Gemini retourne empty (no match) → suggestions=[] empty
 *   SUG4  1 activity matching (max disponible) → suggestions=[1]
 *   SUG5  Gemini error → suggestions=[] fallback (defensive Q5=A)
 *   SUG6  Gemini malformed JSON → suggestions=[] fallback
 *   SUG7  cache hit : 2e call same input → 0 call Gemini
 *   SUG8  cache expired (>24h) → re-call Gemini
 *   SUG9  rate limit propagation 11ème call → AiError('rate-limit-exceeded')
 *   SUG10 __resetSuggestCacheForTesting() purge complète + verify cache séparé
 */

import {
  suggestActivitiesL3,
  SUGGEST_CACHE_TTL_MS,
  __resetSuggestCacheForTesting,
  __setSuggestGenerateFnForTesting,
  __setSuggestNowFnForTesting,
} from '../next-activity-suggester';
import {
  AiError,
  __resetRateLimitForTesting,
  __setNowFnForTesting as __setRateNowForTesting,
} from '../../genkit';
import type { SuggestionInput, SuggestionCatalogEntry } from '../../types';
import { Timestamp } from 'firebase/firestore';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Helpers
// =====================================================================

function buildCatalog(items: Partial<SuggestionCatalogEntry>[]): SuggestionCatalogEntry[] {
  return items.map((item, i) => ({
    activityId: item.activityId ?? `act_${i}`,
    title: item.title ?? `Activity ${i}`,
    sport: item.sport ?? 'yoga',
    city: item.city ?? 'Lausanne',
    partnerId: item.partnerId ?? 'partner_test',
    nextSessionAt: item.nextSessionAt,
  }));
}

function buildInput(opts: {
  catalog?: SuggestionCatalogEntry[];
  history?: Array<{ senderId: string; text: string }>;
  userId?: string;
}): SuggestionInput {
  return {
    chatHistory: (opts.history ?? [{ senderId: 'alice', text: 'salut !' }]).map((m) => ({
      senderId: m.senderId,
      text: m.text,
      createdAt: Timestamp.now(),
    })),
    participantUids: ['alice', 'bob'],
    activitiesCatalog: opts.catalog ?? [],
    rateLimitUserId: opts.userId ?? 'user_default',
  };
}

// =====================================================================

async function main(): Promise<void> {
  function resetAll(): void {
    __resetSuggestCacheForTesting();
    __resetRateLimitForTesting();
    __setSuggestNowFnForTesting(null);
    __setRateNowForTesting(null);
  }

  // ===================================================================
  // SUG1 happy path 3 activities matching
  // ===================================================================
  section('SUG1 happy path 3 activities matching → 3 suggestions FR');
  {
    resetAll();
    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({
        suggestions: [
          { activityId: 'act_0', reason: 'Vous avez aimé le yoga ensemble' },
          { activityId: 'act_1', reason: 'Pour ta revanche padel' },
          { activityId: 'act_2', reason: 'Salsa pour conclure la semaine' },
        ],
      }),
    );

    const input = buildInput({
      catalog: buildCatalog([
        { activityId: 'act_0', sport: 'yoga' },
        { activityId: 'act_1', sport: 'padel' },
        { activityId: 'act_2', sport: 'salsa' },
      ]),
      history: [
        { senderId: 'alice', text: 'super cours, à refaire ?' },
        { senderId: 'bob', text: 'oui yoga top' },
      ],
      userId: 'user_sug1',
    });

    try {
      const result = await suggestActivitiesL3(input);
      if (
        result.suggestions.length === 3 &&
        result.suggestions[0].activityId === 'act_0' &&
        result.suggestions[0].reason.length <= 80 &&
        result.suggestions[2].activityId === 'act_2'
      ) {
        pass('SUG1 3 suggestions FR retournées avec activityId valides + reason ≤80');
      } else {
        fail('SUG1', result);
      }
    } catch (e) {
      fail('SUG1 (suggestActivitiesL3 threw)', e);
    }
  }

  // ===================================================================
  // SUG2 empty catalog
  // ===================================================================
  section('SUG2 empty catalog → suggestions=[]');
  {
    resetAll();
    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({ suggestions: [] }),
    );

    const input = buildInput({ catalog: [], userId: 'user_sug2' });
    try {
      const result = await suggestActivitiesL3(input);
      if (result.suggestions.length === 0) {
        pass('SUG2 empty catalog → suggestions=[] empty');
      } else {
        fail('SUG2', result);
      }
    } catch (e) {
      fail('SUG2', e);
    }
  }

  // ===================================================================
  // SUG3 Gemini retourne empty (no match)
  // ===================================================================
  section('SUG3 Gemini empty (no match clear) → suggestions=[]');
  {
    resetAll();
    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({ suggestions: [] }),
    );

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_dance_zurich', sport: 'salsa' }]),
      history: [
        { senderId: 'alice', text: 'il pleut' },
        { senderId: 'bob', text: 'ouais lol' },
      ],
      userId: 'user_sug3',
    });
    try {
      const result = await suggestActivitiesL3(input);
      if (result.suggestions.length === 0) {
        pass('SUG3 Gemini empty (chat no match catalog) → suggestions=[]');
      } else {
        fail('SUG3', result);
      }
    } catch (e) {
      fail('SUG3', e);
    }
  }

  // ===================================================================
  // SUG4 1 activity max disponible
  // ===================================================================
  section('SUG4 1 activity max disponible → suggestions=[1]');
  {
    resetAll();
    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({
        suggestions: [{ activityId: 'act_0', reason: 'Pour la prochaine session' }],
      }),
    );

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_0', sport: 'yoga' }]),
      userId: 'user_sug4',
    });
    try {
      const result = await suggestActivitiesL3(input);
      if (result.suggestions.length === 1 && result.suggestions[0].activityId === 'act_0') {
        pass('SUG4 1 suggestion retournée (max disponible)');
      } else {
        fail('SUG4', result);
      }
    } catch (e) {
      fail('SUG4', e);
    }
  }

  // ===================================================================
  // SUG5 Gemini error → fallback empty
  // ===================================================================
  section('SUG5 Gemini error → suggestions=[] fallback (Q5=A)');
  {
    resetAll();
    __setSuggestGenerateFnForTesting(async () => {
      throw new Error('Gemini network unavailable');
    });

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_0' }]),
      userId: 'user_sug5',
    });
    try {
      const result = await suggestActivitiesL3(input);
      if (result.suggestions.length === 0) {
        pass('SUG5 Gemini fail → suggestions=[] (defensive fallback)');
      } else {
        fail('SUG5', result);
      }
    } catch (e) {
      fail('SUG5 (should not throw)', e);
    }
  }

  // ===================================================================
  // SUG6 malformed JSON
  // ===================================================================
  section('SUG6 Gemini malformed JSON → suggestions=[] fallback');
  {
    resetAll();
    __setSuggestGenerateFnForTesting(async () => 'not json {invalid');

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_0' }]),
      userId: 'user_sug6',
    });
    try {
      const result = await suggestActivitiesL3(input);
      if (result.suggestions.length === 0) {
        pass('SUG6 malformed JSON → suggestions=[] (parse catch)');
      } else {
        fail('SUG6', result);
      }
    } catch (e) {
      fail('SUG6 (should not throw)', e);
    }
  }

  // ===================================================================
  // SUG7 cache hit — 2e call same input → 0 call Gemini
  // ===================================================================
  section('SUG7 cache hit (24h) — 2e call same input');
  {
    resetAll();
    let mockCalls = 0;
    __setSuggestGenerateFnForTesting(async () => {
      mockCalls++;
      return JSON.stringify({
        suggestions: [{ activityId: 'act_0', reason: 'test cache' }],
      });
    });

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_0' }]),
      history: [{ senderId: 'alice', text: 'cache test message' }],
      userId: 'user_sug7',
    });

    await suggestActivitiesL3(input);
    const result2 = await suggestActivitiesL3(input);

    if (mockCalls === 1 && result2.suggestions.length === 1) {
      pass('SUG7 cache hit (mockCalls=1 sur 2 calls, résultat persisté)');
    } else {
      fail('SUG7', { mockCalls, result2 });
    }
  }

  // ===================================================================
  // SUG8 cache expired (>24h) → re-call
  // ===================================================================
  section('SUG8 cache expired (>24h) → re-call Gemini');
  {
    resetAll();
    let mockCalls = 0;
    __setSuggestGenerateFnForTesting(async () => {
      mockCalls++;
      return JSON.stringify({ suggestions: [] });
    });

    let mockNow = 1_700_000_000_000;
    __setSuggestNowFnForTesting(() => mockNow);

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_0' }]),
      history: [{ senderId: 'alice', text: 'expiry test' }],
      userId: 'user_sug8',
    });

    await suggestActivitiesL3(input); // 1er call → mock + cache write
    mockNow += SUGGEST_CACHE_TTL_MS + 1_000; // +24h + 1s
    await suggestActivitiesL3(input); // cache expired → re-call

    if (mockCalls === 2) {
      pass('SUG8 cache expired après 24h → mock re-invoqué (mockCalls=2)');
    } else {
      fail('SUG8', { mockCalls });
    }
  }

  // ===================================================================
  // SUG9 rate limit propagation
  // ===================================================================
  section('SUG9 rate limit propagation 11ème call');
  {
    resetAll();
    const fixedTime = 1_700_000_000_000;
    __setRateNowForTesting(() => fixedTime);
    __setSuggestGenerateFnForTesting(async () =>
      JSON.stringify({ suggestions: [] }),
    );

    // 10 inputs distincts (cache miss à chaque) → 10 calls Gemini
    for (let i = 0; i < 10; i++) {
      await suggestActivitiesL3(
        buildInput({
          catalog: buildCatalog([{ activityId: `act_${i}` }]),
          history: [{ senderId: 'alice', text: `unique ${i}` }],
          userId: 'user_sug9',
        }),
      );
    }

    // 11ème call → AiError 'rate-limit-exceeded' propagé
    try {
      await suggestActivitiesL3(
        buildInput({
          catalog: buildCatalog([{ activityId: 'act_x' }]),
          history: [{ senderId: 'alice', text: 'unique 10' }],
          userId: 'user_sug9',
        }),
      );
      fail('SUG9 11ème call aurait dû throw AiError');
    } catch (err) {
      if (err instanceof AiError && err.code === 'rate-limit-exceeded') {
        pass('SUG9 11ème call → AiError(rate-limit-exceeded) propagé (wrapAiCall SC0)');
      } else {
        fail('SUG9 (wrong error type)', err);
      }
    }
  }

  // ===================================================================
  // SUG10 __resetSuggestCacheForTesting + verify cache séparé classifier
  // ===================================================================
  section('SUG10 __resetSuggestCacheForTesting purge complète');
  {
    resetAll();
    let mockCalls = 0;
    __setSuggestGenerateFnForTesting(async () => {
      mockCalls++;
      return JSON.stringify({ suggestions: [] });
    });

    const input = buildInput({
      catalog: buildCatalog([{ activityId: 'act_0' }]),
      history: [{ senderId: 'alice', text: 'reset test' }],
      userId: 'user_sug10',
    });

    await suggestActivitiesL3(input); // 1er call
    await suggestActivitiesL3(input); // cache hit (mockCalls=1)
    __resetSuggestCacheForTesting();
    await suggestActivitiesL3(input); // cache vide → mock re-call (mockCalls=2)

    if (mockCalls === 2) {
      pass('SUG10 __resetSuggestCacheForTesting → cache vide, mock re-invoqué (mockCalls=2 sur 3 calls)');
    } else {
      fail('SUG10', { mockCalls });
    }
  }

  // ===================================================================
  // Cleanup DI seams (préventif)
  // ===================================================================
  __setSuggestGenerateFnForTesting(null);
  __setSuggestNowFnForTesting(null);
  __setRateNowForTesting(null);
  __resetSuggestCacheForTesting();
  __resetRateLimitForTesting();

  console.log('');
  console.log('====== Résumé Next-activity suggester (SUG1-SUG10) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
