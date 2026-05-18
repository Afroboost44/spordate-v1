/**
 * BUG pricing tiers FIX A — Tests purs `getBookingPriceCHF`.
 *
 * Le booking modal affichait `Activity.price` (CHF entier vitrine) qui peut
 * diverger du prix réellement chargé par /api/checkout (qui utilise
 * `computePricingTier(session)` → currentPrice en centimes).
 *
 * Fix A : helper pur qui :
 *  - Si session disponible → calcule price via computePricingTier (centimes → CHF)
 *  - Sinon → fallback Activity.price (legacy, sécurité backward-compat)
 *  - Mode Duo (× 2) appliqué APRÈS résolution du prix de base
 *
 * Couverture (BP1-BP6) :
 *   BP1 — session + tier early actif → utilise tier price
 *   BP2 — session + late tier triggé (24h before) → utilise standard
 *   BP3 — session avec tous tiers = 0 → 0 CHF (free booking)
 *   BP4 — session null + activity.price présent → fallback activity
 *   BP5 — session null + activity.price absent → 0
 *   BP6 — Duo = base × 2 dans tous les cas
 *
 * Exécution : npx tsx tests/booking/booking-price.test.ts
 */

import { getBookingPriceCHF } from '../../src/lib/booking/price';
import type { Session, Activity, PricingTier } from '../../src/types/firestore';

let passes = 0;
let failures = 0;

function ok(label: string) { passes++; console.log(`  ✓ ${label}`); }
function fail(label: string, info?: unknown) { failures++; console.error(`  ✗ ${label}`, info ?? ''); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

// Helpers de construction (Timestamp Firestore mock minimal)
function mkTs(ms: number) {
  return {
    toMillis: () => ms,
    toDate: () => new Date(ms),
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  } as unknown as Session['startAt'];
}

function mkSession(opts: {
  startAtMs: number;
  pricingTiers: PricingTier[];
  currentParticipants?: number;
  maxParticipants?: number;
}): Session {
  return {
    sessionId: 's1',
    activityId: 'a1',
    partnerId: 'p1',
    creatorId: 'p1',
    sport: 'salsa',
    title: 'Test',
    city: 'GE',
    startAt: mkTs(opts.startAtMs),
    endAt: mkTs(opts.startAtMs + 60 * 60_000),
    chatOpenAt: mkTs(opts.startAtMs - 120 * 60_000),
    chatCloseAt: mkTs(opts.startAtMs + 90 * 60_000),
    maxParticipants: opts.maxParticipants ?? 10,
    currentParticipants: opts.currentParticipants ?? 0,
    pricingTiers: opts.pricingTiers,
    currentTier: 'early',
    currentPrice: opts.pricingTiers[0]?.price ?? 0,
    status: 'open',
    createdBy: 'p1',
    createdAt: mkTs(0),
    updatedAt: mkTs(0),
  } as Session;
}

function mkActivity(price: number): Activity {
  return { activityId: 'a1', price, title: 'T', sport: 'salsa' } as Activity;
}

async function run() {
  const now = new Date('2026-05-18T12:00:00Z');
  const nowMs = now.getTime();

  // Standard 3-tier setup : early=400 (4 CHF), standard=500, last_minute=600 centimes.
  const standardTiers: PricingTier[] = [
    { kind: 'early', price: 400, activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
    { kind: 'standard', price: 500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
    { kind: 'last_minute', price: 600, activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
  ];

  section('BP1 — session + tier early actif (J-7) → 4 CHF');
  {
    const session = mkSession({ startAtMs: nowMs + 7 * 24 * 60 * 60_000, pricingTiers: standardTiers });
    const r = getBookingPriceCHF({ session, activity: mkActivity(10), now, isDuo: false });
    if (r === 4) ok('early 400 cents → 4 CHF');
    else fail('unexpected', r);
  }

  section('BP2 — session + standard triggé (J-1) → 5 CHF');
  {
    const session = mkSession({ startAtMs: nowMs + 12 * 60 * 60_000, pricingTiers: standardTiers });
    const r = getBookingPriceCHF({ session, activity: mkActivity(10), now, isDuo: false });
    if (r === 5) ok('standard 500 cents → 5 CHF');
    else fail('unexpected', r);
  }

  section('BP3 — session avec tous tiers = 0 → 0 CHF (free booking)');
  {
    const freeTiers: PricingTier[] = [
      { kind: 'early', price: 0, activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
      { kind: 'standard', price: 0, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
      { kind: 'last_minute', price: 0, activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
    ];
    const session = mkSession({ startAtMs: nowMs + 7 * 24 * 60 * 60_000, pricingTiers: freeTiers });
    const r = getBookingPriceCHF({ session, activity: mkActivity(10), now, isDuo: false });
    if (r === 0) ok('free → 0 CHF');
    else fail('unexpected', r);
  }

  section('BP4 — session null + activity.price 8 → fallback 8 CHF');
  {
    const r = getBookingPriceCHF({ session: null, activity: mkActivity(8), now, isDuo: false });
    if (r === 8) ok('fallback activity 8 CHF');
    else fail('unexpected', r);
  }

  section('BP5 — session null + activity.price absent → 0 CHF');
  {
    const r = getBookingPriceCHF({ session: null, activity: { activityId: 'a1' } as Activity, now, isDuo: false });
    if (r === 0) ok('no info → 0');
    else fail('unexpected', r);
  }

  section('BP6 — Duo = base × 2');
  {
    const session = mkSession({ startAtMs: nowMs + 7 * 24 * 60 * 60_000, pricingTiers: standardTiers });
    const r = getBookingPriceCHF({ session, activity: mkActivity(10), now, isDuo: true });
    if (r === 8) ok('early × 2 = 8 CHF');
    else fail('unexpected', r);

    const r2 = getBookingPriceCHF({ session: null, activity: mkActivity(8), now, isDuo: true });
    if (r2 === 16) ok('fallback × 2 = 16 CHF');
    else fail('unexpected2', r2);
  }

  console.log(`\n====== Résumé booking-price ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
