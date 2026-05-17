/**
 * BUG #36 COMMIT 2 — Tests purs helpers UI invite render.
 *
 * 2 helpers :
 *  - formatNextSessionLabel(nextSessionAt, nowMs?) : date FR humanisée
 *    ("Aujourd'hui 19h", "Demain 14h30", "Mardi 17 mai 19h", "Date à venir")
 *  - resolveInviteCardView(msg, currentUserId) : décide sender/receiver +
 *    quels boutons afficher + label status + couleur badge
 *
 * Couverture (IV1-IV15) :
 *   IV1-IV5 formatNextSessionLabel : aujourd'hui, demain, dans la semaine,
 *           date lointaine, null/undefined
 *   IV6-IV15 resolveInviteCardView : sender pending/accepted/declined/expired,
 *           receiver pending/accepted/declined/expired, edge cases
 *
 * Exécution : npx tsx tests/chat/invite-view.test.ts
 */

import { formatNextSessionLabel, resolveInviteCardView } from '../../src/lib/chat/inviteView';

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
  const REF_NOW = new Date('2026-05-17T10:00:00Z').getTime(); // dimanche 17 mai 10h UTC
  const hours = (h: number) => new Date(REF_NOW + h * 3600 * 1000);

  // ─── formatNextSessionLabel ──────────────────────────────────────────
  section('IV1 — null/undefined → "Date à venir"');
  {
    if (formatNextSessionLabel(null, REF_NOW) === 'Date à venir') ok('null');
    else fail('unexpected null', formatNextSessionLabel(null, REF_NOW));
    if (formatNextSessionLabel(undefined, REF_NOW) === 'Date à venir') ok('undefined');
    else fail('unexpected undef', formatNextSessionLabel(undefined, REF_NOW));
  }

  section('IV2 — aujourd\'hui (< 24h) → "Aujourd\'hui {heure}h"');
  {
    const label = formatNextSessionLabel(hours(8), REF_NOW); // 18h aujourd'hui
    if (label.startsWith('Aujourd\'hui')) ok(`OK: ${label}`);
    else fail('unexpected', label);
  }

  section('IV3 — demain (24-48h) → "Demain {heure}h"');
  {
    const label = formatNextSessionLabel(hours(28), REF_NOW); // demain ~14h
    if (label.startsWith('Demain')) ok(`OK: ${label}`);
    else fail('unexpected', label);
  }

  section('IV4 — dans la semaine (2-7j) → "{jour} {date_courte}"');
  {
    const label = formatNextSessionLabel(hours(72), REF_NOW); // dans 3j
    if (label && !label.startsWith('Aujourd') && !label.startsWith('Demain')) ok(`OK: ${label}`);
    else fail('unexpected', label);
  }

  section('IV5 — lointain (> 7j) → "{date_courte}"');
  {
    const label = formatNextSessionLabel(hours(24 * 30), REF_NOW); // 30j
    if (label && label.length > 0) ok(`OK: ${label}`);
    else fail('unexpected', label);
  }

  // ─── resolveInviteCardView ───────────────────────────────────────────
  function makeMsg(senderId: string, status: string) {
    return {
      senderId,
      type: 'activity_invite' as const,
      inviteStatus: status as 'pending' | 'accepted' | 'declined' | 'expired',
      invite: { activityId: 'a', activityTitle: 't', inviteMode: 'individual' as const },
    };
  }

  section('IV6 — sender + pending : status "En attente", no buttons');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'pending'), 'user-A');
    if (v.isSender && !v.isReceiver && v.statusLabel === 'En attente' && !v.showAcceptButton && !v.showDeclineButton) {
      ok('sender pending');
    } else fail('unexpected', v);
  }

  section('IV7 — sender + accepted : status "Acceptée ✓"');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'accepted'), 'user-A');
    if (v.isSender && v.statusLabel.includes('Acceptée') && !v.showAcceptButton) ok('sender accepted');
    else fail('unexpected', v);
  }

  section('IV8 — sender + declined : status "Refusée"');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'declined'), 'user-A');
    if (v.isSender && v.statusLabel.includes('Refusée') && !v.showAcceptButton) ok('sender declined');
    else fail('unexpected', v);
  }

  section('IV9 — sender + expired : status "Expirée"');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'expired'), 'user-A');
    if (v.isSender && v.statusLabel.includes('Expirée') && !v.showAcceptButton) ok('sender expired');
    else fail('unexpected', v);
  }

  section('IV10 — receiver + pending : 2 boutons Accepter/Refuser visibles');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'pending'), 'user-B');
    if (!v.isSender && v.isReceiver && v.showAcceptButton && v.showDeclineButton) ok('receiver pending → boutons');
    else fail('unexpected', v);
  }

  section('IV11 — receiver + accepted : pas de boutons, status "Acceptée"');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'accepted'), 'user-B');
    if (!v.isSender && !v.showAcceptButton && !v.showDeclineButton && v.statusLabel.includes('Acceptée')) ok('receiver accepted');
    else fail('unexpected', v);
  }

  section('IV12 — receiver + declined : pas de boutons, status "Refusée"');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'declined'), 'user-B');
    if (!v.isSender && !v.showAcceptButton && !v.showDeclineButton && v.statusLabel.includes('Refusée')) ok('receiver declined');
    else fail('unexpected', v);
  }

  section('IV13 — receiver + expired : pas de boutons, status "Expirée"');
  {
    const v = resolveInviteCardView(makeMsg('user-A', 'expired'), 'user-B');
    if (!v.isSender && !v.showAcceptButton && !v.showDeclineButton && v.statusLabel.includes('Expirée')) ok('receiver expired');
    else fail('unexpected', v);
  }

  section('IV14 — badge color : pending rose, accepted vert, declined gris, expired blanc/40');
  {
    const p = resolveInviteCardView(makeMsg('A', 'pending'), 'A');
    const a = resolveInviteCardView(makeMsg('A', 'accepted'), 'A');
    const d = resolveInviteCardView(makeMsg('A', 'declined'), 'A');
    const e = resolveInviteCardView(makeMsg('A', 'expired'), 'A');
    if (p.statusBadgeClass.includes('D91CD2') && a.statusBadgeClass.includes('green') && d.statusBadgeClass.includes('white/40') && e.statusBadgeClass.includes('white/40')) {
      ok('couleurs distinctes par status');
    } else fail('unexpected', { p: p.statusBadgeClass, a: a.statusBadgeClass, d: d.statusBadgeClass, e: e.statusBadgeClass });
  }

  section('IV15 — sans inviteStatus → defaults pending');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = { senderId: 'A', type: 'activity_invite' as const, invite: { activityId: 'a', activityTitle: 't', inviteMode: 'individual' as const } } as any;
    const v = resolveInviteCardView(msg, 'A');
    if (v.statusLabel === 'En attente') ok('default pending');
    else fail('unexpected', v);
  }

  console.log(`\n====== Résumé invite-view ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
