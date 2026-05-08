/**
 * Tests Phase 9 sub-chantier 5 commit 1/4 — Excuses pré-session createExcuse + rules.
 *
 * Exécution :
 *   npm run test:excuses:create
 *
 * Pattern : @firebase/rules-unit-testing emulator + DI seam (cohérent reports/no-show.test.ts).
 *
 * Couverture (EX1-EX4 + bonus) :
 *   EX1 happy path : booking confirmed + ≥2h before session → success + Booking.excusedAt set + /excuses/{id} doc
 *   EX2 booking unconfirmed (status='pending') → throw 'not-confirmed-booker'
 *   EX3 <2h before session.startAt → throw 'window-closed'
 *   EX4 already excused (anti-doublon) → throw 'already-excused'
 *
 * Bonus : reason length max 300 chars enforced (>300 → throw 'reason-too-long')
 * Bonus : rules — non-owner cannot create excuse for another user (anti-spoofing Q6=A)
 * Bonus : window-closed exact boundary (1ms past 2h cutoff = closed)
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
  serverTimestamp,
  where,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setExcusesDbForTesting,
  createExcuse,
  EXCUSE_REASON_MAX_LENGTH,
  EXCUSE_WINDOW_HOURS_BEFORE_SESSION,
  ExcuseError,
} from '../../src/lib/excuses';
import type { Booking, Session, UserProfile } from '../../src/types/firestore';

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
    if (err instanceof ExcuseError && err.code === expectedCode) {
      pass(label);
    } else {
      const code = err instanceof ExcuseError ? err.code : (err as Error).message;
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

async function setupUser(
  fbDb: Firestore,
  opts: { uid: string },
): Promise<void> {
  const minimal: Partial<UserProfile> = {
    uid: opts.uid,
    email: `${opts.uid}@test.local`,
    displayName: opts.uid,
    role: 'user',
  };
  await setDoc(doc(fbDb, 'users', opts.uid), minimal);
}

async function setupSession(
  fbDb: Firestore,
  opts: { sessionId: string; startAtMs: number; endAtMs?: number },
): Promise<void> {
  const minimal: Partial<Session> = {
    sessionId: opts.sessionId,
    activityId: 'activity_ex',
    startAt: tsFromMs(opts.startAtMs),
    endAt: tsFromMs(opts.endAtMs ?? opts.startAtMs + 60 * 60 * 1000),
  };
  await setDoc(doc(fbDb, 'sessions', opts.sessionId), minimal);
}

async function setupBooking(
  fbDb: Firestore,
  opts: {
    bookingId: string;
    userId: string;
    sessionId: string;
    status?: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'refunded';
  },
): Promise<void> {
  const minimal: Partial<Booking> = {
    bookingId: opts.bookingId,
    userId: opts.userId,
    sessionId: opts.sessionId,
    activityId: 'activity_ex',
    status: opts.status ?? 'confirmed',
  };
  await setDoc(doc(fbDb, 'bookings', opts.bookingId), minimal);
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-excuses',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setExcusesDbForTesting(fbDb);

    const ALICE = 'user_alice_ex';
    const BOB = 'user_bob_ex';

    await setupUser(fbDb, { uid: ALICE });
    await setupUser(fbDb, { uid: BOB });

    // Helper : clear excuses + bookings between tests
    async function clearAll(): Promise<void> {
      for (const col of ['excuses', 'bookings', 'sessions']) {
        const snap = await getDocs(collection(fbDb, col));
        for (const d of snap.docs) {
          await deleteDoc(d.ref).catch(() => {});
        }
      }
    }

    // ===================================================================
    // EX1 : happy path — ≥2h before session.startAt + booking confirmed
    // ===================================================================
    section('EX1 happy path : booking confirmed + ≥2h before → success + Booking.excusedAt set');
    await clearAll();
    {
      const SESSION = 'session_ex1';
      const BOOKING = 'booking_ex1';
      const now = Date.now();
      const sessionStartMs = now + 5 * 60 * 60 * 1000; // 5h dans le futur
      await setupSession(fbDb, { sessionId: SESSION, startAtMs: sessionStartMs });
      await setupBooking(fbDb, {
        bookingId: BOOKING,
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });

      const result = await createExcuse({
        userId: ALICE,
        sessionId: SESSION,
        reason: 'Empêchement professionnel de dernière minute.',
        now: new Date(now),
      });

      if (result.excuseId && result.bookingFlagUpdated === true) {
        pass('EX1 createExcuse → excuseId + bookingFlagUpdated=true');
      } else {
        fail('EX1 should return excuseId + bookingFlagUpdated', result);
      }

      // Vérif doc /excuses/{excuseId} créé
      const exSnap = await getDoc(doc(fbDb, 'excuses', result.excuseId));
      if (exSnap.exists()) {
        const data = exSnap.data();
        if (
          data.userId === ALICE &&
          data.sessionId === SESSION &&
          data.bookingId === BOOKING &&
          data.reason === 'Empêchement professionnel de dernière minute.'
        ) {
          pass('EX1 doc /excuses/{id} contient userId + sessionId + bookingId + reason');
        } else {
          fail('EX1 excuse doc shape mismatch', data);
        }
      } else {
        fail('EX1 excuse doc not created');
      }

      // Vérif Booking.excusedAt set
      const bookingSnap = await getDoc(doc(fbDb, 'bookings', BOOKING));
      if (bookingSnap.data()?.excusedAt) {
        pass('EX1 Booking.excusedAt persisté (denorm fast-check)');
      } else {
        fail('EX1 Booking.excusedAt not set', bookingSnap.data());
      }
    }

    // ===================================================================
    // EX2 : booking unconfirmed → throw 'not-confirmed-booker'
    // ===================================================================
    section("EX2 booking unconfirmed (status='pending') → throw 'not-confirmed-booker'");
    await clearAll();
    {
      const SESSION = 'session_ex2';
      const now = Date.now();
      await setupSession(fbDb, {
        sessionId: SESSION,
        startAtMs: now + 5 * 60 * 60 * 1000,
      });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex2',
        userId: ALICE,
        sessionId: SESSION,
        status: 'pending',
      });

      await expectThrows(
        () =>
          createExcuse({
            userId: ALICE,
            sessionId: SESSION,
            now: new Date(now),
          }),
        'not-confirmed-booker',
        "EX2 status='pending' → throw 'not-confirmed-booker'",
      );
    }

    // Bonus EX2 : no booking at all → also throw 'not-confirmed-booker'
    section("EX2 bonus pas de booking du tout → 'not-confirmed-booker'");
    await clearAll();
    {
      const SESSION = 'session_ex2b';
      const now = Date.now();
      await setupSession(fbDb, {
        sessionId: SESSION,
        startAtMs: now + 5 * 60 * 60 * 1000,
      });
      // No booking seeded
      await expectThrows(
        () =>
          createExcuse({
            userId: ALICE,
            sessionId: SESSION,
            now: new Date(now),
          }),
        'not-confirmed-booker',
        'EX2 bonus no booking → throw not-confirmed-booker',
      );
    }

    // ===================================================================
    // EX3 : <2h before session.startAt → throw 'window-closed'
    // ===================================================================
    section("EX3 <2h before session.startAt → throw 'window-closed'");
    await clearAll();
    {
      const SESSION = 'session_ex3';
      const now = Date.now();
      const sessionStartMs = now + 1 * 60 * 60 * 1000; // 1h dans le futur (< 2h window)
      await setupSession(fbDb, { sessionId: SESSION, startAtMs: sessionStartMs });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex3',
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });

      await expectThrows(
        () =>
          createExcuse({
            userId: ALICE,
            sessionId: SESSION,
            now: new Date(now),
          }),
        'window-closed',
        "EX3 1h before → throw 'window-closed'",
      );
    }

    // Bonus EX3 : exactement 2h before → OK (boundary inclusive)
    section('EX3 bonus boundary : exactement 2h before → OK (inclusive)');
    await clearAll();
    {
      const SESSION = 'session_ex3b';
      const now = Date.now();
      const sessionStartMs = now + EXCUSE_WINDOW_HOURS_BEFORE_SESSION * 60 * 60 * 1000;
      await setupSession(fbDb, { sessionId: SESSION, startAtMs: sessionStartMs });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex3b',
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });

      try {
        const r = await createExcuse({
          userId: ALICE,
          sessionId: SESSION,
          now: new Date(now),
        });
        if (r.excuseId) {
          pass('EX3 bonus boundary 2h exactly → success (inclusive)');
        } else {
          fail('EX3 bonus boundary should succeed', r);
        }
      } catch (err) {
        fail('EX3 bonus boundary should not throw', err);
      }
    }

    // Bonus EX3 : 1ms past boundary → throw window-closed
    section('EX3 bonus boundary +1ms past 2h → throw window-closed');
    await clearAll();
    {
      const SESSION = 'session_ex3c';
      const now = Date.now();
      const sessionStartMs =
        now + EXCUSE_WINDOW_HOURS_BEFORE_SESSION * 60 * 60 * 1000 - 1;
      await setupSession(fbDb, { sessionId: SESSION, startAtMs: sessionStartMs });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex3c',
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });

      await expectThrows(
        () =>
          createExcuse({
            userId: ALICE,
            sessionId: SESSION,
            now: new Date(now),
          }),
        'window-closed',
        'EX3 bonus +1ms past boundary → throw window-closed',
      );
    }

    // ===================================================================
    // EX4 : already excused (anti-doublon) → throw 'already-excused'
    // ===================================================================
    section("EX4 already excused (anti-doublon) → throw 'already-excused'");
    await clearAll();
    {
      const SESSION = 'session_ex4';
      const now = Date.now();
      const sessionStartMs = now + 5 * 60 * 60 * 1000;
      await setupSession(fbDb, { sessionId: SESSION, startAtMs: sessionStartMs });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex4',
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });

      // 1ère excuse : OK
      const r1 = await createExcuse({
        userId: ALICE,
        sessionId: SESSION,
        reason: 'first',
        now: new Date(now),
      });
      if (r1.excuseId) {
        pass('EX4 1ère excuse → success');
      } else {
        fail('EX4 1ère excuse should succeed', r1);
      }

      // 2ème excuse : throw already-excused
      await expectThrows(
        () =>
          createExcuse({
            userId: ALICE,
            sessionId: SESSION,
            reason: 'second',
            now: new Date(now + 60_000),
          }),
        'already-excused',
        "EX4 2e excuse → throw 'already-excused'",
      );

      // Verify only 1 excuse doc for {userId, sessionId}
      const snap = await getDocs(
        query(
          collection(fbDb, 'excuses'),
          where('userId', '==', ALICE),
          where('sessionId', '==', SESSION),
        ),
      );
      if (snap.size === 1) {
        pass('EX4 only 1 excuse doc persisted (no duplicate)');
      } else {
        fail('EX4 should have exactly 1 excuse', { count: snap.size });
      }
    }

    // ===================================================================
    // Bonus : reason length > 300 chars → throw 'reason-too-long'
    // ===================================================================
    section("Bonus reason > 300 chars → throw 'reason-too-long'");
    await clearAll();
    {
      const SESSION = 'session_ex_reason';
      const now = Date.now();
      await setupSession(fbDb, {
        sessionId: SESSION,
        startAtMs: now + 5 * 60 * 60 * 1000,
      });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex_reason',
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });

      const tooLong = 'a'.repeat(EXCUSE_REASON_MAX_LENGTH + 1);
      await expectThrows(
        () =>
          createExcuse({
            userId: ALICE,
            sessionId: SESSION,
            reason: tooLong,
            now: new Date(now),
          }),
        'reason-too-long',
        `Bonus reason ${EXCUSE_REASON_MAX_LENGTH + 1} chars → throw 'reason-too-long'`,
      );

      // Bonus : exactement 300 chars OK (boundary)
      await clearAll();
      await setupSession(fbDb, {
        sessionId: SESSION,
        startAtMs: now + 5 * 60 * 60 * 1000,
      });
      await setupBooking(fbDb, {
        bookingId: 'booking_ex_reason2',
        userId: ALICE,
        sessionId: SESSION,
        status: 'confirmed',
      });
      try {
        const ok = await createExcuse({
          userId: ALICE,
          sessionId: SESSION,
          reason: 'b'.repeat(EXCUSE_REASON_MAX_LENGTH),
          now: new Date(now),
        });
        if (ok.excuseId) {
          pass(`Bonus reason exactly ${EXCUSE_REASON_MAX_LENGTH} chars → OK (boundary inclusive)`);
        } else {
          fail('Bonus boundary should succeed', ok);
        }
      } catch (err) {
        fail('Bonus boundary 300 chars should not throw', err);
      }
    }
  });

  // ===================================================================
  // Bonus rules : anti-spoofing — Bob ne peut pas créer une excuse pour Alice
  // ===================================================================
  section('Bonus rules anti-spoofing : Bob create excuse Alice → DENIED par rules (Q6=A)');
  {
    const ALICE = 'user_alice_ex';
    const BOB = 'user_bob_ex';
    const bobCtx = env.authenticatedContext(BOB);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bobDb: Firestore = asFirestore((bobCtx as any).firestore());

    // Bob essaie de créer un doc /excuses/spoof_alice avec userId=ALICE
    let denied = false;
    try {
      await setDoc(doc(bobDb, 'excuses', 'spoof_alice'), {
        excuseId: 'spoof_alice',
        userId: ALICE, // ← spoofing
        sessionId: 'whatever',
        bookingId: 'whatever',
        reason: '',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code;
      if (code === 'permission-denied' || code === 'firestore/permission-denied') {
        denied = true;
      }
    }
    if (denied) {
      pass('Bonus rules : Bob create excuse Alice → DENIED (Q6=A anti-spoof)');
    } else {
      fail('Bonus rules : should deny Bob spoofing Alice');
    }
  }

  __setExcusesDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Excuses (EX1-EX4 + bonus) ======');
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
