/**
 * Fix B Option 3 — Tests purs `validateSessionDate`.
 *
 * Helper qui valide la date d'une session partner :
 *  - Doit être dans le futur (startAtMs > nowMs)
 *  - Max 1 an dans le futur (anti-typo : si user entre 2125 par erreur)
 *
 * Couverture VSD1-VSD6 :
 *   VSD1 — date passée → invalid 'past'
 *   VSD2 — date now+5min → valid
 *   VSD3 — date now+1mois → valid
 *   VSD4 — date now+1an exact → valid (limite inclusive)
 *   VSD5 — date now+13mois → invalid 'too-far'
 *   VSD6 — NaN / Infinity → invalid 'invalid-date'
 *
 * Exécution : npx tsx tests/partner/session-edit.test.ts
 */

import { validateSessionDate } from '../../src/lib/billing/sessionDateValidation';

let passes = 0;
let failures = 0;

function ok(label: string) { passes++; console.log(`  ✓ ${label}`); }
function fail(label: string, info?: unknown) { failures++; console.error(`  ✗ ${label}`, info ?? ''); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

async function run() {
  const now = Date.now();

  section('VSD1 — date passée → invalid past');
  {
    const r = validateSessionDate(now - HOUR, now);
    if (!r.valid && r.reason === 'past') ok('past detected');
    else fail('unexpected', r);
  }

  section('VSD2 — date now+5min → valid');
  {
    const r = validateSessionDate(now + 5 * 60 * 1000, now);
    if (r.valid) ok('5min future OK');
    else fail('unexpected', r);
  }

  section('VSD3 — date now+1mois → valid');
  {
    const r = validateSessionDate(now + 30 * DAY, now);
    if (r.valid) ok('1 month future OK');
    else fail('unexpected', r);
  }

  section('VSD4 — date now+1an exact → valid (inclusive)');
  {
    const r = validateSessionDate(now + YEAR, now);
    if (r.valid) ok('1 year exact OK');
    else fail('unexpected', r);
  }

  section('VSD5 — date now+13mois → invalid too-far');
  {
    const r = validateSessionDate(now + 13 * 30 * DAY, now);
    if (!r.valid && r.reason === 'too-far') ok('too far detected');
    else fail('unexpected', r);
  }

  section('VSD6 — NaN / Infinity → invalid invalid-date');
  {
    const r1 = validateSessionDate(NaN, now);
    if (!r1.valid && r1.reason === 'invalid-date') ok('NaN → invalid-date');
    else fail('unexpected NaN', r1);
    const r2 = validateSessionDate(Infinity, now);
    if (!r2.valid && r2.reason === 'invalid-date') ok('Infinity → invalid-date');
    else fail('unexpected Inf', r2);
  }

  console.log(`\n====== Résumé session-edit ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
