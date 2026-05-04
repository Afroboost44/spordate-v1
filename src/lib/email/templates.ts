/**
 * Spordateur — Phase 7 sub-chantier 0
 * Templates email transactional Phase 7 — wrapper renderTemplate() type-safe.
 *
 * Charte stricte (cohérent UI Phase 5) :
 * - Background black (#000000)
 * - Accent #D91CD2
 * - Text white (full / 70% / 40% selon hiérarchie)
 * - Pas de gradient (refonte vs templates legacy.ts qui utilisaient violet/rose)
 * - Email-safe HTML (table-based layout, inline styles, pas de CSS Grid/Flexbox)
 *
 * Phase 7 sub-chantier 5 ajoutera la wiring (ban handler appelle sendEmail
 * avec banNotification, etc.). Sub-chantier 0 ne fait que poser la fondation.
 *
 * Cf. architecture.md §9.sexies pour la doctrine T&S complète.
 */

// =====================================================================
// Type registry
// =====================================================================

export type TemplateName =
  | 'bookingConfirmation' // existing flow Stripe webhook (refactor depuis legacy.ts)
  | 'banNotification' // T&S — warning / suspension_7j / suspension_30j / permanent
  | 'reviewReminder' // T&S — push 48h post-session
  | 'appealAcknowledgment'; // T&S — confirme reception appel SLA 7j

export type BanLevel = 'warning' | 'suspension_7j' | 'suspension_30j' | 'permanent';

export interface TemplateDataMap {
  bookingConfirmation: {
    customerName: string;
    sessionTitle: string;
    partnerName: string;
    sessionDate: string; // formatted FR (ex: 'Mardi 14 mai à 17h00')
    amount: number; // CHF (display value, ex: 35)
    bookingId: string;
  };
  banNotification: {
    userName: string;
    banLevel: BanLevel;
    categoryLabel: string; // ex: 'Harcèlement', 'Comportement agressif'
    expiresAt?: string; // formatted FR (sauf permanent où omis)
    appealEmail: string; // 'contact@spordateur.com'
    appealSlaDays: number; // 7
  };
  reviewReminder: {
    userName: string;
    sessionTitle: string;
    partnerName: string;
    reviewLink: string; // URL deep link
    creditsBonus: number; // 5
  };
  appealAcknowledgment: {
    userName: string;
    banLevelLabel: string; // ex: 'Suspension 7 jours'
    receivedAt: string; // ISO ou formatted FR
    slaDays: number; // 7
  };
}

// =====================================================================
// Layout shared (HTML email-safe table-based)
// =====================================================================

function layout(opts: { headerBadgeText: string; bodyHtml: string; footerNote?: string }): string {
  const footer = opts.footerNote ?? '© 2026 Spordateur — contact@spordateur.com';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#000000;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:0 0 24px 0;">
          <span style="display:inline-block;padding:6px 12px;background-color:#D91CD2;color:#000000;font-weight:500;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;border-radius:4px;">${opts.headerBadgeText}</span>
        </td></tr>
        <tr><td style="padding:0;">
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="padding:32px 0 0 0;border-top:1px solid rgba(255,255,255,0.1);margin-top:32px;">
          <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:24px 0 0 0;text-align:center;font-weight:300;">
            ${footer}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function h1(text: string): string {
  return `<h1 style="color:#ffffff;font-size:24px;font-weight:300;margin:0 0 16px 0;line-height:1.3;">${text}</h1>`;
}
function p(text: string, opacity: '100' | '70' | '40' = '70'): string {
  const color = opacity === '100' ? '#ffffff' : opacity === '70' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)';
  return `<p style="color:${color};font-size:14px;line-height:1.6;margin:0 0 12px 0;font-weight:300;">${text}</p>`;
}
function ctaButton(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;"><tr><td>
    <a href="${href}" style="display:inline-block;padding:12px 24px;background-color:#D91CD2;color:#000000;text-decoration:none;font-weight:500;font-size:14px;border-radius:8px;">${label}</a>
  </td></tr></table>`;
}

// =====================================================================
// Templates (4)
// =====================================================================

const BAN_LEVEL_LABELS: Record<BanLevel, string> = {
  warning: 'Avertissement',
  suspension_7j: 'Suspension 7 jours',
  suspension_30j: 'Suspension 30 jours',
  permanent: 'Bannissement permanent',
};

function renderBookingConfirmation(d: TemplateDataMap['bookingConfirmation']) {
  const subject = `Réservation confirmée — ${d.sessionTitle}`;
  const body = `
    ${h1(`Bonjour ${d.customerName}`)}
    ${p(`Ta réservation pour <strong style="color:#ffffff;">${d.sessionTitle}</strong> est confirmée.`)}
    ${p(`<strong style="color:#ffffff;">Quand</strong> : ${d.sessionDate}`)}
    ${p(`<strong style="color:#ffffff;">Où</strong> : ${d.partnerName}`)}
    ${p(`<strong style="color:#ffffff;">Montant</strong> : ${d.amount} CHF`)}
    ${p(`Référence : ${d.bookingId}`, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: 'Réservation', bodyHtml: body }) };
}

function renderBanNotification(d: TemplateDataMap['banNotification']) {
  const levelLabel = BAN_LEVEL_LABELS[d.banLevel];
  const subject = `${levelLabel} — Spordateur`;
  const expirationLine =
    d.expiresAt && d.banLevel !== 'permanent'
      ? p(`<strong style="color:#ffffff;">Fin de la sanction</strong> : ${d.expiresAt}`)
      : d.banLevel === 'permanent'
        ? p(`Cette mesure est <strong style="color:#ffffff;">permanente</strong>.`)
        : '';
  const body = `
    ${h1(`${levelLabel}`)}
    ${p(`Bonjour ${d.userName},`)}
    ${p(`Suite à un signalement de catégorie <strong style="color:#ffffff;">${d.categoryLabel}</strong>, ton compte fait l'objet d'une sanction Trust & Safety.`)}
    ${expirationLine}
    ${p(`Tu disposes d'un droit d'appel (1× par niveau de sanction). Pour faire appel, réponds à cet email ou écris à <strong style="color:#D91CD2;">${d.appealEmail}</strong> avec le motif détaillé. Délai de réponse admin : <strong style="color:#ffffff;">${d.appealSlaDays} jours calendaires</strong>.`)}
    ${p(`Conformément à la nLPD Art. 19, cette décision est motivée et susceptible de recours. Cf. CGU sections 7.bis (sanctions) et 8 (droits) sur spordateur.com/terms.`, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: 'Trust & Safety', bodyHtml: body }) };
}

function renderReviewReminder(d: TemplateDataMap['reviewReminder']) {
  const subject = `Comment s'est passé ton cours ? (${d.sessionTitle})`;
  const body = `
    ${h1(`Comment s'est passé ?`)}
    ${p(`Salut ${d.userName},`)}
    ${p(`Ta session <strong style="color:#ffffff;">${d.sessionTitle}</strong> avec ${d.partnerName} s'est terminée il y a 2 jours. Comment ça s'est passé ?`)}
    ${p(`30 secondes pour partager ton ressenti — ça aide les autres membres à choisir leurs prochaines sessions.`)}
    ${p(`<strong style="color:#D91CD2;">Bonus : +${d.creditsBonus} crédits chat</strong> dès que tu poste ta review.`)}
    ${ctaButton('Reviewer la session', d.reviewLink)}
  `;
  return { subject, html: layout({ headerBadgeText: 'Review', bodyHtml: body }) };
}

function renderAppealAcknowledgment(d: TemplateDataMap['appealAcknowledgment']) {
  const subject = `Appel reçu — ${d.banLevelLabel}`;
  const body = `
    ${h1(`Appel bien reçu`)}
    ${p(`Bonjour ${d.userName},`)}
    ${p(`Nous avons bien reçu ton appel concernant la sanction <strong style="color:#ffffff;">${d.banLevelLabel}</strong>.`)}
    ${p(`<strong style="color:#ffffff;">Reçu le</strong> : ${d.receivedAt}`)}
    ${p(`Notre équipe modération va examiner ton appel et te répondra par email sous <strong style="color:#ffffff;">${d.slaDays} jours calendaires</strong>.`)}
    ${p(`Si tu as oublié des éléments contradictoires, tu peux répondre à cet email pour les ajouter (1 réponse complémentaire acceptée avant décision finale).`, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: 'Trust & Safety', bodyHtml: body }) };
}

// =====================================================================
// Public renderTemplate (type-safe dispatch)
// =====================================================================

export function renderTemplate<T extends TemplateName>(
  templateName: T,
  data: TemplateDataMap[T],
): { subject: string; html: string } {
  switch (templateName) {
    case 'bookingConfirmation':
      return renderBookingConfirmation(data as TemplateDataMap['bookingConfirmation']);
    case 'banNotification':
      return renderBanNotification(data as TemplateDataMap['banNotification']);
    case 'reviewReminder':
      return renderReviewReminder(data as TemplateDataMap['reviewReminder']);
    case 'appealAcknowledgment':
      return renderAppealAcknowledgment(data as TemplateDataMap['appealAcknowledgment']);
    default: {
      // Exhaustive check — TypeScript should error if a new TemplateName is added without case
      const _exhaustive: never = templateName;
      throw new Error(`Unknown template: ${String(_exhaustive)}`);
    }
  }
}
