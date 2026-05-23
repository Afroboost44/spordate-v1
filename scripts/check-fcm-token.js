/**
 * Vérifie l'état du fcmToken d'un user dans Firestore.
 * Usage : docker exec -w /app -e UID=xxx spordateur node check-fcm-token.js
 */
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function parseKey(raw) {
  const trimmed = raw.trim();
  try {
    const p = JSON.parse(trimmed);
    if (p.private_key?.includes('\\n')) p.private_key = p.private_key.replace(/\\n/g, '\n');
    return p;
  } catch {
    const d = Buffer.from(trimmed, 'base64').toString('utf-8');
    const p = JSON.parse(d);
    if (p.private_key?.includes('\\n')) p.private_key = p.private_key.replace(/\\n/g, '\n');
    return p;
  }
}

if (!getApps().length) {
  initializeApp({ credential: cert(parseKey(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
}

(async () => {
  const s = await getFirestore().collection('users').doc(process.env.UID).get();
  if (!s.exists) {
    console.log('Doc inexistant pour uid', process.env.UID);
    return;
  }
  const d = s.data();
  console.log(JSON.stringify({
    uid: process.env.UID,
    email: d.email,
    displayName: d.displayName,
    hasFcmToken: !!d.fcmToken,
    fcmTokenStart: d.fcmToken ? d.fcmToken.substring(0, 30) + '...' : null,
    pushNotificationsEnabled: d.pushNotificationsEnabled,
    emailNotificationsEnabled: d.emailNotificationsEnabled,
  }, null, 2));
})();
