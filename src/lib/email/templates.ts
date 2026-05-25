/**
 * Spordateur — Phase 7 sub-chantier 0 (créé) + sub-chantier 6 (cleanup banNotification legacy)
 * Templates email transactional Phase 7 — wrapper renderTemplate() type-safe.
 *
 * i18n : depuis Fix #156/#157 — chaque renderer prend un paramètre `lang: EmailLang`
 * et pioche dans le dictionnaire central `STRINGS[lang]`. Default 'fr' pour backward
 * compat (renderTemplate / sendEmail sans `lang` continuent de produire du français).
 *
 * Charte stricte (cohérent UI Phase 5) :
 * - Background black (#000000)
 * - Accent #D91CD2
 * - Text white (full / 70% / 40% selon hiérarchie)
 * - Pas de gradient (refonte vs templates legacy.ts qui utilisaient violet/rose)
 * - Email-safe HTML (table-based layout, inline styles, pas de CSS Grid/Flexbox)
 *
 * Sub-chantier 6 cleanup : `banNotification` legacy retiré (jamais utilisé Phase 7,
 * remplacé fonctionnellement par `userSanctionNotice` qui supporte les 4 SanctionLevel
 * cohérents avec le data model UserSanction).
 *
 * Cf. architecture.md §9.sexies pour la doctrine T&S complète.
 */

// =====================================================================
// Type registry
// =====================================================================

/** Langue email destinataire — cohérent UserProfile.language. */
export type EmailLang = 'fr' | 'en' | 'de';

export type TemplateName =
  | 'bookingConfirmation' // existing flow Stripe webhook (refactor depuis legacy.ts)
  | 'reviewReminder' // T&S — push 48h post-session (Phase 8 wire pending)
  | 'appealAcknowledgment' // T&S — confirme reception appel SLA 7j
  | 'reviewBonusGranted' // T&S Phase 7 commit 5/6 — bonus +5 crédits alloué
  | 'reviewPendingModeration' // T&S Phase 7 commit 5/6 — review 1-2★ en modération
  | 'reviewModerationDecision' // T&S Phase 7 commit 5/6 — décision admin publish/reject
  | 'reportSubmitted' // T&S Phase 7 sub-chantier 3 commit 5/5 — confirme reception report
  | 'userSanctionNotice' // T&S Phase 7 sub-chantier 3 commit 5/5 — notif sanctionné (4 levels)
  | 'noShowWarningNotice' // T&S Phase 7 sub-chantier 3 commit 5/5 — notif no-show 1-4
  | 'partnerNoShowConfirmed' // T&S Phase 7 sub-chantier 3 commit 5/5 — confirm partner check-in
  | 'userSanctionOverturned' // T&S Phase 7 sub-chantier 5 commit 1/3 — admin a annulé sanction
  | 'appealResolved' // T&S Phase 7 sub-chantier 5 commit 1/3 — résultat appel (uphold/overturn)
  | 'leakEscalationAdmin' // Phase 8 SC2 commit 5/6 — alerte admin L4 anti-leak (5+ tentatives chat)
  | 'inviteReceived' // Phase 8 SC4 commit 4/6 — invitation activity reçue par toUserId (mode 'individual')
  | 'inviteReceivedSplit' // Phase 9 SC2 c2/6 — invitation mode='split' (inviter paye part, invité paye reste)
  | 'inviteReceivedGift' // Phase 9 SC2 c2/6 — invitation mode='gift' (inviter paye 100%, invité confirme)
  | 'sessionReminderJMinus1' // Phase 9 SC3 c1/5 — rappel J-1 (24h avant session) Q1=B window 18-30h
  | 'sessionReminderTMinus0' // Phase 9 SC3 c1/5 — rappel T-0 (1h avant session) Q2=A window 30-90min
  | 'passwordResetCustom' // Phase 9.5 c3 — reset password Resend (anti SPAM Firebase Auth default)
  | 'chatMessageReceived' // Fix #118 — fallback email quand push FCM échoue ou opt-out push
  | 'partnerContactRequest'; // Fix #127 — formulaire "Nous contacter" home (section partenaires)

/** SanctionLevel cohérent src/types/firestore.ts (utilisé par userSanctionNotice). */
export type SanctionLevelEmail = 'warning' | 'suspension_7d' | 'suspension_30d' | 'ban_permanent';

/** SanctionReason cohérent src/types/firestore.ts. */
export type SanctionReasonEmail = 'reports_threshold' | 'no_show_threshold' | 'manual_admin';

export interface TemplateDataMap {
  bookingConfirmation: {
    customerName: string;
    sessionTitle: string;
    partnerName: string;
    sessionDate: string; // formatted FR (ex: 'Mardi 14 mai à 17h00')
    amount: number; // CHF (display value, ex: 35)
    bookingId: string;
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
  reportSubmitted: {
    reporterName: string;
    /** Label catégorie en français (ex: 'Harcèlement sexuel'). */
    categoryLabel: string;
    /** SLA admin response. Phase 7 = 72h doctrine §D.3. */
    slaHours: number;
  };
  userSanctionNotice: {
    userName: string;
    level: SanctionLevelEmail;
    reason: SanctionReasonEmail;
    /** Pré-formaté FR (ex: '12 mai 2026'). Présent pour suspension_*, absent pour warning + ban_permanent. */
    endsAtFormatted?: string;
    /** Si true, mention du droit d'appel + email contact. */
    appealable: boolean;
    /** 'contact@spordateur.com'. */
    appealEmail: string;
  };
  noShowWarningNotice: {
    userName: string;
    sessionTitle: string;
    partnerName: string;
    /** Compteur cumulé doctrine §D.5 — 1, 2, 3 ou 4+. */
    noShowCount: number;
  };
  partnerNoShowConfirmed: {
    partnerName: string;
    /** Nom du participant marqué no-show. */
    userName: string;
    sessionTitle: string;
    /** Pré-formaté FR (ex: 'Lundi 12 mai à 18h'). */
    sessionDate: string;
    /** Heures restantes pour annuler (24h depuis création report). */
    cancelWindowHours: number;
  };
  userSanctionOverturned: {
    userName: string;
    /** Niveau de la sanction qui a été annulée (informational). */
    level: SanctionLevelEmail;
    /** Note admin motivant l'overturn (audit + transparency). Optionnelle mais recommandée. */
    adminNote?: string;
  };
  appealResolved: {
    userName: string;
    /** Niveau de la sanction concernée par l'appel. */
    level: SanctionLevelEmail;
    /** Verdict admin : maintenue (upheld) ou annulée (overturned). */
    decision: 'upheld' | 'overturned';
    /** Note admin motivant la décision (audit + transparency). Optionnelle. */
    adminNote?: string;
  };
  /** Phase 8 SC2 commit 5/6 — alerte admin L4 anti-leak (doctrine §B.Q3 escalation manuelle). */
  leakEscalationAdmin: {
    /** Auth uid de l'utilisateur ayant atteint 5+ tentatives leak dans un chat. */
    userId: string;
    /** Display name de l'utilisateur (snapshot — peut être vide si profil incomplet). */
    userName?: string;
    /** Doc-id du chat parent (= matchId). */
    chatId: string;
    /** Compteur cumulatif après ce hit (≥ 5 quand l'email est déclenché). */
    leakCount: number;
    /** Résumé des motifs détectés (FR, ex: "phone-ch×3, ai-leak-likely×2"). Optionnel. */
    motiveSummary?: string;
    /** ISO date du dernier hit. */
    lastFlaggedAt: string;
  };
  /** Phase 8 SC4 commit 4/6 — invitation activity reçue (doctrine §E mode Individuel). */
  inviteReceived: {
    /** Display name de l'inviteur (peut être vide si profil incomplet). */
    fromUserName: string;
    /** Display name destinataire (utilisé dans le greeting). */
    toUserName?: string;
    /** Title activity proposée (snapshot). */
    activityTitle: string;
    /** Date+heure session formatée FR (ex: 'Sam 18 mai à 14h00'). */
    sessionDate: string;
    /** Lien deep page invite (full URL : https://spordateur.com/invite/{id}). */
    inviteLink: string;
    /** Message optionnel inviter (Q1=A, max 200 chars). */
    message?: string;
  };
  /** Phase 9 SC2 c2/6 — invitation mode='split' (inviter paye une part, invité paye le reste). */
  inviteReceivedSplit: {
    fromUserName: string;
    toUserName?: string;
    activityTitle: string;
    sessionDate: string;
    inviteLink: string;
    message?: string;
    /** Montant inviter en CHF (display, ex: '12.50'). */
    inviterAmountChf: string;
    /** Montant invité en CHF (display, ex: '12.50'). */
    inviteeAmountChf: string;
    /** Total session CHF (display, ex: '25.00'). */
    totalAmountChf: string;
  };
  /** Phase 9 SC2 c2/6 — invitation mode='gift' (inviter paye 100%, invité confirme). */
  inviteReceivedGift: {
    fromUserName: string;
    toUserName?: string;
    activityTitle: string;
    sessionDate: string;
    inviteLink: string;
    message?: string;
    /** Total session CHF (display, ex: '25.00'). */
    totalAmountChf: string;
  };
  /** Phase 9 SC3 c1/5 — rappel J-1 (24h avant session). Q1=B window 18-30h. */
  sessionReminderJMinus1: {
    userName: string;
    sessionTitle: string;
    partnerName: string;
    /** Date+heure session formatée FR (ex: 'Sam 18 mai · 14h00'). */
    sessionDate: string;
    /** Adresse session (display). */
    sessionAddress?: string;
    /** Lien deep page session (full URL). */
    sessionLink: string;
  };
  /** Phase 9 SC3 c1/5 — rappel T-0 (1h avant session). Q2=A window 30-90min. */
  sessionReminderTMinus0: {
    userName: string;
    sessionTitle: string;
    partnerName: string;
    sessionDate: string;
    sessionAddress?: string;
    sessionLink: string;
  };
  /** Fix #118 — fallback email "tu as un nouveau message" (envoyé si push FCM échoue
   *  ou si user a opt-out push mais a accepté email). Body court + lien deep chat. */
  chatMessageReceived: {
    /** Display name destinataire (greeting). */
    toUserName?: string;
    /** Display name de l'expéditeur du message. */
    fromUserName: string;
    /** Preview du message (max 80 chars, truncated). */
    messagePreview: string;
    /** Lien deep page chat (full URL). */
    chatLink: string;
  };
  /** Fix #127 — formulaire de contact partenaire home page (section "Studio de danse ou
   *  salle de sport ?"). Envoyé à contact@spordateur.com avec replyTo = email expéditeur
   *  pour permettre une réponse directe. */
  partnerContactRequest: {
    /** Nom complet de l'expéditeur (champ form). */
    fromName: string;
    /** Email expéditeur (champ form, replyTo). */
    fromEmail: string;
    /** Nom du studio / salle (champ form optionnel). */
    studioName?: string;
    /** Numéro de téléphone (champ form optionnel, format libre). */
    phone?: string;
    /** Ville / localisation (champ form optionnel). */
    city?: string;
    /** Message libre (champ form, max 2000 chars). */
    message: string;
  };
  /** Phase 9.5 c3 — reset password via Resend (anti-SPAM vs Firebase Auth default sender). */
  passwordResetCustom: {
    /** Display name (greeting personnalisé), fallback 'membre Spordateur' si absent. */
    userName?: string;
    /** Lien Firebase reset password full URL (généré via Admin SDK generatePasswordResetLink). */
    resetUrl: string;
    /** Expiration link en heures (Firebase default 1h). Display dans email. */
    expiresInHours: number;
  };
}

// =====================================================================
// i18n — Sanction labels & generic labels indexés par EmailLang
// =====================================================================

const SANCTION_LEVEL_LABELS: Record<EmailLang, Record<SanctionLevelEmail, string>> = {
  fr: {
    warning: 'Avertissement',
    suspension_7d: 'Suspension 7 jours',
    suspension_30d: 'Suspension 30 jours',
    ban_permanent: 'Bannissement permanent',
  },
  en: {
    warning: 'Warning',
    suspension_7d: '7-day suspension',
    suspension_30d: '30-day suspension',
    ban_permanent: 'Permanent ban',
  },
  de: {
    warning: 'Verwarnung',
    suspension_7d: '7-tägige Sperre',
    suspension_30d: '30-tägige Sperre',
    ban_permanent: 'Dauerhafte Sperre',
  },
};

const SANCTION_REASON_LABELS: Record<EmailLang, Record<SanctionReasonEmail, string>> = {
  fr: {
    reports_threshold: 'plusieurs signalements indépendants',
    no_show_threshold: 'plusieurs no-shows confirmés',
    manual_admin: 'décision administrative motivée',
  },
  en: {
    reports_threshold: 'multiple independent reports',
    no_show_threshold: 'multiple confirmed no-shows',
    manual_admin: 'reasoned administrative decision',
  },
  de: {
    reports_threshold: 'mehrere unabhängige Meldungen',
    no_show_threshold: 'mehrere bestätigte No-Shows',
    manual_admin: 'begründete administrative Entscheidung',
  },
};

const FOOTER_BY_LANG: Record<EmailLang, string> = {
  fr: '© 2026 Spordateur · Neuchâtel, Suisse · IDE : CHE-407.097.646 · spordateur.com',
  en: '© 2026 Spordateur · Neuchâtel, Switzerland · UID: CHE-407.097.646 · spordateur.com',
  de: '© 2026 Spordateur · Neuenburg, Schweiz · UID: CHE-407.097.646 · spordateur.com',
};

// Fallback générique pour personnaliser le greeting quand userName/displayName est vide.
const MEMBER_FALLBACK: Record<EmailLang, string> = {
  fr: 'membre Spordateur',
  en: 'Spordateur member',
  de: 'Spordateur-Mitglied',
};

const PARTNER_FALLBACK: Record<EmailLang, string> = {
  fr: 'partenaire Spordateur',
  en: 'Spordateur partner',
  de: 'Spordateur-Partner',
};

const BONJOUR: Record<EmailLang, string> = { fr: 'Bonjour', en: 'Hello', de: 'Hallo' };
const SALUT: Record<EmailLang, string> = { fr: 'Salut', en: 'Hi', de: 'Hallo' };

// =====================================================================
// Layout shared (HTML email-safe table-based)
// =====================================================================

function layout(opts: {
  headerBadgeText: string;
  bodyHtml: string;
  footerNote?: string;
  lang?: EmailLang;
}): string {
  // Phase 9.5 c38c — Adresse postale + email retirés du footer pour
  // confidentialité. Coordonnées complètes accessibles uniquement via
  // /legal (Mentions légales) et /terms (CGU) pour conformité LCD/RGPD.
  // L'email contact@spordateur.com reste mentionné DANS le corps du message
  // quand pertinent (support, appeal sanction, etc.) — c'est uniquement le
  // footer générique qui est nettoyé.
  const lang = opts.lang ?? 'fr';
  const footer = opts.footerNote ?? FOOTER_BY_LANG[lang];
  return `<!DOCTYPE html>
<html lang="${lang}">
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
// Templates rendering
// =====================================================================

function renderBookingConfirmation(d: TemplateDataMap['bookingConfirmation'], lang: EmailLang) {
  const T = {
    fr: {
      subject: `Réservation confirmée — ${d.sessionTitle}`,
      badge: 'Réservation',
      h1: `Bonjour ${d.customerName}`,
      intro: `Ta réservation pour <strong style="color:#ffffff;">${d.sessionTitle}</strong> est confirmée.`,
      whenLabel: 'Quand',
      whereLabel: 'Où',
      amountLabel: 'Montant',
      refLabel: 'Référence',
    },
    en: {
      subject: `Booking confirmed — ${d.sessionTitle}`,
      badge: 'Booking',
      h1: `Hello ${d.customerName}`,
      intro: `Your booking for <strong style="color:#ffffff;">${d.sessionTitle}</strong> is confirmed.`,
      whenLabel: 'When',
      whereLabel: 'Where',
      amountLabel: 'Amount',
      refLabel: 'Reference',
    },
    de: {
      subject: `Buchung bestätigt — ${d.sessionTitle}`,
      badge: 'Buchung',
      h1: `Hallo ${d.customerName}`,
      intro: `Deine Buchung für <strong style="color:#ffffff;">${d.sessionTitle}</strong> ist bestätigt.`,
      whenLabel: 'Wann',
      whereLabel: 'Wo',
      amountLabel: 'Betrag',
      refLabel: 'Referenz',
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.intro)}
    ${p(`<strong style="color:#ffffff;">${T.whenLabel}</strong> : ${d.sessionDate}`)}
    ${p(`<strong style="color:#ffffff;">${T.whereLabel}</strong> : ${d.partnerName}`)}
    ${p(`<strong style="color:#ffffff;">${T.amountLabel}</strong> : ${d.amount} CHF`)}
    ${p(`${T.refLabel} : ${d.bookingId}`, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderReviewReminder(d: TemplateDataMap['reviewReminder'], lang: EmailLang) {
  const T = {
    fr: {
      subject: `Comment s'est passé ton cours ? (${d.sessionTitle})`,
      badge: 'Review',
      h1: `Comment s'est passé ?`,
      greeting: `Salut ${d.userName},`,
      intro: `Ta session <strong style="color:#ffffff;">${d.sessionTitle}</strong> avec ${d.partnerName} s'est terminée il y a 2 jours. Comment ça s'est passé ?`,
      ask: `30 secondes pour partager ton ressenti — ça aide les autres membres à choisir leurs prochaines sessions.`,
      bonus: `<strong style="color:#D91CD2;">Bonus : +${d.creditsBonus} crédits chat</strong> dès que tu poste ta review.`,
      cta: 'Reviewer la session',
    },
    en: {
      subject: `How did your class go? (${d.sessionTitle})`,
      badge: 'Review',
      h1: `How did it go?`,
      greeting: `Hi ${d.userName},`,
      intro: `Your <strong style="color:#ffffff;">${d.sessionTitle}</strong> session with ${d.partnerName} ended 2 days ago. How was it?`,
      ask: `30 seconds to share your feedback — it helps other members pick their next sessions.`,
      bonus: `<strong style="color:#D91CD2;">Bonus: +${d.creditsBonus} chat credits</strong> as soon as you post your review.`,
      cta: 'Review the session',
    },
    de: {
      subject: `Wie war dein Kurs? (${d.sessionTitle})`,
      badge: 'Bewertung',
      h1: `Wie war es?`,
      greeting: `Hallo ${d.userName},`,
      intro: `Deine Session <strong style="color:#ffffff;">${d.sessionTitle}</strong> mit ${d.partnerName} ist vor 2 Tagen zu Ende gegangen. Wie war es?`,
      ask: `30 Sekunden, um dein Feedback zu teilen — das hilft anderen Mitgliedern bei der Wahl ihrer nächsten Sessions.`,
      bonus: `<strong style="color:#D91CD2;">Bonus: +${d.creditsBonus} Chat-Credits</strong>, sobald du deine Bewertung postest.`,
      cta: 'Session bewerten',
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${p(T.ask)}
    ${p(T.bonus)}
    ${ctaButton(T.cta, d.reviewLink)}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderAppealAcknowledgment(d: TemplateDataMap['appealAcknowledgment'], lang: EmailLang) {
  const T = {
    fr: {
      subject: `Appel reçu — ${d.banLevelLabel}`,
      badge: 'Trust & Safety',
      h1: `Appel bien reçu`,
      greeting: `Bonjour ${d.userName},`,
      intro: `Nous avons bien reçu ton appel concernant la sanction <strong style="color:#ffffff;">${d.banLevelLabel}</strong>.`,
      receivedLabel: 'Reçu le',
      review: `Notre équipe modération va examiner ton appel et te répondra par email sous <strong style="color:#ffffff;">${d.slaDays} jours calendaires</strong>.`,
      reply: `Si tu as oublié des éléments contradictoires, tu peux répondre à cet email pour les ajouter (1 réponse complémentaire acceptée avant décision finale).`,
    },
    en: {
      subject: `Appeal received — ${d.banLevelLabel}`,
      badge: 'Trust & Safety',
      h1: `Appeal received`,
      greeting: `Hello ${d.userName},`,
      intro: `We have received your appeal regarding the <strong style="color:#ffffff;">${d.banLevelLabel}</strong> sanction.`,
      receivedLabel: 'Received on',
      review: `Our moderation team will review your appeal and respond by email within <strong style="color:#ffffff;">${d.slaDays} calendar days</strong>.`,
      reply: `If you forgot any contradictory evidence, you can reply to this email to add them (1 additional reply accepted before final decision).`,
    },
    de: {
      subject: `Einspruch eingegangen — ${d.banLevelLabel}`,
      badge: 'Trust & Safety',
      h1: `Einspruch eingegangen`,
      greeting: `Hallo ${d.userName},`,
      intro: `Wir haben deinen Einspruch zur Sanktion <strong style="color:#ffffff;">${d.banLevelLabel}</strong> erhalten.`,
      receivedLabel: 'Eingegangen am',
      review: `Unser Moderationsteam prüft deinen Einspruch und antwortet dir per E-Mail innerhalb von <strong style="color:#ffffff;">${d.slaDays} Kalendertagen</strong>.`,
      reply: `Falls du widersprechende Belege vergessen hast, kannst du auf diese E-Mail antworten, um sie hinzuzufügen (1 zusätzliche Antwort vor der endgültigen Entscheidung möglich).`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${p(`<strong style="color:#ffffff;">${T.receivedLabel}</strong> : ${d.receivedAt}`)}
    ${p(T.review)}
    ${p(T.reply, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderReviewBonusGranted(d: TemplateDataMap['reviewBonusGranted'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const T = {
    fr: {
      titleSuffix: d.sessionTitle ? ` sur ${d.sessionTitle}` : '',
      subject: `Merci pour ton avis ★${d.rating} — +${d.creditsAdded} crédits chat`,
      badge: 'Avis publié',
      h1: `Merci pour ton avis !`,
      greeting: `Bonjour ${d.userName || fallback},`,
      published: `Ton avis ★${d.rating}${d.sessionTitle ? ` sur ${d.sessionTitle}` : ''} vient d'être publié.`,
      bonus: `<strong style="color:#D91CD2;">+${d.creditsAdded} crédits chat</strong> ont été ajoutés à ton compte en remerciement. Ils te permettront d'échanger avec d'autres membres après tes prochaines sessions.`,
      foot: `Continue à partager tes expériences — ça aide la communauté Spordateur à choisir les bonnes sessions.`,
    },
    en: {
      titleSuffix: d.sessionTitle ? ` for ${d.sessionTitle}` : '',
      subject: `Thanks for your ★${d.rating} review — +${d.creditsAdded} chat credits`,
      badge: 'Review published',
      h1: `Thanks for your review!`,
      greeting: `Hello ${d.userName || fallback},`,
      published: `Your ★${d.rating} review${d.sessionTitle ? ` for ${d.sessionTitle}` : ''} has just been published.`,
      bonus: `<strong style="color:#D91CD2;">+${d.creditsAdded} chat credits</strong> have been added to your account as a thank you. They let you chat with other members after your next sessions.`,
      foot: `Keep sharing your experiences — it helps the Spordateur community choose great sessions.`,
    },
    de: {
      titleSuffix: d.sessionTitle ? ` für ${d.sessionTitle}` : '',
      subject: `Danke für deine ★${d.rating}-Bewertung — +${d.creditsAdded} Chat-Credits`,
      badge: 'Bewertung veröffentlicht',
      h1: `Danke für deine Bewertung!`,
      greeting: `Hallo ${d.userName || fallback},`,
      published: `Deine ★${d.rating}-Bewertung${d.sessionTitle ? ` für ${d.sessionTitle}` : ''} wurde soeben veröffentlicht.`,
      bonus: `<strong style="color:#D91CD2;">+${d.creditsAdded} Chat-Credits</strong> wurden deinem Konto als Dankeschön gutgeschrieben. Damit kannst du nach deinen nächsten Sessions mit anderen Mitgliedern chatten.`,
      foot: `Teile weiterhin deine Erfahrungen — das hilft der Spordateur-Community, die richtigen Sessions auszuwählen.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.published)}
    ${p(T.bonus)}
    ${p(T.foot, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderReviewPendingModeration(d: TemplateDataMap['reviewPendingModeration'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const titleSuffix = d.sessionTitle ? (lang === 'fr' ? ` sur ${d.sessionTitle}` : lang === 'en' ? ` for ${d.sessionTitle}` : ` für ${d.sessionTitle}`) : '';
  const T = {
    fr: {
      subject: `Ton avis${titleSuffix} est en modération`,
      badge: 'Avis en modération',
      h1: `Avis bien reçu`,
      greeting: `Bonjour ${d.userName || fallback},`,
      received: `Ton avis ★${d.rating}${titleSuffix} a bien été reçu.`,
      explain: `Conformément à notre doctrine de modération (CGU section 7.ter), les avis ★1 et ★2 sont publiés <strong style="color:#ffffff;">anonymement après validation</strong> par notre équipe modération. Cela protège l'auteur de tout backlash et permet de filtrer les attaques personnelles.`,
      sla: `Délai de modération : <strong style="color:#ffffff;">${d.slaDays} jours calendaires maximum</strong>. Tu seras notifié par email dès que la décision est prise (publication ou refus motivé).`,
      contact: `Pour toute question, contacte-nous à contact@spordateur.com.`,
    },
    en: {
      subject: `Your review${titleSuffix} is under moderation`,
      badge: 'Review under moderation',
      h1: `Review received`,
      greeting: `Hello ${d.userName || fallback},`,
      received: `Your ★${d.rating} review${titleSuffix} has been received.`,
      explain: `In accordance with our moderation doctrine (Terms section 7.ter), ★1 and ★2 reviews are published <strong style="color:#ffffff;">anonymously after validation</strong> by our moderation team. This protects the author from any backlash and helps filter out personal attacks.`,
      sla: `Moderation timeframe: <strong style="color:#ffffff;">${d.slaDays} calendar days maximum</strong>. You will be notified by email as soon as a decision is made (publication or reasoned refusal).`,
      contact: `For any question, contact us at contact@spordateur.com.`,
    },
    de: {
      subject: `Deine Bewertung${titleSuffix} wird moderiert`,
      badge: 'Bewertung in Moderation',
      h1: `Bewertung eingegangen`,
      greeting: `Hallo ${d.userName || fallback},`,
      received: `Deine ★${d.rating}-Bewertung${titleSuffix} ist eingegangen.`,
      explain: `Gemäss unserer Moderationsdoktrin (AGB Abschnitt 7.ter) werden ★1- und ★2-Bewertungen <strong style="color:#ffffff;">anonym nach Validierung</strong> durch unser Moderationsteam veröffentlicht. Das schützt die Autor:innen vor Backlash und filtert persönliche Angriffe.`,
      sla: `Moderationsfrist: <strong style="color:#ffffff;">maximal ${d.slaDays} Kalendertage</strong>. Du wirst per E-Mail benachrichtigt, sobald entschieden wurde (Veröffentlichung oder begründete Ablehnung).`,
      contact: `Bei Fragen kontaktiere uns unter contact@spordateur.com.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.received)}
    ${p(T.explain)}
    ${p(T.sla)}
    ${p(T.contact, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderReviewModerationDecision(d: TemplateDataMap['reviewModerationDecision'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const titleSuffix = d.sessionTitle ? (lang === 'fr' ? ` sur ${d.sessionTitle}` : lang === 'en' ? ` for ${d.sessionTitle}` : ` für ${d.sessionTitle}`) : '';

  if (d.decision === 'publish') {
    const T = {
      fr: {
        subject: `Ton avis${titleSuffix} a été publié`,
        badge: 'Avis publié',
        h1: `Ton avis est publié`,
        greeting: `Bonjour ${d.userName || fallback},`,
        published: `Ton avis ★${d.rating}${titleSuffix} a été publié anonymement après modération de notre équipe (cohérent CGU section 7.ter).`,
        bonus: `Tu reçois également <strong style="color:#D91CD2;">+5 crédits chat</strong> en bonus pour ton retour. Merci pour ta contribution à la qualité de la communauté Spordateur.`,
        contact: `Pour tout désaccord ou question, contacte-nous à contact@spordateur.com.`,
      },
      en: {
        subject: `Your review${titleSuffix} has been published`,
        badge: 'Review published',
        h1: `Your review is published`,
        greeting: `Hello ${d.userName || fallback},`,
        published: `Your ★${d.rating} review${titleSuffix} has been published anonymously after moderation by our team (in line with Terms section 7.ter).`,
        bonus: `You also receive <strong style="color:#D91CD2;">+5 chat credits</strong> as a bonus for your feedback. Thank you for contributing to the quality of the Spordateur community.`,
        contact: `For any disagreement or question, contact us at contact@spordateur.com.`,
      },
      de: {
        subject: `Deine Bewertung${titleSuffix} wurde veröffentlicht`,
        badge: 'Bewertung veröffentlicht',
        h1: `Deine Bewertung ist veröffentlicht`,
        greeting: `Hallo ${d.userName || fallback},`,
        published: `Deine ★${d.rating}-Bewertung${titleSuffix} wurde nach Moderation durch unser Team anonym veröffentlicht (gemäss AGB Abschnitt 7.ter).`,
        bonus: `Du erhältst zusätzlich <strong style="color:#D91CD2;">+5 Chat-Credits</strong> als Bonus für dein Feedback. Danke für deinen Beitrag zur Qualität der Spordateur-Community.`,
        contact: `Bei Einwänden oder Fragen kontaktiere uns unter contact@spordateur.com.`,
      },
    }[lang];

    const body = `
      ${h1(T.h1)}
      ${p(T.greeting)}
      ${p(T.published)}
      ${p(T.bonus)}
      ${p(T.contact, '40')}
    `;
    return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
  }

  // reject
  const T = {
    fr: {
      subject: `Ton avis${titleSuffix} n'a pas été retenu`,
      badge: 'Modération',
      h1: `Avis non retenu`,
      greeting: `Bonjour ${d.userName || fallback},`,
      rejected: `Ton avis ★${d.rating}${titleSuffix} n'a pas été retenu pour publication après modération de notre équipe.`,
      reformulate: `Si tu souhaites partager une expérience constructive, tu peux essayer de reformuler ton commentaire en restant factuel et respectueux. Cf. CGU section 7.ter pour les attentes éditoriales.`,
      contest: `Pour tout désaccord, tu peux contester cette décision en répondant à cet email avec tes éléments. Notre équipe revoit les contestations sous 7 jours.`,
      contact: `Contact direct : <strong style="color:#D91CD2;">contact@spordateur.com</strong>.`,
    },
    en: {
      subject: `Your review${titleSuffix} was not accepted`,
      badge: 'Moderation',
      h1: `Review not accepted`,
      greeting: `Hello ${d.userName || fallback},`,
      rejected: `Your ★${d.rating} review${titleSuffix} was not accepted for publication after moderation by our team.`,
      reformulate: `If you wish to share a constructive experience, you can try rewording your comment to remain factual and respectful. See Terms section 7.ter for editorial expectations.`,
      contest: `For any disagreement, you can challenge this decision by replying to this email with your evidence. Our team reviews challenges within 7 days.`,
      contact: `Direct contact: <strong style="color:#D91CD2;">contact@spordateur.com</strong>.`,
    },
    de: {
      subject: `Deine Bewertung${titleSuffix} wurde nicht angenommen`,
      badge: 'Moderation',
      h1: `Bewertung nicht angenommen`,
      greeting: `Hallo ${d.userName || fallback},`,
      rejected: `Deine ★${d.rating}-Bewertung${titleSuffix} wurde nach Moderation durch unser Team nicht zur Veröffentlichung angenommen.`,
      reformulate: `Wenn du eine konstruktive Erfahrung teilen möchtest, kannst du deinen Kommentar sachlich und respektvoll umformulieren. Siehe AGB Abschnitt 7.ter für die redaktionellen Anforderungen.`,
      contest: `Bei Einwänden kannst du diese Entscheidung anfechten, indem du auf diese E-Mail mit deinen Belegen antwortest. Unser Team prüft Anfechtungen innerhalb von 7 Tagen.`,
      contact: `Direktkontakt: <strong style="color:#D91CD2;">contact@spordateur.com</strong>.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.rejected)}
    ${p(T.reformulate)}
    ${p(T.contest)}
    ${p(T.contact, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

// =====================================================================
// Templates Phase 7 sub-chantier 3 commit 5/5 (4 NEW)
// =====================================================================

function renderReportSubmitted(d: TemplateDataMap['reportSubmitted'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const T = {
    fr: {
      subject: 'Signalement bien reçu',
      badge: 'Trust & Safety',
      h1: `Signalement bien reçu`,
      greeting: `Bonjour ${d.reporterName || fallback},`,
      received: `Nous avons bien reçu ton signalement de catégorie <strong style="color:#ffffff;">${d.categoryLabel}</strong>.`,
      anonymity: `<strong style="color:#ffffff;">Anonymat garanti</strong> : la personne signalée ne saura jamais qui l'a signalée. Notre équipe modération examinera ton signalement sous <strong style="color:#ffffff;">${d.slaHours}h</strong> (cf. CGU section 7.bis).`,
      thanks: `Merci de contribuer à la sécurité de la communauté Spordateur. Pour toute question : contact@spordateur.com.`,
    },
    en: {
      subject: 'Report received',
      badge: 'Trust & Safety',
      h1: `Report received`,
      greeting: `Hello ${d.reporterName || fallback},`,
      received: `We have received your report in the <strong style="color:#ffffff;">${d.categoryLabel}</strong> category.`,
      anonymity: `<strong style="color:#ffffff;">Anonymity guaranteed</strong>: the reported person will never know who reported them. Our moderation team will review your report within <strong style="color:#ffffff;">${d.slaHours}h</strong> (see Terms section 7.bis).`,
      thanks: `Thank you for contributing to the safety of the Spordateur community. For any question: contact@spordateur.com.`,
    },
    de: {
      subject: 'Meldung eingegangen',
      badge: 'Trust & Safety',
      h1: `Meldung eingegangen`,
      greeting: `Hallo ${d.reporterName || fallback},`,
      received: `Wir haben deine Meldung in der Kategorie <strong style="color:#ffffff;">${d.categoryLabel}</strong> erhalten.`,
      anonymity: `<strong style="color:#ffffff;">Anonymität garantiert</strong>: Die gemeldete Person wird nie erfahren, wer sie gemeldet hat. Unser Moderationsteam prüft deine Meldung innerhalb von <strong style="color:#ffffff;">${d.slaHours}h</strong> (siehe AGB Abschnitt 7.bis).`,
      thanks: `Danke, dass du zur Sicherheit der Spordateur-Community beiträgst. Bei Fragen: contact@spordateur.com.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.received)}
    ${p(T.anonymity)}
    ${p(T.thanks, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderUserSanctionNotice(d: TemplateDataMap['userSanctionNotice'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const levelLabel = SANCTION_LEVEL_LABELS[lang][d.level];
  const reasonLabel = SANCTION_REASON_LABELS[lang][d.reason];
  const subject = lang === 'fr'
    ? `${levelLabel} — Spordateur`
    : lang === 'en'
      ? `${levelLabel} — Spordateur`
      : `${levelLabel} — Spordateur`;

  const T = {
    fr: {
      badge: 'Trust & Safety',
      greeting: `Bonjour ${d.userName || fallback},`,
      intro: `Suite à <strong style="color:#ffffff;">${reasonLabel}</strong>, ton compte fait l'objet d'une mesure Trust & Safety.`,
      endsAtLabel: 'Fin de la sanction',
      permanent: `Cette mesure est <strong style="color:#ffffff;">permanente</strong>. Elle fait l'objet d'une revue annuelle automatique.`,
      appeal: `Tu disposes d'un droit d'appel (1× par niveau de sanction). Pour faire appel, écris à <strong style="color:#D91CD2;">${d.appealEmail}</strong> en exposant ta version des faits et les éléments contradictoires. Délai de réponse admin : <strong style="color:#ffffff;">7 jours calendaires</strong>.`,
      warningOnly: `Cet avertissement n'est pas une sanction au sens du droit d'appel (cf. doctrine §F). Il vise à signaler un comportement à corriger. Toute récidive pourra entraîner une sanction effective avec droit d'appel.`,
      legal: `Conformément à la nLPD Art. 19 et à la LCD Art. 3, cette décision est motivée et susceptible de recours. Cf. CGU sections 7.bis (sanctions) sur spordateur.com/terms.`,
    },
    en: {
      badge: 'Trust & Safety',
      greeting: `Hello ${d.userName || fallback},`,
      intro: `Following <strong style="color:#ffffff;">${reasonLabel}</strong>, your account is subject to a Trust & Safety measure.`,
      endsAtLabel: 'End of sanction',
      permanent: `This measure is <strong style="color:#ffffff;">permanent</strong>. It is subject to automatic annual review.`,
      appeal: `You have a right to appeal (1× per sanction level). To appeal, write to <strong style="color:#D91CD2;">${d.appealEmail}</strong> stating your version of the facts and any contradictory evidence. Admin response time: <strong style="color:#ffffff;">7 calendar days</strong>.`,
      warningOnly: `This warning is not a sanction in the sense of the right to appeal (see doctrine §F). It aims to flag a behaviour to correct. Any repeat offence may lead to an effective sanction with right to appeal.`,
      legal: `In accordance with revFADP Art. 19 and UCA Art. 3 (Switzerland) and applicable GDPR provisions, this decision is reasoned and open to appeal. See Terms section 7.bis (sanctions) at spordateur.com/terms.`,
    },
    de: {
      badge: 'Trust & Safety',
      greeting: `Hallo ${d.userName || fallback},`,
      intro: `Aufgrund <strong style="color:#ffffff;">${reasonLabel}</strong> ist gegen dein Konto eine Trust-&-Safety-Massnahme verhängt worden.`,
      endsAtLabel: 'Ende der Sanktion',
      permanent: `Diese Massnahme ist <strong style="color:#ffffff;">dauerhaft</strong>. Sie wird jährlich automatisch überprüft.`,
      appeal: `Du hast ein Einspruchsrecht (1× pro Sanktionsstufe). Um Einspruch zu erheben, schreibe an <strong style="color:#D91CD2;">${d.appealEmail}</strong> und schildere deine Sicht der Dinge sowie widersprechende Belege. Antwortzeit des Admins: <strong style="color:#ffffff;">7 Kalendertage</strong>.`,
      warningOnly: `Diese Verwarnung ist keine Sanktion im Sinne des Einspruchsrechts (siehe Doktrin §F). Sie soll auf ein zu korrigierendes Verhalten hinweisen. Jede Wiederholung kann zu einer effektiven Sanktion mit Einspruchsrecht führen.`,
      legal: `Gemäss revDSG Art. 19 und UWG Art. 3 (Schweiz) sowie geltenden DSGVO-Bestimmungen ist diese Entscheidung begründet und anfechtbar. Siehe AGB Abschnitt 7.bis (Sanktionen) unter spordateur.com/terms.`,
    },
  }[lang];

  const expirationLine =
    d.endsAtFormatted && d.level !== 'ban_permanent' && d.level !== 'warning'
      ? p(`<strong style="color:#ffffff;">${T.endsAtLabel}</strong> : ${d.endsAtFormatted}`)
      : d.level === 'ban_permanent'
        ? p(T.permanent)
        : '';

  const appealLine = d.appealable ? p(T.appeal) : p(T.warningOnly);

  const body = `
    ${h1(`${levelLabel}`)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${expirationLine}
    ${appealLine}
    ${p(T.legal, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderNoShowWarningNotice(d: TemplateDataMap['noShowWarningNotice'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const isFirst = d.noShowCount === 1;
  const isSecond = d.noShowCount === 2;
  const isThird = d.noShowCount === 3;
  const isBan = d.noShowCount >= 4;

  const T = {
    fr: {
      badge: 'Trust & Safety',
      greeting: `Bonjour ${d.userName || fallback},`,
      flagged: `Tu as été marqué <strong style="color:#ffffff;">no-show</strong> par ${d.partnerName} pour la session <strong style="color:#ffffff;">${d.sessionTitle}</strong> à laquelle tu étais inscrit·e.`,
      first: { subject: `No-show enregistré`, h1: 'No-show enregistré', escalation: `<strong style="color:#ffffff;">C'est ton 1er no-show</strong>. À 3 no-shows cumulés (90 jours), une suspension 30 jours sera appliquée + remboursement automatique au partenaire. À 4+, ban permanent.` },
      second: { subject: `2ème no-show enregistré`, h1: 'No-show enregistré', escalation: `<strong style="color:#D91CD2;">2ème no-show cumulé</strong> (90 jours rolling). Prochain no-show → suspension 30 jours + remboursement partner. À 4+, ban permanent.` },
      third: { subject: `3ème no-show — suspension 30 jours`, h1: 'No-show enregistré', escalation: `<strong style="color:#D91CD2;">3ème no-show cumulé</strong> (90 jours rolling). Une suspension 30 jours est automatiquement appliquée + remboursement partner. Tu peux faire appel par email à contact@spordateur.com.` },
      ban: { subject: `Ban permanent — no-shows répétés`, h1: 'Ban permanent', escalation: `<strong style="color:#D91CD2;">${d.noShowCount}ème no-show cumulé</strong>. Bannissement permanent appliqué. Tu peux faire appel 1× via contact@spordateur.com.` },
      error: `Si c'est une erreur, contacte <strong style="color:#D91CD2;">contact@spordateur.com</strong> dans les 24h. Le partenaire peut aussi annuler le marquage depuis son dashboard pendant ce délai.`,
      legal: `Cf. CGU section 7.bis pour le détail du workflow no-show. Spordateur applique une politique de fair-play : honorer ses réservations protège la communauté.`,
    },
    en: {
      badge: 'Trust & Safety',
      greeting: `Hello ${d.userName || fallback},`,
      flagged: `You have been marked <strong style="color:#ffffff;">no-show</strong> by ${d.partnerName} for the session <strong style="color:#ffffff;">${d.sessionTitle}</strong> you were registered for.`,
      first: { subject: `No-show recorded`, h1: 'No-show recorded', escalation: `<strong style="color:#ffffff;">This is your 1st no-show</strong>. At 3 cumulative no-shows (rolling 90 days), a 30-day suspension is applied + automatic refund to the partner. At 4+, permanent ban.` },
      second: { subject: `2nd no-show recorded`, h1: 'No-show recorded', escalation: `<strong style="color:#D91CD2;">2nd cumulative no-show</strong> (rolling 90 days). Next no-show → 30-day suspension + partner refund. At 4+, permanent ban.` },
      third: { subject: `3rd no-show — 30-day suspension`, h1: 'No-show recorded', escalation: `<strong style="color:#D91CD2;">3rd cumulative no-show</strong> (rolling 90 days). A 30-day suspension is automatically applied + partner refund. You can appeal by email at contact@spordateur.com.` },
      ban: { subject: `Permanent ban — repeated no-shows`, h1: 'Permanent ban', escalation: `<strong style="color:#D91CD2;">${d.noShowCount}th cumulative no-show</strong>. Permanent ban applied. You can appeal 1× via contact@spordateur.com.` },
      error: `If this is a mistake, contact <strong style="color:#D91CD2;">contact@spordateur.com</strong> within 24 hours. The partner can also cancel the marking from their dashboard during this window.`,
      legal: `See Terms section 7.bis for the no-show workflow. Spordateur applies a fair-play policy: honouring your bookings protects the community.`,
    },
    de: {
      badge: 'Trust & Safety',
      greeting: `Hallo ${d.userName || fallback},`,
      flagged: `Du wurdest von ${d.partnerName} für die Session <strong style="color:#ffffff;">${d.sessionTitle}</strong>, für die du angemeldet warst, als <strong style="color:#ffffff;">No-Show</strong> markiert.`,
      first: { subject: `No-Show erfasst`, h1: 'No-Show erfasst', escalation: `<strong style="color:#ffffff;">Das ist dein 1. No-Show</strong>. Bei 3 kumulierten No-Shows (rollierend 90 Tage) wird eine 30-tägige Sperre verhängt + automatische Rückerstattung an den Partner. Ab 4: dauerhafte Sperre.` },
      second: { subject: `2. No-Show erfasst`, h1: 'No-Show erfasst', escalation: `<strong style="color:#D91CD2;">2. kumulierter No-Show</strong> (rollierend 90 Tage). Nächster No-Show → 30-tägige Sperre + Partner-Rückerstattung. Ab 4: dauerhafte Sperre.` },
      third: { subject: `3. No-Show — 30-tägige Sperre`, h1: 'No-Show erfasst', escalation: `<strong style="color:#D91CD2;">3. kumulierter No-Show</strong> (rollierend 90 Tage). Eine 30-tägige Sperre wird automatisch verhängt + Partner-Rückerstattung. Du kannst per E-Mail an contact@spordateur.com Einspruch erheben.` },
      ban: { subject: `Dauerhafte Sperre — wiederholte No-Shows`, h1: 'Dauerhafte Sperre', escalation: `<strong style="color:#D91CD2;">${d.noShowCount}. kumulierter No-Show</strong>. Dauerhafte Sperre verhängt. Du kannst 1× über contact@spordateur.com Einspruch erheben.` },
      error: `Falls es ein Fehler ist, kontaktiere <strong style="color:#D91CD2;">contact@spordateur.com</strong> innerhalb von 24 Stunden. Der Partner kann die Markierung in diesem Zeitraum ebenfalls über sein Dashboard rückgängig machen.`,
      legal: `Siehe AGB Abschnitt 7.bis für den No-Show-Ablauf. Spordateur verfolgt eine Fair-Play-Politik: Wer seine Buchungen einhält, schützt die Community.`,
    },
  }[lang];

  const variant = isBan ? T.ban : isThird ? T.third : isSecond ? T.second : T.first;

  const body = `
    ${h1(variant.h1)}
    ${p(T.greeting)}
    ${p(T.flagged)}
    ${p(variant.escalation)}
    ${p(T.error)}
    ${p(T.legal, '40')}
  `;
  return { subject: variant.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderPartnerNoShowConfirmed(d: TemplateDataMap['partnerNoShowConfirmed'], lang: EmailLang) {
  const fallback = PARTNER_FALLBACK[lang];
  const T = {
    fr: {
      subject: `Confirmation no-show — ${d.userName}`,
      badge: 'Partner check-in',
      h1: `No-show enregistré`,
      greeting: `Bonjour ${d.partnerName || fallback},`,
      marked: `Tu as marqué <strong style="color:#ffffff;">${d.userName}</strong> comme no-show à la session <strong style="color:#ffffff;">${d.sessionTitle}</strong> (${d.sessionDate}).`,
      notified: `Le participant a été notifié par email. La sanction (warning, suspension ou ban) est appliquée automatiquement selon son cumul de no-shows sur 90 jours.`,
      cancel: `<strong style="color:#D91CD2;">Tu peux annuler ce marquage</strong> dans les <strong style="color:#ffffff;">${d.cancelWindowHours}h</strong> qui suivent depuis ton dashboard partner (en cas d'erreur ou retard de dernière minute découvert).`,
      thanks: `Merci de contribuer à la qualité de la communauté Spordateur en honorant cette responsabilité.`,
    },
    en: {
      subject: `No-show confirmation — ${d.userName}`,
      badge: 'Partner check-in',
      h1: `No-show recorded`,
      greeting: `Hello ${d.partnerName || fallback},`,
      marked: `You marked <strong style="color:#ffffff;">${d.userName}</strong> as a no-show for the session <strong style="color:#ffffff;">${d.sessionTitle}</strong> (${d.sessionDate}).`,
      notified: `The participant has been notified by email. The sanction (warning, suspension or ban) is applied automatically based on their cumulative no-shows over 90 days.`,
      cancel: `<strong style="color:#D91CD2;">You can cancel this marking</strong> within <strong style="color:#ffffff;">${d.cancelWindowHours}h</strong> from your partner dashboard (in case of error or last-minute late arrival discovered).`,
      thanks: `Thank you for contributing to the quality of the Spordateur community by honouring this responsibility.`,
    },
    de: {
      subject: `No-Show-Bestätigung — ${d.userName}`,
      badge: 'Partner Check-in',
      h1: `No-Show erfasst`,
      greeting: `Hallo ${d.partnerName || fallback},`,
      marked: `Du hast <strong style="color:#ffffff;">${d.userName}</strong> als No-Show für die Session <strong style="color:#ffffff;">${d.sessionTitle}</strong> (${d.sessionDate}) markiert.`,
      notified: `Die teilnehmende Person wurde per E-Mail benachrichtigt. Die Sanktion (Verwarnung, Sperre oder Bann) wird automatisch basierend auf den kumulierten No-Shows der letzten 90 Tage angewendet.`,
      cancel: `<strong style="color:#D91CD2;">Du kannst diese Markierung</strong> innerhalb von <strong style="color:#ffffff;">${d.cancelWindowHours}h</strong> über dein Partner-Dashboard rückgängig machen (bei Fehler oder erst nachträglich festgestellter Verspätung).`,
      thanks: `Danke, dass du mit dieser Verantwortung zur Qualität der Spordateur-Community beiträgst.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.marked)}
    ${p(T.notified)}
    ${p(T.cancel)}
    ${p(T.thanks, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderUserSanctionOverturned(d: TemplateDataMap['userSanctionOverturned'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const levelLabel = SANCTION_LEVEL_LABELS[lang][d.level];
  const T = {
    fr: {
      subject: `Sanction annulée — ${levelLabel}`,
      badge: 'Trust & Safety',
      h1: `Sanction annulée`,
      greeting: `Bonjour ${d.userName || fallback},`,
      good: `Bonne nouvelle : la sanction <strong style="color:#ffffff;">${levelLabel}</strong> appliquée à ton compte a été <strong style="color:#D91CD2;">annulée</strong> par notre équipe modération.`,
      reasonLabel: 'Motif',
      restored: `Ton compte est de nouveau pleinement opérationnel. Tu peux à nouveau réserver, matcher et participer aux sessions Spordateur normalement.`,
      contact: `Pour toute question : contact@spordateur.com.`,
    },
    en: {
      subject: `Sanction overturned — ${levelLabel}`,
      badge: 'Trust & Safety',
      h1: `Sanction overturned`,
      greeting: `Hello ${d.userName || fallback},`,
      good: `Good news: the <strong style="color:#ffffff;">${levelLabel}</strong> sanction applied to your account has been <strong style="color:#D91CD2;">overturned</strong> by our moderation team.`,
      reasonLabel: 'Reason',
      restored: `Your account is fully operational again. You can book, match, and participate in Spordateur sessions normally again.`,
      contact: `For any question: contact@spordateur.com.`,
    },
    de: {
      subject: `Sanktion aufgehoben — ${levelLabel}`,
      badge: 'Trust & Safety',
      h1: `Sanktion aufgehoben`,
      greeting: `Hallo ${d.userName || fallback},`,
      good: `Gute Nachricht: Die gegen dein Konto verhängte Sanktion <strong style="color:#ffffff;">${levelLabel}</strong> wurde von unserem Moderationsteam <strong style="color:#D91CD2;">aufgehoben</strong>.`,
      reasonLabel: 'Begründung',
      restored: `Dein Konto ist wieder voll funktionsfähig. Du kannst wieder buchen, matchen und an Spordateur-Sessions teilnehmen.`,
      contact: `Bei Fragen: contact@spordateur.com.`,
    },
  }[lang];

  const noteLine = d.adminNote
    ? p(`<strong style="color:#ffffff;">${T.reasonLabel}</strong> : ${d.adminNote}`)
    : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.good)}
    ${noteLine}
    ${p(T.restored)}
    ${p(T.contact, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderAppealResolved(d: TemplateDataMap['appealResolved'], lang: EmailLang) {
  const fallback = MEMBER_FALLBACK[lang];
  const levelLabel = SANCTION_LEVEL_LABELS[lang][d.level];
  const isOverturned = d.decision === 'overturned';

  const T = {
    fr: {
      subjectOverturned: `Appel accepté — sanction ${levelLabel} annulée`,
      subjectUpheld: `Appel examiné — sanction ${levelLabel} maintenue`,
      badge: 'Trust & Safety',
      h1Overturned: 'Appel accepté',
      h1Upheld: 'Appel examiné',
      greeting: `Bonjour ${d.userName || fallback},`,
      reviewedOverturned: `Notre équipe modération a examiné ton appel concernant la sanction <strong style="color:#ffffff;">${levelLabel}</strong>.`,
      decisionOverturned: `<strong style="color:#D91CD2;">Décision : appel accepté</strong>. La sanction est annulée et ton compte est de nouveau pleinement opérationnel.`,
      thanksOverturned: `Merci d'avoir fait remonter ces éléments. Spordateur applique une politique de fair process — chaque appel est traité humainement avec attention.`,
      reviewedUpheld: `Notre équipe modération a examiné ton appel concernant la sanction <strong style="color:#ffffff;">${levelLabel}</strong>.`,
      decisionUpheld: `<strong style="color:#ffffff;">Décision : sanction maintenue</strong>. Après examen des éléments contradictoires, la sanction reste active.`,
      noAppeal: `Conformément à la doctrine §F (1× appel par niveau), tu ne peux pas faire un nouvel appel sur cette sanction. Tu peux contester sur d'autres voies (médiation externe, recours juridique) — Spordateur respecte les droits LPD/nLPD.`,
      contact: `Pour toute question : contact@spordateur.com.`,
      reasonLabel: 'Motif décision admin',
    },
    en: {
      subjectOverturned: `Appeal accepted — ${levelLabel} sanction overturned`,
      subjectUpheld: `Appeal reviewed — ${levelLabel} sanction upheld`,
      badge: 'Trust & Safety',
      h1Overturned: 'Appeal accepted',
      h1Upheld: 'Appeal reviewed',
      greeting: `Hello ${d.userName || fallback},`,
      reviewedOverturned: `Our moderation team reviewed your appeal regarding the <strong style="color:#ffffff;">${levelLabel}</strong> sanction.`,
      decisionOverturned: `<strong style="color:#D91CD2;">Decision: appeal accepted</strong>. The sanction is overturned and your account is fully operational again.`,
      thanksOverturned: `Thank you for raising these elements. Spordateur applies a fair-process policy — every appeal is handled humanely and attentively.`,
      reviewedUpheld: `Our moderation team reviewed your appeal regarding the <strong style="color:#ffffff;">${levelLabel}</strong> sanction.`,
      decisionUpheld: `<strong style="color:#ffffff;">Decision: sanction upheld</strong>. After review of the contradictory evidence, the sanction remains active.`,
      noAppeal: `In accordance with doctrine §F (1× appeal per level), you cannot make a new appeal on this sanction. You may dispute it through other channels (external mediation, legal recourse) — Spordateur respects FADP/revFADP and GDPR rights.`,
      contact: `For any question: contact@spordateur.com.`,
      reasonLabel: 'Admin decision reason',
    },
    de: {
      subjectOverturned: `Einspruch angenommen — Sanktion ${levelLabel} aufgehoben`,
      subjectUpheld: `Einspruch geprüft — Sanktion ${levelLabel} aufrechterhalten`,
      badge: 'Trust & Safety',
      h1Overturned: 'Einspruch angenommen',
      h1Upheld: 'Einspruch geprüft',
      greeting: `Hallo ${d.userName || fallback},`,
      reviewedOverturned: `Unser Moderationsteam hat deinen Einspruch zur Sanktion <strong style="color:#ffffff;">${levelLabel}</strong> geprüft.`,
      decisionOverturned: `<strong style="color:#D91CD2;">Entscheidung: Einspruch angenommen</strong>. Die Sanktion wird aufgehoben und dein Konto ist wieder voll funktionsfähig.`,
      thanksOverturned: `Danke, dass du diese Elemente eingebracht hast. Spordateur verfolgt eine Fair-Process-Politik — jeder Einspruch wird menschlich und sorgfältig behandelt.`,
      reviewedUpheld: `Unser Moderationsteam hat deinen Einspruch zur Sanktion <strong style="color:#ffffff;">${levelLabel}</strong> geprüft.`,
      decisionUpheld: `<strong style="color:#ffffff;">Entscheidung: Sanktion aufrechterhalten</strong>. Nach Prüfung der widersprechenden Belege bleibt die Sanktion aktiv.`,
      noAppeal: `Gemäss Doktrin §F (1× Einspruch pro Stufe) kannst du keinen neuen Einspruch zu dieser Sanktion einlegen. Du kannst sie über andere Wege anfechten (externe Mediation, Rechtsweg) — Spordateur respektiert die Rechte gemäss DSG/revDSG und DSGVO.`,
      contact: `Bei Fragen: contact@spordateur.com.`,
      reasonLabel: 'Begründung der Admin-Entscheidung',
    },
  }[lang];

  const subject = isOverturned ? T.subjectOverturned : T.subjectUpheld;

  const noteLine = d.adminNote
    ? p(`<strong style="color:#ffffff;">${T.reasonLabel}</strong> : ${d.adminNote}`)
    : '';

  const body = isOverturned
    ? `
        ${h1(T.h1Overturned)}
        ${p(T.greeting)}
        ${p(T.reviewedOverturned)}
        ${p(T.decisionOverturned)}
        ${noteLine}
        ${p(T.thanksOverturned, '40')}
      `
    : `
        ${h1(T.h1Upheld)}
        ${p(T.greeting)}
        ${p(T.reviewedUpheld)}
        ${p(T.decisionUpheld)}
        ${noteLine}
        ${p(T.noAppeal)}
        ${p(T.contact, '40')}
      `;

  return { subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

/**
 * Phase 8 SC2 commit 5/6 — alerte admin L4 anti-leak (doctrine §B.Q3 escalation manuelle).
 *
 * Note : cet email est destiné à des admins internes — on le garde principalement
 * en français car les admins Spordateur opèrent en FR. Le param `lang` est honoré
 * si on veut le router vers un admin EN/DE plus tard, mais le default 'fr' reste sain.
 */
function renderLeakEscalationAdmin(d: TemplateDataMap['leakEscalationAdmin'], lang: EmailLang) {
  const userLabel = d.userName ? `${d.userName} (${d.userId})` : d.userId;
  const subject = `🚨 Anti-leak L4 — user ${d.userId} (${d.leakCount} hits)`;

  const T = {
    fr: {
      badge: 'Trust & Safety',
      h1: `Anti-leak L4 — escalation`,
      summary: `L'utilisateur <strong style="color:#ffffff;">${userLabel}</strong> a atteint <strong style="color:#D91CD2;">${d.leakCount} tentatives anti-leak</strong> dans le chat <strong style="color:#ffffff;">${d.chatId}</strong>.`,
      lastHitLabel: 'Date du dernier hit',
      motivesLabel: 'Motifs détectés',
      flagged: `<strong style="color:#ffffff;">Compte flaggé automatiquement</strong> (UserProfile.leakFlagged=true). Action manuelle recommandée :`,
      steps: `1. Review de la collection <strong style="color:#D91CD2;">aiScanLogs/</strong> pour ce chatId (Firebase Console → query par senderId).<br/>2. Si pattern abusif confirmé, considérer warn/suspend via admin dashboard T&S (Phase 7 sub-chantier 4).<br/>3. Si faux positifs IA, signaler pour tuning prompt (issue interne).`,
      doctrine: `Cet email est généré automatiquement par le système anti-leak Phase 8 doctrine §B.Q3 (escalation manuelle, pas d'auto-quarantine — biais algorithmique = risque LCD).`,
    },
    en: {
      badge: 'Trust & Safety',
      h1: `Anti-leak L4 — escalation`,
      summary: `User <strong style="color:#ffffff;">${userLabel}</strong> has reached <strong style="color:#D91CD2;">${d.leakCount} anti-leak attempts</strong> in chat <strong style="color:#ffffff;">${d.chatId}</strong>.`,
      lastHitLabel: 'Last hit timestamp',
      motivesLabel: 'Detected motives',
      flagged: `<strong style="color:#ffffff;">Account auto-flagged</strong> (UserProfile.leakFlagged=true). Manual action recommended:`,
      steps: `1. Review the <strong style="color:#D91CD2;">aiScanLogs/</strong> collection for this chatId (Firebase Console → query by senderId).<br/>2. If abusive pattern confirmed, consider warn/suspend via admin T&S dashboard (Phase 7 sub-chantier 4).<br/>3. If AI false positives, flag for prompt tuning (internal issue).`,
      doctrine: `This email is automatically generated by the Phase 8 anti-leak system, doctrine §B.Q3 (manual escalation, no auto-quarantine — algorithmic bias = UCA risk).`,
    },
    de: {
      badge: 'Trust & Safety',
      h1: `Anti-Leak L4 — Eskalation`,
      summary: `Benutzer <strong style="color:#ffffff;">${userLabel}</strong> hat <strong style="color:#D91CD2;">${d.leakCount} Anti-Leak-Versuche</strong> im Chat <strong style="color:#ffffff;">${d.chatId}</strong> erreicht.`,
      lastHitLabel: 'Letzter Treffer',
      motivesLabel: 'Erkannte Motive',
      flagged: `<strong style="color:#ffffff;">Konto automatisch markiert</strong> (UserProfile.leakFlagged=true). Manuelle Aktion empfohlen:`,
      steps: `1. Prüfung der Sammlung <strong style="color:#D91CD2;">aiScanLogs/</strong> für diese chatId (Firebase Console → Abfrage nach senderId).<br/>2. Bei bestätigtem missbräuchlichen Muster Warnung/Sperre über das T&S-Admin-Dashboard erwägen (Phase 7 sub-chantier 4).<br/>3. Bei AI-Falschpositiven für Prompt-Tuning markieren (internes Issue).`,
      doctrine: `Diese E-Mail wird automatisch vom Phase-8-Anti-Leak-System gemäss Doktrin §B.Q3 generiert (manuelle Eskalation, keine Auto-Quarantäne — algorithmische Verzerrung = UWG-Risiko).`,
    },
  }[lang];

  const motiveLine = d.motiveSummary
    ? p(`<strong style="color:#ffffff;">${T.motivesLabel}</strong> : ${d.motiveSummary}`)
    : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.summary)}
    ${p(`${T.lastHitLabel} : <strong style="color:#ffffff;">${d.lastFlaggedAt}</strong>.`)}
    ${motiveLine}
    ${p(T.flagged)}
    ${p(T.steps)}
    ${p(T.doctrine, '40')}
  `;
  return { subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

/**
 * Phase 8 SC4 commit 4/6 — invitation activity reçue (doctrine §E mode Individuel).
 *
 * Subject : "{fromUserName} t'invite à {activityTitle} sur Spordateur"
 * Body : greeting + activity + session date + message? optional + CTA "Voir l'invitation"
 *        → page /invite/[id] où user peut Accepter (Stripe) ou Décliner.
 */
function renderInviteReceived(d: TemplateDataMap['inviteReceived'], lang: EmailLang) {
  const fromLabel = d.fromUserName || (lang === 'fr' ? 'Un membre Spordateur' : lang === 'en' ? 'A Spordateur member' : 'Ein Spordateur-Mitglied');
  const T = {
    fr: {
      subject: `${fromLabel} t'invite à ${d.activityTitle} sur Spordateur`,
      badge: 'Invitation',
      h1: `Tu es invité·e !`,
      greeting: d.toUserName ? `Bonjour ${d.toUserName},` : 'Bonjour,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> t'invite à participer à <strong style="color:#ffffff;">${d.activityTitle}</strong>.`,
      whenLabel: 'Quand',
      cta: `Voir l'invitation`,
      footer: `Tu peux accepter (paiement direct ta part — Phase 8 mode Individuel) ou décliner depuis la page d'invitation. L'invitation expire automatiquement (max 7 jours, jamais après le début de la session).`,
    },
    en: {
      subject: `${fromLabel} invites you to ${d.activityTitle} on Spordateur`,
      badge: 'Invitation',
      h1: `You're invited!`,
      greeting: d.toUserName ? `Hello ${d.toUserName},` : 'Hello,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> invites you to join <strong style="color:#ffffff;">${d.activityTitle}</strong>.`,
      whenLabel: 'When',
      cta: 'View the invitation',
      footer: `You can accept (direct payment of your part — Phase 8 Individual mode) or decline from the invitation page. The invitation expires automatically (max 7 days, never after the session starts).`,
    },
    de: {
      subject: `${fromLabel} lädt dich zu ${d.activityTitle} auf Spordateur ein`,
      badge: 'Einladung',
      h1: `Du bist eingeladen!`,
      greeting: d.toUserName ? `Hallo ${d.toUserName},` : 'Hallo,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> lädt dich zu <strong style="color:#ffffff;">${d.activityTitle}</strong> ein.`,
      whenLabel: 'Wann',
      cta: 'Einladung ansehen',
      footer: `Du kannst von der Einladungsseite aus annehmen (direkte Zahlung deines Anteils — Phase 8, Individuell-Modus) oder ablehnen. Die Einladung läuft automatisch ab (max. 7 Tage, niemals nach Sessionbeginn).`,
    },
  }[lang];

  const messageLine = d.message ? p(`<em>« ${d.message} »</em>`, '100') : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${p(`<strong style="color:#ffffff;">${T.whenLabel}</strong> : ${d.sessionDate}`)}
    ${messageLine}
    ${ctaButton(T.cta, d.inviteLink)}
    ${p(T.footer, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

// =====================================================================
// Phase 9 SC2 c2/6 — modes Split + Gift email templates
// =====================================================================

function renderInviteReceivedSplit(d: TemplateDataMap['inviteReceivedSplit'], lang: EmailLang) {
  const fromLabel = d.fromUserName || (lang === 'fr' ? 'Un membre Spordateur' : lang === 'en' ? 'A Spordateur member' : 'Ein Spordateur-Mitglied');
  const T = {
    fr: {
      subject: `${fromLabel} t'invite à ${d.activityTitle} — partagez la note`,
      badge: 'Invitation Split',
      h1: `Tu es invité·e !`,
      greeting: d.toUserName ? `Bonjour ${d.toUserName},` : 'Bonjour,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> t'invite à participer à <strong style="color:#ffffff;">${d.activityTitle}</strong> et partage la note avec toi.`,
      whenLabel: 'Quand',
      inviterPart: `<strong style="color:#ffffff;">Sa part</strong> : ${d.inviterAmountChf} CHF (déjà payée par ${fromLabel})`,
      yourPart: `<strong style="color:#D91CD2;">Ta part à régler</strong> : ${d.inviteeAmountChf} CHF — Total session ${d.totalAmountChf} CHF`,
      cta: `Accepter et payer ma part (${d.inviteeAmountChf} CHF)`,
      footer: `Tu peux accepter ou décliner depuis la page d'invitation. Si tu décline ou laisse expirer (max 7 jours), ${fromLabel} sera remboursé·e automatiquement.`,
    },
    en: {
      subject: `${fromLabel} invites you to ${d.activityTitle} — split the bill`,
      badge: 'Split invitation',
      h1: `You're invited!`,
      greeting: d.toUserName ? `Hello ${d.toUserName},` : 'Hello,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> invites you to join <strong style="color:#ffffff;">${d.activityTitle}</strong> and splits the bill with you.`,
      whenLabel: 'When',
      inviterPart: `<strong style="color:#ffffff;">Their share</strong>: ${d.inviterAmountChf} CHF (already paid by ${fromLabel})`,
      yourPart: `<strong style="color:#D91CD2;">Your share to pay</strong>: ${d.inviteeAmountChf} CHF — Session total ${d.totalAmountChf} CHF`,
      cta: `Accept and pay my share (${d.inviteeAmountChf} CHF)`,
      footer: `You can accept or decline from the invitation page. If you decline or let it expire (max 7 days), ${fromLabel} will be refunded automatically.`,
    },
    de: {
      subject: `${fromLabel} lädt dich zu ${d.activityTitle} ein — teilt die Rechnung`,
      badge: 'Split-Einladung',
      h1: `Du bist eingeladen!`,
      greeting: d.toUserName ? `Hallo ${d.toUserName},` : 'Hallo,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> lädt dich zu <strong style="color:#ffffff;">${d.activityTitle}</strong> ein und teilt die Rechnung mit dir.`,
      whenLabel: 'Wann',
      inviterPart: `<strong style="color:#ffffff;">Sein/ihr Anteil</strong>: ${d.inviterAmountChf} CHF (bereits von ${fromLabel} bezahlt)`,
      yourPart: `<strong style="color:#D91CD2;">Dein Anteil</strong>: ${d.inviteeAmountChf} CHF — Session-Gesamt ${d.totalAmountChf} CHF`,
      cta: `Annehmen und meinen Anteil zahlen (${d.inviteeAmountChf} CHF)`,
      footer: `Du kannst auf der Einladungsseite annehmen oder ablehnen. Wenn du ablehnst oder die Einladung ablaufen lässt (max. 7 Tage), wird ${fromLabel} automatisch zurückerstattet.`,
    },
  }[lang];

  const messageLine = d.message ? p(`<em>« ${d.message} »</em>`, '100') : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${p(`<strong style="color:#ffffff;">${T.whenLabel}</strong> : ${d.sessionDate}`)}
    ${p(T.inviterPart)}
    ${p(T.yourPart)}
    ${messageLine}
    ${ctaButton(T.cta, d.inviteLink)}
    ${p(T.footer, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderInviteReceivedGift(d: TemplateDataMap['inviteReceivedGift'], lang: EmailLang) {
  const fromLabel = d.fromUserName || (lang === 'fr' ? 'Un membre Spordateur' : lang === 'en' ? 'A Spordateur member' : 'Ein Spordateur-Mitglied');
  const T = {
    fr: {
      subject: `${fromLabel} t'offre ${d.activityTitle} — c'est cadeau !`,
      badge: 'Cadeau',
      h1: `Tu reçois un cadeau ! 🎁`,
      greeting: d.toUserName ? `Bonjour ${d.toUserName},` : 'Bonjour,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> t'offre une session <strong style="color:#ffffff;">${d.activityTitle}</strong>.`,
      whenLabel: 'Quand',
      gift: `<strong style="color:#D91CD2;">C'est cadeau</strong> : tu n'as rien à payer (${d.totalAmountChf} CHF déjà réglés par ${fromLabel}).`,
      cta: `Accepter le cadeau`,
      footer: `Tu peux accepter ou décliner depuis la page d'invitation. Si tu décline ou laisse expirer (max 7 jours), ${fromLabel} sera remboursé·e automatiquement.`,
    },
    en: {
      subject: `${fromLabel} is gifting you ${d.activityTitle} — it's a gift!`,
      badge: 'Gift',
      h1: `You've received a gift! 🎁`,
      greeting: d.toUserName ? `Hello ${d.toUserName},` : 'Hello,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> is gifting you a <strong style="color:#ffffff;">${d.activityTitle}</strong> session.`,
      whenLabel: 'When',
      gift: `<strong style="color:#D91CD2;">It's a gift</strong>: you have nothing to pay (${d.totalAmountChf} CHF already covered by ${fromLabel}).`,
      cta: `Accept the gift`,
      footer: `You can accept or decline from the invitation page. If you decline or let it expire (max 7 days), ${fromLabel} will be refunded automatically.`,
    },
    de: {
      subject: `${fromLabel} schenkt dir ${d.activityTitle} — ein Geschenk!`,
      badge: 'Geschenk',
      h1: `Du hast ein Geschenk erhalten! 🎁`,
      greeting: d.toUserName ? `Hallo ${d.toUserName},` : 'Hallo,',
      intro: `<strong style="color:#ffffff;">${fromLabel}</strong> schenkt dir eine <strong style="color:#ffffff;">${d.activityTitle}</strong>-Session.`,
      whenLabel: 'Wann',
      gift: `<strong style="color:#D91CD2;">Es ist ein Geschenk</strong>: Du musst nichts bezahlen (${d.totalAmountChf} CHF bereits von ${fromLabel} übernommen).`,
      cta: `Geschenk annehmen`,
      footer: `Du kannst auf der Einladungsseite annehmen oder ablehnen. Wenn du ablehnst oder die Einladung ablaufen lässt (max. 7 Tage), wird ${fromLabel} automatisch zurückerstattet.`,
    },
  }[lang];

  const messageLine = d.message ? p(`<em>« ${d.message} »</em>`, '100') : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${p(`<strong style="color:#ffffff;">${T.whenLabel}</strong> : ${d.sessionDate}`)}
    ${p(T.gift)}
    ${messageLine}
    ${ctaButton(T.cta, d.inviteLink)}
    ${p(T.footer, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

// =====================================================================
// Phase 9 SC3 c1/5 — Session reminders J-1 + T-0
// =====================================================================

function renderSessionReminderJMinus1(d: TemplateDataMap['sessionReminderJMinus1'], lang: EmailLang) {
  const T = {
    fr: {
      subject: `Demain : ${d.sessionTitle} avec ${d.partnerName}`,
      badge: 'Rappel',
      h1: `C'est demain !`,
      greeting: d.userName ? `Bonjour ${d.userName},` : 'Bonjour,',
      reminder: `Petit rappel : ta session <strong style="color:#ffffff;">${d.sessionTitle}</strong> avec ${d.partnerName} a lieu demain.`,
      whenLabel: 'Quand',
      placeLabel: 'Lieu',
      cta: `Voir les détails`,
      cancel: `Si tu ne peux plus venir, préviens-nous au plus vite — un partenaire peut prendre ta place.`,
    },
    en: {
      subject: `Tomorrow: ${d.sessionTitle} with ${d.partnerName}`,
      badge: 'Reminder',
      h1: `It's tomorrow!`,
      greeting: d.userName ? `Hello ${d.userName},` : 'Hello,',
      reminder: `Just a reminder: your <strong style="color:#ffffff;">${d.sessionTitle}</strong> session with ${d.partnerName} is tomorrow.`,
      whenLabel: 'When',
      placeLabel: 'Where',
      cta: 'View details',
      cancel: `If you can no longer come, let us know as soon as possible — another partner can take your spot.`,
    },
    de: {
      subject: `Morgen: ${d.sessionTitle} mit ${d.partnerName}`,
      badge: 'Erinnerung',
      h1: `Es ist morgen!`,
      greeting: d.userName ? `Hallo ${d.userName},` : 'Hallo,',
      reminder: `Kleine Erinnerung: Deine <strong style="color:#ffffff;">${d.sessionTitle}</strong>-Session mit ${d.partnerName} findet morgen statt.`,
      whenLabel: 'Wann',
      placeLabel: 'Wo',
      cta: 'Details ansehen',
      cancel: `Wenn du nicht mehr kommen kannst, sag uns so schnell wie möglich Bescheid — ein:e andere:r Partner:in kann deinen Platz übernehmen.`,
    },
  }[lang];

  const addressLine = d.sessionAddress
    ? p(`<strong style="color:#ffffff;">${T.placeLabel}</strong> : ${d.sessionAddress}`)
    : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.reminder)}
    ${p(`<strong style="color:#ffffff;">${T.whenLabel}</strong> : ${d.sessionDate}`)}
    ${addressLine}
    ${ctaButton(T.cta, d.sessionLink)}
    ${p(T.cancel, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderSessionReminderTMinus0(d: TemplateDataMap['sessionReminderTMinus0'], lang: EmailLang) {
  const T = {
    fr: {
      subject: `Dans 1h : ${d.sessionTitle}`,
      badge: 'Imminent',
      h1: `Ça commence dans 1h !`,
      greeting: d.userName ? `Salut ${d.userName} !` : 'Salut !',
      reminder: `Ta session <strong style="color:#ffffff;">${d.sessionTitle}</strong> avec ${d.partnerName} démarre dans environ 1h.`,
      placeLabel: 'Lieu',
      cta: `Voir les détails`,
      tip: `Pense à arriver 5-10 minutes en avance pour t'installer.`,
    },
    en: {
      subject: `In 1h: ${d.sessionTitle}`,
      badge: 'Imminent',
      h1: `It starts in 1h!`,
      greeting: d.userName ? `Hi ${d.userName}!` : 'Hi!',
      reminder: `Your <strong style="color:#ffffff;">${d.sessionTitle}</strong> session with ${d.partnerName} starts in about 1 hour.`,
      placeLabel: 'Where',
      cta: 'View details',
      tip: `Try to arrive 5-10 minutes early to settle in.`,
    },
    de: {
      subject: `In 1h: ${d.sessionTitle}`,
      badge: 'Bald',
      h1: `Es beginnt in 1h!`,
      greeting: d.userName ? `Hallo ${d.userName}!` : 'Hallo!',
      reminder: `Deine <strong style="color:#ffffff;">${d.sessionTitle}</strong>-Session mit ${d.partnerName} beginnt in etwa 1 Stunde.`,
      placeLabel: 'Wo',
      cta: 'Details ansehen',
      tip: `Komm am besten 5-10 Minuten früher, um dich einzurichten.`,
    },
  }[lang];

  const addressLine = d.sessionAddress
    ? p(`<strong style="color:#ffffff;">${T.placeLabel}</strong> : ${d.sessionAddress}`)
    : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.reminder)}
    ${p(`<strong style="color:#D91CD2;">${d.sessionDate}</strong>`)}
    ${addressLine}
    ${ctaButton(T.cta, d.sessionLink)}
    ${p(T.tip, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

/**
 * Fix #118 — Fallback email "tu as un nouveau message" envoyé quand le push FCM
 * échoue (token-invalid, opt-out push, navigateur fermé sans SW background sur iOS).
 * Permet de ne plus rater une notif chat même si la chaîne push casse.
 */
function renderChatMessageReceived(d: TemplateDataMap['chatMessageReceived'], lang: EmailLang) {
  const safePreview = d.messagePreview.length > 80
    ? d.messagePreview.substring(0, 80) + '…'
    : d.messagePreview;

  const T = {
    fr: {
      subject: `${d.fromUserName} t'a écrit sur Spordateur`,
      badge: 'Message',
      h1: `Nouveau message`,
      greeting: d.toUserName ? `Salut ${d.toUserName} !` : `Salut !`,
      intro: `<strong style="color:#ffffff;">${d.fromUserName}</strong> t'a envoyé un message :`,
      cta: `Répondre maintenant`,
      tip: `Active les notifications push dans Réglages pour recevoir les messages en direct.`,
    },
    en: {
      subject: `${d.fromUserName} sent you a message on Spordateur`,
      badge: 'Message',
      h1: `New message`,
      greeting: d.toUserName ? `Hi ${d.toUserName}!` : `Hi!`,
      intro: `<strong style="color:#ffffff;">${d.fromUserName}</strong> sent you a message:`,
      cta: 'Reply now',
      tip: `Enable push notifications in Settings to receive messages in real time.`,
    },
    de: {
      subject: `${d.fromUserName} hat dir auf Spordateur geschrieben`,
      badge: 'Nachricht',
      h1: `Neue Nachricht`,
      greeting: d.toUserName ? `Hallo ${d.toUserName}!` : `Hallo!`,
      intro: `<strong style="color:#ffffff;">${d.fromUserName}</strong> hat dir eine Nachricht geschickt:`,
      cta: 'Jetzt antworten',
      tip: `Aktiviere Push-Benachrichtigungen in den Einstellungen, um Nachrichten in Echtzeit zu erhalten.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;background:rgba(217,28,210,0.08);border-left:3px solid #D91CD2;"><tr><td style="padding:12px 16px;">
      <span style="color:rgba(255,255,255,0.9);font-style:italic;font-size:14px;line-height:1.5;font-weight:300;">${safePreview}</span>
    </td></tr></table>
    ${ctaButton(T.cta, d.chatLink)}
    ${p(T.tip, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

/**
 * Fix #127 — Contact partenaire envoyé à un admin Spordateur. L'admin lit en FR
 * en pratique : on garde le template essentiellement français mais on honore `lang`
 * pour cohérence (utile si un jour on route vers un admin EN/DE).
 */
function renderPartnerContactRequest(d: TemplateDataMap['partnerContactRequest'], lang: EmailLang) {
  // Escape minimal pour empêcher injection HTML dans le mail admin (defense in depth :
  // l'API valide déjà mais on protège quand même le render).
  const esc = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const safeName = esc(d.fromName);
  const safeEmail = esc(d.fromEmail);
  const safeStudio = d.studioName ? esc(d.studioName) : '';
  const safePhone = d.phone ? esc(d.phone) : '';
  const safeCity = d.city ? esc(d.city) : '';
  const safeMessage = esc(d.message).replace(/\n/g, '<br>');

  const T = {
    fr: {
      subject: `[Spordateur] Nouveau message partenaire — ${d.fromName}${d.studioName ? ` (${d.studioName})` : ''}`,
      badge: 'Contact',
      h1: `Nouveau message`,
      intro: `Un visiteur a rempli le formulaire "Nous contacter" depuis la page d'accueil.`,
      labels: { name: 'Nom', email: 'Email', studio: 'Studio', phone: 'Téléphone', city: 'Ville' },
      messageTitle: 'Message',
      cta: `Répondre à ${safeName}`,
      ctaSubject: 'Re: contact partenaire Spordateur',
      footer: `Pour répondre, clique sur le bouton ou utilise simplement la fonction "Répondre" de ton client mail — l'expéditeur recevra ta réponse directement.`,
    },
    en: {
      subject: `[Spordateur] New partner message — ${d.fromName}${d.studioName ? ` (${d.studioName})` : ''}`,
      badge: 'Contact',
      h1: `New message`,
      intro: `A visitor filled out the "Contact us" form from the home page.`,
      labels: { name: 'Name', email: 'Email', studio: 'Studio', phone: 'Phone', city: 'City' },
      messageTitle: 'Message',
      cta: `Reply to ${safeName}`,
      ctaSubject: 'Re: Spordateur partner contact',
      footer: `To reply, click the button or just use the "Reply" function of your mail client — the sender will receive your reply directly.`,
    },
    de: {
      subject: `[Spordateur] Neue Partner-Nachricht — ${d.fromName}${d.studioName ? ` (${d.studioName})` : ''}`,
      badge: 'Kontakt',
      h1: `Neue Nachricht`,
      intro: `Eine besuchende Person hat das "Kontakt"-Formular auf der Startseite ausgefüllt.`,
      labels: { name: 'Name', email: 'E-Mail', studio: 'Studio', phone: 'Telefon', city: 'Stadt' },
      messageTitle: 'Nachricht',
      cta: `${safeName} antworten`,
      ctaSubject: 'Re: Spordateur-Partnerkontakt',
      footer: `Um zu antworten, klicke auf den Button oder nutze einfach die "Antworten"-Funktion deines Mail-Clients — der Absender erhält deine Antwort direkt.`,
    },
  }[lang];

  const detailRow = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:6px 0;color:rgba(255,255,255,0.4);font-size:12px;font-weight:300;width:120px;">${label}</td><td style="padding:6px 0;color:#ffffff;font-size:13px;font-weight:300;">${value}</td></tr>`
      : '';

  const body = `
    ${h1(T.h1)}
    ${p(T.intro)}
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:16px 0 8px 0;border-top:1px solid rgba(255,255,255,0.1);border-bottom:1px solid rgba(255,255,255,0.1);padding:12px 0;">
      ${detailRow(T.labels.name, safeName)}
      ${detailRow(T.labels.email, `<a href="mailto:${safeEmail}" style="color:#D91CD2;text-decoration:none;">${safeEmail}</a>`)}
      ${detailRow(T.labels.studio, safeStudio)}
      ${detailRow(T.labels.phone, safePhone)}
      ${detailRow(T.labels.city, safeCity)}
    </table>
    <p style="color:rgba(255,255,255,0.4);font-size:11px;font-weight:300;margin:24px 0 8px 0;letter-spacing:0.1em;text-transform:uppercase;">${T.messageTitle}</p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;background:rgba(217,28,210,0.06);border-left:3px solid #D91CD2;"><tr><td style="padding:16px 18px;">
      <span style="color:rgba(255,255,255,0.9);font-size:14px;line-height:1.6;font-weight:300;">${safeMessage}</span>
    </td></tr></table>
    ${ctaButton(T.cta, `mailto:${safeEmail}?subject=${encodeURIComponent(T.ctaSubject)}`)}
    ${p(T.footer, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

function renderPasswordResetCustom(d: TemplateDataMap['passwordResetCustom'], lang: EmailLang) {
  const T = {
    fr: {
      subject: `Réinitialise ton mot de passe Spordateur`,
      badge: 'Mot de passe',
      h1: `Mot de passe oublié ?`,
      greeting: d.userName ? `Salut ${d.userName} !` : `Salut !`,
      intro: `Tu as demandé à réinitialiser ton mot de passe sur Spordateur. Clique sur le bouton ci-dessous pour choisir un nouveau mot de passe.`,
      cta: `Choisir un nouveau mot de passe`,
      expires: `Ce lien expire dans <strong style="color:#ffffff;">${d.expiresInHours}h</strong>. Au-delà, tu devras refaire la demande.`,
      noRequest: `Si tu n'as pas demandé cette réinitialisation, ignore cet email — ton compte est en sécurité.`,
    },
    en: {
      subject: `Reset your Spordateur password`,
      badge: 'Password',
      h1: `Forgot your password?`,
      greeting: d.userName ? `Hi ${d.userName}!` : `Hi!`,
      intro: `You requested to reset your password on Spordateur. Click the button below to choose a new password.`,
      cta: 'Choose a new password',
      expires: `This link expires in <strong style="color:#ffffff;">${d.expiresInHours}h</strong>. After that, you'll need to request a new one.`,
      noRequest: `If you didn't request this reset, ignore this email — your account is safe.`,
    },
    de: {
      subject: `Setze dein Spordateur-Passwort zurück`,
      badge: 'Passwort',
      h1: `Passwort vergessen?`,
      greeting: d.userName ? `Hallo ${d.userName}!` : `Hallo!`,
      intro: `Du hast angefordert, dein Passwort auf Spordateur zurückzusetzen. Klicke auf den Button unten, um ein neues Passwort zu wählen.`,
      cta: 'Neues Passwort wählen',
      expires: `Dieser Link läuft in <strong style="color:#ffffff;">${d.expiresInHours}h</strong> ab. Danach musst du eine neue Anfrage stellen.`,
      noRequest: `Wenn du diese Zurücksetzung nicht angefordert hast, ignoriere diese E-Mail — dein Konto ist sicher.`,
    },
  }[lang];

  const body = `
    ${h1(T.h1)}
    ${p(T.greeting)}
    ${p(T.intro)}
    ${ctaButton(T.cta, d.resetUrl)}
    ${p(T.expires, '40')}
    ${p(T.noRequest, '40')}
  `;
  return { subject: T.subject, html: layout({ headerBadgeText: T.badge, bodyHtml: body, lang }) };
}

// =====================================================================
// Public renderTemplate (type-safe dispatch)
// =====================================================================

/**
 * Render un template email type-safe.
 *
 * @param templateName Identifiant du template
 * @param data         Données typées via TemplateDataMap[T]
 * @param lang         Langue destinataire. Default 'fr' (backward compat).
 */
export function renderTemplate<T extends TemplateName>(
  templateName: T,
  data: TemplateDataMap[T],
  lang: EmailLang = 'fr',
): { subject: string; html: string } {
  switch (templateName) {
    case 'bookingConfirmation':
      return renderBookingConfirmation(data as TemplateDataMap['bookingConfirmation'], lang);
    case 'reviewReminder':
      return renderReviewReminder(data as TemplateDataMap['reviewReminder'], lang);
    case 'appealAcknowledgment':
      return renderAppealAcknowledgment(data as TemplateDataMap['appealAcknowledgment'], lang);
    case 'reviewBonusGranted':
      return renderReviewBonusGranted(data as TemplateDataMap['reviewBonusGranted'], lang);
    case 'reviewPendingModeration':
      return renderReviewPendingModeration(data as TemplateDataMap['reviewPendingModeration'], lang);
    case 'reviewModerationDecision':
      return renderReviewModerationDecision(data as TemplateDataMap['reviewModerationDecision'], lang);
    case 'reportSubmitted':
      return renderReportSubmitted(data as TemplateDataMap['reportSubmitted'], lang);
    case 'userSanctionNotice':
      return renderUserSanctionNotice(data as TemplateDataMap['userSanctionNotice'], lang);
    case 'noShowWarningNotice':
      return renderNoShowWarningNotice(data as TemplateDataMap['noShowWarningNotice'], lang);
    case 'partnerNoShowConfirmed':
      return renderPartnerNoShowConfirmed(data as TemplateDataMap['partnerNoShowConfirmed'], lang);
    case 'userSanctionOverturned':
      return renderUserSanctionOverturned(data as TemplateDataMap['userSanctionOverturned'], lang);
    case 'appealResolved':
      return renderAppealResolved(data as TemplateDataMap['appealResolved'], lang);
    case 'leakEscalationAdmin':
      return renderLeakEscalationAdmin(data as TemplateDataMap['leakEscalationAdmin'], lang);
    case 'inviteReceived':
      return renderInviteReceived(data as TemplateDataMap['inviteReceived'], lang);
    case 'inviteReceivedSplit':
      return renderInviteReceivedSplit(data as TemplateDataMap['inviteReceivedSplit'], lang);
    case 'inviteReceivedGift':
      return renderInviteReceivedGift(data as TemplateDataMap['inviteReceivedGift'], lang);
    case 'sessionReminderJMinus1':
      return renderSessionReminderJMinus1(data as TemplateDataMap['sessionReminderJMinus1'], lang);
    case 'sessionReminderTMinus0':
      return renderSessionReminderTMinus0(data as TemplateDataMap['sessionReminderTMinus0'], lang);
    case 'passwordResetCustom':
      return renderPasswordResetCustom(data as TemplateDataMap['passwordResetCustom'], lang);
    case 'chatMessageReceived':
      return renderChatMessageReceived(data as TemplateDataMap['chatMessageReceived'], lang);
    case 'partnerContactRequest':
      return renderPartnerContactRequest(data as TemplateDataMap['partnerContactRequest'], lang);
    default: {
      // Exhaustive check — TypeScript should error if a new TemplateName is added without case
      const _exhaustive: never = templateName;
      throw new Error(`Unknown template: ${String(_exhaustive)}`);
    }
  }
}

// Re-exports utilitaires (gardent BUNDLE-level the const utility exports si jamais
// quelqu'un les a importés). Conservés pour backward compat des consommateurs externes.
export { SANCTION_LEVEL_LABELS, SANCTION_REASON_LABELS };

// Petite utilité — suppression du warning lint sur BONJOUR/SALUT non utilisés directement
// dans les templates parce qu'on inline les greetings par variante de langue.
// Garde l'export pour usage futur sans introduire un module dedicated.
export const _i18nExports = { BONJOUR, SALUT, MEMBER_FALLBACK, PARTNER_FALLBACK };
