import { Resend } from 'resend';

// Base URL for emails - use environment variable or fallback to production
const getBaseUrl = () => process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';

// Initialize Resend client
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not configured - emails will be logged only');
    return null;
  }
  return new Resend(apiKey);
};

// Sender email - use Resend's test domain or your verified domain
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'Spordateur <onboarding@resend.dev>';

/**
 * Email template for booking confirmation to customer
 */
function getBookingConfirmationTemplate(data: {
  customerName: string;
  profileName: string;
  partnerName: string;
  partnerAddress?: string;
  ticketType: 'Solo' | 'Duo';
  amount: number;
  bookingId: string;
}): string {
  const ticketEmoji = data.ticketType === 'Duo' ? '👥' : '🎟️';
  const ticketLabel = data.ticketType === 'Duo' ? '2 places' : '1 place';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="500" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(139, 92, 246, 0.3);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 30px 30px 20px; text-align: center; background: linear-gradient(135deg, #7B1FA2 0%, #E91E63 100%);">
              <h1 style="margin: 0; color: white; font-size: 24px;">🎉 Ton ticket est prêt !</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="color: #e2e8f0; font-size: 16px; margin: 0 0 20px;">
                Salut ${data.customerName},
              </p>
              <p style="color: #a0aec0; font-size: 14px; margin: 0 0 25px;">
                Ta réservation avec <strong style="color: #e2e8f0;">${data.profileName}</strong> est confirmée !
              </p>

              <!-- Ticket Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                          <span style="color: #a0aec0; font-size: 12px;">TYPE</span><br>
                          <span style="color: white; font-size: 16px;">${ticketEmoji} ${data.ticketType} (${ticketLabel})</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                          <span style="color: #a0aec0; font-size: 12px;">PARTENAIRE</span><br>
                          <span style="color: white; font-size: 16px;">🏋️ ${data.profileName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                          <span style="color: #a0aec0; font-size: 12px;">LIEU</span><br>
                          <span style="color: white; font-size: 16px;">📍 ${data.partnerName}</span>
                          ${data.partnerAddress ? `<br><span style="color: #a0aec0; font-size: 12px;">${data.partnerAddress}</span>` : ''}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #a0aec0; font-size: 12px;">MONTANT PAYÉ</span><br>
                          <span style="color: #48bb78; font-size: 20px; font-weight: bold;">${data.amount}€</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 25px;">
                <tr>
                  <td align="center">
                    <a href="${getBaseUrl()}/discovery" style="display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #7B1FA2 0%, #E91E63 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                      Voir mes réservations
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #64748b; font-size: 12px; margin: 25px 0 0; text-align: center;">
                Réf: ${data.bookingId.slice(0, 20)}...
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background: rgba(0,0,0,0.3); text-align: center;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">
                © 2026 Spordateur - La communauté sportive
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Email template for partner notification
 */
function getPartnerNotificationTemplate(data: {
  partnerName: string;
  customerEmail: string;
  ticketType: 'Solo' | 'Duo';
  amount: number;
  bookingId: string;
}): string {
  const places = data.ticketType === 'Duo' ? '2 personnes' : '1 personne';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="500" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(139, 92, 246, 0.3);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 30px 30px 20px; text-align: center; background: linear-gradient(135deg, #059669 0%, #10b981 100%);">
              <h1 style="margin: 0; color: white; font-size: 24px;">🎯 Nouveau rendez-vous sportif !</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="color: #e2e8f0; font-size: 16px; margin: 0 0 20px;">
                Bonjour ${data.partnerName},
              </p>
              <p style="color: #a0aec0; font-size: 14px; margin: 0 0 25px;">
                Une nouvelle réservation vient d'être confirmée pour votre établissement !
              </p>

              <!-- Booking Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                          <span style="color: #a0aec0; font-size: 12px;">CLIENT</span><br>
                          <span style="color: white; font-size: 16px;">👤 ${data.customerEmail}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                          <span style="color: #a0aec0; font-size: 12px;">TYPE DE TICKET</span><br>
                          <span style="color: white; font-size: 16px;">🎟️ ${data.ticketType} (${places})</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #a0aec0; font-size: 12px;">COMMISSION REÇUE</span><br>
                          <span style="color: #48bb78; font-size: 20px; font-weight: bold;">${(data.amount * 0.8).toFixed(2)}€</span>
                          <span style="color: #64748b; font-size: 12px;"> (80% de ${data.amount}€)</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 25px;">
                <tr>
                  <td align="center">
                    <a href="${getBaseUrl()}/admin/dashboard" style="display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                      Voir mon tableau de bord
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #64748b; font-size: 12px; margin: 25px 0 0; text-align: center;">
                Réf: ${data.bookingId.slice(0, 20)}...
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background: rgba(0,0,0,0.3); text-align: center;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">
                © 2026 Spordateur - Partenaires
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send booking confirmation email to customer
 */
export async function sendBookingConfirmationEmail(data: {
  to: string;
  customerName: string;
  profileName: string;
  partnerName: string;
  partnerAddress?: string;
  ticketType: 'Solo' | 'Duo';
  amount: number;
  bookingId: string;
}): Promise<boolean> {
  const resend = getResend();
  
  const subject = `🎟️ Ton ticket pour ${data.partnerName} est prêt !`;
  const html = getBookingConfirmationTemplate(data);

  // Log email content
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📧 EMAIL CONFIRMATION CLIENT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📬 À: ${data.to}`);
  console.log(`📝 Sujet: ${subject}`);
  console.log(`🎟️ Ticket: ${data.ticketType} - ${data.amount}€`);
  console.log(`📍 Lieu: ${data.partnerName}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!resend) {
    console.log('[Email] Resend not configured - email logged only');
    return true;
  }

  try {
    const result = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [data.to],
      subject,
      html,
    });

    console.log('[Email] Confirmation sent:', result);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send confirmation:', error);
    return false;
  }
}

/**
 * Send notification email to partner
 */
export async function sendPartnerNotificationEmail(data: {
  partnerName: string;
  partnerEmail?: string;
  customerEmail: string;
  ticketType: 'Solo' | 'Duo';
  amount: number;
  bookingId: string;
}): Promise<boolean> {
  const resend = getResend();
  
  const subject = `🎯 Nouveau RDV sportif confirmé - ${data.ticketType}`;
  const html = getPartnerNotificationTemplate(data);

  // Log email content
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📧 EMAIL NOTIFICATION PARTENAIRE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📬 Partenaire: ${data.partnerName}`);
  console.log(`📝 Sujet: ${subject}`);
  console.log(`👤 Client: ${data.customerEmail}`);
  console.log(`🎟️ Ticket: ${data.ticketType} - ${data.amount}€`);
  console.log(`💰 Commission: ${(data.amount * 0.8).toFixed(2)}€`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!resend || !data.partnerEmail) {
    console.log('[Email] Resend not configured or no partner email - notification logged only');
    return true;
  }

  try {
    const result = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [data.partnerEmail],
      subject,
      html,
    });

    console.log('[Email] Partner notification sent:', result);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send partner notification:', error);
    return false;
  }
}
