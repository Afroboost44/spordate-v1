/**
 * Tests purs Phase 2 — fonctions sans accès Firestore.
 *
 * Exécution :
 *   npx tsx tests/sessions-pure.test.ts
 *
 * 23 cas couverts :
 *   - 12 cas pour computePricingTier
 *   - 3 cas pour computeChatWindow
 *   - 4 cas pour getChatPhase
 *   - 4 cas pour isSessionBookable
 *
 * Pas de framework de test — utilise un mini helper assertEq.
 * Aucune dépendance Firebase Admin / aucun emulator requis.
 */

import { Timestamp } from 'firebase/firestore';
import {
  computeChatWindow,
  computePricingTier,
  getChatPhase,
  isSessionBookable,
} from '../src/services/firestore';
import type { Session, PricingTier, PricingTierKind, SessionStatus } from '../src/types/firestore';

// =====================================================================
// Mini test runner
// =====================================================================

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
// Fixtures
// =====================================================================

const NOW = new Date('2026-06-01T12:00:00Z');

/** startAt = NOW + days. */
function inDays(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 3600 * 1000);
}

const STANDARD_TIERS: PricingTier[] = [
  { kind: 'early',       price: 2500, activateMinutesBeforeStart: null,  activateAtFillRate: null },
  { kind: 'standard',    price: 3500, activateMinutesBeforeStart: 4320,  activateAtFillRate: 0.5 },  // J-3 / 50%
  { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440,  activateAtFillRate: 0.8 },  // J-1 / 80%
];

function mkSession(overrides: Partial<Session> = {}): Session {
  const startAt = overrides.startAt ?? Timestamp.fromDate(inDays(30));
  const endAt = overrides.endAt ?? Timestamp.fromDate(new Date(startAt.toMillis() + 60 * 60_000));
  return {
    sessionId: 'test_session',
    activityId: 'test_activity',
    partnerId: 'test_partner',
    creatorId: 'test_creator',
    sport: 'afroboost',
    title: 'Test Session',
    city: 'Genève',
    startAt,
    endAt,
    chatOpenAt: Timestamp.fromMillis(startAt.toMillis() - 120 * 60_000),
    chatCloseAt: endAt,
    maxParticipants: 10,
    currentParticipants: 0,
    pricingTiers: STANDARD_TIERS,
    currentTier: 'early',
    currentPrice: 2500,
    status: 'open' as SessionStatus,
    createdBy: 'test_user',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

// =====================================================================
// computePricingTier (12 cas)
// =====================================================================

section('computePricingTier — 12 cas');

// 1. J-30, 0 participants → early
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(30)) }), NOW),
  { tier: 'early' as PricingTierKind, price: 2500, passedTiers: [] },
  'C1 J-30, 0 participants → early/2500',
);

// 2. J-30, 50% rempli → standard (par fill)
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(30)), currentParticipants: 5 }), NOW),
  { tier: 'standard' as PricingTierKind, price: 3500, passedTiers: ['early'] as PricingTierKind[] },
  'C2 J-30, 50% rempli → standard/3500',
);

// 3. J-30, 80% rempli → last_minute (par fill)
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(30)), currentParticipants: 8 }), NOW),
  { tier: 'last_minute' as PricingTierKind, price: 4500, passedTiers: ['early', 'standard'] as PricingTierKind[] },
  'C3 J-30, 80% rempli → last_minute/4500',
);

// 4. J-3, 0 participants → standard (par temps)
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(3)) }), NOW),
  { tier: 'standard' as PricingTierKind, price: 3500, passedTiers: ['early'] as PricingTierKind[] },
  'C4 J-3, 0 participants → standard/3500',
);

// 5. J-1, 0 participants → last_minute (par temps)
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(1)) }), NOW),
  { tier: 'last_minute' as PricingTierKind, price: 4500, passedTiers: ['early', 'standard'] as PricingTierKind[] },
  'C5 J-1, 0 participants → last_minute/4500',
);

// 6. J-3, 80% rempli → MAX(temps=standard, fill=last_minute) = last_minute
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(3)), currentParticipants: 8 }), NOW),
  { tier: 'last_minute' as PricingTierKind, price: 4500, passedTiers: ['early', 'standard'] as PricingTierKind[] },
  'C6 J-3 + 80% (MAX) → last_minute/4500',
);

// 7. now > startAt (event passé) → last_minute (au-delà du dernier seuil temporel)
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(-1)) }), NOW),
  { tier: 'last_minute' as PricingTierKind, price: 4500, passedTiers: ['early', 'standard'] as PricingTierKind[] },
  'C7 event passé (now > startAt) → last_minute/4500',
);

// 8. J-30, 100% rempli → last_minute (1.0 >= 0.8)
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(30)), currentParticipants: 10 }), NOW),
  { tier: 'last_minute' as PricingTierKind, price: 4500, passedTiers: ['early', 'standard'] as PricingTierKind[] },
  'C8 J-30, 100% rempli → last_minute',
);

// 9. J-30, >100% rempli (edge) → last_minute robuste
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(30)), currentParticipants: 11, maxParticipants: 10 }), NOW),
  { tier: 'last_minute' as PricingTierKind, price: 4500, passedTiers: ['early', 'standard'] as PricingTierKind[] },
  'C9 fillRate > 1.0 (edge) → last_minute robuste',
);

// 10. pricingTiers vide → fallback early/0
assertEq(
  computePricingTier(mkSession({ pricingTiers: [] }), NOW),
  { tier: 'early' as PricingTierKind, price: 0, passedTiers: [] },
  'C10 pricingTiers vide → early/0 (graceful)',
);

// 11. maxParticipants=0 → fillRate=0 (pas de div/0), early
assertEq(
  computePricingTier(mkSession({ startAt: Timestamp.fromDate(inDays(30)), maxParticipants: 0, currentParticipants: 0 }), NOW),
  { tier: 'early' as PricingTierKind, price: 2500, passedTiers: [] },
  'C11 maxParticipants=0 (div/0 safety) → early/2500',
);

// 12. pricingTiers sans 'early' → fallback price=0
assertEq(
  computePricingTier(
    mkSession({
      startAt: Timestamp.fromDate(inDays(30)),
      pricingTiers: [
        { kind: 'standard',    price: 3500, activateMinutesBeforeStart: 4320, activateAtFillRate: 0.5 },
        { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.8 },
      ],
    }),
    NOW,
  ),
  { tier: 'early' as PricingTierKind, price: 0, passedTiers: [] },
  'C12 pas de tier early dans pricingTiers → early/0',
);

// =====================================================================
// computeChatWindow (3 cas)
// =====================================================================

section('computeChatWindow — 3 cas');

// W1. Cas normal : offset 120 min (= H-2)
{
  const startAt = new Date('2026-06-15T17:00:00Z');
  const endAt = new Date('2026-06-15T18:00:00Z');
  const result = computeChatWindow(startAt, endAt, 120);
  assertEq(
    {
      chatOpenAt: result.chatOpenAt.toDate().toISOString(),
      chatCloseAt: result.chatCloseAt.toDate().toISOString(),
    },
    { chatOpenAt: '2026-06-15T15:00:00.000Z', chatCloseAt: '2026-06-15T18:00:00.000Z' },
    'W1 offset 120min : chat ouvre H-2, ferme à endAt',
  );
}

// W2. Offset 0 : chat ouvre exactement à startAt
{
  const startAt = new Date('2026-06-15T17:00:00Z');
  const endAt = new Date('2026-06-15T18:00:00Z');
  const result = computeChatWindow(startAt, endAt, 0);
  assertEq(
    {
      chatOpenAt: result.chatOpenAt.toDate().toISOString(),
      chatCloseAt: result.chatCloseAt.toDate().toISOString(),
    },
    { chatOpenAt: '2026-06-15T17:00:00.000Z', chatCloseAt: '2026-06-15T18:00:00.000Z' },
    'W2 offset 0 : chat ouvre = startAt',
  );
}

// W3. Offset négatif (edge case bizarre — chat s'ouvre APRÈS startAt) : graceful, pas d'erreur
{
  const startAt = new Date('2026-06-15T17:00:00Z');
  const endAt = new Date('2026-06-15T18:00:00Z');
  const result = computeChatWindow(startAt, endAt, -30);
  assertEq(
    {
      chatOpenAt: result.chatOpenAt.toDate().toISOString(),
      chatCloseAt: result.chatCloseAt.toDate().toISOString(),
    },
    { chatOpenAt: '2026-06-15T17:30:00.000Z', chatCloseAt: '2026-06-15T18:00:00.000Z' },
    'W3 offset négatif (edge) → chat ouvre après startAt, graceful',
  );
}

// =====================================================================
// getChatPhase (4 cas)
// =====================================================================

section('getChatPhase — 4 cas');

// Référence : chatOpenAt=08:00, startAt=10:00, endAt=11:00, chatCloseAt=11:00
const PHASE_SESSION = mkSession({
  chatOpenAt: Timestamp.fromDate(new Date('2026-06-15T08:00:00Z')),
  startAt: Timestamp.fromDate(new Date('2026-06-15T10:00:00Z')),
  endAt: Timestamp.fromDate(new Date('2026-06-15T11:00:00Z')),
  chatCloseAt: Timestamp.fromDate(new Date('2026-06-15T11:00:00Z')),
});

// P1. now=07:00 → before
assertEq(
  getChatPhase(PHASE_SESSION, new Date('2026-06-15T07:00:00Z')),
  'before' as const,
  'P1 now=07:00 (avant chatOpenAt) → before',
);

// P2. now=09:00 → chat-open
assertEq(
  getChatPhase(PHASE_SESSION, new Date('2026-06-15T09:00:00Z')),
  'chat-open' as const,
  'P2 now=09:00 (chat ouvert, pas commencé) → chat-open',
);

// P3. now=10:30 → started
assertEq(
  getChatPhase(PHASE_SESSION, new Date('2026-06-15T10:30:00Z')),
  'started' as const,
  'P3 now=10:30 (event en cours) → started',
);

// P4. now=11:30 → ended
assertEq(
  getChatPhase(PHASE_SESSION, new Date('2026-06-15T11:30:00Z')),
  'ended' as const,
  'P4 now=11:30 (après chatCloseAt) → ended',
);

// =====================================================================
// isSessionBookable (4 cas)
// =====================================================================

section('isSessionBookable — 4 cas');

// B1. Session ouverte, futur, pas pleine → true
assertEq(
  isSessionBookable(
    mkSession({ status: 'open', startAt: Timestamp.fromDate(inDays(7)), currentParticipants: 5 }),
    NOW,
  ),
  true,
  'B1 open + futur + 5/10 → true',
);

// B2. Session avec status='full' → false
assertEq(
  isSessionBookable(
    mkSession({ status: 'full', startAt: Timestamp.fromDate(inDays(7)), currentParticipants: 10 }),
    NOW,
  ),
  false,
  'B2 status=full → false',
);

// B3. Session avec status='completed' → false
assertEq(
  isSessionBookable(
    mkSession({ status: 'completed', startAt: Timestamp.fromDate(inDays(-1)), currentParticipants: 8 }),
    NOW,
  ),
  false,
  'B3 status=completed → false',
);

// B4. Session ouverte mais startAt passé → false
assertEq(
  isSessionBookable(
    mkSession({ status: 'open', startAt: Timestamp.fromDate(inDays(-1)), currentParticipants: 5 }),
    NOW,
  ),
  false,
  'B4 open mais startAt < now → false',
);

// =====================================================================
// Résumé
// =====================================================================

console.log('');
console.log(`====== Résumé ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);

if (failures > 0) {
  process.exit(1);
}
