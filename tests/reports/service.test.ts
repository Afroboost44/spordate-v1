/**
 * Tests Phase 7 sub-chantier 3 commit 2/5 — Reports service layer.
 *
 * Exécution :
 *   npm run test:reports
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reports/service.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing (cohérent
 * tests/reviews/service.test.ts + tests/blocks/service.test.ts).
 *
 * Couverture RP1-RP18 :
 *   createReport : happy, validations (self/category/freeText/no-shared/window),
 *                  rate-limit, dedup, threshold escalation 1/2/3 → null/7d/30d
 *   computeReportsThresholdAction : pure function
 *   sustainReport / dismissReport : admin role check + status transitions
 *   getReportsForReporter : rolling 24h scope
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
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import {
  __setReportsDbForTesting,
  RATE_LIMIT_PER_DAY,
  ReportError,
  computeReportsThresholdAction,
  createReport,
  dismissReport,
  getReportsForReporter,
  sustainReport,
} from '../../src/lib/reports';
import type {
  Activity,
  Booking,
  Report,
  Session,
  UserProfile,
  UserSanction,
} from '../../src/types/firestore';

/** Cast helper rules-unit-testing v4. */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner (cohérent reviews/blocks tests)
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
  opts: { uid: string; email: string; role?: 'user' | 'admin' },
): Promise<void> {
  const minimal: Partial<UserProfile> = {
    uid: opts.uid,
    email: opts.email,
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
    title: 'Test Activity Reports',
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
    projectId: 'demo-spordate-reports',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setReportsDbForTesting(fbDb);

    // -------------------------------------------------------------------
    // FIXTURES uids
    // -------------------------------------------------------------------
    const ALICE = 'user_alice_rp';
    const BOB = 'user_bob_rp';
    const CHARLIE = 'user_charlie_rp';
    const DIANE = 'user_diane_rp';
    const EVE = 'user_eve_rp';
    const FRANK = 'user_frank_rp'; // no shared session avec Alice
    const ADMIN = 'user_admin_rp';
    const HEAVY = 'user_heavy_rp'; // pour rate limit
    const TARGET_1 = 'user_target1_rp';
    const TARGET_2 = 'user_target2_rp';
    const TARGET_3 = 'user_target3_rp';
    const TARGET_4 = 'user_target4_rp';
    const OLD_R = 'user_old_reporter_rp';
    const OLD_T = 'user_old_target_rp';
    const PARTNER = 'user_partner_rp';

    await Promise.all([
      setupUser(fbDb, { uid: ALICE, email: 'alice@test.local' }),
      setupUser(fbDb, { uid: BOB, email: 'bob@test.local' }),
      setupUser(fbDb, { uid: CHARLIE, email: 'charlie@test.local' }),
      setupUser(fbDb, { uid: DIANE, email: 'diane@test.local' }),
      setupUser(fbDb, { uid: EVE, email: 'eve@test.local' }),
      setupUser(fbDb, { uid: FRANK, email: 'frank@test.local' }),
      setupUser(fbDb, { uid: ADMIN, email: 'admin@test.local', role: 'admin' }),
      setupUser(fbDb, { uid: HEAVY, email: 'heavy@test.local' }),
      setupUser(fbDb, { uid: TARGET_1, email: 't1@test.local' }),
      setupUser(fbDb, { uid: TARGET_2, email: 't2@test.local' }),
      setupUser(fbDb, { uid: TARGET_3, email: 't3@test.local' }),
      setupUser(fbDb, { uid: TARGET_4, email: 't4@test.local' }),
      setupUser(fbDb, { uid: OLD_R, email: 'oldr@test.local' }),
      setupUser(fbDb, { uid: OLD_T, email: 'oldt@test.local' }),
    ]);

    const ACT_RECENT = 'act_recent_rp';
    const ACT_OLD = 'act_old_rp';
    const SESS_RECENT = 'sess_recent_rp';
    const SESS_HEAVY = 'sess_heavy_rp';
    const SESS_OLD = 'sess_old_rp';

    await setupActivity(fbDb, { activityId: ACT_RECENT, partnerId: PARTNER });
    await setupActivity(fbDb, { activityId: ACT_OLD, partnerId: PARTNER });

    const threeDaysAgoMs = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgoMs = Date.now() - 60 * 24 * 60 * 60 * 1000;

    await setupSession(fbDb, {
      sessionId: SESS_RECENT,
      activityId: ACT_RECENT,
      endAtMs: threeDaysAgoMs,
    });
    await setupSession(fbDb, {
      sessionId: SESS_HEAVY,
      activityId: ACT_RECENT,
      endAtMs: threeDaysAgoMs,
    });
    await setupSession(fbDb, {
      sessionId: SESS_OLD,
      activityId: ACT_OLD,
      endAtMs: sixtyDaysAgoMs,
    });

    // Bookings sess_recent : Alice/Bob/Charlie/Diane/Eve confirmés (FRANK absent)
    await Promise.all([
      setupBooking(fbDb, { bookingId: 'b_alice_recent', userId: ALICE, sessionId: SESS_RECENT, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_bob_recent', userId: BOB, sessionId: SESS_RECENT, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_charlie_recent', userId: CHARLIE, sessionId: SESS_RECENT, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_diane_recent', userId: DIANE, sessionId: SESS_RECENT, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_eve_recent', userId: EVE, sessionId: SESS_RECENT, activityId: ACT_RECENT }),
    ]);

    // Bookings sess_heavy : HEAVY + 4 TARGET_*
    await Promise.all([
      setupBooking(fbDb, { bookingId: 'b_heavy_h', userId: HEAVY, sessionId: SESS_HEAVY, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_t1_h', userId: TARGET_1, sessionId: SESS_HEAVY, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_t2_h', userId: TARGET_2, sessionId: SESS_HEAVY, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_t3_h', userId: TARGET_3, sessionId: SESS_HEAVY, activityId: ACT_RECENT }),
      setupBooking(fbDb, { bookingId: 'b_t4_h', userId: TARGET_4, sessionId: SESS_HEAVY, activityId: ACT_RECENT }),
    ]);

    // Bookings sess_old : OLD_R + OLD_T (60j ago, hors fenêtre 30j)
    await Promise.all([
      setupBooking(fbDb, { bookingId: 'b_oldr_o', userId: OLD_R, sessionId: SESS_OLD, activityId: ACT_OLD }),
      setupBooking(fbDb, { bookingId: 'b_oldt_o', userId: OLD_T, sessionId: SESS_OLD, activityId: ACT_OLD }),
    ]);

    // -------------------------------------------------------------------
    // SECTION A — Validations errors (RP2-RP6)
    // -------------------------------------------------------------------
    section('createReport : validations errors (RP2-RP6)');

    // RP2 : anti-self
    await assertThrows(
      () =>
        createReport({
          reporterId: ALICE,
          reportedId: ALICE,
          category: 'harassment_sexuel',
        }),
      'self-report',
      'RP2 anti-self (reporterId == reportedId) → throw self-report',
    );

    // RP3 : invalid category
    await assertThrows(
      () =>
        createReport({
          reporterId: ALICE,
          reportedId: BOB,
          category: 'spam_made_up' as 'autre',
        }),
      'invalid-category',
      'RP3 invalid category → throw invalid-category',
    );

    // RP4 : autre sans freeText
    await assertThrows(
      () =>
        createReport({
          reporterId: ALICE,
          reportedId: BOB,
          category: 'autre',
        }),
      'freetext-required',
      'RP4 category=autre sans freeText → throw freetext-required',
    );

    // RP5 : autre freeText <10 chars
    await assertThrows(
      () =>
        createReport({
          reporterId: ALICE,
          reportedId: BOB,
          category: 'autre',
          freeTextReason: 'short',
        }),
      'freetext-required',
      'RP5 category=autre freeText <10 chars → throw freetext-required',
    );

    // RP6 : no shared session (Alice ne partage rien avec Frank)
    await assertThrows(
      () =>
        createReport({
          reporterId: ALICE,
          reportedId: FRANK,
          category: 'comportement_agressif',
        }),
      'no-shared-session',
      'RP6 no shared session Alice↔Frank → throw no-shared-session',
    );

    // -------------------------------------------------------------------
    // SECTION B — Happy path single + threshold init (RP1, RP9)
    // -------------------------------------------------------------------
    section('createReport : happy path single + threshold init (RP1, RP9)');

    // RP1 : Alice signale Bob (1er report sur Bob)
    let r1Result;
    {
      r1Result = await createReport({
        reporterId: ALICE,
        reportedId: BOB,
        category: 'harassment_sexuel',
      });
      assertEq(typeof r1Result.reportId, 'string', 'RP1 reportId est une string');
      assertEq(r1Result.autoSanctionTriggered, false, 'RP1 autoSanctionTriggered=false (1 reporter)');
      assertEq(r1Result.distinctReportersAfter, 1, 'RP1 distinctReportersAfter=1');

      const snap = await getDoc(doc(fbDb, 'reports', r1Result.reportId));
      assertEq(snap.exists(), true, 'RP1 doc Firestore existe');
      const data = snap.data() as Report;
      assertEq(data.status, 'pending', 'RP1 status=pending');
      assertEq(data.source, 'user', 'RP1 source=user');
      assertEq(data.category, 'harassment_sexuel', 'RP1 category preserved');
    }

    // RP9 : 1er report → pas de UserSanction créée
    {
      const sanctionsSnap = await getDocs(
        query(collection(fbDb, 'userSanctions'), where('userId', '==', BOB)),
      );
      assertEq(sanctionsSnap.size, 0, 'RP9 1er report → pas de UserSanction créée');
    }

    // -------------------------------------------------------------------
    // SECTION C — Threshold escalation (RP10, RP11)
    // -------------------------------------------------------------------
    section('createReport : threshold escalation (RP10, RP11)');

    // RP10 : Charlie signale Bob (2ème reporter distinct → suspension_7d auto)
    {
      const r10 = await createReport({
        reporterId: CHARLIE,
        reportedId: BOB,
        category: 'comportement_agressif',
      });
      assertEq(r10.distinctReportersAfter, 2, 'RP10 distinctReportersAfter=2');
      assertEq(r10.autoSanctionTriggered, true, 'RP10 autoSanctionTriggered=true');

      const sanctionsSnap = await getDocs(
        query(collection(fbDb, 'userSanctions'), where('userId', '==', BOB)),
      );
      assertEq(sanctionsSnap.size, 1, 'RP10 1 UserSanction créée pour Bob');
      const sanction = sanctionsSnap.docs[0].data() as UserSanction;
      assertEq(sanction.level, 'suspension_7d', 'RP10 level=suspension_7d');
      assertEq(sanction.reason, 'reports_threshold', 'RP10 reason=reports_threshold');
      assertEq(sanction.appealable, true, 'RP10 appealable=true (pas warning)');
      assertEq(sanction.isActive, true, 'RP10 isActive=true');
    }

    // RP11 : Diane signale Bob (3ème reporter distinct → suspension_30d auto)
    {
      const r11 = await createReport({
        reporterId: DIANE,
        reportedId: BOB,
        category: 'fake_profile',
      });
      assertEq(r11.distinctReportersAfter, 3, 'RP11 distinctReportersAfter=3');
      assertEq(r11.autoSanctionTriggered, true, 'RP11 autoSanctionTriggered=true');

      // Vérifier la sanction créée par RP11 spécifiquement
      const sanctionsSnap = await getDocs(
        query(collection(fbDb, 'userSanctions'), where('userId', '==', BOB)),
      );
      assertEq(sanctionsSnap.size, 2, 'RP11 2 UserSanctions cumulées pour Bob (RP10 + RP11)');
      const latest30d = sanctionsSnap.docs
        .map((d) => d.data() as UserSanction)
        .find((s) => s.level === 'suspension_30d');
      assertEq(latest30d?.level, 'suspension_30d', 'RP11 dernière sanction = suspension_30d');
      assertEq(latest30d?.triggeringReportIds.length, 3, 'RP11 triggeringReportIds.length=3 (distinct)');
    }

    // -------------------------------------------------------------------
    // SECTION D — Dedup (RP8)
    // -------------------------------------------------------------------
    section('createReport : dedup (RP8)');

    // RP8 : Alice signale Bob une 2ème fois — succès, mais distinct count reste 3 (Alice toujours 1)
    {
      const r8 = await createReport({
        reporterId: ALICE,
        reportedId: BOB,
        category: 'comportement_agressif',
      });
      assertEq(r8.distinctReportersAfter, 3, 'RP8 dedup : distinctReportersAfter reste 3 (Alice 1×)');

      // Vérifier que 4 reports existent total sur Bob (Alice×2 + Charlie + Diane)
      const reportsSnap = await getDocs(
        query(collection(fbDb, 'reports'), where('reportedId', '==', BOB)),
      );
      assertEq(reportsSnap.size, 4, 'RP8 4 reports docs créés sur Bob (2 d\'Alice + Charlie + Diane)');
    }

    // -------------------------------------------------------------------
    // SECTION E — computeReportsThresholdAction unit (RP12)
    // -------------------------------------------------------------------
    section('computeReportsThresholdAction : pure function unit (RP12)');

    {
      assertEq(computeReportsThresholdAction(0).level, null, 'RP12a count=0 → level=null');
      assertEq(computeReportsThresholdAction(1).level, null, 'RP12b count=1 → level=null (review only)');
      assertEq(computeReportsThresholdAction(2).level, 'suspension_7d', 'RP12c count=2 → suspension_7d');
      assertEq(computeReportsThresholdAction(3).level, 'suspension_30d', 'RP12d count=3 → suspension_30d');
      assertEq(computeReportsThresholdAction(10).level, 'suspension_30d', 'RP12e count=10 → suspension_30d');
    }

    // -------------------------------------------------------------------
    // SECTION F — Rate limit (RP7)
    // -------------------------------------------------------------------
    section('createReport : rate limit rolling 24h (RP7)');

    // RP7 : HEAVY signale 3 cibles successivement (succès) puis 4ème throws
    {
      const r7a = await createReport({
        reporterId: HEAVY,
        reportedId: TARGET_1,
        category: 'comportement_agressif',
      });
      assertEq(typeof r7a.reportId, 'string', 'RP7a 1er report HEAVY→TARGET_1 OK');

      const r7b = await createReport({
        reporterId: HEAVY,
        reportedId: TARGET_2,
        category: 'comportement_agressif',
      });
      assertEq(typeof r7b.reportId, 'string', 'RP7b 2ème report HEAVY→TARGET_2 OK');

      const r7c = await createReport({
        reporterId: HEAVY,
        reportedId: TARGET_3,
        category: 'comportement_agressif',
      });
      assertEq(typeof r7c.reportId, 'string', 'RP7c 3ème report HEAVY→TARGET_3 OK');

      // 4ème → throw rate-limit-exceeded
      await assertThrows(
        () =>
          createReport({
            reporterId: HEAVY,
            reportedId: TARGET_4,
            category: 'comportement_agressif',
          }),
        'rate-limit-exceeded',
        `RP7d 4ème report HEAVY (limit=${RATE_LIMIT_PER_DAY}) → throw rate-limit-exceeded`,
      );
    }

    // -------------------------------------------------------------------
    // SECTION G — Admin actions sustain/dismiss (RP13-RP16)
    // -------------------------------------------------------------------
    section('admin actions : sustain + dismiss + role checks (RP13-RP16)');

    // Setup : créer un report fresh à dismiss + un à sustain
    let reportToDismissId = '';
    let reportToSustainId = '';
    {
      // Setup 2 fresh reports — utiliser EVE qui n'a pas encore reporté
      const r = await createReport({
        reporterId: EVE,
        reportedId: TARGET_1, // EVE partage sess_recent avec... attends non, TARGET_1 est sur sess_heavy
        category: 'fake_profile',
      }).catch(async () => {
        // EVE et TARGET_1 ne partagent pas — fallback : créer fresh report Eve→Bob
        return createReport({
          reporterId: EVE,
          reportedId: BOB,
          category: 'fake_profile',
        });
      });
      reportToDismissId = r.reportId;

      // Pour sustain : créer un autre via setDoc direct (status pending)
      const sustainRef = doc(collection(fbDb, 'reports'));
      reportToSustainId = sustainRef.id;
      await setDoc(sustainRef, {
        reportId: reportToSustainId,
        reporterId: ALICE,
        reportedId: CHARLIE,
        category: 'autre',
        freeTextReason: 'Test sustain pending report fixture',
        status: 'pending',
        source: 'user',
        createdAt: Timestamp.now(),
      });
    }

    // RP13 : sustainReport admin → status=actioned + manual sanction si level fourni
    {
      const r13 = await sustainReport({
        reportId: reportToSustainId,
        adminId: ADMIN,
        decisionNote: 'Test sustain note',
        manualSanctionLevel: 'warning',
      });
      assertEq(typeof r13.manualSanctionId, 'string', 'RP13 manualSanctionId créé');

      const reportSnap = await getDoc(doc(fbDb, 'reports', reportToSustainId));
      const reportData = reportSnap.data() as Report;
      assertEq(reportData.status, 'actioned', 'RP13 status=actioned');
      assertEq(reportData.decision, 'sustain', 'RP13 decision=sustain');
      assertEq(reportData.reviewedBy, ADMIN, 'RP13 reviewedBy=ADMIN');

      const sanctionSnap = await getDoc(doc(fbDb, 'userSanctions', r13.manualSanctionId!));
      const sanctionData = sanctionSnap.data() as UserSanction;
      assertEq(sanctionData.reason, 'manual_admin', 'RP13 sanction reason=manual_admin');
      assertEq(sanctionData.level, 'warning', 'RP13 sanction level=warning');
      assertEq(sanctionData.appealable, false, 'RP13 warning appealable=false');
    }

    // RP14 : sustainReport non-admin → throw not-admin
    await assertThrows(
      () =>
        sustainReport({
          reportId: reportToDismissId,
          adminId: EVE, // pas admin
        }),
      'not-admin',
      'RP14 sustainReport par non-admin → throw not-admin',
    );

    // RP15 : dismissReport admin → status=dismissed
    {
      await dismissReport({
        reportId: reportToDismissId,
        adminId: ADMIN,
        decisionNote: 'Test dismiss note',
      });
      const snap = await getDoc(doc(fbDb, 'reports', reportToDismissId));
      const data = snap.data() as Report;
      assertEq(data.status, 'dismissed', 'RP15 status=dismissed');
      assertEq(data.decision, 'dismiss', 'RP15 decision=dismiss');
      assertEq(data.reviewedBy, ADMIN, 'RP15 reviewedBy=ADMIN');
    }

    // RP16 : dismissReport non-admin → throw not-admin
    {
      // Créer fresh pending report pour le test
      const freshRef = doc(collection(fbDb, 'reports'));
      await setDoc(freshRef, {
        reportId: freshRef.id,
        reporterId: ALICE,
        reportedId: BOB,
        category: 'comportement_agressif',
        status: 'pending',
        source: 'user',
        createdAt: Timestamp.now(),
      });
      await assertThrows(
        () =>
          dismissReport({
            reportId: freshRef.id,
            adminId: EVE, // pas admin
          }),
        'not-admin',
        'RP16 dismissReport par non-admin → throw not-admin',
      );
    }

    // -------------------------------------------------------------------
    // SECTION H — getReportsForReporter (RP17)
    // -------------------------------------------------------------------
    section('getReportsForReporter : rolling 24h scope (RP17)');

    // RP17 : Alice a créé : RP1 (Bob harassment) + RP8 (Bob comportement) + RP13 fixture (Charlie autre)
    // Tous récents, donc rolling 24h doit les capturer (≥3)
    {
      const list = await getReportsForReporter(ALICE, { scope: 'rate-limit' });
      assertEq(list.length >= 3, true, `RP17 getReportsForReporter(Alice, rate-limit) >=3 (got ${list.length})`);
      // Vérifier que tous sont reporterId=Alice
      const allAlice = list.every((r) => r.reporterId === ALICE);
      assertEq(allAlice, true, 'RP17 tous les reports retournés sont d\'Alice');
    }

    // -------------------------------------------------------------------
    // SECTION I — Window 30j (RP18)
    // -------------------------------------------------------------------
    section('createReport : window 30j post-session (RP18)');

    // RP18 : OLD_R + OLD_T partagent sess_old (60j ago) → window fermée
    await assertThrows(
      () =>
        createReport({
          reporterId: OLD_R,
          reportedId: OLD_T,
          category: 'harassment_sexuel',
        }),
      'report-window-closed',
      'RP18 latest shared session >30j ago → throw report-window-closed',
    );
  });

  // Cleanup
  __setReportsDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Reports service (RP1-RP18) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
