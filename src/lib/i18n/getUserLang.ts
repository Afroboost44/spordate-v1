/**
 * Fix Push i18n — Helper serveur pour récupérer la langue d'un user.
 *
 * Lit `users/{uid}.language` via firebase-admin/firestore (lazy init pattern
 * cohérent avec notifyUser.ts / sendPushNotification.ts). Fallback `'fr'` si
 * non défini ou valeur invalide.
 *
 * Note perf : notifyUser.ts lit déjà le user doc pour récupérer fcmToken —
 * il peut extraire `data_.language` directement sans appel supplémentaire à
 * Firestore. Ce helper est utile pour les callsites externes qui n'ont pas
 * encore lu le doc.
 */

import { coerceLang, DEFAULT_LANG, type ServerLang } from './serverTranslations';

/**
 * Fix #156/#157 i18n emails — variante synchrone, à utiliser quand on a déjà
 * lu le user doc (ex: cron review-reminder, /api/checkout, notify-message).
 * Évite un round-trip Firestore en plus.
 *
 * Usage :
 *   const userSnap = await db.collection('users').doc(uid).get();
 *   const lang = pickUserLang(userSnap.data());
 */
export function pickUserLang(
  data: Record<string, unknown> | null | undefined,
  defaultLang: ServerLang = DEFAULT_LANG,
): ServerLang {
  if (!data) return defaultLang;
  return coerceLang((data as { language?: unknown }).language ?? defaultLang);
}

export async function getUserLang(
  uid: string,
  defaultLang: ServerLang = DEFAULT_LANG,
): Promise<ServerLang> {
  if (!uid) return defaultLang;
  try {
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
    if (!getApps().length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        initializeApp({
          credential: cert(
            parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0],
          ),
        });
      } else {
        initializeApp({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordate-prod',
        });
      }
    }
    const db = getFirestore();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return defaultLang;
    const data_ = snap.data() || {};
    return coerceLang(data_.language ?? defaultLang);
  } catch (err) {
    console.warn('[getUserLang] error', { uid, err: err instanceof Error ? err.message : String(err) });
    return defaultLang;
  }
}
