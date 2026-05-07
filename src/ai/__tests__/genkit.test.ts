/**
 * Tests Phase 8 sub-chantier 0 commit 3/3 — Genkit scaffold + rate limiter.
 *
 * Exécution :
 *   npm run test:genkit
 *   (équivalent : npx tsx src/ai/__tests__/genkit.test.ts)
 *
 * Pure unit tests — pas d'emulator Firestore requis.
 *
 * Couverture (3 cas G1-G3) :
 *
 * G1 : genkit instance initializable (smoke test imports + plugin googleAI)
 * G2 : rate limit per-user 10/min — 11ème call → throws AiError('rate-limit-exceeded')
 * G3 : rate limit reset après 60s (mock Date.now via __setNowFnForTesting)
 *
 * Pattern mini test runner cohérent tests/blocks/rules.test.ts.
 */

import {
  ai,
  AiError,
  RATE_LIMIT_MAX_CALLS,
  RATE_LIMIT_WINDOW_MS,
  checkRateLimit,
  wrapAiCall,
  __setNowFnForTesting,
  __resetRateLimitForTesting,
} from '../genkit';

// =====================================================================
// Mini test runner (cohérent tests/blocks/rules.test.ts)
// =====================================================================

let _passes = 0;
let _failures = 0;

function passManually(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function failManually(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================

async function main(): Promise<void> {
  // ===================================================================
  // G1 : smoke test instance Genkit
  // ===================================================================
  section('G1 : smoke test instance Genkit');
  {
    try {
      if (ai && typeof ai === 'object') {
        passManually('G1 ai instance exportée et initialisée (genkit + googleAI plugin)');
      } else {
        failManually('G1 ai instance falsy ou type incorrect', { ai });
      }
    } catch (e) {
      failManually('G1 (instance init threw)', e);
    }
  }

  // ===================================================================
  // G2 : rate limit per-user 10/min — 11ème call throws
  // ===================================================================
  section('G2 : rate limit per-user 10/min — 11ème call throws');
  {
    __resetRateLimitForTesting();
    __setNowFnForTesting(() => 1_700_000_000_000); // fixed time, fenêtre figée

    const USER_ID = 'user_g2';

    // 10 premiers calls : doivent passer
    let firstTenOk = true;
    for (let i = 0; i < RATE_LIMIT_MAX_CALLS; i++) {
      try {
        checkRateLimit(USER_ID);
      } catch (e) {
        firstTenOk = false;
        failManually(`G2 call #${i + 1} ne devait pas throw`, e);
        break;
      }
    }
    if (firstTenOk) {
      passManually(`G2 ${RATE_LIMIT_MAX_CALLS} premiers calls passent (sous limite)`);
    }

    // 11ème call : doit throw AiError 'rate-limit-exceeded'
    try {
      checkRateLimit(USER_ID);
      failManually('G2 11ème call aurait dû throw mais a passé');
    } catch (e) {
      if (e instanceof AiError && e.code === 'rate-limit-exceeded') {
        passManually(`G2 11ème call → AiError('rate-limit-exceeded') (max ${RATE_LIMIT_MAX_CALLS}/min)`);
      } else {
        failManually('G2 11ème call a throw mais type/code incorrect', e);
      }
    }

    // wrapAiCall doit aussi throw sans appeler fn
    let fnCalled = false;
    try {
      await wrapAiCall(USER_ID, async () => {
        fnCalled = true;
        return 'should-not-reach';
      });
      failManually('G2 wrapAiCall aurait dû throw avant fn');
    } catch (e) {
      if (e instanceof AiError && e.code === 'rate-limit-exceeded' && !fnCalled) {
        passManually('G2 wrapAiCall throw avant exécution fn (anti-burst confirmé)');
      } else {
        failManually('G2 wrapAiCall comportement incorrect', { e, fnCalled });
      }
    }
  }

  // ===================================================================
  // G3 : rate limit reset après 60s (sliding window)
  // ===================================================================
  section('G3 : rate limit reset après 60s (sliding window)');
  {
    __resetRateLimitForTesting();
    let mockNow = 1_700_000_000_000;
    __setNowFnForTesting(() => mockNow);

    const USER_ID = 'user_g3';

    // Saturer la limite
    for (let i = 0; i < RATE_LIMIT_MAX_CALLS; i++) {
      checkRateLimit(USER_ID);
    }

    // 11ème throws
    let stillBlocked = false;
    try {
      checkRateLimit(USER_ID);
    } catch (e) {
      if (e instanceof AiError && e.code === 'rate-limit-exceeded') stillBlocked = true;
    }
    if (!stillBlocked) {
      failManually('G3 setup : limite non atteinte avant fast-forward');
    }

    // Avance le temps de 61s — fenêtre 60s expire, calls oldés purgés
    mockNow += RATE_LIMIT_WINDOW_MS + 1_000;

    try {
      checkRateLimit(USER_ID);
      passManually(`G3 après +${RATE_LIMIT_WINDOW_MS + 1_000}ms : call passe (fenêtre coulissante)`);
    } catch (e) {
      failManually('G3 call après expiration fenêtre aurait dû passer', e);
    }
  }

  // ===================================================================
  // Cleanup DI seams (préventif si tests ré-importés)
  // ===================================================================
  __setNowFnForTesting(null);
  __resetRateLimitForTesting();

  console.log('');
  console.log('====== Résumé Genkit unit (G1-G3) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
