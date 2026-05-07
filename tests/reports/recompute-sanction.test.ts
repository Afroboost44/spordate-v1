/**
 * Tests Phase 8 sub-chantier 5 commit 1/5 — recomputeSanctionAfterReportCancel.
 *
 * Exécution :
 *   npm run test:reports:recompute-cancel
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reports/recompute-sanction.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing (cohérent no-show.test.ts).
 *
 * Couverture (RC1-RC8) :
 *   RC1 sanction warning (1 trigger) → cancel → désactive (newLevel=null)
 *   RC2 sanction suspension_30d (3 triggers) → cancel 1 → downgrade warning
 *   RC3 sanction ban_permanent (4 triggers) → cancel 1 → downgrade suspension_30d
 *   RC4 sanction warning (2 triggers same level threshold) → cancel 1 → level préservé warning
 *   RC5 cancelNoShow integration : autoSuspensionApplied=true + sanction triggered → recompute auto
 *   RC6 sanction reason !== 'no_show_threshold' → skip recompute (no-op)
 *   RC7 sanction !isActive (already overturned) → skip recompute
 *   RC8 reportId pas dans triggeringReportIds → no-op (return false)
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  setDoc,
  getDoc,
  type Firestore,
} from 'firebase/firestore';

import {
  __setReportsDbForTesting,
  cancelNoShow,
  findActiveSanctionTriggeredByReport,
  recomputeSanctionAfterReportCancel,
} from '../../src/lib/reports';
import type { Report, UserSanction } from '../../src/types/firestore';

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

function assertEq<T>(actual: T, expected: T, label: string): void {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson === eJson) pass(label);
  else fail(label, { actual, expected });
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

async function setupSanction(
  fbDb: Firestore,
  opts: {
    sanctionId: string;
    userId: string;
    level: UserSanction['level'];
    reason: UserSanction['reason'];
    triggeringReportIds: string[];
    isActive?: boolean;
    startsAtMs?: number;
  },
): Promise<void> {
  const startsAtMs = opts.startsAtMs ?? Date.now();
  const isActive = opts.isActive ?? true;
  const isWarning = opts.level === 'warning';
  const isPermanent = opts.level === 'ban_permanent';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    sanctionId: opts.sanctionId,
    userId: opts.userId,
    level: opts.level,
    reason: opts.reason,
    triggeringReportIds: opts.triggeringReportIds,
    startsAt: tsFromMs(startsAtMs),
    appealable: !isWarning,
    appealUsed: false,
    isActive,
    createdAt: tsFromMs(startsAtMs),
  };
  if (!isWarning && !isPermanent) {
    const days = opts.level === 'suspension_7d' ? 7 : 30;
    payload.endsAt = tsFromMs(startsAtMs + days * 24 * 60 * 60 * 1000);
  }
  await setDoc(doc(fbDb, 'userSanctions', opts.sanctionId), payload);
}

async function setupReport(
  fbDb: Firestore,
  opts: {
    reportId: string;
    reporterId: string;
    reportedId: string;
    autoSuspensionApplied?: boolean;
    createdAtMs?: number;
  },
): Promise<void> {
  const createdAtMs = opts.createdAtMs ?? Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    reportId: opts.reportId,
    reporterId: opts.reporterId,
    reportedId: opts.reportedId,
    category: 'no_show',
    status: 'pending',
    source: 'partner_no_show',
    createdAt: tsFromMs(createdAtMs),
  };
  if (opts.autoSuspensionApplied) {
    payload.autoSuspensionApplied = true;
    payload.autoSuspensionDurationDays = 30;
  }
  await setDoc(doc(fbDb, 'reports', opts.reportId), payload);
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-recompute',
    firestore: { host: 'localhost', port: 8080 },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setReportsDbForTesting(fbDb);

    const USER = 'user_recompute';
    const PARTNER = 'partner_recompute';
    const NOW = Date.now();

    // =================================================================
    // RC1 sanction warning (1 trigger) → cancel → désactive
    // =================================================================
    section('RC1 sanction warning 1 trigger → cancel → disabled');
    {
      const SID = 'sanction_rc1';
      const RID = 'report_rc1';
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'warning',
        reason: 'no_show_threshold',
        triggeringReportIds: [RID],
      });
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: SID,
        cancelledReportId: RID,
      });
      assertEq(result.updated, true, 'RC1 updated=true');
      assertEq(result.newLevel, null, 'RC1 newLevel=null');
      assertEq(result.reason, 'disabled-no-triggering', 'RC1 reason=disabled-no-triggering');

      const snap = await getDoc(doc(fbDb, 'userSanctions', SID));
      const data = snap.data() as UserSanction;
      assertEq(data.isActive, false, 'RC1 isActive=false persisted');
      assertEq(data.triggeringReportIds, [], 'RC1 triggeringReportIds=[]');
    }

    // =================================================================
    // RC2 sanction suspension_30d (3 triggers) → cancel 1 → downgrade warning
    // =================================================================
    section('RC2 suspension_30d (3 triggers) → cancel 1 → downgrade warning');
    {
      const SID = 'sanction_rc2';
      const RIDS = ['rep_rc2_a', 'rep_rc2_b', 'rep_rc2_c'];
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'suspension_30d',
        reason: 'no_show_threshold',
        triggeringReportIds: RIDS,
        startsAtMs: NOW,
      });
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: SID,
        cancelledReportId: RIDS[0],
      });
      assertEq(result.updated, true, 'RC2 updated=true');
      assertEq(result.newLevel, 'warning', 'RC2 newLevel=warning (2 triggers → warning)');
      assertEq(result.reason, 'downgraded', 'RC2 reason=downgraded');

      const data = (await getDoc(doc(fbDb, 'userSanctions', SID))).data() as UserSanction;
      assertEq(data.level, 'warning', 'RC2 level=warning persisté');
      assertEq(
        (data.triggeringReportIds ?? []).sort(),
        [RIDS[1], RIDS[2]].sort(),
        'RC2 triggeringReportIds 2 restants',
      );
      assertEq(data.isActive, true, 'RC2 isActive=true (downgrade preserves active)');
    }

    // =================================================================
    // RC3 sanction ban_permanent (4 triggers) → cancel 1 → downgrade suspension_30d
    // =================================================================
    section('RC3 ban_permanent (4 triggers) → cancel 1 → downgrade suspension_30d');
    {
      const SID = 'sanction_rc3';
      const RIDS = ['rep_rc3_a', 'rep_rc3_b', 'rep_rc3_c', 'rep_rc3_d'];
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'ban_permanent',
        reason: 'no_show_threshold',
        triggeringReportIds: RIDS,
        startsAtMs: NOW,
      });
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: SID,
        cancelledReportId: RIDS[0],
      });
      assertEq(result.updated, true, 'RC3 updated=true');
      assertEq(result.newLevel, 'suspension_30d', 'RC3 newLevel=suspension_30d');

      const data = (await getDoc(doc(fbDb, 'userSanctions', SID))).data() as UserSanction;
      assertEq(data.level, 'suspension_30d', 'RC3 level downgraded');
      // endsAt recomputed = startsAt + 30d
      const expectedEndsAt = NOW + 30 * 24 * 60 * 60 * 1000;
      const actualEndsAt = data.endsAt?.toMillis?.() ?? 0;
      const within1s = Math.abs(actualEndsAt - expectedEndsAt) < 1000;
      assertEq(within1s, true, 'RC3 endsAt recomputed = startsAt+30d');
    }

    // =================================================================
    // RC4 cancel non-triggering report → no-op (return false)
    // =================================================================
    section('RC4 reportId pas dans triggeringReportIds → no-op');
    {
      const SID = 'sanction_rc4';
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'warning',
        reason: 'no_show_threshold',
        triggeringReportIds: ['rep_rc4_known'],
      });
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: SID,
        cancelledReportId: 'rep_rc4_unknown',
      });
      assertEq(result.updated, false, 'RC4 updated=false');
      assertEq(result.reason, 'report-not-in-triggering', 'RC4 reason=report-not-in-triggering');
    }

    // =================================================================
    // RC5 cancelNoShow integration : autoSuspensionApplied=true + sanction triggered
    // =================================================================
    section('RC5 cancelNoShow integration → recompute auto');
    {
      const SID = 'sanction_rc5';
      const RID = 'report_rc5';
      await setupReport(fbDb, {
        reportId: RID,
        reporterId: PARTNER,
        reportedId: USER,
        autoSuspensionApplied: true,
        createdAtMs: NOW - 1 * 60 * 60 * 1000, // 1h ago, well within 24h window
      });
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'suspension_30d',
        reason: 'no_show_threshold',
        triggeringReportIds: [RID, 'rep_rc5_other_b', 'rep_rc5_other_c'],
        startsAtMs: NOW,
      });

      // findActiveSanctionTriggeredByReport sanity
      const found = await findActiveSanctionTriggeredByReport(USER, RID);
      assertEq(found?.sanctionId ?? null, SID, 'RC5 findActiveSanctionTriggeredByReport returns sanction');

      // cancelNoShow should auto-trigger recompute
      await cancelNoShow({ partnerId: PARTNER, reportId: RID });

      const data = (await getDoc(doc(fbDb, 'userSanctions', SID))).data() as UserSanction;
      // 3 triggers - 1 = 2 → warning level
      assertEq(data.level, 'warning', 'RC5 sanction downgraded warning (auto-recompute via cancelNoShow)');
      assertEq(data.triggeringReportIds?.includes(RID) ?? true, false, 'RC5 reportId removed from triggeringReportIds');
    }

    // =================================================================
    // RC6 sanction reason='reports_threshold' → skip recompute (no-op)
    // =================================================================
    section('RC6 reason=reports_threshold → skip (out of scope SC5)');
    {
      const SID = 'sanction_rc6';
      const RID = 'report_rc6';
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'suspension_7d',
        reason: 'reports_threshold',
        triggeringReportIds: [RID, 'rep_rc6_other'],
      });
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: SID,
        cancelledReportId: RID,
      });
      assertEq(result.updated, false, 'RC6 updated=false');
      assertEq(result.reason, 'reason-not-no-show', 'RC6 reason=reason-not-no-show');

      // Sanction unchanged
      const data = (await getDoc(doc(fbDb, 'userSanctions', SID))).data() as UserSanction;
      assertEq(data.level, 'suspension_7d', 'RC6 level unchanged');
      assertEq(
        (data.triggeringReportIds ?? []).length,
        2,
        'RC6 triggeringReportIds preserved (length=2)',
      );
    }

    // =================================================================
    // RC7 sanction !isActive (already overturned) → skip recompute
    // =================================================================
    section('RC7 sanction !isActive → skip already-inactive');
    {
      const SID = 'sanction_rc7';
      const RID = 'report_rc7';
      await setupSanction(fbDb, {
        sanctionId: SID,
        userId: USER,
        level: 'warning',
        reason: 'no_show_threshold',
        triggeringReportIds: [RID],
        isActive: false, // already overturned/expired
      });
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: SID,
        cancelledReportId: RID,
      });
      assertEq(result.updated, false, 'RC7 updated=false');
      assertEq(result.reason, 'already-inactive', 'RC7 reason=already-inactive');
    }

    // =================================================================
    // RC8 sanction-not-found
    // =================================================================
    section('RC8 sanction-not-found');
    {
      const result = await recomputeSanctionAfterReportCancel({
        sanctionId: 'sanction_rc8_does_not_exist',
        cancelledReportId: 'report_rc8',
      });
      assertEq(result.updated, false, 'RC8 updated=false');
      assertEq(result.reason, 'sanction-not-found', 'RC8 reason=sanction-not-found');
    }
  });

  __setReportsDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Recompute sanction (RC1-RC8) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
