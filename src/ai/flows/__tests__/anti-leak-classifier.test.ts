/**
 * Tests Phase 8 sub-chantier 2 commit 2/6 — Anti-leak classifier IA L2 (pure unit, mock Gemini).
 *
 * Exécution :
 *   npm run test:anti-leak:classifier
 *   (équivalent : npx tsx src/ai/flows/__tests__/anti-leak-classifier.test.ts)
 *
 * Pure unit — pas d'emulator. Mock _generateFn via __setGenerateFnForTesting (DI seam).
 *
 * Couverture (10 cas ALC1-ALC10) :
 *
 *   ALC1  clean (likely=0, confidence=1.0)             → riskScore=0, flagged=false, motive='ai-leak-unlikely'
 *   ALC2  phone obvious (likely=1, confidence=0.9)     → riskScore=0.9, flagged=true, motive='ai-leak-likely'
 *   ALC3  email obvious (likely=1, confidence=0.85)    → riskScore=0.85, flagged=true
 *   ALC4  ambiguous "@samedi" (likely=0, conf=0.6)     → riskScore=0.4, flagged=false
 *   ALC5  cache hit — 2e call sur même text → mock pas invoqué (cache 24h doctrine §C)
 *   ALC6  cache expired (now > +24h) → mock re-invoqué
 *   ALC7  Gemini throw → fallback motive='ai-error', flagged=false
 *   ALC8  malformed JSON → catch parse error → 'ai-error'
 *   ALC9  rate limit 11ème call → AiError('rate-limit-exceeded') propagated
 *   ALC10 __resetCacheForTesting() empties cache → mock re-invoqué
 */

import {
  classifyMessageL2,
  CACHE_TTL_MS,
  __resetCacheForTesting,
  __setGenerateFnForTesting,
  __setNowFnForTesting,
} from '../anti-leak-classifier';
import {
  AiError,
  __resetRateLimitForTesting,
  __setNowFnForTesting as __setRateNowForTesting,
} from '../../genkit';

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

function approxEq(a: number, b: number, tolerance = 0.001): boolean {
  return Math.abs(a - b) < tolerance;
}

// =====================================================================

async function main(): Promise<void> {
  // Helper : reset between tests
  function resetAll(): void {
    __resetCacheForTesting();
    __resetRateLimitForTesting();
    __setNowFnForTesting(null);
    __setRateNowForTesting(null);
  }

  // ===================================================================
  // ALC1 clean (likely=0, confidence=1.0)
  // ===================================================================
  section('ALC1 clean message (likely=0, confidence=1.0)');
  {
    resetAll();
    __setGenerateFnForTesting(async () =>
      JSON.stringify({ likely: 0, motive: 'unknown', confidence: 1.0 }),
    );
    const result = await classifyMessageL2({
      messageContent: 'salut, on se voit jeudi ?',
      chatId: 'chat_alc1',
      userId: 'user_alc1',
    });
    if (
      result.flagged === false &&
      approxEq(result.riskScore, 0) &&
      result.technicalMotive === 'ai-leak-unlikely'
    ) {
      pass('ALC1 clean → riskScore≈0, flagged=false, motive=ai-leak-unlikely');
    } else {
      fail('ALC1', result);
    }
  }

  // ===================================================================
  // ALC2 phone obvious
  // ===================================================================
  section('ALC2 phone obvious (likely=1, confidence=0.9)');
  {
    resetAll();
    __setGenerateFnForTesting(async () =>
      JSON.stringify({ likely: 1, motive: 'phone', confidence: 0.9 }),
    );
    const result = await classifyMessageL2({
      messageContent: 'appelle-moi 079 123 45 67',
      chatId: 'chat_alc2',
      userId: 'user_alc2',
    });
    if (
      result.flagged === true &&
      approxEq(result.riskScore, 0.9) &&
      result.technicalMotive === 'ai-leak-likely'
    ) {
      pass('ALC2 phone → riskScore=0.9, flagged=true, motive=ai-leak-likely');
    } else {
      fail('ALC2', result);
    }
  }

  // ===================================================================
  // ALC3 email obvious
  // ===================================================================
  section('ALC3 email obvious (likely=1, confidence=0.85)');
  {
    resetAll();
    __setGenerateFnForTesting(async () =>
      JSON.stringify({ likely: 1, motive: 'email', confidence: 0.85 }),
    );
    const result = await classifyMessageL2({
      messageContent: 'mon mail c est test@mail.com',
      chatId: 'chat_alc3',
      userId: 'user_alc3',
    });
    if (result.flagged === true && approxEq(result.riskScore, 0.85)) {
      pass('ALC3 email → riskScore=0.85, flagged=true');
    } else {
      fail('ALC3', result);
    }
  }

  // ===================================================================
  // ALC4 ambiguous "@samedi" (Gemini: likely=0, confidence=0.6)
  // ===================================================================
  section('ALC4 ambiguous "@samedi" (likely=0, confidence=0.6)');
  {
    resetAll();
    __setGenerateFnForTesting(async () =>
      JSON.stringify({ likely: 0, motive: 'unknown', confidence: 0.6 }),
    );
    const result = await classifyMessageL2({
      messageContent: '@samedi je suis libre',
      chatId: 'chat_alc4',
      userId: 'user_alc4',
    });
    if (result.flagged === false && approxEq(result.riskScore, 0.4)) {
      pass('ALC4 ambiguous → riskScore=0.4 (=1-0.6), flagged=false (Gemini sait jour semaine)');
    } else {
      fail('ALC4', result);
    }
  }

  // ===================================================================
  // ALC5 cache hit — 2e call same text → mock pas invoqué
  // ===================================================================
  section('ALC5 cache hit (24h) — 2e call same text');
  {
    resetAll();
    let mockCalls = 0;
    __setGenerateFnForTesting(async () => {
      mockCalls++;
      return JSON.stringify({ likely: 1, motive: 'phone', confidence: 0.95 });
    });
    const input = {
      messageContent: 'appel: 079 999 88 77',
      chatId: 'chat_alc5',
      userId: 'user_alc5',
    };
    await classifyMessageL2(input);
    const result2 = await classifyMessageL2(input);
    if (mockCalls === 1 && result2.flagged === true && approxEq(result2.riskScore, 0.95)) {
      pass('ALC5 cache hit (mockCalls=1 sur 2 calls, résultat persisté)');
    } else {
      fail('ALC5', { mockCalls, result2 });
    }
  }

  // ===================================================================
  // ALC6 cache expired (now > +24h) → mock re-invoqué
  // ===================================================================
  section('ALC6 cache expired (>24h) → re-call');
  {
    resetAll();
    let mockCalls = 0;
    __setGenerateFnForTesting(async () => {
      mockCalls++;
      return JSON.stringify({ likely: 0, motive: 'unknown', confidence: 0.99 });
    });

    let mockNow = 1_700_000_000_000;
    __setNowFnForTesting(() => mockNow);

    const input = {
      messageContent: 'message identique pour cache test',
      chatId: 'chat_alc6',
      userId: 'user_alc6',
    };
    await classifyMessageL2(input); // 1er call → mock + cache write
    mockNow += CACHE_TTL_MS + 1_000; // +24h + 1s
    await classifyMessageL2(input); // cache expired → re-call

    if (mockCalls === 2) {
      pass('ALC6 cache expired après 24h → mock re-invoqué (mockCalls=2)');
    } else {
      fail('ALC6', { mockCalls });
    }
  }

  // ===================================================================
  // ALC7 Gemini throw → fallback ai-error
  // ===================================================================
  section('ALC7 Gemini throw → fallback ai-error');
  {
    resetAll();
    __setGenerateFnForTesting(async () => {
      throw new Error('Gemini network unavailable');
    });
    const result = await classifyMessageL2({
      messageContent: 'message qui déclenche fail',
      chatId: 'chat_alc7',
      userId: 'user_alc7',
    });
    if (
      result.flagged === false &&
      result.riskScore === 0 &&
      result.technicalMotive === 'ai-error'
    ) {
      pass('ALC7 Gemini fail → motive=ai-error, flagged=false (Q5=A defensive)');
    } else {
      fail('ALC7', result);
    }
  }

  // ===================================================================
  // ALC8 malformed JSON → ai-error
  // ===================================================================
  section('ALC8 malformed JSON → ai-error');
  {
    resetAll();
    __setGenerateFnForTesting(async () => 'this is not json {invalid');
    const result = await classifyMessageL2({
      messageContent: 'message bizarre',
      chatId: 'chat_alc8',
      userId: 'user_alc8',
    });
    if (result.technicalMotive === 'ai-error' && result.flagged === false) {
      pass('ALC8 malformed JSON → motive=ai-error (parse catch)');
    } else {
      fail('ALC8', result);
    }
  }

  // ===================================================================
  // ALC9 rate limit propagation 11ème call
  // ===================================================================
  section('ALC9 rate limit propagation 11ème call');
  {
    resetAll();
    // freezing time empêche fenêtre 60s expiration entre les 11 calls
    const fixedTime = 1_700_000_000_000;
    __setRateNowForTesting(() => fixedTime);
    __setGenerateFnForTesting(async () =>
      JSON.stringify({ likely: 0, motive: 'unknown', confidence: 1.0 }),
    );

    // 10 messages distincts (cache miss à chaque) → 10 calls Gemini
    for (let i = 0; i < 10; i++) {
      await classifyMessageL2({
        messageContent: `unique message ${i}`,
        chatId: 'chat_alc9',
        userId: 'user_alc9',
      });
    }

    // 11ème → AiError 'rate-limit-exceeded' propagé
    try {
      await classifyMessageL2({
        messageContent: 'unique message 10',
        chatId: 'chat_alc9',
        userId: 'user_alc9',
      });
      fail('ALC9 11ème call aurait dû throw AiError');
    } catch (err) {
      if (err instanceof AiError && err.code === 'rate-limit-exceeded') {
        pass('ALC9 11ème call → AiError(rate-limit-exceeded) propagé (wrapAiCall SC0)');
      } else {
        fail('ALC9 (wrong error type)', err);
      }
    }
  }

  // ===================================================================
  // ALC10 __resetCacheForTesting() — DI seam helper
  // ===================================================================
  section('ALC10 __resetCacheForTesting() empties cache');
  {
    resetAll();
    let mockCalls = 0;
    __setGenerateFnForTesting(async () => {
      mockCalls++;
      return JSON.stringify({ likely: 0, motive: 'unknown', confidence: 1.0 });
    });

    const input = {
      messageContent: 'message reset cache',
      chatId: 'chat_alc10',
      userId: 'user_alc10',
    };
    await classifyMessageL2(input); // 1er call (mockCalls=1) + cache write
    await classifyMessageL2(input); // cache hit (mockCalls=1 unchanged)
    __resetCacheForTesting();
    await classifyMessageL2(input); // cache vide → mock re-call (mockCalls=2)

    if (mockCalls === 2) {
      pass('ALC10 __resetCacheForTesting → cache vide, mock re-invoqué (mockCalls=2 sur 3 calls)');
    } else {
      fail('ALC10', { mockCalls });
    }
  }

  // ===================================================================
  // Cleanup DI seams (préventif)
  // ===================================================================
  __setGenerateFnForTesting(null);
  __setNowFnForTesting(null);
  __setRateNowForTesting(null);
  __resetCacheForTesting();
  __resetRateLimitForTesting();

  console.log('');
  console.log('====== Résumé Anti-leak classifier IA L2 (ALC1-ALC10) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
