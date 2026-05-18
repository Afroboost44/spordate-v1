/**
 * Debug script : inspecte le document Firestore sessions/WuSHRyM4mahRlLpWJzkn
 * et l'activity liée pour comprendre l'image "tasse de café" affichée.
 *
 * Usage : npx tsx tests/debug/check-zumba.ts
 *
 * Objectif : déterminer si l'image vient de :
 *   - une URL réellement stockée dans Firestore (test data à nettoyer)
 *   - ou du fallback picsum.photos dans SessionMediaPlayer.tsx (placeholder random)
 */

import { getAdminDb } from '../../src/lib/firebase/admin';

const SESSION_ID = 'WuSHRyM4mahRlLpWJzkn';

(async () => {
  const db = await getAdminDb();

  console.log('=== Lecture session ' + SESSION_ID + ' ===\n');
  const sessSnap = await db.collection('sessions').doc(SESSION_ID).get();

  if (!sessSnap.exists) {
    console.log('❌ Session NOT FOUND dans Firestore.');
    console.log('   → Peut-être que /sessions/' + SESSION_ID + ' pointe sur un Booking');
    console.log('   → Vérification dans bookings/...');
    const bSnap = await db.collection('bookings').doc(SESSION_ID).get();
    if (bSnap.exists) {
      console.log('✅ Trouvé dans bookings :');
      console.log(JSON.stringify(bSnap.data(), null, 2));
    } else {
      console.log('❌ Pas trouvé dans bookings non plus.');
    }
    process.exit(0);
  }

  const session = sessSnap.data() as any;
  console.log('=== SESSION DATA ===');
  console.log(JSON.stringify(session, null, 2));
  console.log('\n');

  if (!session.activityId) {
    console.log('⚠️ Pas d\'activityId dans la session — impossible de chercher activity');
    process.exit(0);
  }

  console.log('=== Lecture activity ' + session.activityId + ' ===\n');
  const actSnap = await db.collection('activities').doc(session.activityId).get();

  if (!actSnap.exists) {
    console.log('❌ Activity NOT FOUND : ' + session.activityId);
    process.exit(0);
  }

  const activity = actSnap.data() as any;
  console.log('=== ACTIVITY DATA ===');
  console.log(JSON.stringify(activity, null, 2));

  console.log('\n=== ANALYSE FALLBACK IMAGE ===');
  console.log('images[]        : ' + JSON.stringify(activity.images || null));
  console.log('mediaUrls[]     : ' + JSON.stringify(activity.mediaUrls || null));
  console.log('thumbnailMedia  : ' + JSON.stringify(activity.thumbnailMedia || null));
  console.log('imageUrl        : ' + JSON.stringify(activity.imageUrl || null));

  const hasAnyImage = (activity.images && activity.images.length > 0)
    || (activity.mediaUrls && activity.mediaUrls.length > 0)
    || activity.thumbnailMedia
    || activity.imageUrl;

  if (!hasAnyImage) {
    console.log('\n🎯 CONCLUSION : aucune image stockée → la tasse de café vient du fallback');
    console.log('   picsumPlaceholder() dans SessionMediaPlayer.tsx ligne 73-75.');
    console.log('   Le fix code (resolveMediaImageSrc + logo Spordateur) résoudra ça.');
  } else {
    console.log('\n🎯 CONCLUSION : une URL est stockée. Si c\'est l\'URL coffee, il faut');
    console.log('   nettoyer cette data Firestore en plus du fix code.');
  }

  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
