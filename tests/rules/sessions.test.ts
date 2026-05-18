/**
 * Fix B B3 — Tests rules sécurité sessions/{sessionId} defense-in-depth.
 *
 * Vérifie que les rules Firestore empêchent un partner malveillant de
 * bypasser les checks ownership + V9 freeze via DevTools direct write
 * (au-delà des endpoints /api/partner/sessions/* qui appliquent déjà
 * les checks en première ligne).
 *
 * Exécution :
 *   firebase emulators:exec --only firestore 'npx tsx tests/rules/sessions.test.ts'
 *
 * Pattern : @firebase/rules-unit-testing v4 (cohérent tests/blocks/rules.test.ts).
 *
 * Couverture RS1-RS9 :
 *   RS1 — partner peut create session pour son activité → SUCCESS
 *   RS2 — partner ne peut PAS create pour activité d'un autre partner → REJET
 *   RS3 — partner peut update pricing de sa session (currentParticipants=0) → SUCCESS
 *   RS4 — partner ne peut PAS update si currentParticipants>0 (V9 freeze) → REJET
 *   RS5 — partner ne peut PAS update field hors whitelist (ex: partnerId) → REJET
 *   RS6 — partner peut delete sa session (currentParticipants=0) → SUCCESS
 *   RS7 — partner ne peut PAS delete session avec réservations → REJET
 *   RS8 — partner ne peut PAS delete session d'un autre partner → REJET
 *   RS9 — user normal (non-partner) ne peut RIEN write → REJET
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

let _passes = 0;
let _failures = 0;
function ok(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}
function fail(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}
function section(t: string): void {
  console.log('');
  console.log(`--- ${t} ---`);
}

const PARTNER_A_UID = 'partner_a_b3';
const PARTNER_B_UID = 'partner_b_b3';
const USER_UID = 'user_normal_b3';
const ACTIVITY_A_ID = 'activity_a_b3';
const ACTIVITY_B_ID = 'activity_b_b3';
const SESSION_A_ID = 'session_a_b3';
const SESSION_FROZEN_ID = 'session_frozen_b3';

function buildValidSession(opts: {
  partnerId: string;
  activityId: string;
  currentParticipants?: number;
}): Record<string, unknown> {
  return {
    sessionId: SESSION_A_ID,
    activityId: opts.activityId,
    partnerId: opts.partnerId,
    creatorId: opts.partnerId,
    sport: 'salsa',
    title: 'Test Session',
    city: 'Genève',
    startAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 3600 * 1000),
    endAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 3600 * 1000 + 3600 * 1000),
    chatOpenAt: Timestamp.fromMillis(Date.now() + 6 * 24 * 3600 * 1000),
    chatCloseAt: Timestamp.fromMillis(Date.now() + 8 * 24 * 3600 * 1000),
    maxParticipants: 10,
    currentParticipants: opts.currentParticipants ?? 0,
    pricingTiers: [
      { kind: 'early', price: 500, activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
      { kind: 'standard', price: 600, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
      { kind: 'last_minute', price: 700, activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
    ],
    pricingMode: 'inherit',
    currentTier: 'early',
    currentPrice: 500,
    status: 'open',
    createdBy: opts.partnerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-sessions-b3',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ─── SETUP : activities A et B (read-only setup pour rules ownership lookups) ───
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'activities', ACTIVITY_A_ID), {
      activityId: ACTIVITY_A_ID,
      partnerId: PARTNER_A_UID,
      title: 'Activity A',
      isActive: true,
    });
    await setDoc(doc(fbDb, 'activities', ACTIVITY_B_ID), {
      activityId: ACTIVITY_B_ID,
      partnerId: PARTNER_B_UID,
      title: 'Activity B',
      isActive: true,
    });
  });

  // ─── RS1 : partner-owner peut create session pour son activité ───────
  section('RS1 — partner peut create session pour son activité');
  {
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    const payload = buildValidSession({ partnerId: PARTNER_A_UID, activityId: ACTIVITY_A_ID });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'sessions', SESSION_A_ID), payload));
      ok('RS1 partner create own session → SUCCESS');
    } catch (e) {
      fail('RS1 (expected success)', e);
    }
  }

  // ─── RS2 : partner ne peut PAS create pour activité d'un autre partner ───
  section('RS2 — partner ne peut PAS create pour activité d\'un autre partner');
  {
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    // Partner A tente create session pour activity B (owned par PARTNER_B)
    const payload = buildValidSession({ partnerId: PARTNER_A_UID, activityId: ACTIVITY_B_ID });
    try {
      await assertFails(setDoc(doc(fbDb, 'sessions', 'session_steal_b3'), payload));
      ok('RS2 partner cross-create → REJET');
    } catch (e) {
      fail('RS2 (expected fail)', e);
    }
  }

  // ─── RS3 : partner peut update pricing de sa session (cP=0) ───────────
  section('RS3 — partner peut update pricing de sa session (currentParticipants=0)');
  {
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'sessions', SESSION_A_ID), {
          pricingTiers: [
            { kind: 'early', price: 800, activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
            { kind: 'standard', price: 800, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
            { kind: 'last_minute', price: 800, activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
          ],
          pricingMode: 'custom',
          updatedAt: serverTimestamp(),
        }),
      );
      ok('RS3 partner update pricing (cP=0) → SUCCESS');
    } catch (e) {
      fail('RS3 (expected success)', e);
    }
  }

  // ─── RS4 : V9 freeze — update bloqué si currentParticipants > 0 ───────
  section('RS4 — partner ne peut PAS update si currentParticipants > 0 (V9 freeze)');
  {
    // Setup : créer une session frozen avec currentParticipants=1
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', SESSION_FROZEN_ID),
        buildValidSession({ partnerId: PARTNER_A_UID, activityId: ACTIVITY_A_ID, currentParticipants: 1 }),
      );
    });
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'sessions', SESSION_FROZEN_ID), {
          pricingMode: 'custom',
          updatedAt: serverTimestamp(),
        }),
      );
      ok('RS4 partner update frozen session → REJET');
    } catch (e) {
      fail('RS4 (expected fail)', e);
    }
  }

  // ─── RS5 : partner ne peut PAS modifier field hors whitelist ──────────
  section('RS5 — partner ne peut PAS update field hors whitelist (ex: partnerId, currentParticipants)');
  {
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    // Tente de spoof partnerId (transfert vers PARTNER_B)
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'sessions', SESSION_A_ID), {
          partnerId: PARTNER_B_UID,
          updatedAt: serverTimestamp(),
        }),
      );
      ok('RS5a partner spoof partnerId → REJET');
    } catch (e) {
      fail('RS5a (expected fail)', e);
    }
    // Tente de manipuler currentParticipants (anti-cheat)
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'sessions', SESSION_A_ID), {
          currentParticipants: 99,
          updatedAt: serverTimestamp(),
        }),
      );
      ok('RS5b partner spoof currentParticipants → REJET');
    } catch (e) {
      fail('RS5b (expected fail)', e);
    }
  }

  // ─── RS6 : partner peut delete sa session vide ────────────────────────
  section('RS6 — partner peut delete sa session (currentParticipants=0)');
  {
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    try {
      await assertSucceeds(deleteDoc(doc(fbDb, 'sessions', SESSION_A_ID)));
      ok('RS6 partner delete own empty session → SUCCESS');
    } catch (e) {
      fail('RS6 (expected success)', e);
    }
  }

  // ─── RS7 : partner ne peut PAS delete session avec bookings ───────────
  section('RS7 — partner ne peut PAS delete session avec réservations');
  {
    // SESSION_FROZEN_ID a currentParticipants=1 (setup RS4)
    const ctx = env.authenticatedContext(PARTNER_A_UID);
    const fbDb = asFirestore(ctx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'sessions', SESSION_FROZEN_ID)));
      ok('RS7 partner delete frozen session → REJET');
    } catch (e) {
      fail('RS7 (expected fail)', e);
    }
  }

  // ─── RS8 : partner ne peut PAS delete session d'un autre partner ──────
  section('RS8 — partner ne peut PAS delete session d\'un autre partner');
  {
    // Setup : recréer SESSION_A pour partner A, puis tenter delete depuis partner B
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(
        doc(fbDb, 'sessions', SESSION_A_ID),
        buildValidSession({ partnerId: PARTNER_A_UID, activityId: ACTIVITY_A_ID }),
      );
    });
    const ctx = env.authenticatedContext(PARTNER_B_UID);
    const fbDb = asFirestore(ctx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'sessions', SESSION_A_ID)));
      ok('RS8 partner B delete A\'s session → REJET');
    } catch (e) {
      fail('RS8 (expected fail)', e);
    }
  }

  // ─── RS9 : user normal (non-partner) ne peut RIEN write ───────────────
  section('RS9 — user normal (non-partner) ne peut RIEN write sur sessions');
  {
    const ctx = env.authenticatedContext(USER_UID);
    const fbDb = asFirestore(ctx.firestore());
    // Create
    try {
      await assertFails(
        setDoc(doc(fbDb, 'sessions', 'session_user_b3'), buildValidSession({ partnerId: USER_UID, activityId: ACTIVITY_A_ID })),
      );
      ok('RS9a user create → REJET');
    } catch (e) {
      fail('RS9a (expected fail)', e);
    }
    // Update
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'sessions', SESSION_A_ID), { pricingMode: 'custom', updatedAt: serverTimestamp() }),
      );
      ok('RS9b user update → REJET');
    } catch (e) {
      fail('RS9b (expected fail)', e);
    }
    // Delete
    try {
      await assertFails(deleteDoc(doc(fbDb, 'sessions', SESSION_A_ID)));
      ok('RS9c user delete → REJET');
    } catch (e) {
      fail('RS9c (expected fail)', e);
    }
  }

  await env.cleanup();

  console.log('');
  console.log(`====== Résumé sessions-rules-b3 ======`);
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  if (_failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
