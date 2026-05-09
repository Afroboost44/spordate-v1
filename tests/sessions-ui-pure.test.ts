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
import { tsToMs, tsToDate } from '../src/lib/firestore/timestamp';

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
// Phase 9.5 c11.1 — tsToMs + tsToDate (4 input formats)
// =====================================================================

section('tsToMs / tsToDate — SSR serialization defensive (4 formats)');

const REF_MS = 1717250400000; // 2024-06-01 14:00 UTC
const REF_DATE = new Date(REF_MS);

// TS1 Firestore Timestamp class (méthodes intactes — Server Component scenario)
{
  const tsClass = {
    toMillis: () => REF_MS,
    toDate: () => REF_DATE,
    seconds: Math.floor(REF_MS / 1000),
    nanoseconds: 0,
  };
  assertEq(tsToMs(tsClass), REF_MS, 'TS1.a tsToMs(Timestamp class) → ms');
  assertEq(tsToDate(tsClass)?.getTime(), REF_MS, 'TS1.b tsToDate(Timestamp class) → Date');
}

// TS2 Date instance native
{
  assertEq(tsToMs(REF_DATE), REF_MS, 'TS2.a tsToMs(Date) → ms');
  assertEq(tsToDate(REF_DATE)?.getTime(), REF_MS, 'TS2.b tsToDate(Date) → same Date');
}

// TS3 number (epoch ms)
{
  assertEq(tsToMs(REF_MS), REF_MS, 'TS3.a tsToMs(number) → identity');
  assertEq(tsToDate(REF_MS)?.getTime(), REF_MS, 'TS3.b tsToDate(number) → Date');
}

// TS4 sérialisé JSON {seconds, nanoseconds} (Bug original — SSR→Client serialization)
{
  const tsJson = {
    seconds: Math.floor(REF_MS / 1000),
    nanoseconds: (REF_MS % 1000) * 1_000_000, // ms restants → nanos
  };
  // Tolérance 1ms (round trip nanoseconds)
  const ms = tsToMs(tsJson);
  assertEq(
    Math.abs(ms - REF_MS) <= 1,
    true,
    `TS4.a tsToMs({seconds,nanoseconds}) → ${ms} (≈ ${REF_MS})`,
  );
  const d = tsToDate(tsJson);
  assertEq(
    d !== null && Math.abs(d.getTime() - REF_MS) <= 1,
    true,
    'TS4.b tsToDate({seconds,nanoseconds}) → Date',
  );
}

// TS5 edge cases : null / undefined / unsupported shape → defensive
{
  // Mute le console.warn pendant les tests pour ne pas polluer le run
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assertEq(tsToMs(null), 0, 'TS5.a tsToMs(null) → 0 defensive');
    assertEq(tsToMs(undefined), 0, 'TS5.b tsToMs(undefined) → 0 defensive');
    assertEq(tsToMs({ random: 'shape' }), 0, 'TS5.c tsToMs(unsupported) → 0 + warn');
    assertEq(tsToDate(null), null, 'TS5.d tsToDate(null) → null');
    assertEq(tsToDate({ random: 'shape' }), null, 'TS5.e tsToDate(unsupported) → null');
  } finally {
    console.warn = origWarn;
  }
}

// =====================================================================
// Résumé
// =====================================================================

console.log('');
console.log('====== Résumé Phase 4 UI pure + c11.1 Timestamp helpers ======');
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);

if (failures > 0) {
  process.exit(1);
}
