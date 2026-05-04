/**
 * Spordateur — Tests Phase 6 anti-cheat — fixtures partagées.
 *
 * Helpers réutilisés entre chantiers B/C/D :
 * - Constantes (ALICE_UID, BOB_UID, ACTIVITY_ID_ALICE)
 * - Mini test runner (assertEq, assertThrows, section, passManually, failManually, getCounts)
 * - asFirestore cast helper (rules-unit-testing v4 compat)
 * - makeTestSession factory (Session avec defaults sains, override pour cas test)
 * - setupActivityAlice (crée activities/{ID} avec partnerId=ALICE pour rules tests)
 *
 * État du runner :
 * Les compteurs `passes`/`failures` sont module-scoped. Chaque test file s'exécute dans son
 * propre processus Node via `firebase emulators:exec` → pas de contamination cross-file.
 * Le test file appelle resetCounts() au début (defensive) et getCounts() à la fin pour reporting.
 */

import { Timestamp, doc, setDoc, type Firestore } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Session, PricingTier } from '../../src/types/firestore';

// =====================================================================
// Constantes
// =====================================================================

export const ALICE_UID = 'alice_partner';
export const BOB_UID = 'bob_other_user';
export const ACTIVITY_ID_ALICE = 'activity_alice';

// =====================================================================
// Type compat helper
// =====================================================================

/**
 * @firebase/rules-unit-testing v4 retourne une Firestore "compat" (legacy namespace) qui est
 * runtime-compatible avec la modular SDK mais déclarée différemment côté types.
 */
export function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

export function getCounts(): { passes: number; failures: number } {
  return { passes: _passes, failures: _failures };
}

export function resetCounts(): void {
  _passes = 0;
  _failures = 0;
}

export function assertEq<T>(actual: T, expected: T, label: string): void {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson === eJson) {
    console.log(`PASS  ${label}`);
    _passes++;
  } else {
    console.log(`FAIL  ${label}`);
    console.log(`        actual  : ${aJson}`);
    console.log(`        expected: ${eJson}`);
    _failures++;
  }
}

/**
 * Vérifie qu'une promise rejette avec un message exact.
 * Retourne l'Error capturée (pour inspection de err.cause par le caller).
 */
export async function assertThrows(
  fn: () => Promise<unknown>,
  expectedMessage: string,
  label: string,
): Promise<Error | null> {
  try {
    await fn();
    console.log(`FAIL  ${label} (expected throw "${expectedMessage}", got success)`);
    _failures++;
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === expectedMessage) {
      console.log(`PASS  ${label}`);
      _passes++;
      return err instanceof Error ? err : null;
    }
    console.log(`FAIL  ${label} (expected throw "${expectedMessage}", got "${msg}")`);
    _failures++;
    return null;
  }
}

export function passManually(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

export function failManually(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

export function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Session factory
// =====================================================================

/**
 * Crée une Session test complète avec defaults sains :
 * - startAt = J+7, endAt = J+7 + 1h
 * - chatOpenAt = J+5, chatCloseAt = endAt
 * - maxParticipants=10, currentParticipants=0
 * - pricingTiers : 3 tiers standards (early 2500, standard 3500, last_minute 4500)
 * - currentTier='early', currentPrice=2500, status='open'
 * - partnerId=creatorId=ALICE_UID, activityId=ACTIVITY_ID_ALICE
 *
 * Override n'importe quel field via le param overrides.
 */
export function makeTestSession(overrides: Partial<Session>): Session {
  const nowMs = Date.now();
  const startAt = Timestamp.fromMillis(nowMs + 7 * 24 * 60 * 60 * 1000);
  const endAt = Timestamp.fromMillis(nowMs + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  const chatOpenAt = Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60 * 1000);
  const chatCloseAt = endAt;
  const tiers: PricingTier[] = [
    { kind: 'early', price: 2500, activateMinutesBeforeStart: null, activateAtFillRate: null },
    { kind: 'standard', price: 3500, activateMinutesBeforeStart: 4320, activateAtFillRate: 0.5 },
    { kind: 'last_minute', price: 4500, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.8 },
  ];
  return {
    sessionId: 'will-be-overridden',
    activityId: ACTIVITY_ID_ALICE,
    partnerId: ALICE_UID,
    creatorId: ALICE_UID,
    sport: 'Afroboost',
    title: 'Test Session',
    city: 'Genève',
    startAt,
    endAt,
    chatOpenAt,
    chatCloseAt,
    maxParticipants: 10,
    currentParticipants: 0,
    pricingTiers: tiers,
    currentTier: 'early',
    currentPrice: 2500,
    status: 'open',
    createdBy: ALICE_UID,
    createdAt: Timestamp.fromMillis(nowMs),
    updatedAt: Timestamp.fromMillis(nowMs),
    ...overrides,
  };
}

// =====================================================================
// Activity setup
// =====================================================================

/**
 * Crée activities/{ACTIVITY_ID_ALICE} avec partnerId=ALICE_UID.
 * Nécessaire pour que les rules sessions/{id} valident qu'ALICE est partner-owner.
 * Setup minimum (juste partnerId + 1-2 fields) — autres champs Activity non requis par rules.
 *
 * Utilise withSecurityRulesDisabled pour bypass les rules d'écriture sur activities.
 */
export async function setupActivityAlice(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'activities', ACTIVITY_ID_ALICE), {
      activityId: ACTIVITY_ID_ALICE,
      partnerId: ALICE_UID,
      title: 'Test Activity Alice',
    });
  });
}
