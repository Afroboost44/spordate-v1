/**
 * Script admin one-shot pour fixer l'email Firestore d'un user.
 * Usage:
 *   docker exec -w /app -e UID=xxxx -e EMAIL=yyyy spordateur node fix-user-email.js
 */
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const targetUid = process.env.UID;
const targetEmail = process.env.EMAIL;
if (!targetUid || !targetEmail) {
  console.error('UID et EMAIL requis (env vars).');
  process.exit(1);
}

// Parser défensif identique à src/lib/auth/verifyAuth.ts — gère le cas
// FIREBASE_SERVICE_ACCOUNT_KEY avec \n littéraux dans private_key
function parseServiceAccountKeyDefensive(raw) {
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY missing');
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.private_key && parsed.private_key.includes('\\n')) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch (e) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (parsed.private_key && parsed.private_key.includes('\\n')) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (e2) {
      throw new Error(`Cannot parse FIREBASE_SERVICE_ACCOUNT_KEY: ${e.message}`);
    }
  }
}

if (!getApps().length) {
  initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
}
const db = getFirestore();

(async () => {
  const ref = db.collection('users').doc(targetUid);
  const before = await ref.get();
  const oldEmail = before.exists ? before.data().email : '(doc inexistant)';
  // set + merge crée le doc s'il manque OU update sinon
  await ref.set(
    { email: targetEmail, emailNotificationsEnabled: true },
    { merge: true },
  );
  console.log('Email mis à jour:', { uid: targetUid, before: oldEmail, after: targetEmail });
  process.exit(0);
})();
