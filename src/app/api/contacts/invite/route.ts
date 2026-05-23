/**
 * BUG #86 — POST /api/contacts/invite
 *
 * Envoie un email d'invitation à un contact pour qu'il rejoigne Spordateur,
 * avec le lien de parrainage de l'utilisateur. Lit users/{uid} pour récupérer
 * le referralCode + displayName puis appelle sendEmail (Resend).
 *
 * Body : { identifier: string; type: 'email' | 'phone'; name?: string }
 *
 * Pour les SMS (type='phone'), on log seulement en attente d'intégration
 * Twilio/SMSAPI ultérieure. L'email reste l'unique canal actif aujourd'hui.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const identifier = (body?.identifier as string | undefined)?.trim() || '';
    const type = body?.type as 'email' | 'phone' | undefined;
    const name = (body?.name as string | undefined)?.trim() || '';

    if (!identifier || !type) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'identifier and type required' },
        { status: 400 },
      );
    }

    // Lit le profil de l'envoyeur (referralCode + displayName)
    const db = await getAdminDb();
    const senderSnap = await db.collection('users').doc(uid).get();
    if (!senderSnap.exists) {
      return NextResponse.json({ error: 'sender-not-found' }, { status: 404 });
    }
    const sender = senderSnap.data() || {};
    const senderName = (sender.displayName as string | undefined) || 'Un ami';
    const referralCode = (sender.referralCode as string | undefined) || uid;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    const inviteUrl = `${baseUrl}/signup?ref=${encodeURIComponent(referralCode)}`;

    if (type === 'phone') {
      // Pas d'intégration SMS active aujourd'hui. On log et on retourne ok=true
      // pour ne pas bloquer l'UX (le contact restera en 'pending').
      console.log(`[contacts/invite] SMS placeholder pour ${identifier} (provider non configuré)`);
      return NextResponse.json({
        ok: true,
        channel: 'sms',
        deferred: true,
        detail: 'SMS provider non configuré, contact marqué pending. Le lien est : ' + inviteUrl,
      });
    }

    // Email via Resend
    const greet = name ? name : 'Salut';
    const subject = `${senderName} t'invite sur Spordateur 🎯`;
    const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background-color: #fafafa; padding: 40px 16px; margin: 0;">
        <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <h1 style="font-size: 22px; font-weight: 600; color: #111; margin: 0 0 16px;">
            ${greet}, ${senderName} pense à toi 🎯
          </h1>
          <p style="font-size: 15px; line-height: 1.6; color: #444; margin: 0 0 20px;">
            Spordateur, c'est le réseau qui connecte les gens autour du sport en Suisse :
            cours collectifs, dates sportives et rencontres autour d'activités locales.
          </p>
          <p style="font-size: 15px; line-height: 1.6; color: #444; margin: 0 0 24px;">
            Rejoins ${senderName} via ce lien d'invitation et essaye l'app :
          </p>
          <p style="text-align: center; margin: 32px 0;">
            <a
              href="${inviteUrl}"
              style="display: inline-block; background-color: #D91CD2; color: #fff; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px;"
            >
              Rejoindre Spordateur
            </a>
          </p>
          <p style="font-size: 12px; color: #888; line-height: 1.5; margin: 20px 0 0;">
            Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br />
            <a href="${inviteUrl}" style="color: #D91CD2; word-break: break-all;">${inviteUrl}</a>
          </p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 28px 0 16px;" />
          <p style="font-size: 11px; color: #aaa; line-height: 1.5; text-align: center; margin: 0;">
            Tu reçois cet email parce que ${senderName} a entré ton adresse dans son
            carnet d'invitations Spordateur. Si tu ne veux pas être recontacté,
            écris à <a href="mailto:contact@spordateur.com" style="color: #D91CD2;">contact@spordateur.com</a>.
          </p>
        </div>
      </body>
      </html>
    `;
    const text = `${greet}, ${senderName} t'invite à rejoindre Spordateur (réseau sportif suisse). Inscription via ce lien : ${inviteUrl}`;

    // Envoi via Resend (API directe, contournement du système de templates
    // typés qui ne supporte pas cette nouvelle invitation custom). Si la
    // RESEND_API_KEY est absente (dev mode) → on log et retourne ok=true.
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log(`[contacts/invite] RESEND_API_KEY absente — logged only`);
      console.log(`  to=${identifier} subject="${subject}" inviteUrl=${inviteUrl}`);
      return NextResponse.json({
        ok: true,
        channel: 'email',
        loggedOnly: true,
        inviteUrl,
      });
    }
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey);
      const sender = process.env.SENDER_EMAIL || 'Spordateur <noreply@spordateur.com>';
      const result = await resend.emails.send({
        from: sender,
        to: identifier,
        subject,
        html,
        text,
      });
      if (result.error) {
        return NextResponse.json(
          { error: 'send-failed', detail: String(result.error) },
          { status: 500 },
        );
      }
      return NextResponse.json({
        ok: true,
        channel: 'email',
        messageId: result.data?.id,
        inviteUrl,
      });
    } catch (err) {
      console.error('[contacts/invite] Resend error', err);
      return NextResponse.json(
        { error: 'send-failed', detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[/api/contacts/invite]', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
