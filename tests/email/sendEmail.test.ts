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
