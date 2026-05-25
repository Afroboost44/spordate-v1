/**
 * Phase 9 sub-chantier 3 commit 3/5 — Client helper register/unregister push notifications.
 *
 * Pipeline registerPushNotifications(uid) :
 *   1. Detect browser support : 'serviceWorker' in navigator + 'Notification' in window
 *      (Q6=A silent skip si non-supporté — ex: Safari iOS <16.4)
 *   2. Register Firebase Messaging Service Worker `/firebase-messaging-sw.js` (scope `/`)
 *   3. Notification.requestPermission() → si denied/default → return ok=false
 *   4. firebase/messaging client SDK getToken({vapidKey: NEXT_PUBLIC_FIREBASE_VAPID_KEY})
 *   5. Persist users/{uid}.fcmToken via Firestore client SDK
 *   6. Return {ok:true, token}
 *
 * Pipeline unregisterPushNotifications(uid) :
 *   1. Remove fcmToken from user doc (FieldValue.delete())
 *   2. deleteToken(messaging) (revoke côté Firebase)
 *
 * Errors typed (cohérent SC3 c2/5 sendPushNotification reasons) :
 *  - 'unsupported' : browser pas support push (Safari iOS <16.4, anciens navigateurs)
 *  - 'permission-denied' : user a refusé Notification permission
 *  - 'permission-default' : user a fermé le prompt (pas accepté)
 *  - 'no-vapid-key' : NEXT_PUBLIC_FIREBASE_VAPID_KEY env var manquant (config bug)
 *  - 'fcm-error' : Firebase Messaging API error
 *  - 'firestore-error' : write users.{uid}.fcmToken fail
 *
 * Best-effort : never throw — caller (UI Switch) affiche toast selon reason.
 */

export type RegisterPushReason =
  | 'unsupported'
  | 'permission-denied'
  | 'permission-default'
  | 'no-vapid-key'
  | 'fcm-error'
  | 'firestore-error'
  | 'invalid-input';

export interface RegisterPushResult {
  ok: boolean;
  /** FCM registration token si ok=true. */
  token?: string;
  reason?: RegisterPushReason;
  /** Détail erreur (pour log uniquement). */
  detail?: string;
}

/**
 * Browser support detection (Q6=A silent skip).
 * Exposé pour UI : disabled toggle si !isPushSupported().
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (typeof Notification === 'undefined') return false;
  // Safari iOS <16.4 : Notification existe mais Push API absent
  if (typeof PushManager === 'undefined') return false;
  return true;
}

/**
 * Register FCM token + persist users/{uid}.fcmToken.
 * Best-effort silent skip si non-supporté.
 */
export async function registerPushNotifications(uid: string): Promise<RegisterPushResult> {
  console.log('[registerPush] START', { uid });
  if (!uid) {
    console.warn('[registerPush] FAIL: no uid');
    return { ok: false, reason: 'invalid-input' };
  }

  if (!isPushSupported()) {
    console.warn('[registerPush] FAIL: browser unsupported');
    return { ok: false, reason: 'unsupported' };
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn('[registerPush] FAIL: NEXT_PUBLIC_FIREBASE_VAPID_KEY not configured');
    return { ok: false, reason: 'no-vapid-key' };
  }
  console.log('[registerPush] vapidKey length', vapidKey.length);

  // 1. Service Worker registration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let swRegistration: any;
  try {
    console.log('[registerPush] step1: SW register /firebase-messaging-sw.js');
    swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    console.log('[registerPush] step1 ok, swRegistration', {
      installing: !!swRegistration.installing,
      waiting: !!swRegistration.waiting,
      active: !!swRegistration.active,
    });
    // Wait until SW activé (sinon getToken fail)
    if (swRegistration.installing) {
      console.log('[registerPush] waiting for SW activation...');
      await new Promise<void>((resolve) => {
        const sw = swRegistration.installing;
        if (!sw) return resolve();
        sw.addEventListener('statechange', () => {
          console.log('[registerPush] SW statechange', sw.state);
          if (sw.state === 'activated') resolve();
        });
      });
    }
  } catch (err) {
    console.error('[registerPush] FAIL step1 SW register', err);
    return {
      ok: false,
      reason: 'fcm-error',
      detail: `SW register failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Permission
  let permission: NotificationPermission;
  try {
    console.log('[registerPush] step2: requestPermission');
    permission = await Notification.requestPermission();
    console.log('[registerPush] step2 result', permission);
  } catch (err) {
    console.error('[registerPush] FAIL step2 requestPermission', err);
    return {
      ok: false,
      reason: 'permission-denied',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (permission === 'denied') {
    console.warn('[registerPush] FAIL permission denied');
    return { ok: false, reason: 'permission-denied' };
  }
  if (permission === 'default') {
    console.warn('[registerPush] FAIL permission default (popup closed)');
    return { ok: false, reason: 'permission-default' };
  }

  // 3. getToken FCM
  let token: string;
  try {
    console.log('[registerPush] step3: getToken FCM');
    const { getMessaging, getToken } = await import('firebase/messaging');
    const { getApp } = await import('firebase/app');
    const app = getApp();
    const messaging = getMessaging(app);
    const fetchedToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swRegistration,
    });
    console.log('[registerPush] step3 result', fetchedToken ? `token(${fetchedToken.length} chars)` : 'EMPTY');
    if (!fetchedToken) {
      return { ok: false, reason: 'fcm-error', detail: 'getToken returned empty' };
    }
    token = fetchedToken;
  } catch (err) {
    console.error('[registerPush] FAIL step3 getToken', err);
    return {
      ok: false,
      reason: 'fcm-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 4. Persist users/{uid}.fcmToken
  try {
    console.log('[registerPush] step4: persist Firestore');
    const { doc, updateDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    if (!db) {
      console.error('[registerPush] FAIL step4 db not initialized');
      return { ok: false, reason: 'firestore-error', detail: 'Firestore not initialized' };
    }
    await updateDoc(doc(db, 'users', uid), {
      fcmToken: token,
      pushNotificationsEnabled: true,
    });
    console.log('[registerPush] step4 OK — token persisted');
  } catch (err) {
    console.error('[registerPush] FAIL step4 updateDoc', err);
    return {
      ok: false,
      reason: 'firestore-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  console.log('[registerPush] SUCCESS', { uid });
  return { ok: true, token };
}

/**
 * Unregister : remove fcmToken + revoke Firebase token.
 * Best-effort silent.
 */
export async function unregisterPushNotifications(uid: string): Promise<RegisterPushResult> {
  if (!uid) {
    return { ok: false, reason: 'invalid-input' };
  }

  // 1. Remove from user doc + opt-out flag
  try {
    const { doc, updateDoc, deleteField } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    if (!db) {
      return { ok: false, reason: 'firestore-error', detail: 'Firestore not initialized' };
    }
    await updateDoc(doc(db, 'users', uid), {
      fcmToken: deleteField(),
      pushNotificationsEnabled: false,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'firestore-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. Revoke FCM token côté Firebase (best-effort)
  if (isPushSupported()) {
    try {
      const { getMessaging, deleteToken } = await import('firebase/messaging');
      const { getApp } = await import('firebase/app');
      const app = getApp();
      const messaging = getMessaging(app);
      await deleteToken(messaging);
    } catch (err) {
      // Silent : revocation côté serveur Firebase moins critique que Firestore-side opt-out
      console.warn('[unregisterPush] deleteToken failed (silent)', err);
    }
  }

  return { ok: true };
}
