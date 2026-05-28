import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';
/**
 * Phase 9 sub-chantier 3 commit 2/5 — Helper sendPushNotification (server-side).
 *
 * Wrapper firebase-admin/messaging. Pattern cohérent SC2 c3/6 connectHelpers + SC5 c4/5
 * refundForSanction (lazy-init + DI seam pour tests).
 *
 * Best-effort : si push fail (token invalid, FCM API down, etc.) → return ok=false
 * + reason. Caller (cron) doit fallback email automatiquement.
 *
 * Usage Phase 9 SC3 c2/5 :
 *   const r = await sendPushNotification({fcmToken, title, body, data?});
 *   if (r.ok) { skip email — push délivré }
 *   else { fallback email — push échoué (token invalide, FCM down, etc.) }
 *
 * Errors common :
 *  - 'messaging/registration-token-not-registered' → user désinstallé app, fcmToken obsolète
 *  - 'messaging/invalid-registration-token' → format token invalide
 *  - 'messaging/mismatched-credential' → projet ID mismatch
 *
 * Cf. https://firebase.google.com/docs/cloud-messaging/manage-tokens pour cleanup.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _messagingOverride: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _messagingReal: any = null;

/**
 * @internal — DI seam pour tests/notifications/*.test.ts.
 * Cohérent pattern SC2 c3/6 (`__setSharedStripeForTesting`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setMessagingForTesting(mock: any): void {
  _messagingOverride = mock;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMessaging(): Promise<any> {
  if (_messagingOverride) return _messagingOverride;
  if (_messagingReal) return _messagingReal;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getMessaging: getMsgFn } = await import('firebase-admin/messaging');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _messagingReal = getMsgFn();
  return _messagingReal;
}

export interface SendPushInput {
  /** FCM registration token (depuis UserProfile.fcmToken). */
  fcmToken: string;
  /** Notification title (max 65 chars recommandé pour Android/iOS). */
  title: string;
  /** Notification body (max 240 chars recommandé). */
  body: string;
  /** Data payload optionnel (deeplink, IDs, etc.). String values uniquement (FCM constraint). */
  data?: Record<string, string>;
  /** URL absolue à ouvrir au clic (web push). */
  clickUrl?: string;
}

export type SendPushReason =
  | 'invalid-input'
  | 'token-invalid'
  | 'token-not-registered'
  | 'fcm-error';

export interface SendPushResult {
  /** True si message accepté par FCM (pas garanti délivré). */
  ok: boolean;
  /** Message ID FCM si ok=true. */
  messageId?: string;
  /** Code raison si ok=false. */
  reason?: SendPushReason;
  /** Détail erreur (pour log uniquement). */
  detail?: string;
}

/**
 * Envoie une notification push via FCM. Best-effort silent — caller fallback email
 * si ok=false.
 *
 * Token cleanup Phase 10 polish : si reason='token-not-registered' ou 'token-invalid',
 * caller pourra effacer `users.{uid}.fcmToken` pour éviter retries (out of scope SC3 c2).
 */
export async function sendPushNotification(input: SendPushInput): Promise<SendPushResult> {
  if (!input.fcmToken || !input.title || !input.body) {
    return { ok: false, reason: 'invalid-input' };
  }

  const messaging = await getMessaging();

  // FCM message structure cohérent firebase-admin/messaging API.
  // BUG #116 — Payload enrichi pour iOS PWA + Chrome Android :
  //  - webpush.headers.Urgency 'high' : iOS livre immédiatement (vs batch)
  //  - webpush.notification.icon : visuel branding Spordateur
  //  - webpush.notification.requireInteraction false : auto-dismiss
  //  - webpush.notification.vibrate : vibration Android
  //  - fcmOptions.link : URL de redirection au click
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message: any = {
    token: input.fcmToken,
    notification: {
      title: input.title,
      body: input.body,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '3600',
      },
      notification: {
        title: input.title,
        body: input.body,
        icon: '/icons/placeholder.png',
        badge: '/icons/placeholder.png',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vibrate: [200, 100, 200],
        requireInteraction: false,
        silent: false,
      },
    } as Record<string, unknown>,
  };
  if (input.data) {
    message.data = input.data;
  }
  if (input.clickUrl) {
    message.webpush.fcmOptions = { link: input.clickUrl };
  }

  try {
    const messageId = (await messaging.send(message)) as string;
    return { ok: true, messageId };
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any)?.code as string | undefined;
    const detail = err instanceof Error ? err.message : String(err);

    if (code === 'messaging/registration-token-not-registered') {
      return { ok: false, reason: 'token-not-registered', detail };
    }
    if (code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') {
      return { ok: false, reason: 'token-invalid', detail };
    }
    console.warn('[sendPushNotification] FCM error', { code, detail });
    return { ok: false, reason: 'fcm-error', detail };
  }
}
