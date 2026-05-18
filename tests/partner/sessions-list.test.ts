/**
 * Fix B B1 — Tests purs helper `groupSessionsByActivity`.
 *
 * Helper utilisé par /partner/sessions/page.tsx pour grouper les sessions
 * du partenaire par activité (vue list).
 *
 * Couverture (GS1-GS5) :
 *   GS1 — empty array → empty Map
 *   GS2 — sessions même activityId → groupées ensemble
 *   GS3 — sessions diff activityId → groupes séparés
 *   GS4 — sessions dans un groupe → triées par startAt asc
 *   GS5 — order des groupes = ordre d'apparition (1ère session de chaque activity)
 *
 * Exécution : npx tsx tests/partner/sessions-list.test.ts
 */

import { groupSessionsByActivity } from '../../src/lib/partner/sessionsList';
import type { Session } from '../../src/types/firestore';

let passes = 0;
let failures = 0;

function ok(label: string) { passes++; console.log(`  ✓ ${label}`); }
function fail(label: string, info?: unknown) { failures++; console.error(`  ✗ ${label}`, info ?? ''); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

function mkSession(id: string, activityId: string, startAtMs: number): Session {
  return {
    sessionId: id,
    activityId,
    partnerId: 'p1',
    creatorId: 'p1',
    sport: 'salsa',
    title: id,
    city: 'GE',
    startAt: { toMillis: () => startAtMs, toDate: () => new Date(startAtMs), seconds: 0, nanoseconds: 0 } as unknown as Session['startAt'],
    endAt: { toMillis: () => startAtMs + 3600000 } as unknown as Session['endAt'],
    chatOpenAt: { toMillis: () => startAtMs } as unknown as Session['chatOpenAt'],
    chatCloseAt: { toMillis: () => startAtMs } as unknown as Session['chatCloseAt'],
    maxParticipants: 10,
    currentParticipants: 0,
    pricingTiers: [],
    currentTier: 'early',
    currentPrice: 0,
    status: 'open',
    createdBy: 'p1',
    createdAt: { toMillis: () => 0 } as unknown as Session['createdAt'],
    updatedAt: { toMillis: () => 0 } as unknown as Session['updatedAt'],
  } as Session;
}

async function run() {
  section('GS1 — empty array → empty Map');
  {
    const r = groupSessionsByActivity([]);
    if (r instanceof Map && r.size === 0) ok('empty Map');
    else fail('unexpected', r);
  }

  section('GS2 — sessions même activityId → 1 groupe');
  {
    const sessions = [
      mkSession('s1', 'a1', 1000),
      mkSession('s2', 'a1', 2000),
      mkSession('s3', 'a1', 3000),
    ];
    const r = groupSessionsByActivity(sessions);
    if (r.size === 1 && r.get('a1')?.length === 3) ok('1 group of 3');
    else fail('unexpected', { size: r.size, a1: r.get('a1')?.length });
  }

  section('GS3 — sessions diff activityId → 2 groupes');
  {
    const sessions = [
      mkSession('s1', 'a1', 1000),
      mkSession('s2', 'a2', 2000),
      mkSession('s3', 'a1', 3000),
    ];
    const r = groupSessionsByActivity(sessions);
    if (r.size === 2 && r.get('a1')?.length === 2 && r.get('a2')?.length === 1) {
      ok('2 groups : a1=2, a2=1');
    } else {
      fail('unexpected', { size: r.size, a1: r.get('a1')?.length, a2: r.get('a2')?.length });
    }
  }

  section('GS4 — sessions dans groupe triées par startAt asc');
  {
    const sessions = [
      mkSession('s-late', 'a1', 5000),
      mkSession('s-mid', 'a1', 3000),
      mkSession('s-early', 'a1', 1000),
    ];
    const r = groupSessionsByActivity(sessions);
    const ids = r.get('a1')?.map((s) => s.sessionId) ?? [];
    if (ids[0] === 's-early' && ids[1] === 's-mid' && ids[2] === 's-late') ok('asc sort OK');
    else fail('unexpected order', ids);
  }

  section('GS5 — order groupes = ordre d\'apparition 1ère session');
  {
    const sessions = [
      mkSession('s1', 'a2', 1000),
      mkSession('s2', 'a1', 2000),
      mkSession('s3', 'a3', 3000),
      mkSession('s4', 'a1', 4000),
    ];
    const r = groupSessionsByActivity(sessions);
    const keys = Array.from(r.keys());
    if (keys[0] === 'a2' && keys[1] === 'a1' && keys[2] === 'a3') ok('order = a2,a1,a3');
    else fail('unexpected key order', keys);
  }

  console.log(`\n====== Résumé sessions-list ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
