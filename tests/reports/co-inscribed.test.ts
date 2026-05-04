/**
 * Tests Phase 7 sub-chantier 4 commit 4/4 — getCoInscribedConflicts.
 *
 * Exécution :
 *   npm run test:reports:co-inscribed
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reports/co-inscribed.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing.
 * Cross-module DI seam : __setSessionsLibDbForTesting + __setBlocksDbForTesting injectés sur même testEnv.
 *
 * Couverture CC1-CC6 :
 *   CC1 : happy path — 1 conflit détecté (session future + 2 users avec block + bookings confirmed)
 *   CC2 : sessions passées (endAt < now) → exclusion (pas dans futureSessions)
 *   CC3 : caller responsibility — service ne fait pas de role check, accepte n'importe quel partnerId
 *   CC4 : multi-paires sur même session → returns N conflits avec userA<userB lex order
 *   CC5 : aucun conflit → empty array
 *   CC6 : block uni-directionnel A→B → isBlocked détecte mutuel via 2× getDoc check (doctrine §E)
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  setDoc,
  type Firestore,
} from 'firebase/firestore';

import { __setBlocksDbForTesting, blockUser } from '../../src/lib/blocks';
import {
  __setSessionsLibDbForTesting,
  getCoInscribedConflicts,
} from '../../src/lib/sessions';
import type { Activity, Booking, Session } from '../../src/types/firestore';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function assertEq<T>(actual: T, expected: T, label: string): void {
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

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Fixture helpers
// =====================================================================

async function setupActivity(
  fbDb: Firestore,
  opts: { activityId: string; partnerId: string; title?: string },
): Promise<void> {
  const minimal: Partial<Activity> = {
    activityId: opts.activityId,
    partnerId: opts.partnerId,
    title: opts.title ?? 'Test Activity CC',
  };
  await setDoc(doc(fbDb, 'activities', opts.activityId), minimal);
}

async function setupSession(
  fbDb: Firestore,
  opts: {
    sessionId: string;
    activityId: string;
    partnerId: string;
    startAtMs: number;
    endAtMs: number;
  },
): Promise<void> {
  const minimal: Partial<Session> = {
    sessionId: opts.sessionId,
    activityId: opts.activityId,
    partnerId: opts.partnerId,
    startAt: Timestamp.fromMillis(opts.startAtMs),
    endAt: Timestamp.fromMillis(opts.endAtMs),
  };
  await setDoc(doc(fbDb, 'sessions', opts.sessionId), minimal);
}

async function setupBooking(
  fbDb: Firestore,
  opts: { bookingId: string; userId: string; sessionId: string; activityId: string },
): Promise<void> {
  const minimal: Partial<Booking> = {
    bookingId: opts.bookingId,
    userId: opts.userId,
    sessionId: opts.sessionId,
    activityId: opts.activityId,
    status: 'confirmed',
  };
  await setDoc(doc(fbDb, 'bookings', opts.bookingId), minimal);
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-coinscribed',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    // Cross-module DI seam : sessions + blocks pointent sur le même testEnv firestore
    __setSessionsLibDbForTesting(fbDb);
    __setBlocksDbForTesting(fbDb);

    const PARTNER = 'partner_cc';
    const PARTNER_OTHER = 'partner_other_cc';

    const ACT = 'act_cc';
    await setupActivity(fbDb, { activityId: ACT, partnerId: PARTNER });

    const nowMs = Date.now();
    const futureMs = nowMs + 24 * 60 * 60 * 1000; // +24h
    const pastMs = nowMs - 24 * 60 * 60 * 1000; // -24h

    // -----------------------------------------------------------------
    // SCÉNARIO CC1 — happy path 1 conflit
    // -----------------------------------------------------------------
    section('CC1 happy path : 1 conflit détecté');

    const ALICE = 'user_alice_cc';
    const BOB = 'user_bob_cc';
    const SESS_FUTURE = 'sess_future_cc';

    await setupSession(fbDb, {
      sessionId: SESS_FUTURE,
      activityId: ACT,
      partnerId: PARTNER,
      startAtMs: futureMs,
      endAtMs: futureMs + 60 * 60 * 1000,
    });
    await setupBooking(fbDb, { bookingId: 'b_cc1_alice', userId: ALICE, sessionId: SESS_FUTURE, activityId: ACT });
    await setupBooking(fbDb, { bookingId: 'b_cc1_bob', userId: BOB, sessionId: SESS_FUTURE, activityId: ACT });

    // Alice block Bob (mutual via isBlocked check 2 sens)
    await blockUser({ blockerId: ALICE, blockedId: BOB });

    {
      const conflicts = await getCoInscribedConflicts(PARTNER);
      assertEq(conflicts.length, 1, 'CC1 1 conflit détecté');
      assertEq(conflicts[0].sessionId, SESS_FUTURE, 'CC1 sessionId correct');
      // Lex order : ALICE < BOB → userA=ALICE, userB=BOB
      const sortedPair = ALICE < BOB ? [ALICE, BOB] : [BOB, ALICE];
      assertEq(conflicts[0].userA, sortedPair[0], 'CC1 userA = lex min');
      assertEq(conflicts[0].userB, sortedPair[1], 'CC1 userB = lex max');
      assertEq(conflicts[0].sessionTitle, 'Test Activity CC', 'CC1 sessionTitle fetched from activity');
    }

    // -----------------------------------------------------------------
    // SCÉNARIO CC2 — sessions passées exclues
    // -----------------------------------------------------------------
    section('CC2 sessions passées (endAt < now) → exclusion');

    const SESS_PAST = 'sess_past_cc';
    await setupSession(fbDb, {
      sessionId: SESS_PAST,
      activityId: ACT,
      partnerId: PARTNER,
      startAtMs: pastMs - 60 * 60 * 1000,
      endAtMs: pastMs,
    });
    await setupBooking(fbDb, { bookingId: 'b_cc2_alice', userId: ALICE, sessionId: SESS_PAST, activityId: ACT });
    await setupBooking(fbDb, { bookingId: 'b_cc2_bob', userId: BOB, sessionId: SESS_PAST, activityId: ACT });

    {
      const conflicts = await getCoInscribedConflicts(PARTNER);
      // CC1 a ajouté 1 conflit. CC2 ne doit pas ajouter (session passée).
      assertEq(conflicts.length, 1, 'CC2 toujours 1 conflit (session passée exclue)');
      const noPastConflict = !conflicts.some((c) => c.sessionId === SESS_PAST);
      assertEq(noPastConflict, true, 'CC2 sess_past_cc absent du résultat');
    }

    // -----------------------------------------------------------------
    // SCÉNARIO CC3 — caller responsibility (pas de role check)
    // -----------------------------------------------------------------
    section('CC3 caller responsibility — pas de role check service');

    {
      // PARTNER_OTHER n'a aucune session → returns []
      const conflicts = await getCoInscribedConflicts(PARTNER_OTHER);
      assertEq(conflicts.length, 0, 'CC3 partnerId tiers sans sessions → empty array');
      // Note : le service accepte n'importe quel uid (caller responsibility — UI partner
      // dashboard filtre par user.uid déjà via AuthGuard).
    }

    // -----------------------------------------------------------------
    // SCÉNARIO CC4 — multi-paires sur même session
    // -----------------------------------------------------------------
    section('CC4 multi-paires sur même session');

    const CHARLIE = 'user_charlie_cc';
    const DIANE = 'user_diane_cc';
    const SESS_MULTI = 'sess_multi_cc';

    await setupSession(fbDb, {
      sessionId: SESS_MULTI,
      activityId: ACT,
      partnerId: PARTNER,
      startAtMs: futureMs + 2 * 60 * 60 * 1000,
      endAtMs: futureMs + 3 * 60 * 60 * 1000,
    });
    await setupBooking(fbDb, { bookingId: 'b_cc4_a', userId: ALICE, sessionId: SESS_MULTI, activityId: ACT });
    await setupBooking(fbDb, { bookingId: 'b_cc4_b', userId: BOB, sessionId: SESS_MULTI, activityId: ACT });
    await setupBooking(fbDb, { bookingId: 'b_cc4_c', userId: CHARLIE, sessionId: SESS_MULTI, activityId: ACT });
    await setupBooking(fbDb, { bookingId: 'b_cc4_d', userId: DIANE, sessionId: SESS_MULTI, activityId: ACT });

    // Block Charlie ↔ Diane (mutuel direction)
    await blockUser({ blockerId: CHARLIE, blockedId: DIANE });
    // Alice ↔ Bob déjà bloqué CC1

    {
      const conflicts = await getCoInscribedConflicts(PARTNER);
      // Conflits attendus : SESS_FUTURE (Alice↔Bob 1) + SESS_MULTI (Alice↔Bob + Charlie↔Diane = 2)
      assertEq(conflicts.length, 3, 'CC4 3 conflits cumulés (1 SESS_FUTURE + 2 SESS_MULTI)');

      const multiSession = conflicts.filter((c) => c.sessionId === SESS_MULTI);
      assertEq(multiSession.length, 2, 'CC4 2 paires conflits sur SESS_MULTI');

      // Vérifier lex order pour chaque paire
      const allLexOrdered = multiSession.every((c) => c.userA < c.userB);
      assertEq(allLexOrdered, true, 'CC4 toutes paires lex ordered (userA<userB)');
    }

    // -----------------------------------------------------------------
    // SCÉNARIO CC5 — aucun conflit (other partner without bookings/blocks)
    // -----------------------------------------------------------------
    section('CC5 aucun conflit → empty array');

    const ACT_CLEAN = 'act_clean_cc';
    const SESS_CLEAN = 'sess_clean_cc';
    const EVE = 'user_eve_cc';
    const FRANK = 'user_frank_cc';

    await setupActivity(fbDb, { activityId: ACT_CLEAN, partnerId: PARTNER_OTHER, title: 'Clean Activity' });
    await setupSession(fbDb, {
      sessionId: SESS_CLEAN,
      activityId: ACT_CLEAN,
      partnerId: PARTNER_OTHER,
      startAtMs: futureMs,
      endAtMs: futureMs + 60 * 60 * 1000,
    });
    await setupBooking(fbDb, { bookingId: 'b_cc5_eve', userId: EVE, sessionId: SESS_CLEAN, activityId: ACT_CLEAN });
    await setupBooking(fbDb, { bookingId: 'b_cc5_frank', userId: FRANK, sessionId: SESS_CLEAN, activityId: ACT_CLEAN });
    // Pas de block Eve↔Frank

    {
      const conflicts = await getCoInscribedConflicts(PARTNER_OTHER);
      assertEq(conflicts.length, 0, 'CC5 partner sans block → empty array');
    }

    // -----------------------------------------------------------------
    // SCÉNARIO CC6 — block uni-directionnel détecté via mutuel isBlocked
    // -----------------------------------------------------------------
    section('CC6 block uni-directionnel détecté via mutual check');

    const GRACE = 'user_grace_cc';
    const HENRI = 'user_henri_cc';
    const SESS_UNI = 'sess_uni_cc';
    const ACT_UNI = 'act_uni_cc';

    await setupActivity(fbDb, { activityId: ACT_UNI, partnerId: PARTNER, title: 'Uni Test' });
    await setupSession(fbDb, {
      sessionId: SESS_UNI,
      activityId: ACT_UNI,
      partnerId: PARTNER,
      startAtMs: futureMs + 4 * 60 * 60 * 1000,
      endAtMs: futureMs + 5 * 60 * 60 * 1000,
    });
    await setupBooking(fbDb, { bookingId: 'b_cc6_g', userId: GRACE, sessionId: SESS_UNI, activityId: ACT_UNI });
    await setupBooking(fbDb, { bookingId: 'b_cc6_h', userId: HENRI, sessionId: SESS_UNI, activityId: ACT_UNI });

    // Grace block Henri uniquement (1 sens)
    await blockUser({ blockerId: GRACE, blockedId: HENRI });

    {
      const conflicts = await getCoInscribedConflicts(PARTNER);
      const uniConflict = conflicts.find((c) => c.sessionId === SESS_UNI);
      assertEq(!!uniConflict, true, 'CC6 conflit détecté via isBlocked mutuel (Grace→Henri 1-sens)');
    }
  });

  __setSessionsLibDbForTesting(null);
  __setBlocksDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé getCoInscribedConflicts (CC1-CC6) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
