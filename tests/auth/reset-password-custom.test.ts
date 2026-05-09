/**
 * Tests Phase 9.5 hotfix c3 — POST /api/auth/send-reset-password.
 *
 * Exécution :
 *   npm run test:auth:reset-password-custom
 *
 * Pattern : pure unit (no emulator) + mock Resend + mock Admin Auth via DI seam
 * (cohérent verifyAuth Phase 8 SC4 + sharedStripe Phase 9 SC2 c3 patterns).
 *
 * Couverture (PR1-PR4 + bonus) :
 *   PR1 happy : email valide → endpoint 200 + Resend mock called avec template passwordResetCustom + lien Firebase
 *   PR2 email invalide → 400 invalid-input
 *   PR3 user inexistant → endpoint 200 silent (anti-enumeration security)
 *   PR4 Resend fail → 200 (anti-enumeration defense-in-depth)
 *
 * Bonus :
 *   - userName personnalisé si Firebase getUserByEmail returns displayName
 *   - HTML contient mention "expire dans 1h"
 *   - Empty body → 400 invalid-input
 */

import { Resend } from 'resend';
import { __setResendForTesting } from '../../src/lib/email/sendEmail';
import { POST as POSTSendReset } from '../../src/app/api/auth/send-reset-password/route';
import { __setAdminAuthForTesting } from '../../src/app/api/auth/send-reset-password/_internal';

// =====================================================================
// Mock Admin Auth (DI seam)
// =====================================================================

const mockAdminAuth = {
  generatePasswordResetLink: async (email: string): Promise<string> => {
    if (email === 'unknown@test.local') {
      const err: Error & { code?: string } = new Error('user-not-found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return `https://spordate-prod.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=mock_${email}`;
  },
  getUserByEmail: async (email: string) => {
    if (email === 'displayname@test.local') {
      return { displayName: 'Marie Test' };
    }
    return { displayName: null };
  },
};

// =====================================================================
// Mock Resend
// =====================================================================

interface MockSendCall {
  to: string[];
  from: string;
  subject: string;
  html: string;
  templateUsed?: string;
}

class MockResend {
  public sendCalls: MockSendCall[] = [];
  public failNext = false;

  emails = {
    send: async (args: {
      to: string[];
      from: string;
      subject: string;
      html: string;
    }): Promise<{ data: { id: string } | null; error: { message: string } | null }> => {
      if (this.failNext) {
        this.failNext = false;
        return { data: null, error: { message: 'Mock Resend failure' } };
      }
      const templateUsed = args.subject.includes('Réinitialise')
        ? 'passwordResetCustom'
        : 'unknown';
      this.sendCalls.push({ ...args, templateUsed });
      return { data: { id: `mock_re_${this.sendCalls.length}` }, error: null };
    },
  };

  reset(): void {
    this.sendCalls = [];
    this.failNext = false;
  }
}

const mockResend = new MockResend();

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

async function callApi(body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const req = new Request('http://localhost/api/auth/send-reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTSendReset(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  // Wire DI seams
  __setAdminAuthForTesting(mockAdminAuth);
  __setResendForTesting(mockResend as unknown as Resend);

  // ===================================================================
  // PR1 : happy path → 200 + Resend called + Firebase link
  // ===================================================================
  section('PR1 happy path : email valide → 200 + Resend template passwordResetCustom + Firebase link');
  mockResend.reset();
  {
    const res = await callApi({ email: 'alice@test.local' });
    if (res.status === 200 && res.body?.ok === true) {
      pass('PR1 endpoint 200 ok=true');
    } else {
      fail('PR1 expected 200 ok=true', res);
    }
    if (mockResend.sendCalls.length === 1) {
      pass('PR1 Resend sendCalls.length=1');
    } else {
      fail('PR1 should send 1 email', { count: mockResend.sendCalls.length });
    }
    const sent = mockResend.sendCalls[0];
    if (sent && sent.to.includes('alice@test.local')) {
      pass('PR1 Resend to=alice@test.local');
    } else {
      fail('PR1 Resend to mismatch', sent);
    }
    if (sent && sent.templateUsed === 'passwordResetCustom') {
      pass('PR1 template = passwordResetCustom (subject "Réinitialise")');
    } else {
      fail('PR1 template mismatch', sent);
    }
    if (
      sent &&
      sent.html.includes(
        'https://spordate-prod.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=mock_alice@test.local',
      )
    ) {
      pass('PR1 HTML contient lien Firebase valide (oobCode + URL Firebase)');
    } else {
      fail('PR1 HTML missing Firebase reset link', { html: sent?.html?.slice(0, 200) });
    }
    if (sent && sent.html.includes('expire dans')) {
      pass('PR1 HTML contient mention expiration "expire dans 1h"');
    } else {
      fail('PR1 HTML missing expiration text', sent);
    }
  }

  // ===================================================================
  // PR2 : email invalide → 400 invalid-input
  // ===================================================================
  section('PR2 email invalide → 400 invalid-input');
  mockResend.reset();
  {
    const r1 = await callApi({ email: 'not-an-email' });
    if (r1.status === 400 && r1.body?.error === 'invalid-input') {
      pass('PR2 not-an-email → 400 invalid-input');
    } else {
      fail('PR2 should be 400 invalid-input', r1);
    }
    const r2 = await callApi({ email: '' });
    if (r2.status === 400) {
      pass('PR2 empty email → 400');
    } else {
      fail('PR2 empty should be 400', r2);
    }
    const r3 = await callApi({});
    if (r3.status === 400) {
      pass('PR2 no email key → 400');
    } else {
      fail('PR2 no key should be 400', r3);
    }
    if (mockResend.sendCalls.length === 0) {
      pass('PR2 zero Resend calls (validation block avant Firebase + Resend)');
    } else {
      fail('PR2 should not call Resend', { count: mockResend.sendCalls.length });
    }
  }

  // ===================================================================
  // PR3 : user inexistant → 200 silent (anti-enumeration)
  // ===================================================================
  section('PR3 user inexistant → 200 silent (anti-enumeration security)');
  mockResend.reset();
  {
    const res = await callApi({ email: 'unknown@test.local' });
    if (res.status === 200 && res.body?.ok === true) {
      pass('PR3 unknown user → 200 ok=true (silent, anti-enumeration)');
    } else {
      fail('PR3 should be 200 silent', res);
    }
    if (mockResend.sendCalls.length === 0) {
      pass('PR3 zero Resend calls (skip silent — pas de leak existence email)');
    } else {
      fail('PR3 should not call Resend for unknown user', mockResend.sendCalls);
    }
  }

  // ===================================================================
  // PR4 : Resend fail → 200 (anti-enumeration defense-in-depth)
  // ===================================================================
  section('PR4 Resend fail → 200 (anti-enumeration defense-in-depth)');
  mockResend.reset();
  mockResend.failNext = true;
  {
    const res = await callApi({ email: 'alice@test.local' });
    if (res.status === 200 && res.body?.ok === true) {
      pass('PR4 Resend fail → 200 ok=true (defense-in-depth anti-enumeration)');
    } else {
      fail('PR4 should be 200 even if Resend fail', res);
    }
  }

  // ===================================================================
  // Bonus : userName personnalisé si Firebase getUserByEmail returns displayName
  // ===================================================================
  section('Bonus userName personnalisé via Firebase getUserByEmail');
  mockResend.reset();
  {
    const res = await callApi({ email: 'displayname@test.local' });
    if (res.status === 200) {
      pass('Bonus displayname email → 200');
    } else {
      fail('Bonus should be 200', res);
    }
    const sent = mockResend.sendCalls[0];
    if (sent && sent.html.includes('Salut Marie Test')) {
      pass('Bonus HTML contient greeting personnalisé "Salut Marie Test"');
    } else {
      fail('Bonus userName should be in HTML', { html: sent?.html?.slice(0, 300) });
    }
  }

  // ===================================================================
  // Bonus : displayName absent → fallback greeting "Salut !"
  // ===================================================================
  section('Bonus displayName absent → fallback greeting générique');
  mockResend.reset();
  {
    await callApi({ email: 'alice@test.local' });
    const sent = mockResend.sendCalls[0];
    if (sent && sent.html.includes('Salut !')) {
      pass('Bonus fallback "Salut !" si displayName null');
    } else {
      fail('Bonus fallback greeting missing', { html: sent?.html?.slice(0, 300) });
    }
  }

  // Cleanup
  __setResendForTesting(null);
  __setAdminAuthForTesting(null);

  console.log('');
  console.log('====== Résumé Reset Password Custom (PR1-PR4 + bonus) ======');
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
