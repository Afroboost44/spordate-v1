/**
 * Tests Phase 9 sub-chantier 2 commit 2/6 — email templates split + gift.
 *
 * Exécution :
 *   npm run test:invites:email-split-gift
 *
 * Pure render tests (pas d'emulator requis) — vérifie subjects + body content
 * pour les 2 nouveaux templates Phase 9 SC2 c2/6.
 *
 * Couverture (EM-SP1-EM-SP4) :
 *   EM-SP1 renderTemplate('inviteReceivedSplit') subject mentions inviter + activity
 *   EM-SP2 renderTemplate('inviteReceivedSplit') body contient amounts CHF formatés
 *   EM-SP3 renderTemplate('inviteReceivedGift') subject mentions 'cadeau'
 *   EM-SP4 renderTemplate('inviteReceivedGift') body mentions total CHF + 'rien à payer'
 */

import { renderTemplate } from '../../src/lib/email/templates';

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

async function main(): Promise<void> {
  // ===================================================================
  // EM-SP1 inviteReceivedSplit subject mentions inviter + activity
  // ===================================================================
  section('EM-SP1 inviteReceivedSplit subject contains inviter + activity');
  {
    const result = renderTemplate('inviteReceivedSplit', {
      fromUserName: 'Marie',
      toUserName: 'Bob',
      activityTitle: 'Yoga Sunset',
      sessionDate: 'Sam 18 mai · 14h00',
      inviteLink: 'https://spordateur.com/invite/abc123',
      inviterAmountChf: '12.50',
      inviteeAmountChf: '12.50',
      totalAmountChf: '25.00',
    });

    if (result.subject.includes('Marie') && result.subject.includes('Yoga Sunset')) {
      pass('EM-SP1 subject contains "Marie" + "Yoga Sunset"');
    } else {
      fail('EM-SP1 subject', result.subject);
    }
    if (result.subject.toLowerCase().includes('partage') || result.subject.toLowerCase().includes('split')) {
      pass('EM-SP1 subject indique split (partagez/split)');
    } else {
      fail('EM-SP1 subject manque indicateur split', result.subject);
    }
  }

  // ===================================================================
  // EM-SP2 inviteReceivedSplit body contains amounts CHF
  // ===================================================================
  section('EM-SP2 inviteReceivedSplit body contains amounts CHF formatés');
  {
    const result = renderTemplate('inviteReceivedSplit', {
      fromUserName: 'Marie',
      activityTitle: 'Padel',
      sessionDate: 'Sam 18 mai · 14h00',
      inviteLink: 'https://spordateur.com/invite/x',
      inviterAmountChf: '17.50',
      inviteeAmountChf: '7.50',
      totalAmountChf: '25.00',
    });

    if (result.html.includes('17.50') && result.html.includes('7.50') && result.html.includes('25.00')) {
      pass('EM-SP2 body contient inviterAmount + inviteeAmount + totalAmount CHF');
    } else {
      fail('EM-SP2 amounts missing in body', { containsInviter: result.html.includes('17.50'), containsInvitee: result.html.includes('7.50'), containsTotal: result.html.includes('25.00') });
    }
    if (result.html.includes('CHF')) {
      pass('EM-SP2 body contient label CHF');
    } else {
      fail('EM-SP2 CHF missing');
    }
    if (result.html.includes('https://spordateur.com/invite/x')) {
      pass('EM-SP2 body contient inviteLink CTA');
    } else {
      fail('EM-SP2 inviteLink missing');
    }
  }

  // ===================================================================
  // EM-SP3 inviteReceivedGift subject mentions cadeau
  // ===================================================================
  section('EM-SP3 inviteReceivedGift subject mentions "cadeau"');
  {
    const result = renderTemplate('inviteReceivedGift', {
      fromUserName: 'Marie',
      activityTitle: 'Spa & Wellness',
      sessionDate: 'Dim 25 mai · 11h00',
      inviteLink: 'https://spordateur.com/invite/gift1',
      totalAmountChf: '60.00',
    });

    if (result.subject.toLowerCase().includes('cadeau')) {
      pass('EM-SP3 subject contains "cadeau"');
    } else {
      fail('EM-SP3 subject missing cadeau', result.subject);
    }
    if (result.subject.includes('Marie') && result.subject.includes('Spa & Wellness')) {
      pass('EM-SP3 subject mentions inviter + activity');
    } else {
      fail('EM-SP3 subject parts', result.subject);
    }
  }

  // ===================================================================
  // EM-SP4 inviteReceivedGift body mentions total CHF + 'rien à payer'
  // ===================================================================
  section('EM-SP4 inviteReceivedGift body mentions total + "rien à payer"');
  {
    const result = renderTemplate('inviteReceivedGift', {
      fromUserName: 'Marie',
      toUserName: 'Bob',
      activityTitle: 'Massage',
      sessionDate: 'Lun 19 mai · 18h00',
      inviteLink: 'https://spordateur.com/invite/g2',
      totalAmountChf: '75.00',
    });

    if (result.html.includes('75.00')) {
      pass('EM-SP4 body contient totalAmount 75.00');
    } else {
      fail('EM-SP4 totalAmount missing');
    }
    if (result.html.toLowerCase().includes('rien à payer') || result.html.toLowerCase().includes("c'est cadeau")) {
      pass('EM-SP4 body contient mention gratuit (rien à payer / c\'est cadeau)');
    } else {
      fail('EM-SP4 body manque mention gratuité', result.html.slice(0, 500));
    }
    if (result.html.includes('Bob')) {
      pass('EM-SP4 body greeting toUserName "Bob"');
    } else {
      fail('EM-SP4 toUserName missing');
    }
    if (result.html.includes('Marie')) {
      pass('EM-SP4 body mentions inviter Marie');
    } else {
      fail('EM-SP4 fromUserName missing');
    }
  }

  console.log('');
  console.log('====== Résumé Email Split + Gift (EM-SP1-EM-SP4) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
