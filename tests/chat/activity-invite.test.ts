/**
 * BUG #36 COMMIT 1 — Tests purs activity-invite helpers.
 *
 * 3 helpers TDD :
 *  - buildActivityInvitePayload : shape ChatMessage avec invite + inviteStatus='pending'
 *  - validateInviteStatusTransition : transitions autorisées pending → accepted/declined/expired
 *  - isInviteExpired : check 24h avant nextSessionAt OR session passée
 *
 * Couverture (AI1-AI14) :
 *   AI1  — build : shape minimal payload
 *   AI2  — build : champs dénormalisés (city/sport/imageUrl) optionnels
 *   AI3  — build : inviteStatus='pending' systématique
 *   AI4  — transition : pending→accepted par receiver OK
 *   AI5  — transition : pending→declined par receiver OK
 *   AI6  — transition : pending→accepted par sender NOK (sender ne peut pas accepter son propre invite)
 *   AI7  — transition : pending→expired (system) OK
 *   AI8  — transition : accepted→declined NOK (déjà finalisé)
 *   AI9  — transition : declined→accepted NOK
 *   AI10 — transition : expired→accepted NOK
 *   AI11 — transition : pending→pending NOK (no-op)
 *   AI12 — expired : pas de nextSessionAt → false (jamais expiré)
 *   AI13 — expired : nextSessionAt > 24h dans le futur → false
 *   AI14 — expired : nextSessionAt dans <24h OR passé → true
 *
 * Exécution : npx tsx tests/chat/activity-invite.test.ts
 */

import {
  buildActivityInvitePayload,
  validateInviteStatusTransition,
  isInviteExpired,
  buildFutureSessionActivityIdSet,
  filterActivitiesWithFutureSession,
} from '../../src/lib/chat/activityInvite';

let passes = 0;
let failures = 0;

function ok(label: string) {
  passes++;
  console.log(`  ✓ ${label}`);
}
function fail(label: string, info?: unknown) {
  failures++;
  console.error(`  ✗ ${label}`, info ?? '');
}
function section(t: string) {
  console.log(`\n--- ${t} ---`);
}

async function run() {
  // ─── buildActivityInvitePayload ──────────────────────────────────────
  section('AI1 — build : shape minimal');
  {
    const p = buildActivityInvitePayload({
      senderId: 'user-A',
      activityId: 'act-1',
      activityTitle: 'Afroboost',
      inviteMode: 'individual',
    });
    if (
      p.senderId === 'user-A' &&
      p.type === 'activity_invite' &&
      p.text === '' &&
      Array.isArray(p.readBy) &&
      p.readBy.length === 1 &&
      p.readBy[0] === 'user-A' &&
      p.invite?.activityId === 'act-1' &&
      p.invite?.activityTitle === 'Afroboost' &&
      p.invite?.inviteMode === 'individual'
    ) ok('shape minimal OK');
    else fail('unexpected', p);
  }

  section('AI2 — build : champs dénormalisés optionnels');
  {
    const p = buildActivityInvitePayload({
      senderId: 'A',
      activityId: 'act-2',
      activityTitle: 'Salsa',
      inviteMode: 'duo',
      activityCity: 'Genève',
      activitySport: 'salsa',
      activityImageUrl: 'https://storage/img.jpg',
      nextSessionId: 'sess-1',
    });
    if (
      p.invite?.activityCity === 'Genève' &&
      p.invite?.activitySport === 'salsa' &&
      p.invite?.activityImageUrl === 'https://storage/img.jpg' &&
      p.invite?.nextSessionId === 'sess-1' &&
      p.invite?.inviteMode === 'duo'
    ) ok('champs optionnels OK');
    else fail('unexpected', p);
  }

  section('AI2b — build : activityTitle vide/undefined → fallback "Activité" (anti Firestore undefined)');
  {
    const p1 = buildActivityInvitePayload({ senderId: 'A', activityId: 'a', activityTitle: '', inviteMode: 'individual' });
    if (p1.invite?.activityTitle === 'Activité') ok('empty → fallback');
    else fail('unexpected empty', p1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p2 = buildActivityInvitePayload({ senderId: 'A', activityId: 'a', activityTitle: undefined as any, inviteMode: 'individual' });
    if (p2.invite?.activityTitle === 'Activité') ok('undefined → fallback');
    else fail('unexpected undef', p2);
  }

  section('AI2c — build : champs optionnels undefined ne sont PAS dans invite (anti Firestore undefined)');
  {
    const p = buildActivityInvitePayload({
      senderId: 'A',
      activityId: 'a',
      activityTitle: 'Test',
      inviteMode: 'individual',
      // activityCity, activitySport, activityImageUrl, nextSessionId, nextSessionAt non fournis
    });
    if (
      p.invite &&
      !('activityCity' in p.invite) &&
      !('activitySport' in p.invite) &&
      !('activityImageUrl' in p.invite) &&
      !('nextSessionId' in p.invite) &&
      !('nextSessionAt' in p.invite)
    ) ok('keys undefined absentes');
    else fail('unexpected keys présents', p.invite);
  }

  section('AI3 — build : inviteStatus systématique = pending');
  {
    const p = buildActivityInvitePayload({
      senderId: 'A', activityId: 'a', activityTitle: 't', inviteMode: 'individual',
    });
    if (p.inviteStatus === 'pending') ok('status=pending par défaut');
    else fail('unexpected', p.inviteStatus);
  }

  // ─── validateInviteStatusTransition ──────────────────────────────────
  section('AI4 — pending→accepted par receiver OK');
  {
    if (validateInviteStatusTransition('pending', 'accepted', { isReceiver: true }) === true) ok('OK');
    else fail('unexpected');
  }

  section('AI5 — pending→declined par receiver OK');
  {
    if (validateInviteStatusTransition('pending', 'declined', { isReceiver: true }) === true) ok('OK');
    else fail('unexpected');
  }

  section('AI6 — pending→accepted par sender NOK (anti-self-accept)');
  {
    if (validateInviteStatusTransition('pending', 'accepted', { isReceiver: false }) === false) ok('NOK');
    else fail('unexpected');
  }

  section('AI7 — pending→expired (system) OK même sans receiver');
  {
    if (validateInviteStatusTransition('pending', 'expired', { isReceiver: false, isSystem: true }) === true) ok('system OK');
    else fail('unexpected');
  }

  section('AI8 — accepted→declined NOK (déjà finalisé)');
  {
    if (validateInviteStatusTransition('accepted', 'declined', { isReceiver: true }) === false) ok('NOK');
    else fail('unexpected');
  }

  section('AI9 — declined→accepted NOK');
  {
    if (validateInviteStatusTransition('declined', 'accepted', { isReceiver: true }) === false) ok('NOK');
    else fail('unexpected');
  }

  section('AI10 — expired→accepted NOK');
  {
    if (validateInviteStatusTransition('expired', 'accepted', { isReceiver: true }) === false) ok('NOK');
    else fail('unexpected');
  }

  section('AI11 — pending→pending NOK (no-op)');
  {
    if (validateInviteStatusTransition('pending', 'pending', { isReceiver: true }) === false) ok('NOK');
    else fail('unexpected');
  }

  // ─── isInviteExpired ─────────────────────────────────────────────────
  const now = Date.now();
  const hours = (h: number) => new Date(now + h * 3600 * 1000);

  section('AI12 — pas de nextSessionAt → false');
  {
    if (isInviteExpired({}, now) === false) ok('no session → not expired');
    else fail('unexpected');
  }

  section('AI13 — session dans >24h → false (still in window)');
  {
    const inviteWith48hSession = { nextSessionAt: hours(48) };
    if (isInviteExpired(inviteWith48hSession, now) === false) ok('48h ahead → not expired');
    else fail('unexpected');
  }

  section('AI14 — session dans <24h ou passée → true');
  {
    const inviteWith12hSession = { nextSessionAt: hours(12) };
    const invitePast = { nextSessionAt: hours(-1) };
    if (
      isInviteExpired(inviteWith12hSession, now) === true &&
      isInviteExpired(invitePast, now) === true
    ) ok('12h/past → expired');
    else fail('unexpected');
  }

  // ─── buildFutureSessionActivityIdSet + filterActivitiesWithFutureSession ─
  // (BUG #36 post-hotfix : pré-filtrer ActivitySelectorModal pour ne montrer
  // QUE les activités avec session future — évite le 409 no-future-session.)
  const nowMs = Date.now();

  section('AI15 — buildFutureSessionActivityIdSet empty array → empty Set');
  {
    const set = buildFutureSessionActivityIdSet([], nowMs);
    if (set instanceof Set && set.size === 0) ok('empty in → empty Set');
    else fail('unexpected', { size: set.size });
  }

  section('AI16 — buildFutureSessionActivityIdSet mix past/future → only futures');
  {
    const set = buildFutureSessionActivityIdSet(
      [
        { activityId: 'a-future', startAtMs: nowMs + 3600 * 1000 },
        { activityId: 'a-past', startAtMs: nowMs - 3600 * 1000 },
        { activityId: 'a-future-2', startAtMs: nowMs + 7200 * 1000 },
        { activityId: 'a-future', startAtMs: nowMs + 5000 * 1000 }, // dup OK
      ],
      nowMs,
    );
    if (set.size === 2 && set.has('a-future') && set.has('a-future-2') && !set.has('a-past')) {
      ok('only future activityIds, dedup OK');
    } else {
      fail('unexpected', { size: set.size, has: Array.from(set) });
    }
  }

  section('AI17 — filterActivitiesWithFutureSession keeps only matching activityIds');
  {
    const acts = [
      { activityId: 'a-1', title: 'A1' },
      { activityId: 'a-2', title: 'A2' },
      { activityId: 'a-3', title: 'A3' },
    ];
    const set = new Set(['a-1', 'a-3']);
    const filtered = filterActivitiesWithFutureSession(acts, set);
    if (
      filtered.length === 2 &&
      filtered[0].activityId === 'a-1' &&
      filtered[1].activityId === 'a-3'
    ) {
      ok('filters correctly preserving order');
    } else {
      fail('unexpected', { ids: filtered.map((a) => a.activityId) });
    }
    // Empty set → empty result
    const emptyFiltered = filterActivitiesWithFutureSession(acts, new Set());
    if (emptyFiltered.length === 0) ok('empty Set → empty result');
    else fail('expected empty');
  }

  console.log(`\n====== Résumé activity-invite ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
