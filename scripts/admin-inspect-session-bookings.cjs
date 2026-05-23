/**
 * Script admin : inspecte les bookings liés à une liste de sessions.
 *
 * Usage : node /app/admin-inspect-session-bookings.cjs <id1> <id2> ...
 *
 * Pour chaque session, affiche :
 *  - tous les bookings liés (via where sessionId == id)
 *  - userId, email du user (résolu via /users)
 *  - status booking, montant
 *
 * Permet de décider si les "doublons" sont vraiment des doublons (même user
 * sur plusieurs sessions identiques) ou des sessions distinctes avec users
 * différents (à garder).
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const IDS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

(async () => {
  if (IDS.length === 0) {
    console.error('Usage: node admin-inspect-session-bookings.cjs <id1> <id2> ...');
    process.exit(2);
  }

  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });

  const db = getFirestore();
  const userCache = new Map();

  async function getUserInfo(uid) {
    if (!uid) return '(no uid)';
    if (userCache.has(uid)) return userCache.get(uid);
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) {
      userCache.set(uid, `${uid} (user introuvable)`);
      return userCache.get(uid);
    }
    const u = snap.data();
    const info = `${u.email || u.displayName || uid}`;
    userCache.set(uid, info);
    return info;
  }

  console.log('');
  for (const id of IDS) {
    console.log(`=== SESSION ${id} ===`);
    const bookingsQ = await db
      .collection('bookings')
      .where('sessionId', '==', id)
      .get();

    if (bookingsQ.empty) {
      console.log('  (aucun booking lié à cette session)');
      console.log('');
      continue;
    }

    for (const b of bookingsQ.docs) {
      const bd = b.data();
      const userInfo = await getUserInfo(bd.userId);
      console.log(`  booking=${b.id}`);
      console.log(`    user        : ${userInfo}`);
      console.log(`    status      : ${bd.status || '?'}`);
      console.log(`    amountPaid  : ${bd.amountPaid ?? '?'} (centimes)`);
      console.log(`    createdAt   : ${bd.createdAt?.toDate?.()?.toISOString() || '?'}`);
    }
    console.log('');
  }
  process.exit(0);
})().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
