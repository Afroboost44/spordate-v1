/**
 * Tests Phase 7 sub-chantier 3 commit 3/5 — No-show + Sanctions + Appeals.
 *
 * Exécution :
 *   npm run test:reports:no-show
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reports/no-show.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing (cohérent service.test.ts).
 *
 * Couverture NP1-NP13 + TR1-TR2 :
 *   triggerAutoSanction direct (TR1-TR2) : warning + suspension_7d shapes
 *   markNoShow : happy, partner check, grâce 30min, booking check, anti-doublon
 *   threshold no-show 90j : 2/3/4 → warning/suspension_30d_refund/ban_permanent
 *   appealSanction : happy, not-appealable (warning), appeal-already-used
 *   cancelNoShow : within 24h OK, >24h throw
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  setDoc,
  type Firestore,
} from 'firebase/firestore';

import {
  __setReportsDbForTesting,
  appealSanction,
  cancelNoShow,
  computeNoShowThresholdAction,
  markNoShow,
  ReportError,
  triggerAutoSanction,
} from '../../src/lib/reports';
import type {
  Activity,
  Booking,
  Report,
  Session,
  UserProfile,
  UserSanction,
} from '../../src/types/firestore';

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

async function assertThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<ReportError | null> {
  try {
    await fn();
    console.log(`FAIL  ${label} (expected throw "${expectedCode}", got success)`);
    _failures++;
    return null;
  } catch (err) {
    if (err instanceof ReportError && err.code === expectedCode) {
      console.log(`PASS  ${label}`);
      _passes++;
      return err;
    }
    const code = err instanceof ReportError ? err.code : (err as Error).message;
    console.log(`FAIL  ${label} (expected "${expectedCode}", got "${code}")`);
    _failures++;
    return null;
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Fixture helpers
// =====================================================================

function tsFromMs(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

async function setupUser(
  fbDb: Firestore,
  opts: { uid: string; email?: string; role?: 'user' | 'admin' },
): Promise<void> {
  const minimal: Partial<UserProfile> = {
    uid: opts.uid,
    email: opts.email ?? `${opts.uid}@test.local`,
    displayName: opts.uid,
    role: opts.role ?? 'user',
  };
  await setDoc(doc(fbDb, 'users', opts.uid), minimal);
}

async function setupActivity(
  fbDb: Firestore,
  opts: { activityId: string; partnerId: string },
): Promise<void> {
  const minimal: Partial<Activity> = {
    activityId: opts.activityId,
    partnerId: opts.partnerId,
    title: 'Test Activity NoShow',
    sport: 'Afroboost',
    city: 'Genève',
  };
  await setDoc(doc(fbDb, 'activities', opts.activityId), minimal);
}

async function setupSession(
  fbDb: Firestore,
  opts: { sessionId: string; activityId: string; endAtMs: number },
): Promise<void> {
  const minimal: Partial<Session> = {
    sessionId: opts.sessionId,
    activityId: opts.activityId,
    startAt: tsFromMs(opts.endAtMs - 60 * 60 * 1000),
    endAt: tsFromMs(opts.endAtMs),
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
    projectId: 'demo-spordate-noshow',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setReportsDbForTesting(fbDb);

    // -----------------------------------------------------------------
    // FIXTURES
    // -----------------------------------------------------------------
    const PARTNER = 'partner_ns';
    const OTHER_PARTNER = 'partner_other_ns';
    const ADMIN = 'admin_ns';
    const HAPPY = 'user_happy_ns';
    const GRACE = 'user_grace_ns';
    const NO_BOOK = 'user_nobook_ns';
    const DUP = 'user_dup_ns';
    const THRESHOLD = 'user_threshold_ns';
    const CANCEL_FRESH = 'user_cancel_fresh_ns';
    const CANCEL_OLD = 'user_cancel_old_ns';

    await Promise.all([
      setupUser(fbDb, { uid: PARTNER }),
      setupUser(fbDb, { uid: OTHER_PARTNER }),
      setupUser(fbDb, { uid: ADMIN, role: 'admin' }),
      setupUser(fbDb, { uid: HAPPY }),
      setupUser(fbDb, { uid: GRACE }),
      setupUser(fbDb, { uid: NO_BOOK }),
      setupUser(fbDb, { uid: DUP }),
      setupUser(fbDb, { uid: THRESHOLD }),
      setupUser(fbDb, { uid: CANCEL_FRESH }),
      setupUser(fbDb, { uid: CANCEL_OLD }),
    ]);

    const ACT_NS = 'act_ns';
    await setupActivity(fbDb, { activityId: ACT_NS, partnerId: PARTNER });

    const twoHoursAgoMs = Date.now() - 2 * 60 * 60 * 1000;
    const tenMinAgoMs = Date.now() - 10 * 60 * 1000; // in grace

    const SESS_HAPPY = 'sess_happy_ns';
    const SESS_GRACE = 'sess_grace_ns';
    const SESS_DUP = 'sess_dup_ns';
    const SESS_T1 = 'sess_t1_ns';
    const SESS_T2 = 'sess_t2_ns';
    const SESS_T3 = 'sess_t3_ns';
    const SESS_T4 = 'sess_t4_ns';
    const SESS_NO_BOOK = 'sess_nobook_ns';
    const SESS_CANCEL_FRESH = 'sess_cancel_fresh_ns';
    const SESS_CANCEL_OLD = 'sess_cancel_old_ns';

    await Promise.all([
      setupSession(fbDb, { sessionId: SESS_HAPPY, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_GRACE, activityId: ACT_NS, endAtMs: tenMinAgoMs }),
      setupSession(fbDb, { sessionId: SESS_DUP, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_T1, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_T2, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_T3, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_T4, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_NO_BOOK, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_CANCEL_FRESH, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
      setupSession(fbDb, { sessionId: SESS_CANCEL_OLD, activityId: ACT_NS, endAtMs: twoHoursAgoMs }),
    ]);

    await Promise.all([
      setupBooking(fbDb, { bookingId: 'b_happy', userId: HAPPY, sessionId: SESS_HAPPY, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_grace', userId: GRACE, sessionId: SESS_GRACE, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_dup', userId: DUP, sessionId: SESS_DUP, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_t1', userId: THRESHOLD, sessionId: SESS_T1, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_t2', userId: THRESHOLD, sessionId: SESS_T2, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_t3', userId: THRESHOLD, sessionId: SESS_T3, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_t4', userId: THRESHOLD, sessionId: SESS_T4, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_cancel_f', userId: CANCEL_FRESH, sessionId: SESS_CANCEL_FRESH, activityId: ACT_NS }),
      setupBooking(fbDb, { bookingId: 'b_cancel_o', userId: CANCEL_OLD, sessionId: SESS_CANCEL_OLD, activityId: ACT_NS }),
    ]);

    // -----------------------------------------------------------------
    // SECTION TR — triggerAutoSanction direct (TR1-TR2)
    // -----------------------------------------------------------------
    section('triggerAutoSanction direct (TR1-TR2)');

    // TR1 : warning level → appealable=false, isActive=true, no endsAt
    {
      const sid = await triggerAutoSanction({
        userId: 'sanction_target_tr1',
        level: 'warning',
        reason: 'reports_threshold',
        triggeringReportIds: ['rep_dummy_tr1'],
      });
      const snap = await getDoc(doc(fbDb, 'userSanctions', sid));
      const data = snap.data() as UserSanction;
      assertEq(data.level, 'warning', 'TR1 level=warning');
      assertEq(data.appealable, false, 'TR1 warning appealable=false (doctrine §F)');
      assertEq(data.isActive, true, 'TR1 isActive=true');
      assertEq(data.appealUsed, false, 'TR1 appealUsed=false initial');
      assertEq(data.endsAt === undefined, true, 'TR1 warning sans endsAt');
    }

    // TR2 : suspension_7d → endsAt set, appealable=true
    {
      const sid = await triggerAutoSanction({
        userId: 'sanction_target_tr2',
        level: 'suspension_7d',
        reason: 'reports_threshold',
        triggeringReportIds: ['rep_dummy_tr2'],
      });
      const snap = await getDoc(doc(fbDb, 'userSanctions', sid));
      const data = snap.data() as UserSanction;
      assertEq(data.level, 'suspension_7d', 'TR2 level=suspension_7d');
      assertEq(data.appealable, true, 'TR2 suspension appealable=true');
      assertEq(typeof data.endsAt?.toMillis, 'function', 'TR2 endsAt set (Timestamp)');
      assertEq(data.refundDue === undefined, true, 'TR2 sans refundDue');
    }

    // -----------------------------------------------------------------
    // SECTION A — markNoShow happy path + threshold init (NP1)
    // -----------------------------------------------------------------
    section('markNoShow happy path (NP1)');

    let happyWarningSanctionId: string | undefined;
    {
      const r = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESS_HAPPY,
        userId: HAPPY,
      });
      assertEq(typeof r.reportId, 'string', 'NP1 reportId créé');
      assertEq(r.noShowCountAfter, 1, 'NP1 noShowCountAfter=1');
      assertEq(typeof r.sanctionId, 'string', 'NP1 sanctionId créé (1er no-show → warning)');
      happyWarningSanctionId = r.sanctionId;

      const reportSnap = await getDoc(doc(fbDb, 'reports', r.reportId));
      const reportData = reportSnap.data() as Report;
      assertEq(reportData.source, 'partner_no_show', 'NP1 source=partner_no_show');
      assertEq(reportData.category, 'no_show', 'NP1 category=no_show');
      assertEq(reportData.reporterId, PARTNER, 'NP1 reporterId=partner');

      const sanctionSnap = await getDoc(doc(fbDb, 'userSanctions', r.sanctionId!));
      const sanctionData = sanctionSnap.data() as UserSanction;
      assertEq(sanctionData.level, 'warning', 'NP1 sanction level=warning (1er)');
      assertEq(sanctionData.reason, 'no_show_threshold', 'NP1 reason=no_show_threshold');
    }

    // -----------------------------------------------------------------
    // SECTION B — Validations errors (NP2-NP5)
    // -----------------------------------------------------------------
    section('markNoShow : validations errors (NP2-NP5)');

    // NP2 : non-partner tente de marquer
    await assertThrows(
      () =>
        markNoShow({
          partnerId: OTHER_PARTNER,
          sessionId: SESS_HAPPY,
          userId: HAPPY,
        }),
      'not-partner',
      'NP2 non-partner (other_partner) → throw not-partner',
    );

    // NP3 : grâce 30 min — sess_grace ended 10 min ago
    await assertThrows(
      () =>
        markNoShow({
          partnerId: PARTNER,
          sessionId: SESS_GRACE,
          userId: GRACE,
        }),
      'grace-period-active',
      'NP3 session ended 10 min ago (within 30 min grace) → throw grace-period-active',
    );

    // NP4 : NO_BOOK_USER pas de booking confirmed
    await assertThrows(
      () =>
        markNoShow({
          partnerId: PARTNER,
          sessionId: SESS_NO_BOOK,
          userId: NO_BOOK,
        }),
      'not-confirmed-booker',
      'NP4 user sans booking confirmed → throw not-confirmed-booker',
    );

    // NP5 : DUP_USER marqué une 1ère fois OK, 2ème fois throws
    {
      await markNoShow({
        partnerId: PARTNER,
        sessionId: SESS_DUP,
        userId: DUP,
      }); // 1ère fois OK (setup)
      await assertThrows(
        () =>
          markNoShow({
            partnerId: PARTNER,
            sessionId: SESS_DUP,
            userId: DUP,
          }),
        'duplicate-no-show',
        'NP5 marquage répété même session/user → throw duplicate-no-show',
      );
    }

    // -----------------------------------------------------------------
    // SECTION C — Threshold escalation no-show (NP6, NP7, NP8)
    // -----------------------------------------------------------------
    section('markNoShow : threshold no-show 90j escalation (NP6-NP8)');

    // Pre-mark THRESHOLD on sess_t1 (1er no-show — warning)
    await markNoShow({
      partnerId: PARTNER,
      sessionId: SESS_T1,
      userId: THRESHOLD,
    });

    // NP6 : 2ème no-show sur THRESHOLD → warning (computeNoShowThresholdAction(2))
    {
      const r6 = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESS_T2,
        userId: THRESHOLD,
      });
      assertEq(r6.noShowCountAfter, 2, 'NP6 noShowCountAfter=2');
      assertEq(typeof r6.sanctionId, 'string', 'NP6 sanctionId créé (2ème → warning)');

      const sanctionSnap = await getDoc(doc(fbDb, 'userSanctions', r6.sanctionId!));
      const sanctionData = sanctionSnap.data() as UserSanction;
      assertEq(sanctionData.level, 'warning', 'NP6 sanction level=warning (2ème, doctrine D.5)');
    }

    // NP7 : 3ème no-show → suspension_30d + refundDue=true
    let suspension30dSanctionId: string | undefined;
    {
      const r7 = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESS_T3,
        userId: THRESHOLD,
      });
      assertEq(r7.noShowCountAfter, 3, 'NP7 noShowCountAfter=3');
      assertEq(typeof r7.sanctionId, 'string', 'NP7 sanctionId créé');
      suspension30dSanctionId = r7.sanctionId;

      const sanctionSnap = await getDoc(doc(fbDb, 'userSanctions', r7.sanctionId!));
      const sanctionData = sanctionSnap.data() as UserSanction;
      assertEq(sanctionData.level, 'suspension_30d', 'NP7 sanction level=suspension_30d (3ème)');
      assertEq(sanctionData.refundDue, true, 'NP7 refundDue=true (Q7 doctrine D.5)');
      assertEq(sanctionData.appealable, true, 'NP7 suspension appealable=true');
    }

    // NP8 : 4ème no-show → ban_permanent
    {
      const r8 = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESS_T4,
        userId: THRESHOLD,
      });
      assertEq(r8.noShowCountAfter, 4, 'NP8 noShowCountAfter=4');

      const sanctionSnap = await getDoc(doc(fbDb, 'userSanctions', r8.sanctionId!));
      const sanctionData = sanctionSnap.data() as UserSanction;
      assertEq(sanctionData.level, 'ban_permanent', 'NP8 sanction level=ban_permanent (4ème)');
      assertEq(sanctionData.endsAt === undefined, true, 'NP8 ban_permanent sans endsAt');
    }

    // computeNoShowThresholdAction unit (sanity)
    {
      assertEq(computeNoShowThresholdAction(0).level, null, 'computeNoShowThresholdAction(0)=null');
      assertEq(computeNoShowThresholdAction(1).level, 'warning', 'computeNoShowThresholdAction(1)=warning');
      assertEq(computeNoShowThresholdAction(2).level, 'warning', 'computeNoShowThresholdAction(2)=warning');
      assertEq(computeNoShowThresholdAction(3).level, 'suspension_30d', 'computeNoShowThresholdAction(3)=suspension_30d');
      assertEq(computeNoShowThresholdAction(3).refundDue, true, 'computeNoShowThresholdAction(3) refundDue=true');
      assertEq(computeNoShowThresholdAction(4).level, 'ban_permanent', 'computeNoShowThresholdAction(4)=ban_permanent');
    }

    // -----------------------------------------------------------------
    // SECTION D — appealSanction (NP9-NP11)
    // -----------------------------------------------------------------
    section('appealSanction : happy + not-appealable + already-used (NP9-NP11)');

    // NP9 : appeal happy path sur suspension_30d
    {
      await appealSanction({
        userId: THRESHOLD,
        sanctionId: suspension30dSanctionId!,
        appealNote: 'Je conteste cette sanction car contexte exceptionnel maladie.',
      });
      const snap = await getDoc(doc(fbDb, 'userSanctions', suspension30dSanctionId!));
      const data = snap.data() as UserSanction;
      assertEq(data.appealUsed, true, 'NP9 appealUsed=true après filing');
      assertEq(data.appealNote?.length! >= 20, true, 'NP9 appealNote stocké');
    }

    // NP10 : appeal sur warning (appealable=false)
    await assertThrows(
      () =>
        appealSanction({
          userId: HAPPY,
          sanctionId: happyWarningSanctionId!,
          appealNote: 'Note pour test sur warning interdit appel.',
        }),
      'not-appealable',
      'NP10 appel sur warning sanction → throw not-appealable',
    );

    // NP11 : 2ème appel sur même sanction NP9
    await assertThrows(
      () =>
        appealSanction({
          userId: THRESHOLD,
          sanctionId: suspension30dSanctionId!,
          appealNote: 'Tentative re-appel sur sanction déjà appealée.',
        }),
      'appeal-already-used',
      'NP11 re-appel sur sanction NP9 → throw appeal-already-used',
    );

    // Bonus : note trop courte
    await assertThrows(
      () =>
        appealSanction({
          userId: 'sanction_target_tr2',
          sanctionId: 'fake-id-doesnt-matter',
          appealNote: 'short',
        }),
      'appeal-note-too-short',
      'NP11b appealNote <20 chars → throw appeal-note-too-short',
    );

    // -----------------------------------------------------------------
    // SECTION E — cancelNoShow (NP12, NP13)
    // -----------------------------------------------------------------
    section('cancelNoShow : within 24h + cancel-window-closed (NP12-NP13)');

    // NP12 : mark CANCEL_FRESH puis cancel within 24h
    {
      const r = await markNoShow({
        partnerId: PARTNER,
        sessionId: SESS_CANCEL_FRESH,
        userId: CANCEL_FRESH,
      });
      await cancelNoShow({
        partnerId: PARTNER,
        reportId: r.reportId,
      });
      const reportSnap = await getDoc(doc(fbDb, 'reports', r.reportId));
      const reportData = reportSnap.data() as Report;
      assertEq(reportData.status, 'dismissed', 'NP12 report.status=dismissed après cancel');
      assertEq(reportData.decision, 'dismiss', 'NP12 decision=dismiss');
    }

    // NP13 : créer manuellement un report 30h ago, cancel → throw cancel-window-closed
    {
      const oldReportRef = doc(collection(fbDb, 'reports'));
      const oldReportId = oldReportRef.id;
      const thirtyHoursAgoMs = Date.now() - 30 * 60 * 60 * 1000;
      await setDoc(oldReportRef, {
        reportId: oldReportId,
        reporterId: PARTNER,
        reportedId: CANCEL_OLD,
        category: 'no_show',
        status: 'pending',
        source: 'partner_no_show',
        sessionId: SESS_CANCEL_OLD,
        activityId: ACT_NS,
        createdAt: tsFromMs(thirtyHoursAgoMs),
      });
      await assertThrows(
        () =>
          cancelNoShow({
            partnerId: PARTNER,
            reportId: oldReportId,
          }),
        'cancel-window-closed',
        'NP13 report créé 30h ago (>24h) → throw cancel-window-closed',
      );
    }

    // Bonus : cancelNoShow par non-partner
    {
      const fakeReportRef = doc(collection(fbDb, 'reports'));
      const fakeReportId = fakeReportRef.id;
      await setDoc(fakeReportRef, {
        reportId: fakeReportId,
        reporterId: PARTNER,
        reportedId: CANCEL_FRESH,
        category: 'no_show',
        status: 'pending',
        source: 'partner_no_show',
        sessionId: SESS_CANCEL_FRESH,
        activityId: ACT_NS,
        createdAt: Timestamp.now(),
      });
      await assertThrows(
        () =>
          cancelNoShow({
            partnerId: OTHER_PARTNER,
            reportId: fakeReportId,
          }),
        'report-not-cancellable',
        'NP13b cancelNoShow par non-reporter → throw report-not-cancellable',
      );
    }
  });

  __setReportsDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé No-show + Sanctions (NP1-NP13 + TR1-TR2) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
