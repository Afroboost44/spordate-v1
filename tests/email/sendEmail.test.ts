/**
 * Tests Phase 7 sub-chantier 0 — sendEmail wrapper Resend.
 *
 * Exécution :
 *   npm run test:email
 *   (équivalent : npx tsx tests/email/sendEmail.test.ts)
 *
 * Pas d'emulator Firestore requis — sendEmail ne touche pas Firestore.
 * Mock le Resend client via __setResendForTesting() (test seam dépendance injection).
 *
 * 4 cas couverts :
 *   E1 : RESEND_API_KEY non set → ok=true, loggedOnly=true (graceful degradation)
 *   E2 : RESEND_API_KEY set + mock Resend OK → ok=true, messageId présent, mock.send appelé
 *   E3 : Mock Resend retourne error → ok=false, error string non vide, NO throw
 *   E4 : Template rendering — html contient les fields attendus (banLevel, appealEmail)
 *
 * Pattern test runner : mini-runner cohérent Phase 2/6 (assertEq, section, mainflow).
 */

import { sendEmail, __setResendForTesting } from '../../src/lib/email/sendEmail';
import { renderTemplate } from '../../src/lib/email/templates';

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

function assertContains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    console.log(`PASS  ${label}`);
    _passes++;
  } else {
    console.log(`FAIL  ${label} — needle "${needle}" not found in haystack (${haystack.length} chars)`);
    _failures++;
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Mock Resend client (minimal subset of Resend API surface)
// =====================================================================

interface ResendSendResult {
  data: { id: string } | null;
  error: { message: string; name?: string } | null;
}

function makeMockResend(opts: {
  shouldFail?: boolean;
  messageId?: string;
}): {
  emails: { send: (req: unknown) => Promise<ResendSendResult> };
  __calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    __calls: calls,
    emails: {
      send: async (req: unknown) => {
        calls.push(req);
        if (opts.shouldFail) {
          return { data: null, error: { message: 'mock-resend-failure', name: 'MockError' } };
        }
        return { data: { id: opts.messageId ?? 'mock_msg_xyz' }, error: null };
      },
    },
  };
}

// =====================================================================
// Tests
// =====================================================================

async function main(): Promise<void> {
  section('E1 : RESEND_API_KEY non set → log-only graceful');

  // Sauve l'env actuel + reset
  const originalKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  __setResendForTesting(null);

  {
    // Sub-chantier 6 cleanup : banNotification legacy retiré, on utilise userSanctionNotice
    // (template fonctionnellement équivalent, cohérent data model UserSanction).
    const result = await sendEmail({
      to: 'user@example.com',
      templateName: 'userSanctionNotice',
      templateData: {
        userName: 'Marie',
        level: 'suspension_7d',
        reason: 'reports_threshold',
        endsAtFormatted: '11 mai 2026',
        appealable: true,
        appealEmail: 'contact@spordateur.com',
      },
    });
    assertEq(result.ok, true, 'E1 ok=true (degradation gracieuse)');
    assertEq(result.loggedOnly, true, 'E1 loggedOnly=true (pas envoyé Resend)');
    assertEq(result.messageId, undefined, 'E1 pas de messageId (pas envoyé)');
  }

  // Restore env
  if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;

  section('E2 : Resend OK via mock → ok=true + messageId + mock called');

  {
    process.env.RESEND_API_KEY = 'fake_key_for_test';
    const mock = makeMockResend({ messageId: 'mock_msg_e2' });
    __setResendForTesting(mock as unknown as Parameters<typeof __setResendForTesting>[0]);

    const result = await sendEmail({
      to: 'user@example.com',
      templateName: 'reviewReminder',
      templateData: {
        userName: 'Julien',
        sessionTitle: 'Afroboost Silent Neuchâtel',
        partnerName: 'Afroboost Silent',
        reviewLink: 'https://spordateur.com/review/abc',
        creditsBonus: 5,
      },
    });

    assertEq(result.ok, true, 'E2 ok=true');
    assertEq(result.messageId, 'mock_msg_e2', 'E2 messageId correct');
    assertEq(mock.__calls.length, 1, 'E2 mock.send appelé exactement 1 fois');

    const call = mock.__calls[0] as Record<string, unknown>;
    assertEq(call.to, ['user@example.com'], 'E2 mock recoit to=[email]');
    assertContains(String(call.subject), 'Comment', 'E2 mock recoit subject contient "Comment"');
    assertContains(String(call.html), 'Julien', 'E2 mock recoit html contient userName');
    assertContains(String(call.html), 'spordateur.com/review/abc', 'E2 mock recoit reviewLink dans html');

    __setResendForTesting(null);
  }

  section('E3 : Mock Resend error → ok=false, no throw');

  {
    process.env.RESEND_API_KEY = 'fake_key_for_test';
    const mock = makeMockResend({ shouldFail: true });
    __setResendForTesting(mock as unknown as Parameters<typeof __setResendForTesting>[0]);

    const result = await sendEmail({
      to: 'user@example.com',
      templateName: 'appealAcknowledgment',
      templateData: {
        userName: 'Sandra',
        banLevelLabel: 'Suspension 7 jours',
        receivedAt: '4 mai 2026',
        slaDays: 7,
      },
    });

    assertEq(result.ok, false, 'E3 ok=false');
    assertEq(result.messageId, undefined, 'E3 pas de messageId');
    if (typeof result.error === 'string' && result.error.includes('mock-resend-failure')) {
      console.log('PASS  E3 error string contient "mock-resend-failure"');
      _passes++;
    } else {
      console.log(`FAIL  E3 error string = "${result.error}"`);
      _failures++;
    }

    __setResendForTesting(null);
  }

  section('E4 : Template rendering userSanctionNotice — fields attendus dans html');

  {
    // Sub-chantier 6 cleanup : remplacé banNotification legacy par userSanctionNotice
    // (template Phase 7 actif, cohérent data model UserSanction).
    const { subject, html } = renderTemplate('userSanctionNotice', {
      userName: 'Bassi',
      level: 'ban_permanent',
      reason: 'reports_threshold',
      appealable: true,
      appealEmail: 'contact@spordateur.com',
    });

    assertContains(subject, 'Bannissement permanent', 'E4 subject contient "Bannissement permanent"');
    assertContains(html, 'Bassi', 'E4 html contient userName');
    assertContains(html, 'plusieurs signalements', 'E4 html contient reason label (reports_threshold)');
    assertContains(html, 'contact@spordateur.com', 'E4 html contient appealEmail');
    assertContains(html, '7 jours calendaires', 'E4 html contient SLA appel');
    assertContains(html, '#D91CD2', 'E4 html contient accent color #D91CD2 (charte stricte)');
    assertContains(html, '#000000', 'E4 html contient background #000000 (charte stricte)');
  }

  // =====================================================================
  // Phase 8 SC2 commit 5/6 — leakEscalationAdmin template (EM-LK1-EM-LK3)
  // =====================================================================
  section('EM-LK1 : leakEscalationAdmin template render — fields attendus');
  {
    const { subject, html } = renderTemplate('leakEscalationAdmin', {
      userId: 'user_alice_xyz',
      userName: 'Alice Test',
      chatId: 'match_completed_test',
      leakCount: 5,
      motiveSummary: 'phone-ch×3, ai-leak-likely×2',
      lastFlaggedAt: '2026-05-07T15:00:00Z',
    });
    assertContains(subject, '🚨', 'EM-LK1 subject contient emoji alerte');
    assertContains(subject, 'Anti-leak L4', 'EM-LK1 subject contient "Anti-leak L4"');
    assertContains(subject, 'user_alice_xyz', 'EM-LK1 subject contient userId');
    assertContains(html, 'Alice Test', 'EM-LK1 html contient userName');
    assertContains(html, 'user_alice_xyz', 'EM-LK1 html contient userId');
    assertContains(html, 'match_completed_test', 'EM-LK1 html contient chatId');
    assertContains(html, '5 tentatives', 'EM-LK1 html contient leakCount');
    assertContains(html, 'phone-ch×3', 'EM-LK1 html contient motiveSummary');
    assertContains(html, '2026-05-07T15:00:00Z', 'EM-LK1 html contient lastFlaggedAt ISO');
    assertContains(html, '#D91CD2', 'EM-LK1 html accent color (charte stricte)');
    assertContains(html, 'aiScanLogs/', 'EM-LK1 html contient pointer aiScanLogs (action recommandée)');
    assertContains(html, 'doctrine §B.Q3', 'EM-LK1 html mention doctrine source');
  }

  section('EM-LK2 : leakEscalationAdmin sans userName ni motiveSummary (optional fields)');
  {
    const { subject, html } = renderTemplate('leakEscalationAdmin', {
      userId: 'user_minimal',
      chatId: 'chat_minimal',
      leakCount: 5,
      lastFlaggedAt: '2026-05-07T16:00:00Z',
      // userName + motiveSummary omis (optionnels)
    });
    assertContains(subject, 'user_minimal', 'EM-LK2 subject userId présent');
    assertContains(html, 'user_minimal', 'EM-LK2 html userId présent');
    assertContains(html, 'chat_minimal', 'EM-LK2 html chatId présent');
    // Pas de userName → fallback affiche userId seul (pas de "(undefined)")
    if (html.includes('undefined') || html.includes('(null)')) {
      console.log('FAIL  EM-LK2 html ne doit pas contenir "undefined" ou "(null)" pour fields optionnels');
      _failures++;
    } else {
      console.log('PASS  EM-LK2 html clean sans "undefined"/"(null)" sur fields optionnels');
      _passes++;
    }
  }

  section('EM-LK3 : leakEscalationAdmin via sendEmail end-to-end (mock Resend)');
  {
    process.env.RESEND_API_KEY = 'mock_re_xxx';
    const mockSent: { to?: string; subject?: string } = {};
    __setResendForTesting({
      emails: {
        send: async (opts: { to?: string | string[]; subject?: string }) => {
          mockSent.to = Array.isArray(opts.to) ? opts.to[0] : opts.to;
          mockSent.subject = opts.subject;
          return { data: { id: 'mock_msg_lk3' }, error: null };
        },
      },
    } as never);

    const result = await sendEmail({
      to: 'admin-test@spordateur.com',
      templateName: 'leakEscalationAdmin',
      templateData: {
        userId: 'user_e2e_test',
        userName: 'E2E Test',
        chatId: 'chat_e2e_test',
        leakCount: 5,
        lastFlaggedAt: '2026-05-07T17:00:00Z',
      },
    });
    assertEq(result.ok, true, 'EM-LK3 sendEmail ok=true');
    assertEq(mockSent.to, 'admin-test@spordateur.com', 'EM-LK3 mock Resend send called avec to=admin');
    assertContains(mockSent.subject || '', 'user_e2e_test', 'EM-LK3 subject envoyé contient userId');
  }

  // =====================================================================
  // Cleanup
  // =====================================================================

  delete process.env.RESEND_API_KEY;
  if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
  __setResendForTesting(null);

  console.log('');
  console.log('====== Résumé Email sendEmail wrapper ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
