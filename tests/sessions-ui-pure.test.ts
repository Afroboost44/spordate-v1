/**
 * Spordateur — Phase 4
 * Tests purs des helpers de formatage countdown.
 *
 * Exécution :
 *   npx tsx tests/sessions-ui-pure.test.ts
 *
 * 7 cas couverts :
 *   C1 breakdownMs(0) → tout 0
 *   C2 breakdownMs(3j5h30m15s) → {3,5,30,15}
 *   C3 breakdownMs(-100) → tout 0 (clamp)
 *   C4 breakdownMs(59999) → {0,0,0,59} (juste sous 1min)
 *   C5 formatBadge(target=now+3j à 17:00) → "J-3 17:00"
 *   C6 formatBadge(target=now+30min) → "30min 0s"
 *   C7 formatBadge(target=now-10s) → "Démarré"
 *
 * Helpers PURES uniquement — pas d'accès React, pas d'accès Firestore.
 */

import { breakdownMs } from '../src/hooks/useCountdown';
import { formatBadge } from '../src/components/sessions/format';

let passes = 0;
let failures = 0;

function assertEq<T>(actual: T, expected: T, label: string): void {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson === eJson) {
    console.log(`PASS  ${label}`);
    passes++;
  } else {
    console.log(`FAIL  ${label}`);
    console.log(`        actual  : ${aJson}`);
    console.log(`        expected: ${eJson}`);
    failures++;
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// breakdownMs (4 cas)
// =====================================================================

section('breakdownMs — 4 cas');

assertEq(
  breakdownMs(0),
  { days: 0, hours: 0, minutes: 0, seconds: 0 },
  'C1 breakdownMs(0) → tout 0',
);

const ms_3d_5h_30m_15s = 3 * 86400_000 + 5 * 3600_000 + 30 * 60_000 + 15_000;
assertEq(
  breakdownMs(ms_3d_5h_30m_15s),
  { days: 3, hours: 5, minutes: 30, seconds: 15 },
  'C2 breakdownMs(3j5h30m15s) → {3,5,30,15}',
);

assertEq(
  breakdownMs(-100),
  { days: 0, hours: 0, minutes: 0, seconds: 0 },
  'C3 breakdownMs(-100) → tout 0 (clamp)',
);

assertEq(
  breakdownMs(59_999),
  { days: 0, hours: 0, minutes: 0, seconds: 59 },
  'C4 breakdownMs(59999) → {0,0,0,59}',
);

// =====================================================================
// formatBadge (3 cas)
// =====================================================================

section('formatBadge — 3 cas');

// C5 — > 24h : "J-3 17:00" (heure locale absolue de la cible)
// Construction via Date(year, month, day, hours, ...) qui utilise la TZ LOCALE :
// getHours() retourne 17 en n'importe quelle TZ.
{
  const NOW = new Date(2026, 5, 1, 12, 0, 0, 0); // 1 juin 2026, 12:00 local
  const target = new Date(2026, 5, 4, 17, 0, 0, 0); // 4 juin 2026, 17:00 local (= 3 jours + 5h)
  assertEq(
    formatBadge(target, { now: NOW }),
    'J-3 17:00',
    'C5 formatBadge(3 jours, target à 17:00) → "J-3 17:00"',
  );
}

// C6 — 30 min : "30min 0s"
{
  const NOW = new Date(2026, 5, 1, 12, 0, 0, 0);
  const target = new Date(2026, 5, 1, 12, 30, 0, 0); // +30 min
  assertEq(
    formatBadge(target, { now: NOW }),
    '30min 0s',
    'C6 formatBadge(30min) → "30min 0s"',
  );
}

// C7 — expired : "Démarré"
{
  const NOW = new Date(2026, 5, 1, 12, 0, 0, 0);
  const target = new Date(2026, 5, 1, 11, 59, 50, 0); // 10s dans le passé
  assertEq(
    formatBadge(target, { now: NOW }),
    'Démarré',
    'C7 formatBadge(target dépassé) → "Démarré"',
  );
}

// =====================================================================
// Résumé
// =====================================================================

console.log('');
console.log('====== Résumé Phase 4 UI pure ======');
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);

if (failures > 0) {
  process.exit(1);
}
