/**
 * Tests Phase 9 sub-chantier 4 commit 1/6 — Admin queue history CSV export.
 *
 * Exécution :
 *   npm run test:admin-actions:history-csv
 *
 * Pattern : @firebase/rules-unit-testing pour client SDK + Admin SDK pour seed/cleanup,
 * cohérent tests/admin-actions/service.test.ts.
 *
 * Couverture (AQ1-AQ5) :
 *   AQ1 : formatAdminActionsCsv headers + 1 row + RFC 4180 escape (quotes, commas, newlines)
 *   AQ2 : filtre actionType query → 3/10 docs renvoyés
 *   AQ3 : filtre date range last 24h (rollingDays=1) → exclusion docs >24h ago
 *   AQ4 : pagination cursor startAfter → page 2 différente de page 1
 *   AQ5 : empty state (no rows) → headers seul (1 ligne CSV terminée \r\n)
 *
 * Bonus : fetchAllAdminActionsForExport boucle pagination jusqu'à cap.
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-history-csv';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-history-csv';

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';

import {
  __setAdminActionsDbForTesting,
  formatAdminActionsCsv,
  fetchAllAdminActionsForExport,
  getAdminActions,
  CSV_HEADERS,
} from '../../src/lib/admin-actions';
import type { AdminAction } from '../../src/types/firestore';

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

// =====================================================================

async function seedActionAdmin(
  env: RulesTestEnvironment,
  a: Partial<AdminAction> & { actionId: string },
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = asFirestore(ctx.firestore());
    const doc_ = {
      actionId: a.actionId,
      adminId: a.adminId ?? 'admin_default',
      actionType: a.actionType ?? 'review_publish',
      targetType: a.targetType ?? 'review',
      targetId: a.targetId ?? `target_${a.actionId}`,
      reason: a.reason ?? '',
      metadata: a.metadata ?? {},
      createdAt: a.createdAt ?? Timestamp.now(),
    };
    await setDoc(doc(fs, 'adminActions', a.actionId), doc_);
  });
}

async function clearAllAdmin(env: RulesTestEnvironment): Promise<void> {
  // Use Admin SDK direct (firebase-admin) for nuke — bypass rules clean
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-history-csv' });
  }
  const adminDb = getFirestore();
  const snap = await adminDb.collection('adminActions').get();
  for (const d of snap.docs) await d.ref.delete().catch(() => {});
  void env; // unused
}

// =====================================================================

const ADMIN_UID = 'admin_test_aq';

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-history-csv',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // 1. Seed admin user doc (role='admin') via rules-disabled (chicken-and-egg)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = asFirestore(ctx.firestore());
    await setDoc(doc(fs, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin@test.local',
      displayName: 'Admin Test',
      role: 'admin',
    });
  });

  // 2. Long-lived authenticated context for admin queries (rules pass via isAdmin())
  const adminCtx = env.authenticatedContext(ADMIN_UID);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminFs: Firestore = asFirestore((adminCtx as any).firestore());

  // 3. Wire DI seam
  __setAdminActionsDbForTesting(adminFs);

  // ===================================================================
  // AQ1 : formatAdminActionsCsv headers + 1 row + RFC 4180 escape
  // ===================================================================
  section('AQ1 formatAdminActionsCsv headers + 1 row + RFC 4180 escape');
  {
    const action: AdminAction = {
      actionId: 'a_aq1',
      adminId: 'admin_aq1',
      actionType: 'review_reject',
      targetType: 'review',
      targetId: 'rev_aq1',
      reason: 'Insulte, "diffamation" + retour\nligne',
      metadata: { score: 0.95, motive: 'slur,present' },
      createdAt: Timestamp.fromMillis(Date.UTC(2026, 4, 8, 10, 30, 0)),
    };
    const csv = formatAdminActionsCsv([action]);
    const lines = csv.split('\r\n');
    if (lines.length >= 2) {
      pass('AQ1 CSV produit ≥2 lignes (headers + 1 row + final \\r\\n)');
    } else {
      fail('AQ1 expected ≥2 lines', { lines });
    }
    const headerLine = lines[0];
    const expectedHeader = CSV_HEADERS.join(',');
    if (headerLine === expectedHeader) {
      pass('AQ1 headers row exact (ordre canonique)');
    } else {
      fail('AQ1 headers mismatch', { actual: headerLine, expected: expectedHeader });
    }
    const rowLine = lines[1];
    if (rowLine.includes('"Insulte, ""diffamation"" + retour\nligne"')) {
      pass('AQ1 reason RFC 4180 escape (quotes doublées + comma + \\n wrap)');
    } else {
      fail('AQ1 reason escape failed', { rowLine });
    }
    if (rowLine.includes('"{""score"":0.95,""motive"":""slur,present""}"')) {
      pass('AQ1 metadata JSON escape (comma+quote → wrap+double)');
    } else {
      fail('AQ1 metadata escape failed', { rowLine });
    }
    if (rowLine.includes('2026-05-08T10:30:00.000Z')) {
      pass('AQ1 createdAt format ISO 8601 UTC');
    } else {
      fail('AQ1 createdAt format ISO failed', { rowLine });
    }
  }

  // ===================================================================
  // AQ5 : empty state (no rows) → headers seul
  // ===================================================================
  section('AQ5 empty state (no rows) → headers seul');
  {
    const csv = formatAdminActionsCsv([]);
    const expected = CSV_HEADERS.join(',') + '\r\n';
    if (csv === expected) {
      pass('AQ5 empty CSV = headers seuls + terminator');
    } else {
      fail('AQ5 empty CSV mismatch', { actual: csv, expected });
    }
  }

  // ===================================================================
  // AQ2 : filtre actionType → 3/10 docs renvoyés
  // ===================================================================
  section('AQ2 filtre actionType query → 3/10 docs renvoyés');
  await clearAllAdmin(env);
  // Seed 7 review_publish + 3 review_reject (10 total), spread sur 3h
  const baseMs = Date.now();
  for (let i = 0; i < 7; i++) {
    await seedActionAdmin(env, {
      actionId: `pub_${i}`,
      actionType: 'review_publish',
      targetId: `rev_pub_${i}`,
      createdAt: Timestamp.fromMillis(baseMs - i * 60_000),
    });
  }
  for (let i = 0; i < 3; i++) {
    await seedActionAdmin(env, {
      actionId: `rej_${i}`,
      actionType: 'review_reject',
      targetId: `rev_rej_${i}`,
      createdAt: Timestamp.fromMillis(baseMs - i * 30_000),
    });
  }
  {
    const items = await getAdminActions({ actionType: 'review_reject', limit: 50 });
    if (items.length === 3 && items.every((a) => a.actionType === 'review_reject')) {
      pass('AQ2 filtre actionType=review_reject → 3 docs');
    } else {
      fail('AQ2 should return 3 docs review_reject', {
        count: items.length,
        types: items.map((a) => a.actionType),
      });
    }
    // Sanity : sans filtre = 10
    const allItems = await getAdminActions({ limit: 50 });
    if (allItems.length === 10) {
      pass('AQ2 sans filtre → 10 docs (sanity)');
    } else {
      fail('AQ2 sans filtre should return 10', { count: allItems.length });
    }
  }

  // ===================================================================
  // AQ3 : filtre date range last 24h (rollingDays=1)
  // ===================================================================
  section('AQ3 filtre date range last 24h (rollingDays=1)');
  await clearAllAdmin(env);
  const now = Date.now();
  // 2 docs in window (last 24h) + 3 docs older (>24h ago)
  for (let i = 0; i < 2; i++) {
    await seedActionAdmin(env, {
      actionId: `recent_${i}`,
      createdAt: Timestamp.fromMillis(now - i * 60 * 60_000), // i*1h ago
    });
  }
  for (let i = 0; i < 3; i++) {
    await seedActionAdmin(env, {
      actionId: `old_${i}`,
      createdAt: Timestamp.fromMillis(now - (25 + i * 24) * 60 * 60_000), // 25h, 49h, 73h ago
    });
  }
  {
    const items = await getAdminActions({ rollingDays: 1, limit: 50 });
    if (items.length === 2) {
      pass('AQ3 rollingDays=1 → 2 docs (last 24h)');
    } else {
      fail('AQ3 should return 2 docs', { count: items.length, ids: items.map((a) => a.actionId) });
    }
    const allItems = await getAdminActions({ limit: 50 });
    if (allItems.length === 5) {
      pass('AQ3 sans rollingDays → 5 docs (sanity)');
    } else {
      fail('AQ3 sans rollingDays should return 5', { count: allItems.length });
    }
  }

  // ===================================================================
  // AQ4 : pagination cursor startAfter → page 2 différente
  // ===================================================================
  section('AQ4 pagination cursor startAfter → page 2 différente de page 1');
  await clearAllAdmin(env);
  // Seed 7 docs, ordre createdAt DESC
  for (let i = 0; i < 7; i++) {
    await seedActionAdmin(env, {
      actionId: `p_${i}`,
      adminId: `admin_p_${i}`,
      createdAt: Timestamp.fromMillis(now - i * 60_000),
    });
  }
  {
    const page1 = await getAdminActions({ limit: 3 });
    if (page1.length === 3) {
      pass('AQ4 page 1 limit=3 → 3 docs');
    } else {
      fail('AQ4 page 1 should be 3', { count: page1.length });
    }
    // page 2 cursor = last of page1
    const cursor = page1[page1.length - 1];
    const page2 = await getAdminActions({ limit: 3, cursorAfter: cursor });
    if (page2.length === 3) {
      pass('AQ4 page 2 limit=3 → 3 docs');
    } else {
      fail('AQ4 page 2 should be 3', { count: page2.length });
    }
    // Pas d'overlap entre p1 et p2
    const p1Ids = new Set(page1.map((a) => a.actionId));
    const overlap = page2.filter((a) => p1Ids.has(a.actionId));
    if (overlap.length === 0) {
      pass('AQ4 zéro overlap entre page 1 et page 2');
    } else {
      fail('AQ4 overlap detected', { overlap: overlap.map((a) => a.actionId) });
    }
    // Page 3 = derniers 1 doc (7 - 6 = 1)
    const cursor2 = page2[page2.length - 1];
    const page3 = await getAdminActions({ limit: 3, cursorAfter: cursor2 });
    if (page3.length === 1) {
      pass('AQ4 page 3 (cap) → 1 doc restant');
    } else {
      fail('AQ4 page 3 should be 1', { count: page3.length });
    }
  }

  // ===================================================================
  // Bonus : fetchAllAdminActionsForExport boucle pagination
  // ===================================================================
  section('Bonus fetchAllAdminActionsForExport (loop pagination jusqu\'au cap)');
  await clearAllAdmin(env);
  for (let i = 0; i < 12; i++) {
    await seedActionAdmin(env, {
      actionId: `loop_${i}`,
      createdAt: Timestamp.fromMillis(now - i * 60_000),
    });
  }
  {
    // Cap > total → tout récupéré, pas truncated
    const result = await fetchAllAdminActionsForExport({}, 100);
    if (result.actions.length === 12 && result.truncated === false) {
      pass('Bonus fetchAll cap=100 sur 12 docs → 12 actions, truncated=false');
    } else {
      fail('Bonus fetchAll cap=100 mismatch', result);
    }
    // Cap = 5 → truncated=true, exactement 5 actions
    const truncResult = await fetchAllAdminActionsForExport({}, 5);
    if (truncResult.actions.length === 5 && truncResult.truncated === true) {
      pass('Bonus fetchAll cap=5 sur 12 docs → 5 actions, truncated=true');
    } else {
      fail('Bonus fetchAll cap=5 should truncate', truncResult);
    }
  }

  // Cleanup
  __setAdminActionsDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé History CSV (AQ1-AQ5 + bonus) ======');
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
