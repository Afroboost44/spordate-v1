/**
 * Accent feature — Tests purs `hexToHsl`, `hexToRgb`, `isValidHexColor`.
 *
 * Helpers utilisés par ThemeProvider pour injecter dynamiquement la couleur
 * d'accent dans les CSS variables :
 *  - --accent-color (hex direct, ex: '#D91CD2')
 *  - --accent-color-rgb (triplet RGB, ex: '217 28 210')
 *  - --primary / --accent / --sidebar-primary (HSL stripped, ex: '302 77% 48%')
 *
 * Couverture CC1-CC8 :
 *   CC1 hexToHsl('#D91CD2') → '302 77% 48%' (charte Spordateur)
 *   CC2 hexToHsl('#FFFFFF') → '0 0% 100%' (blanc)
 *   CC3 hexToHsl('#000000') → '0 0% 0%' (noir)
 *   CC4 hexToHsl normalise 3-digit (#FFF → #FFFFFF)
 *   CC5 hexToRgb('#D91CD2') → '217 28 210'
 *   CC6 hexToRgb('#FFFFFF') → '255 255 255'
 *   CC7 isValidHexColor : true/false cases
 *   CC8 hexToHsl invalid input → throw avec message
 *
 * Exécution : npx tsx tests/theme/color-conversion.test.ts
 */

import { hexToHsl, hexToRgb, isValidHexColor } from '../../src/lib/theme/colorConversion';

let passes = 0;
let failures = 0;

function ok(label: string) { passes++; console.log(`  ✓ ${label}`); }
function fail(label: string, info?: unknown) { failures++; console.error(`  ✗ ${label}`, info ?? ''); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

async function run() {
  section('CC1 — hexToHsl #D91CD2 → 302 77% 48% (charte)');
  {
    const r = hexToHsl('#D91CD2');
    // Tolérance d'arrondi : 302 ±1, 77 ±1, 48 ±1
    const m = r.match(/^(\d+) (\d+)% (\d+)%$/);
    if (m && Math.abs(parseInt(m[1]) - 302) <= 1 && Math.abs(parseInt(m[2]) - 77) <= 1 && Math.abs(parseInt(m[3]) - 48) <= 1) {
      ok(`got ${r}`);
    } else {
      fail('unexpected', r);
    }
  }

  section('CC2 — hexToHsl #FFFFFF → 0 0% 100%');
  {
    const r = hexToHsl('#FFFFFF');
    if (r === '0 0% 100%') ok('white OK');
    else fail('unexpected', r);
  }

  section('CC3 — hexToHsl #000000 → 0 0% 0%');
  {
    const r = hexToHsl('#000000');
    if (r === '0 0% 0%') ok('black OK');
    else fail('unexpected', r);
  }

  section('CC4 — hexToHsl normalise 3-digit (#FFF → #FFFFFF)');
  {
    const r1 = hexToHsl('#FFF');
    const r2 = hexToHsl('#000');
    if (r1 === '0 0% 100%' && r2 === '0 0% 0%') ok('3-digit hex normalized');
    else fail('unexpected', { r1, r2 });
  }

  section('CC5 — hexToRgb #D91CD2 → 217 28 210');
  {
    const r = hexToRgb('#D91CD2');
    if (r === '217 28 210') ok('charte RGB OK');
    else fail('unexpected', r);
  }

  section('CC6 — hexToRgb #FFFFFF → 255 255 255');
  {
    const r = hexToRgb('#FFFFFF');
    if (r === '255 255 255') ok('white RGB OK');
    else fail('unexpected', r);
  }

  section('CC7 — isValidHexColor : true/false');
  {
    if (isValidHexColor('#D91CD2') === true) ok('#D91CD2 valid');
    else fail('#D91CD2 should be valid');
    if (isValidHexColor('#fff') === true) ok('#fff valid');
    else fail('#fff should be valid');
    if (isValidHexColor('D91CD2') === false) ok('missing # invalid');
    else fail('D91CD2 should be invalid');
    if (isValidHexColor('#GGGGGG') === false) ok('non-hex chars invalid');
    else fail('#GGGGGG should be invalid');
    if (isValidHexColor('') === false) ok('empty invalid');
    else fail('empty should be invalid');
  }

  section('CC8 — hexToHsl invalid → throw');
  {
    try {
      hexToHsl('not-a-hex');
      fail('expected throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('invalid')) ok('throws with invalid message');
      else fail('wrong throw message', msg);
    }
  }

  console.log(`\n====== Résumé color-conversion ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
