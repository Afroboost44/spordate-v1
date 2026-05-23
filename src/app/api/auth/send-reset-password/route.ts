/**
 * Phase 9.5 hotfix c3 — POST /api/auth/send-reset-password.
 *
 * Comble BUG 1 : Firebase Auth default sender (noreply@spordate-prod.firebaseapp.com)
 * tombait dans SPAM Gmail (mauvaise réputation domaine firebaseapp.com par défaut).
 *
 * Solution : générer le lien Firebase via Admin SDK puis envoyer email via Resend
 * (cohérent template Phase 7+8+9 — branding Spordateur FR + sender vérifié spordateur.com).
 *
 * Pipeline :
 *   1. Validate email (non-empty + format basique)
 *   2. getAuth().generatePasswordResetLink(email, actionCodeSettings)
 *      → si user inexistant : Firebase throw 'auth/user-not-found' → silent 200 (anti-enumeration)
 *   3. sendEmail Resend template 'passwordResetCustom' avec resetUrl + userName
 *   4. Returns 200 OK (silent même si email user introuvable — anti-enumeration security)
 *
 * Note anti-enumeration : si user inexistant, l'API renvoie 200 sans envoyer d'email.
 * Empêche un attaquant de découvrir quels emails sont inscrits via l'API publique.
 *
 * Returns :
 *   200 { ok: true } (toujours — succès OU silent skip user-not-found)
 *   400 { error: 'invalid-input' } si email malformed
 *   500 { error: 'internal' } si Resend OR Firebase Admin throw inattendu
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/sendEmail';
import { getAdminAuthOverride, type AdminAuthLike } from './_internal';
import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/cron/*)
// DI seam pattern dans _internal.ts (Next.js 15 route.ts strict exports).
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminApp: any = null;

async function getAdminAuth(): Promise<AdminAuthLike> {
  const override = getAdminAuthOverride();
  if (override) return override;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  if (!_adminApp) {
    if (getApps().length > 0) {
      _adminApp = getApps()[0];
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      _adminApp = initializeApp({
        credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]),
      });
    } else {
      _adminApp = initializeApp({
        projectId:
          (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim() ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  return getAuth(_adminApp) as unknown as AdminAuthLike;
}

// =====================================================================
// Email regex basique (anti-injection)
// =====================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Phase 9.5 : reset link expire 1h (Firebase default — non override). */
const RESET_LINK_EXPIRES_HOURS = 1;

// =====================================================================
// POST handler
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'email required (valid format)' },
        { status: 400 },
      );
    }

    const auth = await getAdminAuth();

    // Generate Firebase password reset link via Admin SDK.
    // actionCodeSettings : URL de retour après reset (page web app).
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com'
    ).trim();

    let resetUrl: string;
    let userName: string | undefined;
    try {
      resetUrl = await auth.generatePasswordResetLink(email, {
        url: `${baseUrl}/login?reset=success`,
        handleCodeInApp: false,
      });
      // Best-effort lookup user pour personnaliser greeting (silent fail si user-not-found)
      try {
        const user = await auth.getUserByEmail(email);
        userName = user.displayName || undefined;
      } catch {
        userName = undefined;
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code;
      if (code === 'auth/user-not-found') {
        // Anti-enumeration : silent 200 même si user inexistant
        console.info('[/api/auth/send-reset-password] user-not-found (silent)', { email });
        return NextResponse.json({ ok: true }, { status: 200 });
      }
      // Autres erreurs Firebase Admin → 500 (rare en prod après init OK)
      console.error('[/api/auth/send-reset-password] generatePasswordResetLink fatal', err);
      return NextResponse.json(
        { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }

    // Send Resend email avec template branded Spordateur
    const emailResult = await sendEmail({
      to: email,
      templateName: 'passwordResetCustom',
      templateData: {
        userName,
        resetUrl,
        expiresInHours: RESET_LINK_EXPIRES_HOURS,
      },
    });

    if (!emailResult.ok) {
      // Log mais ne fail pas — le user peut retry si email perdu
      console.warn('[/api/auth/send-reset-password] Resend send failed', {
        email,
        error: emailResult.error,
      });
      // Note : on retourne 200 quand-même pour ne pas révéler l'erreur infra à l'attaquant
      // (defense-in-depth anti-enumeration). Le user verra "email envoyé" et peut retry.
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[/api/auth/send-reset-password] unexpected error', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
