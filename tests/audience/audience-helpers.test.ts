/**
 * Tests Phase 9 sub-chantier 6 commit 1/4 — Audience helpers (Q3=A + Q4=A hard enforcement).
 *
 * Exécution :
 *   npm run test:audience:helpers
 *
 * Pattern : pure unit (no emulator) — helpers stateless.
 *
 * Couverture (AS1-AS4 + bonus) :
 *   AS1 isAllowedByAudience('female', 'women-only') → true
 *   AS2 isAllowedByAudience('male', 'women-only') → false
 *   AS3 isAllowedByAudience('male', 'mixed-priority-women') → true (Q2=C boost defer Phase 10)
 *   AS4 isAllowedByAudience('female', 'all') → true (default)
 *
 * Bonus :
 *   - 'other' gender + 'women-only' → false (Q3=A strict, doctrine §G women-safety stricte)
 *   - undefined audienceType → 'all' default (graceful rétro-compat)
 *   - assertAllowedByAudience throws AudienceError 'gender-mismatch' si denied
 *   - 'men-only' enforcement Q4=A symmetric (gender='male' only)
 *   - audienceType invalide → false (defense-in-depth fail-safe)
 */

import {
  isAllowedByAudience,
  assertAllowedByAudience,
  isAudienceType,
  AUDIENCE_TYPES,
  AudienceError,
  type AudienceType,
} from '../../src/lib/audience';

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

function expectThrows(
  fn: () => unknown,
  expectedCode: string,
  label: string,
): void {
  try {
    fn();
    fail(`${label} (expected throw '${expectedCode}', got success)`);
  } catch (err) {
    if (err instanceof AudienceError && err.code === expectedCode) {
      pass(label);
    } else {
      const code = err instanceof AudienceError ? err.code : (err as Error).message;
      fail(`${label} (expected '${expectedCode}', got '${code}')`);
    }
  }
}

// =====================================================================

async function main(): Promise<void> {
  // ===================================================================
  // AS1 : 'female' + 'women-only' → true
  // ===================================================================
  section("AS1 isAllowedByAudience('female', 'women-only') → true");
  {
    if (isAllowedByAudience('female', 'women-only') === true) {
      pass('AS1 female allowed in women-only');
    } else {
      fail('AS1 should allow female in women-only');
    }
  }

  // ===================================================================
  // AS2 : 'male' + 'women-only' → false (Q3=A strict)
  // ===================================================================
  section("AS2 isAllowedByAudience('male', 'women-only') → false");
  {
    if (isAllowedByAudience('male', 'women-only') === false) {
      pass('AS2 male denied in women-only (Q3=A strict)');
    } else {
      fail('AS2 should deny male in women-only');
    }
  }

  // ===================================================================
  // AS3 : 'male' + 'mixed-priority-women' → true (Q2=C boost defer Phase 10)
  // ===================================================================
  section("AS3 isAllowedByAudience('male', 'mixed-priority-women') → true (Q2=C boost defer)");
  {
    if (isAllowedByAudience('male', 'mixed-priority-women') === true) {
      pass('AS3 male allowed in mixed-priority-women (no hard enforcement, Q2=C boost defer)');
    } else {
      fail('AS3 should allow male in mixed-priority-women');
    }
  }

  // ===================================================================
  // AS4 : 'female' + 'all' → true (default)
  // ===================================================================
  section("AS4 isAllowedByAudience('female', 'all') → true (default)");
  {
    if (isAllowedByAudience('female', 'all') === true) {
      pass('AS4 female allowed in all');
    } else {
      fail('AS4 should allow female in all');
    }
  }

  // ===================================================================
  // Bonus : 'other' gender + 'women-only' → false (Q3=A strict)
  // ===================================================================
  section("Bonus 'other' gender + 'women-only' → false (Q3=A strict)");
  {
    if (isAllowedByAudience('other', 'women-only') === false) {
      pass("Bonus 'other' denied in women-only (strict — only 'female')");
    } else {
      fail("Bonus 'other' should be denied in women-only");
    }
  }

  // ===================================================================
  // Bonus : undefined audienceType → treated as 'all' (graceful rétro-compat)
  // ===================================================================
  section('Bonus undefined audienceType → graceful default (all)');
  {
    if (isAllowedByAudience('male', undefined) === true) {
      pass('Bonus undefined audienceType male → allowed (default all)');
    } else {
      fail('Bonus undefined should default to all');
    }
    if (isAllowedByAudience('female', null) === true) {
      pass('Bonus null audienceType female → allowed (default all)');
    } else {
      fail('Bonus null should default to all');
    }
  }

  // ===================================================================
  // Bonus : assertAllowedByAudience throws gender-mismatch
  // ===================================================================
  section('Bonus assertAllowedByAudience throws AudienceError gender-mismatch');
  {
    expectThrows(
      () => assertAllowedByAudience('male', 'women-only'),
      'gender-mismatch',
      "Bonus assert male+women-only → throw 'gender-mismatch'",
    );
    // Variante : assert female + women-only → no throw
    try {
      assertAllowedByAudience('female', 'women-only');
      pass('Bonus assert female+women-only → no throw');
    } catch (err) {
      fail('Bonus assert female+women-only should not throw', err);
    }
  }

  // ===================================================================
  // Bonus : 'men-only' enforcement Q4=A symmetric
  // ===================================================================
  section('Bonus men-only Q4=A symmetric enforcement');
  {
    if (isAllowedByAudience('male', 'men-only') === true) {
      pass('Bonus male allowed in men-only');
    } else {
      fail('Bonus male should be allowed in men-only');
    }
    if (isAllowedByAudience('female', 'men-only') === false) {
      pass('Bonus female denied in men-only (Q4=A symmetric)');
    } else {
      fail('Bonus female should be denied in men-only');
    }
    if (isAllowedByAudience('other', 'men-only') === false) {
      pass("Bonus 'other' denied in men-only (strict)");
    } else {
      fail("Bonus 'other' should be denied in men-only");
    }
  }

  // ===================================================================
  // Bonus : audienceType invalide → false (defense-in-depth fail-safe)
  // ===================================================================
  section('Bonus audienceType invalide → false (defense-in-depth fail-safe)');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isAllowedByAudience('female', 'invalid-type' as any) === false) {
      pass('Bonus audienceType invalide → false (fail-safe deny)');
    } else {
      fail('Bonus audienceType invalide should fail-safe to false');
    }
  }

  // ===================================================================
  // Bonus : isAudienceType type guard
  // ===================================================================
  section('Bonus isAudienceType type guard');
  {
    let allOk = true;
    for (const t of AUDIENCE_TYPES) {
      if (!isAudienceType(t)) {
        allOk = false;
        break;
      }
    }
    if (allOk) {
      pass('Bonus isAudienceType valide tous AUDIENCE_TYPES');
    } else {
      fail('Bonus isAudienceType should validate all AUDIENCE_TYPES');
    }
    if (!isAudienceType('foo') && !isAudienceType(123) && !isAudienceType(null)) {
      pass('Bonus isAudienceType reject foo / 123 / null');
    } else {
      fail('Bonus isAudienceType should reject invalid values');
    }
  }

  // ===================================================================
  // Bonus : AUDIENCE_TYPES contient 4 valeurs (Q1=A enum schema Phase 7)
  // ===================================================================
  section('Bonus AUDIENCE_TYPES enum 4 valeurs (Q1=A schema Phase 7 préservé)');
  {
    const expected: AudienceType[] = ['all', 'women-only', 'men-only', 'mixed-priority-women'];
    if (
      AUDIENCE_TYPES.length === expected.length &&
      expected.every((t) => (AUDIENCE_TYPES as readonly string[]).includes(t))
    ) {
      pass('Bonus enum 4 valeurs strict cohérent Phase 7 SC0 c3');
    } else {
      fail('Bonus enum mismatch', { actual: AUDIENCE_TYPES });
    }
  }

  console.log('');
  console.log('====== Résumé Audience Helpers (AS1-AS4 + bonus) ======');
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
