/**
 * Script admin : liste les sessions liées à une activity (par activityId
 * ou par nom contenu dans title) avec leur status.
 *
 * Usage :
 *   node /app/admin-list-sessions.cjs <search>
 *
 * <search> peut être un activityId, ou un fragment de title (case-insensitive).
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const SEARCH = (process.argv[2] || '').toLowerCase();

(async () => {
  if (!SEARCH) {
    console.error('Usage: node admin-list-sessions.cjs <search>');
    process.exit(2);
  }

  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });

  const db = getFirestore();

  console.log(`Projet Firestore : ${initializeApp.length > 0 ? 'OK' : '?'}`);
  const snap = await db.collection('sessions').get();
  console.log(`Total sessions en base : ${snap.size}\n`);

  const matches = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => {
      const id = (s.id || '').toLowerCase();
      const title = (s.title || '').toLowerCase();
      const activityId = (s.activityId || '').toLowerCase();
      return id.includes(SEARCH) || title.includes(SEARCH) || activityId.includes(SEARCH);
    });

  if (matches.length === 0) {
    console.log(`Aucune session ne match "${SEARCH}".\n`);
    // Affiche quand même les 5 dernières créées pour avoir une idée du format
    const recent = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      })
      .slice(0, 5);
    console.log('5 dernières sessions créées (pour référence) :');
    recent.forEach((s) => {
      console.log(`  - id=${s.id}`);
      console.log(`    title="${s.title}" activityId=${s.activityId}`);
      console.log(`    status=${s.status || '(active)'} startAt=${s.startAt?.toDate?.()?.toISOString()}`);
    });
    process.exit(0);
  }

  console.log(`${matches.length} session(s) trouvée(s) pour "${SEARCH}" :\n`);
  matches.forEach((s) => {
    console.log(`  id        : ${s.id}`);
    console.log(`  title     : ${s.title}`);
    console.log(`  activityId: ${s.activityId}`);
    console.log(`  status    : ${s.status || '(undefined = active)'}`);
    console.log(`  startAt   : ${s.startAt?.toDate?.()?.toISOString()}`);
    console.log(`  ---`);
  });

  process.exit(0);
})().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
