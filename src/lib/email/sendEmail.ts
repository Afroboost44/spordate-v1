/**
 * Spordateur — Phase 7 sub-chantier 0
 * Wrapper Resend pour transactional emails (T&S notifications, booking confirmations, etc.).
 *
 * Server-only — n'expose AUCUN secret côté client (n'import depuis client components).
 *
 * Graceful degradation :
 * - Si RESEND_API_KEY absent → log only, retourne ok=true + loggedOnly=true (dev mode)
 * - Si Resend API throw → catch, log erreur, retourne ok=false + error string (jamais throw)
 * - Permet de coder le flow ban/review sans bloquer si infra email pas encore configurée
 *
 * Usage Phase 7 sub-chantier 5+ :
 *   import { sendEmail } from '@/lib/email/sendEmail';
 *
 *   const result = await sendEmail({
 *     to: 'user@example.com',
 *     templateName: 'banNotification',
 *     templateData: {
 *       userName: 'Marie',
 *       banLevel: 'suspension_7j',
 *       categoryLabel: 'Harcèlement',
 *       expiresAt: '11 mai 2026',
 *       appealEmail: 'contact@spordateur.com',
 *       appealSlaDays: 7,
 *     },
 *   });
 *
 *   if (!result.ok) {
 *     // Log + admin alert (Phase 8 polish observability)
 *   }
 *
 * Test seam : __setResendForTesting(mockInstance) — utilisé par tests/email/sendEmail.test.ts
 * pour injecter un mock Resend client (cohérent pattern __setSessionsDbForTesting Phase 2).
 *
 * Cf. architecture.md §9.sexies pour la doctrine T&S.
 */

import { Resend } from 'resend';
import { renderTemplate, type TemplateDataMap, type TemplateName } from './templates';

const SENDER = process.env.SENDER_EMAIL || 'Spordateur <noreply@spordateur.com>';

// =====================================================================
// Types
// =====================================================================

export interface SendEmailOptions<T extends TemplateName> {
  to: string | string[];
  templateName: T;
  templateData: TemplateDataMap[T];
  /** Optionnel : override sender (rarement utile, surtout tests). */
  from?: string;
  /** Optionnel : reply-to (défaut SENDER). */
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Resend message ID si envoyé avec succès. */
  messageId?: string;
  /** Description erreur si ok=false. */
  error?: string;
  /** True si pas envoyé pour cause de RESEND_API_KEY absent (dev mode log-only). */
  loggedOnly?: boolean;
}

// =====================================================================
// Resend client (lazy init + test seam)
// =====================================================================

let _resend: Resend | null = null;
let _testOverride: Resend | null = null;

/**
 * Test seam : injecte un mock Resend client pour les tests unitaires.
 * Pattern cohérent avec __setSessionsDbForTesting() (services/firestore.ts).
 *
 * Usage tests :
 *   __setResendForTesting(mockResendInstance);
 *   await sendEmail(...);
 *   __setResendForTesting(null);  // reset après le test
 */
export function __setResendForTesting(mock: Resend | null): void {
  _testOverride = mock;
}

function getResend(): Resend | null {
  if (_testOverride) return _testOverride;
  if (_resend) return _resend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  _resend = new Resend(apiKey);
  return _resend;
}

// =====================================================================
// sendEmail (public API)
// =====================================================================

export async function sendEmail<T extends TemplateName>(
  opts: SendEmailOptions<T>,
): Promise<SendEmailResult> {
  // 1. Render template (type-safe dispatch)
  let rendered: { subject: string; html: string };
  try {
    rendered = renderTemplate(opts.templateName, opts.templateData);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[sendEmail] Template render failed', {
      templateName: opts.templateName,
      error,
    });
    return { ok: false, error: `template-render-failed: ${error}` };
  }

  // 2. Get Resend client (with graceful degradation)
  const resend = getResend();
  const sender = opts.from ?? SENDER;
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];

  if (!resend) {
    // Dev mode — log only, return ok=true to not block the flow
    console.log('[sendEmail] RESEND_API_KEY not configured — log-only mode', {
      to: recipients,
      from: sender,
      subject: rendered.subject,
      templateName: opts.templateName,
    });
    return { ok: true, loggedOnly: true };
  }

  // 3. Send via Resend
  try {
    const result = await resend.emails.send({
      from: sender,
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });

    // Resend SDK v6 returns { data: { id }, error: null } on success or { data: null, error } on failure
    if (result.error) {
      const error = JSON.stringify(result.error);
      console.error('[sendEmail] Resend API error', {
        templateName: opts.templateName,
        to: recipients,
        error,
      });
      return { ok: false, error: `resend-api-error: ${error}` };
    }

    const messageId = result.data?.id;
    console.log('[sendEmail] Sent', {
      templateName: opts.templateName,
      to: recipients,
      messageId,
    });
    return { ok: true, messageId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[sendEmail] Unexpected error', {
      templateName: opts.templateName,
      to: recipients,
      error,
    });
    return { ok: false, error: `send-throw: ${error}` };
  }
}
