/**
 * Tests Phase 7 sub-chantier 4 commit 1/4 — Admin actions service.
 *
 * Exécution :
 *   npm run test:reports:admin
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reports/admin.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing.
 *
 * Couverture RA1-RA10 :
 *   getPendingReports : sort priorité + FIFO + filter status
 *   overturnSanction : admin OK, non-admin REJET, déjà overturned REJET
 *   resolveAppeal : uphold/overturn, sanction sans appeal REJET, déjà résolu REJET
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
  getPendingReports,
  overturnSanction,
  ReportError,
  resolveAppeal,
} from '../../src/lib/reports';
import type { Report, UserProfile, UserSanction } from '../../src/types/firestore';

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

async function setupUser(
  fbDb: Firestore,
  opts: { uid: string; role?: 'user' | 'admin' },
): Promise<void> {
  const minimal: Partial<UserProfile> = {
    uid: opts.uid,
    email: `${opts.uid}@test.local`,
    displayName: opts.uid,
    role: opts.role ?? 'user',
  };
  await setDoc(doc(fbDb, 'users', opts.uid), minimal);
}

async function setupReport(
  fbDb: Firestore,
  opts: {
    reportId: string;
    reporterId: string;
    reportedId: string;
    category: string;
    status?: string;
    createdAtMs?: number;
  },
): Promise<void> {
  const minimal: Partial<Report> = {
    reportId: opts.reportId,
    reporterId: opts.reporterId,
    reportedId: opts.reportedId,
    category: opts.category as Report['category'],
    status: (opts.status ?? 'pending') as Report['status'],
    source: 'user',
    createdAt: Timestamp.fromMillis(opts.createdAtMs ?? Date.now()),
  };
  await setDoc(doc(fbDb, 'reports', opts.reportId), minimal);
}

async function setupSanction(
  fbDb: Firestore,
  opts: {
    sanctionId: string;
    userId: string;
    level?: 'warning' | 'suspension_7d' | 'suspension_30d' | 'ban_permanent';
    appealable?: boolean;
    appealUsed?: boolean;
    isActive?: boolean;
    appealResolvedAt?: Timestamp;
    appealDecision?: 'upheld' | 'overturned';
  },
): Promise<void> {
  const minimal: Partial<UserSanction> = {
    sanctionId: opts.sanctionId,
    userId: opts.userId,
    level: opts.level ?? 'suspension_7d',
    reason: 'reports_threshold',
    triggeringReportIds: ['rp_dummy'],
    startsAt: Timestamp.now(),
    appealable: opts.appealable ?? true,
    appealUsed: opts.appealUsed ?? false,
    isActive: opts.isActive ?? true,
    createdAt: Timestamp.now(),
    ...(opts.appealResolvedAt ? { appealResolvedAt: opts.appealResolvedAt } : {}),
    ...(opts.appealDecision ? { appealDecision: opts.appealDecision } : {}),
  };
  await setDoc(doc(fbDb, 'userSanctions', opts.sanctionId), minimal);
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-admin',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setReportsDbForTesting(fbDb);

    const ADMIN = 'admin_ra';
    const USER = 'user_ra';
    const TARGET = 'target_ra';

    await Promise.all([
      setupUser(fbDb, { uid: ADMIN, role: 'admin' }),
      setupUser(fbDb, { uid: USER }),
      setupUser(fbDb, { uid: TARGET }),
    ]);

    // -----------------------------------------------------------------
    // SECTION A — getPendingReports priorité sort + FIFO (RA1-RA3)
    // -----------------------------------------------------------------
    section('getPendingReports : priorité catégorie + FIFO + filter status (RA1-RA3)');

    // Setup reports avec catégories variées + timestamps
    const baseMs = Date.now() - 60 * 60 * 1000; // 1h ago
    await setupReport(fbDb, {
      reportId: 'rp_low_old',
      reporterId: 'rep1', reportedId: TARGET,
      category: 'no_show',
      createdAtMs: baseMs - 30 * 60 * 1000, // -30min from baseMs
    });
    await setupReport(fbDb, {
      reportId: 'rp_high_recent',
      reporterId: 'rep2', reportedId: TARGET,
      category: 'comportement_agressif',
      createdAtMs: baseMs + 10 * 60 * 1000,
    });
    await setupReport(fbDb, {
      reportId: 'rp_urgent_recent',
      reporterId: 'rep3', reportedId: TARGET,
      category: 'harassment_sexuel',
      createdAtMs: baseMs + 20 * 60 * 1000,
    });
    await setupReport(fbDb, {
      reportId: 'rp_urgent_oldest',
      reporterId: 'rep4', reportedId: TARGET,
      category: 'substance_etat_problematique',
      createdAtMs: baseMs - 60 * 60 * 1000, // 2h ago — oldest
    });
    await setupReport(fbDb, {
      reportId: 'rp_already_dismissed',
      reporterId: 'rep5', reportedId: TARGET,
      category: 'harassment_sexuel',
      status: 'dismissed',
      createdAtMs: baseMs,
    });

    // RA1 : sort par priorité (urgent first)
    {
      const list = await getPendingReports();
      assertEq(list.length, 4, 'RA1 getPendingReports.length=4 (1 dismissed exclu)');
      assertEq(
        list[0].category === 'substance_etat_problematique' || list[0].category === 'harassment_sexuel',
        true,
        'RA1 1er report = priorité 1 (urgent rouge)',
      );
    }

    // RA2 : FIFO within same priority — urgent_oldest avant urgent_recent
    {
      const list = await getPendingReports();
      const urgents = list.filter((r) =>
        r.category === 'harassment_sexuel' || r.category === 'substance_etat_problematique',
      );
      assertEq(urgents[0].reportId, 'rp_urgent_oldest', 'RA2 within priorité urgent : oldest first (FIFO)');
    }

    // RA3 : filter status='pending' uniquement
    {
      const list = await getPendingReports();
      const allPending = list.every((r) => r.status === 'pending');
      assertEq(allPending, true, 'RA3 tous les reports retournés ont status=pending');
      const noDismissed = list.find((r) => r.reportId === 'rp_already_dismissed');
      assertEq(noDismissed, undefined, 'RA3 dismissed exclu');
    }

    // -----------------------------------------------------------------
    // SECTION B — overturnSanction (RA4-RA6)
    // -----------------------------------------------------------------
    section('overturnSanction : admin/non-admin/double-overturn (RA4-RA6)');

    // RA4 : admin overturn OK
    {
      await setupSanction(fbDb, {
        sanctionId: 'sx_to_overturn',
        userId: TARGET,
      });
      await overturnSanction({
        adminId: ADMIN,
        sanctionId: 'sx_to_overturn',
        reason: 'Sanction abusive après review.',
      });
      const snap = await getDoc(doc(fbDb, 'userSanctions', 'sx_to_overturn'));
      const data = snap.data() as UserSanction;
      assertEq(data.isActive, false, 'RA4 admin overturn → isActive=false');
      assertEq(data.appealDecision, 'overturned', 'RA4 appealDecision=overturned');
      assertEq(data.appealResolvedBy, ADMIN, 'RA4 appealResolvedBy=adminId');
    }

    // RA5 : non-admin overturn → throw not-admin
    {
      await setupSanction(fbDb, {
        sanctionId: 'sx_nonadmin_attempt',
        userId: TARGET,
      });
      await assertThrows(
        () =>
          overturnSanction({
            adminId: USER, // pas admin
            sanctionId: 'sx_nonadmin_attempt',
          }),
        'not-admin',
        'RA5 overturnSanction par non-admin → throw not-admin',
      );
    }

    // RA6 : overturn sur sanction déjà inactive → throw not-sanction-active
    {
      await assertThrows(
        () =>
          overturnSanction({
            adminId: ADMIN,
            sanctionId: 'sx_to_overturn', // déjà overturned RA4
          }),
        'not-sanction-active',
        'RA6 overturn sur sanction déjà inactive → throw not-sanction-active',
      );
    }

    // -----------------------------------------------------------------
    // SECTION C — resolveAppeal (RA7-RA10)
    // -----------------------------------------------------------------
    section('resolveAppeal : uphold/overturn + appeal-not-filed + already-resolved (RA7-RA10)');

    // RA7 : resolveAppeal uphold → appealDecision=upheld, isActive INCHANGÉ
    {
      await setupSanction(fbDb, {
        sanctionId: 'sx_appeal_uphold',
        userId: TARGET,
        appealUsed: true,
      });
      await resolveAppeal({
        adminId: ADMIN,
        sanctionId: 'sx_appeal_uphold',
        decision: 'upheld',
        decisionNote: 'Appeal rejeté après review.',
      });
      const snap = await getDoc(doc(fbDb, 'userSanctions', 'sx_appeal_uphold'));
      const data = snap.data() as UserSanction;
      assertEq(data.appealDecision, 'upheld', 'RA7 appealDecision=upheld');
      assertEq(data.appealResolvedBy, ADMIN, 'RA7 appealResolvedBy=adminId');
      assertEq(data.isActive, true, 'RA7 isActive INCHANGÉ (true) — uphold');
    }

    // RA8 : resolveAppeal overturn → appealDecision=overturned + isActive=false
    {
      await setupSanction(fbDb, {
        sanctionId: 'sx_appeal_overturn',
        userId: TARGET,
        appealUsed: true,
      });
      await resolveAppeal({
        adminId: ADMIN,
        sanctionId: 'sx_appeal_overturn',
        decision: 'overturned',
      });
      const snap = await getDoc(doc(fbDb, 'userSanctions', 'sx_appeal_overturn'));
      const data = snap.data() as UserSanction;
      assertEq(data.appealDecision, 'overturned', 'RA8 appealDecision=overturned');
      assertEq(data.isActive, false, 'RA8 overturn → isActive=false propagé');
    }

    // RA9 : resolveAppeal sans appealUsed=true → throw appeal-not-filed
    {
      await setupSanction(fbDb, {
        sanctionId: 'sx_no_appeal',
        userId: TARGET,
        appealUsed: false,
      });
      await assertThrows(
        () =>
          resolveAppeal({
            adminId: ADMIN,
            sanctionId: 'sx_no_appeal',
            decision: 'upheld',
          }),
        'appeal-not-filed',
        'RA9 resolveAppeal sur sanction sans appeal filé → throw appeal-not-filed',
      );
    }

    // RA10 : resolveAppeal already resolved → throw appeal-already-resolved
    {
      await assertThrows(
        () =>
          resolveAppeal({
            adminId: ADMIN,
            sanctionId: 'sx_appeal_uphold', // déjà résolu RA7
            decision: 'overturned',
          }),
        'appeal-already-resolved',
        'RA10 resolveAppeal sur sanction déjà résolue → throw appeal-already-resolved',
      );
    }

    // Bonus : non-admin resolveAppeal
    {
      await setupSanction(fbDb, {
        sanctionId: 'sx_appeal_nonadmin',
        userId: TARGET,
        appealUsed: true,
      });
      await assertThrows(
        () =>
          resolveAppeal({
            adminId: USER,
            sanctionId: 'sx_appeal_nonadmin',
            decision: 'upheld',
          }),
        'not-admin',
        'RA10b resolveAppeal par non-admin → throw not-admin',
      );
    }

    // Bonus : invalid decision
    {
      await assertThrows(
        () =>
          resolveAppeal({
            adminId: ADMIN,
            sanctionId: 'sx_appeal_nonadmin',
            decision: 'invalid' as 'upheld',
          }),
        'invalid-decision',
        'RA10c resolveAppeal decision invalide → throw invalid-decision',
      );
    }
  });

  __setReportsDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Admin actions (RA1-RA10) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
