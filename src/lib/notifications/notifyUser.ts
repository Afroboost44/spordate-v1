/**
 * BUG #116 — Helper "fire-and-forget" pour notifier un utilisateur côté serveur.
 *
 * Pipeline :
 *   1. Lit users/{uid}.fcmToken + pushNotificationsEnabled + language depuis Firestore Admin
 *   2. Skip si toggle off ou pas de token
 *   3. Si messageKey fourni → traduit via tPush(lang, key, params) en utilisant
 *      la `language` lue depuis le user doc (fallback 'fr')
 *   4. Appelle sendPushNotification (FCM)
 *   5. Cleanup automatique si token-not-registered/token-invalid (deleteField)
 *
 * Best-effort : ne throw JAMAIS, retourne juste un résultat. Les appelants
 * (match mutual, chat send, booking webhook, etc.) peuvent appeler en
 * `void notifyUser(...)` sans bloquer le flux principal.
 *
 * À utiliser pour TOUS les events live :
 *   - Match mutual (match-fr-fr → user reçoit "C'est un match !")
 *   - Nouveau message chat
 *   - Like reçu
 *   - Activity invite reçue
 *   - Booking confirmé (déjà fait via webhook Stripe, à compléter)
 *
 * Fix Push i18n — Deux signatures supportées :
 *   1. Legacy (title/body fournis directement, pas de traduction) :
 *        notifyUser({ uid, title: '...', body: '...' })
 *   2. Recommandée (messageKey + params, traduit selon users.language) :
 *        notifyUser({ uid, messageKey: 'chat_new_message', params: { senderName, preview } })
 */

import { sendPushNotification } from './sendPushNotification';
import { coerceLang, tPush, type MessageKey } from '@/lib/i18n/serverTranslations';

interface NotifyUserOptionsBase {
  uid: string;
  /** URL de redirection au click sur la notif (relatif ou absolu). */
  clickUrl?: string;
  /** Data custom (chatId, matchId, etc.) accessible dans le SW background handler. */
  data?: Record<string, string>;
}

interface NotifyUserOptionsLegacy extends NotifyUserOptionsBase {
  /** Mode legacy : titre brut (pas traduit). */
  title: string;
  /** Mode legacy : body brut (pas traduit). */
  body: string;
  messageKey?: never;
  params?: never;
}

interface NotifyUserOptionsI18n extends NotifyUserOptionsBase {
  /** Mode i18n : clé de message, traduit selon users.language au moment de l'envoi. */
  messageKey: MessageKey;
  /** Params interpolés dans le template (ex: { senderName, preview }). */
  params?: Record<string, string | number | undefined>;
  title?: never;
  body?: never;
}

export type NotifyUserOptions = NotifyUserOptionsLegacy | NotifyUserOptionsI18n;

interface NotifyUserResult {
  ok: boolean;
  /** Raison du skip / échec pour debugging. */
  reason?: 'no-uid' | 'no-token' | 'opt-out' | 'fcm-fail' | 'db-error' | 'token-invalid';
  detail?: string;
}

/**
 * Lit settings/site/baseUrl ou retombe sur env var. Pour construire clickUrl absolu.
 * Le SW utilise webpush.fcmOptions.link qui exige URL absolue.
 */
function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com').replace(/\/$/, '');
}

export async function notifyUser(opts: NotifyUserOptions): Promise<NotifyUserResult> {
  const { uid, clickUrl, data } = opts;
  if (!uid) return { ok: false, reason: 'no-uid' };

  // Validation early : un seul mode doit être fourni.
  const hasLegacy = typeof opts.title === 'string' && typeof opts.body === 'string';
  const hasI18n = typeof opts.messageKey === 'string';
  if (!hasLegacy && !hasI18n) {
    return { ok: false, reason: 'no-uid', detail: 'missing title/body or messageKey' };
  }

  try {
    // Lazy init Admin SDK (cohérent avec sendPushNotification.ts qui le fait déjà)
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
    if (!getApps().length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        initializeApp({
          credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]),
        });
      } else {
        initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordate-prod' });
      }
    }
    const db = getFirestore();

    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return { ok: false, reason: 'no-token', detail: 'user doc absent' };
    const data_ = snap.data() || {};
    const token = data_.fcmToken as string | undefined;
    const enabled = data_.pushNotificationsEnabled !== false; // default true
    if (!token) return { ok: false, reason: 'no-token' };
    if (!enabled) return { ok: false, reason: 'opt-out' };

    // Fix Push i18n — résolution title/body selon le mode.
    let title: string;
    let body: string;
    if (hasI18n) {
      const lang = coerceLang(data_.language);
      const tpl = tPush(lang, opts.messageKey as MessageKey, opts.params);
      title = tpl.title;
      body = tpl.body;
    } else {
      title = opts.title as string;
      body = opts.body as string;
    }

    if (!title || !body) return { ok: false, reason: 'no-uid', detail: 'empty title/body after render' };

    // Build absolute URL pour clickUrl (webpush fcm_options.link exige absolu)
    const fullClickUrl = clickUrl
      ? clickUrl.startsWith('http') ? clickUrl : `${getBaseUrl()}${clickUrl.startsWith('/') ? clickUrl : '/' + clickUrl}`
      : undefined;

    const result = await sendPushNotification({
      fcmToken: token,
      title,
      body,
      clickUrl: fullClickUrl,
      data,
    });

    // Cleanup automatique si token-not-registered ou token-invalid (user a
    // désinstallé la PWA, changé device, etc.). On efface le token pour
    // ne plus retenter et éviter les retries inutiles.
    if (!result.ok && (result.reason === 'token-not-registered' || result.reason === 'token-invalid')) {
      try {
        await userRef.update({
          fcmToken: FieldValue.delete(),
          pushNotificationsEnabled: false,
        });
      } catch (err) {
        console.warn('[notifyUser] cleanup failed', err);
      }
      return { ok: false, reason: 'token-invalid', detail: result.detail };
    }

    if (!result.ok) return { ok: false, reason: 'fcm-fail', detail: result.detail };
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[notifyUser] error', { uid, detail });
    return { ok: false, reason: 'db-error', detail };
  }
}
