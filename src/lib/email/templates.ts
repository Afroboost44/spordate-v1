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
  | 'appealAcknowledgment' // T&S — confirme reception appel SLA 7j
  | 'reviewBonusGranted' // T&S Phase 7 commit 5/6 — bonus +5 crédits alloué
  | 'reviewPendingModeration' // T&S Phase 7 commit 5/6 — review 1-2★ en modération
  | 'reviewModerationDecision'; // T&S Phase 7 commit 5/6 — décision admin publish/reject

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
  reviewBonusGranted: {
    userName: string;
    sessionTitle: string; // titre activity (peut être vide en fallback)
    rating: number; // 1-5 — note de la review qui a généré le bonus
    creditsAdded: number; // 5 (cohérent REVIEW_BONUS_CREDITS)
  };
  reviewPendingModeration: {
    userName: string;
    sessionTitle: string;
    rating: 1 | 2; // 1-2★ uniquement (3-5★ auto-publish, pas de modération)
    slaDays: number; // 7 (cohérent ban appeal SLA)
  };
  reviewModerationDecision: {
    userName: string;
    decision: 'publish' | 'reject';
    rating: number;
    sessionTitle: string;
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

function renderReviewBonusGranted(d: TemplateDataMap['reviewBonusGranted']) {
  const titleSuffix = d.sessionTitle ? ` sur ${d.sessionTitle}` : '';
  const subject = `Merci pour ton avis ★${d.rating} — +${d.creditsAdded} crédits chat`;
  const body = `
    ${h1(`Merci pour ton avis !`)}
    ${p(`Bonjour ${d.userName || 'membre Spordateur'},`)}
    ${p(`Ton avis ★${d.rating}${titleSuffix} vient d'être publié.`)}
    ${p(`<strong style="color:#D91CD2;">+${d.creditsAdded} crédits chat</strong> ont été ajoutés à ton compte en remerciement. Ils te permettront d'échanger avec d'autres membres après tes prochaines sessions.`)}
    ${p(`Continue à partager tes expériences — ça aide la communauté Spordateur à choisir les bonnes sessions.`, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: 'Avis publié', bodyHtml: body }) };
}

function renderReviewPendingModeration(d: TemplateDataMap['reviewPendingModeration']) {
  const titleSuffix = d.sessionTitle ? ` sur ${d.sessionTitle}` : '';
  const subject = `Ton avis${titleSuffix} est en modération`;
  const body = `
    ${h1(`Avis bien reçu`)}
    ${p(`Bonjour ${d.userName || 'membre Spordateur'},`)}
    ${p(`Ton avis ★${d.rating}${titleSuffix} a bien été reçu.`)}
    ${p(`Conformément à notre doctrine de modération (CGU section 7.ter), les avis ★1 et ★2 sont publiés <strong style="color:#ffffff;">anonymement après validation</strong> par notre équipe modération. Cela protège l'auteur de tout backlash et permet de filtrer les attaques personnelles.`)}
    ${p(`Délai de modération : <strong style="color:#ffffff;">${d.slaDays} jours calendaires maximum</strong>. Tu seras notifié par email dès que la décision est prise (publication ou refus motivé).`)}
    ${p(`Pour toute question, contacte-nous à contact@spordateur.com.`, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: 'Avis en modération', bodyHtml: body }) };
}

function renderReviewModerationDecision(d: TemplateDataMap['reviewModerationDecision']) {
  const titleSuffix = d.sessionTitle ? ` sur ${d.sessionTitle}` : '';
  if (d.decision === 'publish') {
    const subject = `Ton avis${titleSuffix} a été publié`;
    const body = `
      ${h1(`Ton avis est publié`)}
      ${p(`Bonjour ${d.userName || 'membre Spordateur'},`)}
      ${p(`Ton avis ★${d.rating}${titleSuffix} a été publié anonymement après modération de notre équipe (cohérent CGU section 7.ter).`)}
      ${p(`Tu reçois également <strong style="color:#D91CD2;">+5 crédits chat</strong> en bonus pour ton retour. Merci pour ta contribution à la qualité de la communauté Spordateur.`)}
      ${p(`Pour tout désaccord ou question, contacte-nous à contact@spordateur.com.`, '40')}
    `;
    return { subject, html: layout({ headerBadgeText: 'Avis publié', bodyHtml: body }) };
  }
  // reject
  const subject = `Ton avis${titleSuffix} n'a pas été retenu`;
  const body = `
    ${h1(`Avis non retenu`)}
    ${p(`Bonjour ${d.userName || 'membre Spordateur'},`)}
    ${p(`Ton avis ★${d.rating}${titleSuffix} n'a pas été retenu pour publication après modération de notre équipe.`)}
    ${p(`Si tu souhaites partager une expérience constructive, tu peux essayer de reformuler ton commentaire en restant factuel et respectueux. Cf. CGU section 7.ter pour les attentes éditoriales.`)}
    ${p(`Pour tout désaccord, tu peux contester cette décision en répondant à cet email avec tes éléments. Notre équipe revoit les contestations sous 7 jours.`)}
    ${p(`Contact direct : <strong style="color:#D91CD2;">contact@spordateur.com</strong>.`, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: 'Modération', bodyHtml: body }) };
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
    case 'reviewBonusGranted':
      return renderReviewBonusGranted(data as TemplateDataMap['reviewBonusGranted']);
    case 'reviewPendingModeration':
      return renderReviewPendingModeration(data as TemplateDataMap['reviewPendingModeration']);
    case 'reviewModerationDecision':
      return renderReviewModerationDecision(data as TemplateDataMap['reviewModerationDecision']);
    default: {
      // Exhaustive check — TypeScript should error if a new TemplateName is added without case
      const _exhaustive: never = templateName;
      throw new Error(`Unknown template: ${String(_exhaustive)}`);
    }
  }
}
