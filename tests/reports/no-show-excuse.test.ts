/**
 * Tests Phase 9 sub-chantier 5 commit 2/4 — markNoShow excuse pre-check (Q1=A 2h grace).
 *
 * Exécution :
 *   npm run test:reports:no-show-excuse
 *
 * Pattern : @firebase/rules-unit-testing emulator + DI seam (cohérent SC5 c1/4 + reports/no-show.test.ts).
 *
 * Couverture (NS-EX1-NS-EX5 + bonus) :
 *   NS-EX1 excuse 3h avant session → markNoShow throw 'user-excused' + report NOT created + threshold count NOT trigger
 *   NS-EX2 excuse 1h avant (trop tardive) → markNoShow normal (report created + threshold compute) — excuse Firestore préservée
 *   NS-EX3 pas d'excuse → markNoShow normal (régression safety)
 *   NS-EX4 excuse pour other session → markNoShow normal (scope sessionId préservé)
 *   NS-EX5 excuse pour same session, other user → markNoShow normal (scope userId préservé)
 *
 * Bonus : 2 no-shows existants + 3e tentative excusée 3h avant → threshold count reste à 2 (pas trigger niveau 3 ban_permanent)
 * Bonus : excuse exact 2h avant (boundary inclusive) → throw 'user-excused' (cohérent EX3 boundary SC5 c1)
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import {
  __setReportsDbForTesting,
  markNoShow,
  ReportError,
} from '../../src/lib/reports';
import {
  __setExcusesDbForTesting,
  EXCUSE_WINDOW_HOURS_BEFORE_SESSION,
} from '../../src/lib/excuses';
import type {
  Activity,
  Booking,
  Session,
  UserProfile,
} from '../../src/types/firestore';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

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

async function expectThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await fn();
    fail(`${label} (expected throw '${expectedCode}', got success)`);
  } catch (err) {
    if (err instanceof ReportError && err.code === expectedCode) {
      pass(label);
    } else {
      const code = err instanceof ReportError ? err.code : (err as Error).message;
      fail(`${label} (expected '${expectedCode}', got '${code}')`);
    }
  }
}

// =====================================================================
// Fixture helpers
// =====================================================================

function tsFromMs(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

const PARTNER = 'partner_nsex';
const ALICE = 'user_alice_nsex';
const BOB = 'user_bob_nsex';
const ACTIVITY = 'activity_nsex';

async function setupUser(fbDb: Firestore, uid: string): Promise<void> {
  const minimal: Partial<UserProfile> = {
    uid,
    email: `${uid}@test.local`,
    displayName: uid,
    role: 'user',
  };
  await setDoc(doc(fbDb, 'users', uid), minimal);
}

async function setupActivity(fbDb: Firestore): Promise<void> {
  const minimal: Partial<Activity> = {
    activityId: ACTIVITY,
    partnerId: PARTNER,
    title: 'Test Activity NoShow Excuse',
    sport: 'Afroboost',
    city: 'Genève',
  };
  await setDoc(doc(fbDb, 'activities', ACTIVITY), minimal);
}

async function setupSession(
  fbDb: Firestore,
  sessionId: string,
  startAtMs: number,
  endAtMs?: number,
): Promise<void> {
  const minimal: Partial<Session> = {
    sessionId,
    activityId: ACTIVITY,
    startAt: tsFromMs(startAtMs),
    endAt: tsFromMs(endAtMs ?? startAtMs + 60 * 60 * 1000),
  };
  await setDoc(doc(fbDb, 'sessions', sessionId), minimal);
}

async function setupBooking(
  fbDb: Firestore,
  bookingId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const minimal: Partial<Booking> = {
    bookingId,
    userId,
    sessionId,
    activityId: ACTIVITY,
    status: 'confirmed',
  };
  await setDoc(doc(fbDb, 'bookings', bookingId), minimal);
}

async function setupExcuse(
  fbDb: Firestore,
  excuseId: string,
  userId: string,
  sessionId: string,
  bookingId: string,
  createdAtMs: number,
): Promise<void> {
  await setDoc(doc(fbDb, 'excuses', excuseId), {
    excuseId,
    userId,
    sessionId,
    bookingId,
    reason: 'test excuse',
    createdAt: tsFromMs(createdAtMs),
  });
}

async function clearAll(fbDb: Firestore): Promise<void> {
  for (const col of ['excuses', 'bookings', 'sessions', 'reports', 'userSanctions']) {
    const snap = await getDocs(collection(fbDb, col));
    for (const d of snap.docs) {
      await deleteDoc(d.ref).catch(() => {});
    }
  }
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-noshow-excuse',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setReportsDbForTesting(fbDb);
    __setExcusesDbForTesting(fbDb);

    await setupUser(fbDb, PARTNER);
    await setupUser(fbDb, ALICE);
    await setupUser(fbDb, BOB);
    await setupActivity(fbDb);

    // ===================================================================
    // NS-EX1 : excuse 3h avant → markNoShow throw 'user-excused'
    // ===================================================================
    section("NS-EX1 excuse 3h avant session → markNoShow throw 'user-excused' + no report + no threshold");
    await clearAll(fbDb);
    {
      const SESSION = 'sess_nsex1';
      // Session past (endAt + 30min < now). Use now-Xh anchor.
      const now = Date.now();
      const sessionStartMs = now - 90 * 60 * 1000; // 1.5h ago start
      const sessionEndMs = now - 60 * 60 * 1000; // 1h ago end (>30min grace passed)
      await setupSession(fbDb, SESSION, sessionStartMs, sessionEndMs);
      await setupBooking(fbDb, 'book_nsex1', ALICE, SESSION);
      // Excuse créée 3h avant session.startAt (sessionStartMs - 3h)
      await setupExcuse(
        fbDb,
        'excuse_nsex1',
        ALICE,
        SESSION,
        'book_nsex1',
        sessionStartMs - 3 * 60 * 60 * 1000,
      );

      await expectThrows(
        () =>
          markNoShow({
            partnerId: PARTNER,
            sessionId: SESSION,
            userId: ALICE,
            now: new Date(now),
          }),
        'user-excused',
        'NS-EX1 markNoShow throw user-excused',
      );

      // Verify NO report created
      const reports = await getDocs(
        query(
          collection(fbDb, 'reports'),
          where('reportedId', '==', ALICE),
          where('sessionId', '==', SESSION),
        ),
      );
      if (reports.empty) {
        pass('NS-EX1 report NOT created (no-show skipped)');
      } else {
        fail('NS-EX1 report should not be created', { count: reports.size });
      }

      // Excuse persistée Firestore (audit trail)
      const exSnap = await getDoc(doc(fbDb, 'excuses', 'excuse_nsex1'));
      if (exSnap.exists()) {
        pass('NS-EX1 excuse Firestore préservée (audit trail)');
      } else {
        fail('NS-EX1 excuse should remain persisted');
      }
    }

    // ===================================================================
    // NS-EX2 : excuse 1h avant (trop tardive) → markNoShow normal flow
    // ===================================================================
    section('NS-EX2 excuse 1h avant (trop tardive) → markNoShow normal (report créé)');
    await clearAll(fbDb);
    {
      const SESSION = 'sess_nsex2';
      const now = Date.now();
      const sessionStartMs = now - 90 * 60 * 1000;
      const sessionEndMs = now - 60 * 60 * 1000;
      await setupSession(fbDb, SESSION, sessionStartMs, sessionEndMs);
      await setupBooking(fbDb, 'book_nsex2', ALICE, SESSION);
      // Excuse 1h avant session.startAt (trop tardive — ignored)
      await setupExcuse(
        fbDb,
        'excuse_nsex2',
        ALICE,
        SESSION,
        'book_nsex2',
        sessionStartMs - 1 * 60 * 60 * 1000,
      );

      const result = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESSION,
        userId: ALICE,
        now: new Date(now),
      });

      if (result.reportId) {
        pass('NS-EX2 markNoShow normal flow (report créé malgré excuse tardive)');
      } else {
        fail('NS-EX2 should create report', result);
      }

      // Excuse Firestore toujours présente (pas de side-effect destructif)
      const exSnap = await getDoc(doc(fbDb, 'excuses', 'excuse_nsex2'));
      if (exSnap.exists()) {
        pass('NS-EX2 excuse tardive préservée Firestore (no destructive side-effect)');
      } else {
        fail('NS-EX2 excuse should remain persisted');
      }
    }

    // ===================================================================
    // NS-EX3 : pas d'excuse → markNoShow normal (régression safety)
    // ===================================================================
    section('NS-EX3 pas d\'excuse → markNoShow normal (régression Phase 7)');
    await clearAll(fbDb);
    {
      const SESSION = 'sess_nsex3';
      const now = Date.now();
      const sessionStartMs = now - 90 * 60 * 1000;
      const sessionEndMs = now - 60 * 60 * 1000;
      await setupSession(fbDb, SESSION, sessionStartMs, sessionEndMs);
      await setupBooking(fbDb, 'book_nsex3', ALICE, SESSION);
      // No excuse seeded

      const result = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESSION,
        userId: ALICE,
        now: new Date(now),
      });

      if (result.reportId && result.noShowCountAfter === 1) {
        pass('NS-EX3 markNoShow normal flow + threshold compute (count=1)');
      } else {
        fail('NS-EX3 should create report + count=1', result);
      }
    }

    // ===================================================================
    // NS-EX4 : excuse pour other session → markNoShow normal (scope sessionId)
    // ===================================================================
    section('NS-EX4 excuse pour autre session → markNoShow normal (scope sessionId préservé)');
    await clearAll(fbDb);
    {
      const SESSION_A = 'sess_nsex4_a';
      const SESSION_B = 'sess_nsex4_b';
      const now = Date.now();
      const sessionStartMs = now - 90 * 60 * 1000;
      const sessionEndMs = now - 60 * 60 * 1000;
      await setupSession(fbDb, SESSION_A, sessionStartMs, sessionEndMs);
      await setupSession(fbDb, SESSION_B, sessionStartMs + 24 * 60 * 60 * 1000, sessionEndMs + 24 * 60 * 60 * 1000);
      await setupBooking(fbDb, 'book_nsex4_a', ALICE, SESSION_A);
      // Excuse pour SESSION_B (autre session) — ne devrait PAS protéger SESSION_A
      await setupExcuse(
        fbDb,
        'excuse_nsex4_b',
        ALICE,
        SESSION_B,
        'book_nsex4_b',
        (sessionStartMs + 24 * 60 * 60 * 1000) - 3 * 60 * 60 * 1000,
      );

      const result = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESSION_A, // marker sur SESSION_A
        userId: ALICE,
        now: new Date(now),
      });

      if (result.reportId) {
        pass('NS-EX4 markNoShow normal (excuse SESSION_B ne protège pas SESSION_A)');
      } else {
        fail('NS-EX4 should create report', result);
      }
    }

    // ===================================================================
    // NS-EX5 : excuse pour same session, other user → markNoShow normal (scope userId)
    // ===================================================================
    section('NS-EX5 excuse pour autre user same session → markNoShow normal (scope userId préservé)');
    await clearAll(fbDb);
    {
      const SESSION = 'sess_nsex5';
      const now = Date.now();
      const sessionStartMs = now - 90 * 60 * 1000;
      const sessionEndMs = now - 60 * 60 * 1000;
      await setupSession(fbDb, SESSION, sessionStartMs, sessionEndMs);
      await setupBooking(fbDb, 'book_nsex5_a', ALICE, SESSION);
      await setupBooking(fbDb, 'book_nsex5_b', BOB, SESSION);
      // Excuse Bob — ne devrait PAS protéger Alice
      await setupExcuse(
        fbDb,
        'excuse_nsex5_bob',
        BOB,
        SESSION,
        'book_nsex5_b',
        sessionStartMs - 3 * 60 * 60 * 1000,
      );

      const result = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESSION,
        userId: ALICE, // marker sur Alice
        now: new Date(now),
      });

      if (result.reportId) {
        pass('NS-EX5 markNoShow Alice normal (excuse Bob ne protège pas Alice)');
      } else {
        fail('NS-EX5 should create report for Alice', result);
      }
    }

    // ===================================================================
    // Bonus : 2 no-shows existants + 3e tentative excusée → threshold reste à 2
    // ===================================================================
    section('Bonus 2 no-shows existants + 3e excusée 3h avant → threshold reste à 2 (pas niveau 3)');
    await clearAll(fbDb);
    {
      const now = Date.now();
      const cutoffPast30d = now - 30 * 24 * 60 * 60 * 1000; // dans la fenêtre 90j

      // Seed 2 no-show reports historiques (within 90j rolling)
      for (let i = 0; i < 2; i++) {
        const rid = `report_hist_${i}`;
        await setDoc(doc(fbDb, 'reports', rid), {
          reportId: rid,
          reporterId: PARTNER,
          reportedId: ALICE,
          category: 'no_show',
          status: 'pending',
          source: 'partner_no_show',
          sessionId: `sess_hist_${i}`,
          activityId: ACTIVITY,
          createdAt: tsFromMs(cutoffPast30d - i * 24 * 60 * 60 * 1000),
        });
      }

      // 3e session — excusée 3h avant
      const SESSION_3 = 'sess_nsex_bonus3';
      const sessionStartMs = now - 90 * 60 * 1000;
      const sessionEndMs = now - 60 * 60 * 1000;
      await setupSession(fbDb, SESSION_3, sessionStartMs, sessionEndMs);
      await setupBooking(fbDb, 'book_nsex_bonus3', ALICE, SESSION_3);
      await setupExcuse(
        fbDb,
        'excuse_nsex_bonus3',
        ALICE,
        SESSION_3,
        'book_nsex_bonus3',
        sessionStartMs - 3 * 60 * 60 * 1000,
      );

      await expectThrows(
        () =>
          markNoShow({
            partnerId: PARTNER,
            sessionId: SESSION_3,
            userId: ALICE,
            now: new Date(now),
          }),
        'user-excused',
        'Bonus markNoShow throw user-excused (3e tentative excusée)',
      );

      // Verify count no-show reste à 2 (pas de 3e report créé)
      const noShowSnap = await getDocs(
        query(
          collection(fbDb, 'reports'),
          where('reportedId', '==', ALICE),
          where('category', '==', 'no_show'),
        ),
      );
      if (noShowSnap.size === 2) {
        pass('Bonus threshold count reste à 2 (3e session excusée non comptabilisée)');
      } else {
        fail('Bonus threshold count should remain 2', { count: noShowSnap.size });
      }
    }

    // ===================================================================
    // Bonus : excuse exact 2h avant (boundary inclusive) → throw 'user-excused'
    // ===================================================================
    section('Bonus excuse exactement 2h avant (boundary inclusive) → throw user-excused');
    await clearAll(fbDb);
    {
      const SESSION = 'sess_nsex_boundary';
      const now = Date.now();
      const sessionStartMs = now - 90 * 60 * 1000;
      const sessionEndMs = now - 60 * 60 * 1000;
      await setupSession(fbDb, SESSION, sessionStartMs, sessionEndMs);
      await setupBooking(fbDb, 'book_nsex_boundary', ALICE, SESSION);
      // Excuse exactement EXCUSE_WINDOW_HOURS_BEFORE_SESSION (2h) avant session.startAt
      await setupExcuse(
        fbDb,
        'excuse_nsex_boundary',
        ALICE,
        SESSION,
        'book_nsex_boundary',
        sessionStartMs - EXCUSE_WINDOW_HOURS_BEFORE_SESSION * 60 * 60 * 1000,
      );

      await expectThrows(
        () =>
          markNoShow({
            partnerId: PARTNER,
            sessionId: SESSION,
            userId: ALICE,
            now: new Date(now),
          }),
        'user-excused',
        'Bonus boundary 2h exact → throw user-excused (inclusive cohérent EX3 SC5 c1)',
      );
    }
  });

  __setReportsDbForTesting(null);
  __setExcusesDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé No-Show Excuse (NS-EX1-NS-EX5 + bonus) ======');
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
