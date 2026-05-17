/**
 * BUG #36 COMMIT 3 — Tests purs helpers extras (rate limit + Duo metadata + expiration).
 *
 * 3 helpers :
 *  - checkInviteRateLimit(count, max=10) : soft limit, retourne { allowed, message? }
 *  - buildDuoInviteMetadata(input) : Stripe metadata object pour mode Duo
 *  - findExpiredInvites(messages, nowMs) : ids des invites pending à expirer
 *
 * Couverture (IE1-IE13) :
 *   IE1-IE3 checkInviteRateLimit : sous limite, à limite, au-dessus
 *   IE4-IE6 buildDuoInviteMetadata : champs requis, optionnels, sentinel
 *   IE7-IE13 findExpiredInvites : empty, non-invite skip, accepted skip,
 *           pas de session skip, dans 48h skip, dans 12h expire, déjà
 *           expired skip
 *
 * Exécution : npx tsx tests/chat/invite-extras.test.ts
 */

import {
  checkInviteRateLimit,
  buildDuoInviteMetadata,
  findExpiredInvites,
  INVITE_DAILY_LIMIT,
} from '../../src/lib/chat/inviteExtras';

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
  // ─── checkInviteRateLimit ────────────────────────────────────────────
  section('IE1 — count < limit → allowed=true, no message');
  {
    const r = checkInviteRateLimit(3);
    if (r.allowed === true && !r.message) ok('sous limite OK');
    else fail('unexpected', r);
  }

  section('IE2 — count = limit (10) → allowed=true (soft, dernier autorisé)');
  {
    const r = checkInviteRateLimit(INVITE_DAILY_LIMIT);
    if (r.allowed === true && !r.message) ok('à la limite OK');
    else fail('unexpected', r);
  }

  section('IE3 — count > limit (11) → allowed=true mais message warning');
  {
    const r = checkInviteRateLimit(INVITE_DAILY_LIMIT + 1);
    if (r.allowed === true && typeof r.message === 'string' && r.message.includes('10')) {
      ok('soft limit warning');
    } else fail('unexpected', r);
  }

  // ─── buildDuoInviteMetadata ──────────────────────────────────────────
  section('IE4 — buildDuoInviteMetadata : champs requis');
  {
    const m = buildDuoInviteMetadata({
      activityId: 'act-1',
      sessionId: 'sess-1',
      matchId: 'A_B',
      senderUid: 'user-A',
      receiverUid: 'user-B',
    });
    if (
      m.activityInviteMode === 'duo' &&
      m.activityInviteMatchId === 'A_B' &&
      m.activityInviteSenderUid === 'user-A' &&
      m.activityInviteReceiverUid === 'user-B' &&
      m.inviteeUid === 'user-B' && // alias attendu par webhook fix Phase 9.5 c47
      m.isDuoTicket === 'true'
    ) ok('metadata complet');
    else fail('unexpected', m);
  }

  section('IE5 — buildDuoInviteMetadata : sessionId optionnel');
  {
    const m = buildDuoInviteMetadata({
      activityId: 'act-1',
      matchId: 'A_B',
      senderUid: 'user-A',
      receiverUid: 'user-B',
    });
    if (m.activityInviteMode === 'duo' && !('sessionId' in m)) ok('sessionId absent OK');
    else fail('unexpected', m);
  }

  section('IE6 — buildDuoInviteMetadata : tous strings (Stripe metadata limit)');
  {
    const m = buildDuoInviteMetadata({
      activityId: 'act-1', matchId: 'A_B', senderUid: 'A', receiverUid: 'B',
    });
    if (Object.values(m).every((v) => typeof v === 'string')) ok('tous strings');
    else fail('valeurs non-string', m);
  }

  // ─── findExpiredInvites ──────────────────────────────────────────────
  const nowMs = Date.now();
  const hours = (h: number) => new Date(nowMs + h * 3600 * 1000);

  section('IE7 — empty messages → empty array');
  {
    if (findExpiredInvites([], nowMs).length === 0) ok('empty');
    else fail('unexpected');
  }

  section('IE8 — non-invite (type=text) → skip');
  {
    const msgs = [{ messageId: 'm1', type: 'text', inviteStatus: 'pending' }];
    if (findExpiredInvites(msgs, nowMs).length === 0) ok('text skip');
    else fail('unexpected');
  }

  section('IE9 — invite accepted → skip');
  {
    const msgs = [{ messageId: 'm1', type: 'activity_invite', inviteStatus: 'accepted', invite: { nextSessionAt: hours(12) } }];
    if (findExpiredInvites(msgs, nowMs).length === 0) ok('accepted skip');
    else fail('unexpected');
  }

  section('IE10 — invite déjà expired → skip');
  {
    const msgs = [{ messageId: 'm1', type: 'activity_invite', inviteStatus: 'expired', invite: { nextSessionAt: hours(12) } }];
    if (findExpiredInvites(msgs, nowMs).length === 0) ok('expired skip');
    else fail('unexpected');
  }

  section('IE11 — pending sans nextSessionAt → skip');
  {
    const msgs = [{ messageId: 'm1', type: 'activity_invite', inviteStatus: 'pending', invite: {} }];
    if (findExpiredInvites(msgs, nowMs).length === 0) ok('no session → skip');
    else fail('unexpected');
  }

  section('IE12 — pending + session dans 48h → skip (window non atteinte)');
  {
    const msgs = [{ messageId: 'm1', type: 'activity_invite', inviteStatus: 'pending', invite: { nextSessionAt: hours(48) } }];
    if (findExpiredInvites(msgs, nowMs).length === 0) ok('48h ahead OK');
    else fail('unexpected');
  }

  section('IE13 — pending + session dans 12h → expire');
  {
    const msgs = [
      { messageId: 'm1', type: 'activity_invite', inviteStatus: 'pending', invite: { nextSessionAt: hours(12) } },
      { messageId: 'm2', type: 'activity_invite', inviteStatus: 'pending', invite: { nextSessionAt: hours(-1) } },
      { messageId: 'm3', type: 'activity_invite', inviteStatus: 'pending', invite: { nextSessionAt: hours(72) } },
    ];
    const expired = findExpiredInvites(msgs, nowMs);
    if (expired.length === 2 && expired.includes('m1') && expired.includes('m2')) {
      ok('m1 + m2 expirés, m3 trop loin');
    } else fail('unexpected', expired);
  }

  console.log(`\n====== Résumé invite-extras ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
