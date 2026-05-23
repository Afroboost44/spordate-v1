/**
 * Script admin : inspecte une session + son activity parente.
 *
 * Usage (depuis le container Docker spordateur) :
 *   node /app/admin-inspect-session.cjs <sessionId> [--reactivate]
 *
 * Sans --reactivate : affiche l'état actuel (status, startAt, activity, etc.)
 * Avec --reactivate : si la session est cancelled, repasse le champ status
 *                     à undefined (= active par défaut) — uniquement si
 *                     l'activity parente est bien active.
 *
 * Nécessite FIREBASE_SERVICE_ACCOUNT_KEY dans l'env.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const SESSION_ID = process.argv[2];
const REACTIVATE = process.argv.includes('--reactivate');

(async () => {
  if (!SESSION_ID) {
    console.error('Usage: node admin-inspect-session.cjs <sessionId> [--reactivate]');
    process.exit(2);
  }

  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });

  const db = getFirestore();

  const sessionSnap = await db.collection('sessions').doc(SESSION_ID).get();
  if (!sessionSnap.exists) {
    console.error(`❌ Session "${SESSION_ID}" introuvable.`);
    process.exit(1);
  }
  const session = sessionSnap.data();

  console.log('\n=== SESSION ===');
  console.log(`  id            : ${SESSION_ID}`);
  console.log(`  activityId    : ${session.activityId || '?'}`);
  console.log(`  title         : ${session.title || '?'}`);
  console.log(`  status        : ${session.status || '(undefined = active)'}`);
  console.log(`  startAt       : ${session.startAt?.toDate?.()?.toISOString() || '?'}`);
  console.log(`  currentParticipants : ${session.currentParticipants ?? 0}`);
  console.log(`  currentPrice  : ${session.currentPrice ?? '?'} CHF`);

  let activity = null;
  if (session.activityId) {
    const activitySnap = await db.collection('activities').doc(session.activityId).get();
    if (activitySnap.exists) {
      activity = activitySnap.data();
      console.log('\n=== ACTIVITY PARENTE ===');
      console.log(`  id        : ${session.activityId}`);
      console.log(`  name      : ${activity.name || '?'}`);
      console.log(`  isActive  : ${activity.isActive}`);
      console.log(`  partnerId : ${activity.partnerId || '?'}`);
    } else {
      console.log('\n=== ACTIVITY PARENTE ===');
      console.log(`  ❌ Activity "${session.activityId}" introuvable (hard-deleted)`);
    }
  }

  // Diagnostic
  console.log('\n=== DIAGNOSTIC ===');
  const sessCancelled = session.status === 'cancelled';
  const actUnavailable = !activity || activity.isActive === false;

  if (sessCancelled && actUnavailable) {
    console.log('  Session cancelled ET activity indisponible → cohérent (cascade #3)');
  } else if (sessCancelled && !actUnavailable) {
    console.log('  ⚠️  Session cancelled MAIS activity est bien ACTIVE.');
    console.log('  → C\'est un état incohérent (probablement legacy migration #29).');
    console.log('  → Pour réactiver la session : relance avec --reactivate');
  } else if (!sessCancelled && actUnavailable) {
    console.log('  ⚠️  Session active mais activity indisponible (orpheline).');
  } else {
    console.log('  ✓ Tout est cohérent (session active, activity active).');
  }

  // Action --reactivate
  if (REACTIVATE) {
    if (!sessCancelled) {
      console.log('\n→ Session pas cancelled, rien à faire.');
      process.exit(0);
    }
    if (actUnavailable) {
      console.error('\n❌ Refus : activity parente indisponible. Réactive l\'activity d\'abord.');
      process.exit(1);
    }
    await db.collection('sessions').doc(SESSION_ID).update({
      status: FieldValue.delete(),
    });
    console.log('\n✅ Champ "status" supprimé → session réactivée (status undefined = active).');
  }

  process.exit(0);
})().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
