/**
 * Tests Phase 9 sub-chantier 4 commit 3/6 — Admin queue badge IA + reason prefill + warning.
 *
 * Exécution :
 *   npm run test:reviews:admin-queue-ai-badge
 *
 * Pattern : pure helpers tests (Q8=A SC4 plan global verify content sans RTL).
 * Helpers extraits dans src/lib/reviews/aiBadgeHelpers.ts pour testabilité directe.
 *
 * Couverture (AQ-IA1-AQ-IA3 + bonus) :
 *   AQ-IA1 review aiSuggestion='publish' → badge testId='ai-badge-publish' + classes vertes
 *   AQ-IA2 review.aiSuggestion null → no badge (graceful degradation)
 *   AQ-IA3 prefilledReason aiSuggestion='reject' + admin click 'reject' → "(IA suggestion: motive)"
 *   Bonus aiSuggestion='reject' + admin click 'publish' → no prefill + warning
 *   Bonus tooltip motive accessible (data-attribute / aria-label)
 *   Bonus borderline → badge amber + jamais prefill
 */

import {
  aiBadgeProps,
  prefilledReason,
  mismatchWarning,
} from '../../src/lib/reviews/aiBadgeHelpers';
import type { Review } from '../../src/types/firestore';
import type { Timestamp } from 'firebase/firestore';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Helpers
// =====================================================================

function makeAiSuggestion(
  recommendation: 'publish' | 'reject' | 'borderline',
  overrides: Partial<NonNullable<Review['aiSuggestion']>> = {},
): NonNullable<Review['aiSuggestion']> {
  const stubTs = {
    toMillis: () => Date.now() - 60_000, // 1min ago
    toDate: () => new Date(Date.now() - 60_000),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Timestamp;
  return {
    civility: recommendation === 'reject' ? 0.15 : recommendation === 'publish' ? 0.92 : 0.55,
    factuality: recommendation === 'reject' ? 0.0 : recommendation === 'publish' ? 0.7 : 0.5,
    recommendation,
    motive:
      recommendation === 'reject'
        ? 'Insulte / slur — non publiable'
        : recommendation === 'publish'
          ? 'Critique civile et factuelle'
          : 'Opinion forte sans détails vérifiables',
    modelVersion: 'gemini-2.5-flash-2026-05',
    scoredAt: stubTs,
    ...overrides,
  };
}

// =====================================================================

async function main(): Promise<void> {
  // ===================================================================
  // AQ-IA1 : aiSuggestion='publish' → badge classes green + testId
  // ===================================================================
  section('AQ-IA1 review aiSuggestion=publish → badge ai-badge-publish + classes green');
  {
    const ai = makeAiSuggestion('publish');
    const badge = aiBadgeProps(ai);
    if (!badge) {
      fail('AQ-IA1 expected badge non-null');
    } else {
      if (badge.testId === 'ai-badge-publish') {
        pass('AQ-IA1 testId=ai-badge-publish');
      } else {
        fail('AQ-IA1 testId mismatch', badge);
      }
      if (badge.className.includes('green-')) {
        pass('AQ-IA1 className contient classes vertes (publish)');
      } else {
        fail('AQ-IA1 className green missing', badge.className);
      }
      if (badge.label === 'IA: publish 0.92') {
        pass('AQ-IA1 label format "IA: publish 0.92" (max civility/factuality)');
      } else {
        fail('AQ-IA1 label format mismatch', badge.label);
      }
      if (badge.recommendation === 'publish') {
        pass('AQ-IA1 recommendation re-export = publish');
      } else {
        fail('AQ-IA1 recommendation mismatch', badge.recommendation);
      }
    }
  }

  // ===================================================================
  // AQ-IA2 : aiSuggestion null → no badge (graceful degradation)
  // ===================================================================
  section('AQ-IA2 review.aiSuggestion null → no badge (graceful degradation)');
  {
    const badge = aiBadgeProps(null);
    if (badge === null) {
      pass('AQ-IA2 null → badge=null (no render)');
    } else {
      fail('AQ-IA2 should return null for null aiSuggestion', badge);
    }
    const badge2 = aiBadgeProps(undefined);
    if (badge2 === null) {
      pass('AQ-IA2 undefined → badge=null (no render)');
    } else {
      fail('AQ-IA2 should return null for undefined aiSuggestion', badge2);
    }
  }

  // ===================================================================
  // AQ-IA3 : prefilledReason aligned (admin click 'reject' AND aiSuggestion='reject') → motive
  // ===================================================================
  section("AQ-IA3 prefilledReason admin choix === IA recommendation → motive prefilled");
  {
    const ai = makeAiSuggestion('reject');
    const prefilled = prefilledReason(ai, 'reject');
    if (prefilled === '(IA suggestion: Insulte / slur — non publiable)') {
      pass('AQ-IA3 reject + reject IA → "(IA suggestion: motive)"');
    } else {
      fail('AQ-IA3 prefilled mismatch', prefilled);
    }
    // Idem pour publish aligned
    const aiPub = makeAiSuggestion('publish');
    const prefilledPub = prefilledReason(aiPub, 'publish');
    if (prefilledPub === '(IA suggestion: Critique civile et factuelle)') {
      pass('AQ-IA3 publish + publish IA → "(IA suggestion: motive)"');
    } else {
      fail('AQ-IA3 publish prefilled mismatch', prefilledPub);
    }
    // Pas de warning si aligned
    const w = mismatchWarning(ai, 'reject');
    if (w === '') {
      pass('AQ-IA3 aligned → no warning (warning="")');
    } else {
      fail('AQ-IA3 aligned should have no warning', w);
    }
  }

  // ===================================================================
  // Bonus : mismatch admin click 'publish' BUT aiSuggestion='reject' → no prefill + warning
  // ===================================================================
  section("Bonus mismatch admin diverge IA → no prefill + warning visible");
  {
    const ai = makeAiSuggestion('reject');
    const prefilled = prefilledReason(ai, 'publish');
    if (prefilled === '') {
      pass('Bonus mismatch publish vs reject IA → prefilled=""');
    } else {
      fail('Bonus mismatch should not prefill', prefilled);
    }
    const w = mismatchWarning(ai, 'publish');
    if (w === "L'IA suggérait : reject") {
      pass('Bonus mismatch warning = "L\'IA suggérait : reject"');
    } else {
      fail('Bonus mismatch warning mismatch', w);
    }
    // Inverse : admin click 'reject' avec IA='publish'
    const aiPub = makeAiSuggestion('publish');
    const w2 = mismatchWarning(aiPub, 'reject');
    if (w2 === "L'IA suggérait : publish") {
      pass('Bonus mismatch reject vs publish IA → warning = "L\'IA suggérait : publish"');
    } else {
      fail('Bonus inverse mismatch warning', w2);
    }
  }

  // ===================================================================
  // Bonus : tooltip motive accessible (badge.tooltip multi-line)
  // ===================================================================
  section('Bonus tooltip motive accessible via data-tooltip + aria-label');
  {
    const ai = makeAiSuggestion('reject', {
      civility: 0.05,
      factuality: 0.0,
      modelVersion: 'gemini-2.5-flash-2026-05',
      motive: 'Insulte raciste flagrante',
    });
    const badge = aiBadgeProps(ai);
    if (!badge) {
      fail('Bonus tooltip badge null inattendu');
    } else {
      if (badge.tooltip.includes('IA recommendation: reject')) {
        pass('Bonus tooltip contient recommendation');
      } else {
        fail('Bonus tooltip recommendation missing', badge.tooltip);
      }
      if (
        badge.tooltip.includes('Civility: 0.05') &&
        badge.tooltip.includes('Factuality: 0.00')
      ) {
        pass('Bonus tooltip contient civility + factuality scores');
      } else {
        fail('Bonus tooltip scores missing', badge.tooltip);
      }
      if (badge.tooltip.includes('Insulte raciste flagrante')) {
        pass('Bonus tooltip contient motive');
      } else {
        fail('Bonus tooltip motive missing', badge.tooltip);
      }
      if (badge.tooltip.includes('gemini-2.5-flash-2026-05')) {
        pass('Bonus tooltip contient modelVersion');
      } else {
        fail('Bonus tooltip modelVersion missing', badge.tooltip);
      }
    }
  }

  // ===================================================================
  // Bonus : borderline → badge amber + jamais prefill
  // ===================================================================
  section('Bonus borderline recommendation → badge amber + jamais prefill');
  {
    const ai = makeAiSuggestion('borderline');
    const badge = aiBadgeProps(ai);
    if (!badge) {
      fail('Bonus borderline badge null inattendu');
    } else {
      if (badge.testId === 'ai-badge-borderline') {
        pass('Bonus borderline testId=ai-badge-borderline');
      } else {
        fail('Bonus borderline testId mismatch', badge);
      }
      if (badge.className.includes('amber-')) {
        pass('Bonus borderline className contient classes amber');
      } else {
        fail('Bonus borderline className amber missing', badge.className);
      }
    }
    // borderline ne prefill jamais (admin doit toujours saisir)
    const prefPub = prefilledReason(ai, 'publish');
    const prefRej = prefilledReason(ai, 'reject');
    if (prefPub === '' && prefRej === '') {
      pass('Bonus borderline → prefilled="" pour publish ET reject');
    } else {
      fail('Bonus borderline should not prefill', { prefPub, prefRej });
    }
    // borderline ne warning jamais
    const warn = mismatchWarning(ai, 'publish');
    if (warn === '') {
      pass('Bonus borderline → no warning (admin tranche librement)');
    } else {
      fail('Bonus borderline should not warn', warn);
    }
  }

  console.log('');
  console.log('====== Résumé Admin Queue AI Badge (AQ-IA1-AQ-IA3 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
