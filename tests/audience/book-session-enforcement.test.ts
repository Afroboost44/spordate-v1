/**
 * Tests Phase 9 sub-chantier 6 commit 2/4 — bookSession audience enforcement.
 *
 * Exécution :
 *   npm run test:audience:book-session
 *
 * Pattern : @firebase/rules-unit-testing emulator + DI seam (cohérent SC5 c1 + SC6 c1).
 *
 * Couverture (BS1-BS4 + bonus) :
 *   BS1 user female + activity women-only → bookSession success + booking créé
 *   BS2 user male + activity women-only → throw 'gender-mismatch' + booking NOT créé
 *   BS3 user male + activity mixed-priority-women → bookSession success (Q2=C no enforcement)
 *   BS4 user 'other' + activity women-only → throw 'gender-mismatch' (Q3=A strict)
 *
 * Bonus :
 *   - user female + activity 'all' (default) → success (no audience check)
 *   - user male + activity audienceType undefined → success (graceful default 'all')
 *   - user gender undefined + activity women-only → throw 'gender-required' (force profil complet)
 *   - user male + activity men-only → success (Q4=A symmetric)
 *   - user female + activity men-only → throw 'gender-mismatch'
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  setDoc,
  type Firestore,
} from 'firebase/firestore';

import { __setSessionsDbForTesting, bookSession } from '../../src/services/firestore';
import { __setExcusesDbForTesting } from '../../src/lib/excuses';
import { AudienceError, type AudienceType } from '../../src/lib/audience';
import type {
  Activity,
  Session,
  SessionStatus,
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
    if (err instanceof AudienceError && err.code === expectedCode) {
      pass(label);
    } else {
      const code = err instanceof AudienceError ? err.code : (err as Error).message;
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

const ACTIVITY_ID = 'activity_bs';
const PARTNER = 'partner_bs';

async function setupUser(
  fbDb: Firestore,
  uid: string,
  gender?: 'male' | 'female' | 'other',
): Promise<void> {
  const data: Partial<UserProfile> = {
    uid,
    email: `${uid}@test.local`,
    displayName: uid,
    role: 'user',
  };
  if (gender !== undefined) data.gender = gender;
  await setDoc(doc(fbDb, 'users', uid), data);
}

async function setupActivity(
  fbDb: Firestore,
  activityId: string,
  audienceType?: AudienceType,
): Promise<void> {
  const data: Partial<Activity> = {
    activityId,
    partnerId: PARTNER,
    title: 'Test Activity Audience',
    sport: 'Yoga',
    city: 'Genève',
  };
  if (audienceType !== undefined) data.audienceType = audienceType;
  await setDoc(doc(fbDb, 'activities', activityId), data);
}

async function setupSession(
  fbDb: Firestore,
  sessionId: string,
  activityId: string,
): Promise<void> {
  const now = Date.now();
  const data: Partial<Session> = {
    sessionId,
    activityId,
    partnerId: PARTNER,
    sport: 'Yoga',
    title: 'Test Session BS',
    city: 'Genève',
    startAt: tsFromMs(now + 5 * 60 * 60_000),
    endAt: tsFromMs(now + 6 * 60 * 60_000),
    maxParticipants: 8,
    currentParticipants: 0,
    pricingTiers: [],
    currentTier: 'early',
    currentPrice: 2500,
    status: 'open' as SessionStatus,
  };
  await setDoc(doc(fbDb, 'sessions', sessionId), data);
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-bs-audience',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setSessionsDbForTesting(fbDb);
    __setExcusesDbForTesting(fbDb);

    // Helper : run bookSession + verify booking count
    async function bookAndCount(input: {
      sessionId: string;
      userId: string;
      paymentIntentId: string;
    }): Promise<string> {
      return bookSession({
        sessionId: input.sessionId,
        userId: input.userId,
        amount: 2500,
        tier: 'early',
        paymentIntentId: input.paymentIntentId,
      });
    }

    async function countBookingsForSession(sessionId: string): Promise<number> {
      const snap = await getDocs(collection(fbDb, 'bookings'));
      let count = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snap.forEach((d) => {
        const data = d.data();
        if (data.sessionId === sessionId) count++;
      });
      return count;
    }

    // ===================================================================
    // BS1 : female + women-only → success
    // ===================================================================
    section('BS1 user female + activity women-only → success + booking créé');
    {
      await setupUser(fbDb, 'alice_bs1', 'female');
      await setupActivity(fbDb, 'act_bs1', 'women-only');
      await setupSession(fbDb, 'sess_bs1', 'act_bs1');

      const bookingId = await bookAndCount({
        sessionId: 'sess_bs1',
        userId: 'alice_bs1',
        paymentIntentId: 'pi_bs1',
      });
      if (bookingId) {
        pass('BS1 bookSession success → bookingId returned');
      } else {
        fail('BS1 should return bookingId');
      }
      const count = await countBookingsForSession('sess_bs1');
      if (count === 1) {
        pass('BS1 1 booking créé');
      } else {
        fail('BS1 should have 1 booking', { count });
      }
    }

    // ===================================================================
    // BS2 : male + women-only → throw 'gender-mismatch'
    // ===================================================================
    section("BS2 user male + activity women-only → throw 'gender-mismatch' + no booking");
    {
      await setupUser(fbDb, 'bob_bs2', 'male');
      await setupActivity(fbDb, 'act_bs2', 'women-only');
      await setupSession(fbDb, 'sess_bs2', 'act_bs2');

      await expectThrows(
        () =>
          bookAndCount({
            sessionId: 'sess_bs2',
            userId: 'bob_bs2',
            paymentIntentId: 'pi_bs2',
          }),
        'gender-mismatch',
        "BS2 throw 'gender-mismatch' (Q3=A strict)",
      );
      const count = await countBookingsForSession('sess_bs2');
      if (count === 0) {
        pass('BS2 0 booking créé (audience block avant tx)');
      } else {
        fail('BS2 should have 0 booking', { count });
      }
    }

    // ===================================================================
    // BS3 : male + mixed-priority-women → success (Q2=C no enforcement)
    // ===================================================================
    section('BS3 user male + activity mixed-priority-women → success (Q2=C no enforcement)');
    {
      await setupUser(fbDb, 'bob_bs3', 'male');
      await setupActivity(fbDb, 'act_bs3', 'mixed-priority-women');
      await setupSession(fbDb, 'sess_bs3', 'act_bs3');

      const bookingId = await bookAndCount({
        sessionId: 'sess_bs3',
        userId: 'bob_bs3',
        paymentIntentId: 'pi_bs3',
      });
      if (bookingId) {
        pass('BS3 male allowed in mixed-priority-women (Q2=C boost defer Phase 10)');
      } else {
        fail('BS3 should succeed');
      }
    }

    // ===================================================================
    // BS4 : 'other' + women-only → throw 'gender-mismatch'
    // ===================================================================
    section("BS4 user 'other' + activity women-only → throw 'gender-mismatch' (Q3=A strict)");
    {
      await setupUser(fbDb, 'pat_bs4', 'other');
      await setupActivity(fbDb, 'act_bs4', 'women-only');
      await setupSession(fbDb, 'sess_bs4', 'act_bs4');

      await expectThrows(
        () =>
          bookAndCount({
            sessionId: 'sess_bs4',
            userId: 'pat_bs4',
            paymentIntentId: 'pi_bs4',
          }),
        'gender-mismatch',
        "BS4 'other' denied in women-only (strict)",
      );
    }

    // ===================================================================
    // Bonus : female + 'all' (default) → success (no audience check)
    // ===================================================================
    section("Bonus female + activity 'all' (default) → success (no audience check)");
    {
      await setupUser(fbDb, 'alice_bonus_all', 'female');
      await setupActivity(fbDb, 'act_bonus_all', 'all');
      await setupSession(fbDb, 'sess_bonus_all', 'act_bonus_all');

      const bookingId = await bookAndCount({
        sessionId: 'sess_bonus_all',
        userId: 'alice_bonus_all',
        paymentIntentId: 'pi_bonus_all',
      });
      if (bookingId) {
        pass("Bonus 'all' audience → success (default no restriction)");
      } else {
        fail("Bonus 'all' should succeed");
      }
    }

    // ===================================================================
    // Bonus : male + audienceType undefined → success (graceful default 'all')
    // ===================================================================
    section('Bonus male + audienceType undefined → success (graceful default all)');
    {
      await setupUser(fbDb, 'bob_bonus_undef', 'male');
      await setupActivity(fbDb, 'act_bonus_undef'); // no audienceType
      await setupSession(fbDb, 'sess_bonus_undef', 'act_bonus_undef');

      const bookingId = await bookAndCount({
        sessionId: 'sess_bonus_undef',
        userId: 'bob_bonus_undef',
        paymentIntentId: 'pi_bonus_undef',
      });
      if (bookingId) {
        pass('Bonus undefined audienceType → success (rétro-compat default all)');
      } else {
        fail('Bonus undefined should succeed');
      }
    }

    // ===================================================================
    // Bonus : gender undefined + women-only → throw 'gender-required'
    // ===================================================================
    section("Bonus gender undefined + women-only → throw 'gender-required' (force profil)");
    {
      // setupUser without gender field
      await setDoc(doc(fbDb, 'users', 'alice_no_gender'), {
        uid: 'alice_no_gender',
        email: 'alice_no_gender@test.local',
        displayName: 'Alice No Gender',
        role: 'user',
        // gender omis
      });
      await setupActivity(fbDb, 'act_bonus_nogender', 'women-only');
      await setupSession(fbDb, 'sess_bonus_nogender', 'act_bonus_nogender');

      await expectThrows(
        () =>
          bookAndCount({
            sessionId: 'sess_bonus_nogender',
            userId: 'alice_no_gender',
            paymentIntentId: 'pi_bonus_nogender',
          }),
        'gender-required',
        "Bonus gender absent + women-only → throw 'gender-required' (UX force profil)",
      );
    }

    // ===================================================================
    // Bonus : male + men-only → success (Q4=A symmetric)
    // ===================================================================
    section('Bonus male + men-only → success (Q4=A symmetric enforcement)');
    {
      await setupUser(fbDb, 'bob_bonus_men', 'male');
      await setupActivity(fbDb, 'act_bonus_men', 'men-only');
      await setupSession(fbDb, 'sess_bonus_men', 'act_bonus_men');

      const bookingId = await bookAndCount({
        sessionId: 'sess_bonus_men',
        userId: 'bob_bonus_men',
        paymentIntentId: 'pi_bonus_men',
      });
      if (bookingId) {
        pass('Bonus male allowed in men-only (Q4=A)');
      } else {
        fail('Bonus male should succeed in men-only');
      }
    }

    // ===================================================================
    // Bonus : female + men-only → throw 'gender-mismatch'
    // ===================================================================
    section("Bonus female + men-only → throw 'gender-mismatch' (Q4=A symmetric)");
    {
      await setupUser(fbDb, 'alice_bonus_men_denied', 'female');
      await setupActivity(fbDb, 'act_bonus_men_denied', 'men-only');
      await setupSession(fbDb, 'sess_bonus_men_denied', 'act_bonus_men_denied');

      await expectThrows(
        () =>
          bookAndCount({
            sessionId: 'sess_bonus_men_denied',
            userId: 'alice_bonus_men_denied',
            paymentIntentId: 'pi_bonus_men_denied',
          }),
        'gender-mismatch',
        "Bonus female denied in men-only (Q4=A symmetric)",
      );
    }

    // ===================================================================
    // Bonus : idempotency preserved (re-call with same paymentIntentId returns same id)
    // ===================================================================
    section('Bonus idempotency preserved (BS1 re-call same paymentIntentId)');
    {
      const bookingId1 = await bookAndCount({
        sessionId: 'sess_bs1',
        userId: 'alice_bs1',
        paymentIntentId: 'pi_bs1', // same as BS1
      });
      const count = await countBookingsForSession('sess_bs1');
      if (count === 1 && bookingId1) {
        pass('Bonus idempotency BS1 re-call → 1 booking only (no duplicate)');
      } else {
        fail('Bonus idempotency failed', { count, bookingId1 });
      }
    }
  });

  __setSessionsDbForTesting(null);
  __setExcusesDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé bookSession Audience Enforcement (BS1-BS4 + bonus) ======');
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
