/**
 * Fix Push i18n — Templates de notifications push FCM côté serveur.
 *
 * Objectif : envoyer une notif push dans la langue du destinataire (FR/EN/DE).
 * Le LanguageContext.tsx est client-only — on ne peut pas l'importer ici. Ce
 * module est la source de vérité serveur, isolé et minimal.
 *
 * Pattern :
 *   const { title, body } = tPush(userLang, 'chat_new_message', { senderName, preview });
 *
 * Pour ajouter une clé : étendre `MessageKey` + ajouter l'entrée dans les 3 langues
 * du dictionnaire `PUSH_TEMPLATES`. TypeScript force la complétude.
 *
 * Interpolation : `{name}` dans le template → remplacé par `params.name`. Les
 * params manquants sont remplacés par chaîne vide (best-effort, pas de throw).
 */

export type ServerLang = 'fr' | 'en' | 'de';

export const SUPPORTED_LANGS: ReadonlyArray<ServerLang> = ['fr', 'en', 'de'];

export const DEFAULT_LANG: ServerLang = 'fr';

/**
 * Liste des MessageKey supportées. Étendre ici quand on ajoute un nouvel event push.
 *  - chat_new_message              : "{senderName} t'a écrit" / preview
 *  - match_mutual                  : "C'est un match !" — match mutuel détecté
 *  - test_push                     : diagnostique /api/test-push
 *  - referral_commission_received  : commission CHF reçue (creator ou invite)
 *  - referral_free_class_creator   : N cours offerts via lien créateur
 *  - referral_free_class_invite    : N cours offerts via parrainage user
 *  - referral_commission_reversed  : commission CHF annulée suite à un refund Stripe
 *  - referral_free_class_reversed_one / _other : N crédit(s) parrainage retirés
 *    suite à un refund Stripe (mode free-class).
 */
export type MessageKey =
  | 'chat_new_message'
  | 'match_mutual'
  | 'test_push'
  | 'referral_commission_received'
  | 'referral_free_class_creator_one'
  | 'referral_free_class_creator_other'
  | 'referral_free_class_invite_one'
  | 'referral_free_class_invite_other'
  | 'referral_commission_reversed'
  | 'referral_free_class_reversed_one'
  | 'referral_free_class_reversed_other';

export interface PushTemplate {
  title: string;
  body: string;
}

/**
 * Coerce une valeur arbitraire en `ServerLang`. Fallback `DEFAULT_LANG`
 * si la valeur n'est pas une langue supportée.
 */
export function coerceLang(value: unknown): ServerLang {
  if (typeof value === 'string' && (SUPPORTED_LANGS as ReadonlyArray<string>).includes(value)) {
    return value as ServerLang;
  }
  return DEFAULT_LANG;
}

/**
 * Dictionnaire complet (FR source de vérité, EN/DE traductions).
 * Les placeholders `{name}` sont interpolés par `tPush`.
 */
export const PUSH_TEMPLATES: Record<ServerLang, Record<MessageKey, PushTemplate>> = {
  fr: {
    chat_new_message: {
      title: "{senderName} t'a écrit",
      body: '{preview}',
    },
    match_mutual: {
      title: "🎉 C'est un match !",
      body: 'Vous vous êtes likés. Lancez la conversation.',
    },
    test_push: {
      title: '🎉 Test Spordateur',
      body: 'Si tu lis ceci, les push fonctionnent. Tu peux fermer cette notif.',
    },
    referral_commission_received: {
      title: 'Commission reçue !',
      body: '+{amount} CHF de commission sur un achat de ton filleul',
    },
    referral_free_class_creator_one: {
      title: 'Cours offert reçu !',
      body: '+{credits} cours offert via ton lien créateur',
    },
    referral_free_class_creator_other: {
      title: '{credits} cours offerts reçus !',
      body: '+{credits} cours offerts via ton lien créateur',
    },
    referral_free_class_invite_one: {
      title: 'Cours offert reçu !',
      body: '+{credits} cours offert — ton ami a fait un achat',
    },
    referral_free_class_invite_other: {
      title: '{credits} cours offerts reçus !',
      body: '+{credits} cours offerts — ton ami a fait un achat',
    },
    referral_commission_reversed: {
      title: 'Commission annulée',
      body: 'Une commission de {amount} CHF a été annulée suite à un remboursement client.',
    },
    referral_free_class_reversed_one: {
      title: 'Crédit parrainage retiré',
      body: '{credits} crédit parrainage a été retiré suite à un remboursement client.',
    },
    referral_free_class_reversed_other: {
      title: 'Crédits parrainage retirés',
      body: '{credits} crédits parrainage ont été retirés suite à un remboursement client.',
    },
  },
  en: {
    chat_new_message: {
      title: '{senderName} sent you a message',
      body: '{preview}',
    },
    match_mutual: {
      title: "🎉 It's a match!",
      body: 'You liked each other. Start the conversation.',
    },
    test_push: {
      title: '🎉 Spordateur test',
      body: 'If you can read this, push notifications work. You can close this notification.',
    },
    referral_commission_received: {
      title: 'Commission received!',
      body: '+{amount} CHF commission on a purchase by your referral',
    },
    referral_free_class_creator_one: {
      title: 'Free class received!',
      body: '+{credits} free class via your creator link',
    },
    referral_free_class_creator_other: {
      title: '{credits} free classes received!',
      body: '+{credits} free classes via your creator link',
    },
    referral_free_class_invite_one: {
      title: 'Free class received!',
      body: '+{credits} free class — your friend made a purchase',
    },
    referral_free_class_invite_other: {
      title: '{credits} free classes received!',
      body: '+{credits} free classes — your friend made a purchase',
    },
    referral_commission_reversed: {
      title: 'Commission reversed',
      body: 'A {amount} CHF commission was reversed due to a customer refund.',
    },
    referral_free_class_reversed_one: {
      title: 'Referral credit removed',
      body: '{credits} referral credit was removed due to a customer refund.',
    },
    referral_free_class_reversed_other: {
      title: 'Referral credits removed',
      body: '{credits} referral credits were removed due to a customer refund.',
    },
  },
  de: {
    chat_new_message: {
      title: '{senderName} hat dir geschrieben',
      body: '{preview}',
    },
    match_mutual: {
      title: '🎉 Es ist ein Match!',
      body: 'Ihr habt euch gegenseitig geliked. Starte die Unterhaltung.',
    },
    test_push: {
      title: '🎉 Spordateur-Test',
      body: 'Wenn du dies lesen kannst, funktionieren die Push-Benachrichtigungen. Du kannst diese Mitteilung schliessen.',
    },
    referral_commission_received: {
      title: 'Provision erhalten!',
      body: '+{amount} CHF Provision für einen Kauf deines Empfohlenen',
    },
    referral_free_class_creator_one: {
      title: 'Gratiskurs erhalten!',
      body: '+{credits} Gratiskurs über deinen Creator-Link',
    },
    referral_free_class_creator_other: {
      title: '{credits} Gratiskurse erhalten!',
      body: '+{credits} Gratiskurse über deinen Creator-Link',
    },
    referral_free_class_invite_one: {
      title: 'Gratiskurs erhalten!',
      body: '+{credits} Gratiskurs — dein Freund hat einen Kauf getätigt',
    },
    referral_free_class_invite_other: {
      title: '{credits} Gratiskurse erhalten!',
      body: '+{credits} Gratiskurse — dein Freund hat einen Kauf getätigt',
    },
    referral_commission_reversed: {
      title: 'Provision storniert',
      body: 'Eine Provision von {amount} CHF wurde aufgrund einer Kundenrückerstattung storniert.',
    },
    referral_free_class_reversed_one: {
      title: 'Empfehlungskredit entfernt',
      body: '{credits} Empfehlungskredit wurde aufgrund einer Kundenrückerstattung entfernt.',
    },
    referral_free_class_reversed_other: {
      title: 'Empfehlungskredite entfernt',
      body: '{credits} Empfehlungskredite wurden aufgrund einer Kundenrückerstattung entfernt.',
    },
  },
};

/**
 * Interpole `{key}` → params[key]. Tolérant : si une clé manque, remplace par ''.
 * Pas de regex complexe — split/join simple sur chaque clé fournie.
 */
function interpolate(template: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return template;
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{${key}}`;
    if (out.includes(placeholder)) {
      out = out.split(placeholder).join(value == null ? '' : String(value));
    }
  }
  return out;
}

/**
 * Retourne `{ title, body }` traduit + interpolé pour la langue donnée.
 * Fallback automatique sur DEFAULT_LANG si une clé manque dans `lang`
 * (ne devrait jamais arriver grâce au typage strict, mais robust quand
 * on ajoute une nouvelle key et qu'on oublie une langue).
 */
export function tPush(
  lang: ServerLang,
  key: MessageKey,
  params?: Record<string, string | number | undefined>,
): PushTemplate {
  const dictForLang = PUSH_TEMPLATES[lang] ?? PUSH_TEMPLATES[DEFAULT_LANG];
  const template = dictForLang[key] ?? PUSH_TEMPLATES[DEFAULT_LANG][key];
  return {
    title: interpolate(template.title, params),
    body: interpolate(template.body, params),
  };
}
