/**
 * Script admin : supprime une liste de sessions Firestore avec garde-fous.
 *
 * Usage :
 *   node /app/admin-cleanup-sessions.cjs <id1> <id2> ... [flags]
 *
 * Flags :
 *   --apply              Exécute réellement (sans → dry-run par défaut)
 *   --with-bookings      Supprime aussi les bookings liés (cascade hard-delete)
 *   --force-with-participants  Bypass le refus quand la session a des inscrits
 *                              (à utiliser avec --with-bookings sinon orphelins)
 *   --force-future       Bypass le refus quand startAt est dans le futur
 *
 * Garde-fous (par défaut) :
 *   - REFUS de supprimer une session avec currentParticipants > 0
 *   - REFUS de supprimer une session avec startAt dans le futur
 *   - Vérifie que la session existe avant suppression
 *
 * Cascade --with-bookings : pour chaque session supprimée, query bookings où
 * sessionId == id (+ tentative bookings.doc(sameId) au cas où id session == id booking)
 * et supprime aussi ces docs. Garantit zéro orphelin.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE_FUTURE = args.includes('--force-future');
const FORCE_PARTICIPANTS = args.includes('--force-with-participants');
const WITH_BOOKINGS = args.includes('--with-bookings');
const IDS = args.filter((a) => !a.startsWith('--'));

(async () => {
  if (IDS.length === 0) {
    console.error('Usage: node admin-cleanup-sessions.cjs <id1> <id2> ... [--apply]');
    process.exit(2);
  }

  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });

  const db = getFirestore();
  const nowMs = Date.now();

  console.log(`\n${APPLY ? '🚨 MODE APPLY (suppression réelle)' : '🔍 MODE DRY-RUN (aucune suppression)'}\n`);
  console.log(`Sessions à examiner : ${IDS.length}\n`);

  const toDelete = [];
  const skipped = [];

  for (const id of IDS) {
    const snap = await db.collection('sessions').doc(id).get();
    if (!snap.exists) {
      skipped.push({ id, reason: 'introuvable' });
      continue;
    }
    const data = snap.data();
    const startMs = data.startAt?.toMillis?.() || 0;
    const isFuture = startMs > nowMs;
    const participants = data.currentParticipants ?? 0;

    if (participants > 0 && !FORCE_PARTICIPANTS) {
      skipped.push({
        id,
        reason: `${participants} participant(s) inscrit(s) — refus (--force-with-participants pour bypass)`,
        title: data.title,
        startAt: data.startAt?.toDate?.()?.toISOString(),
      });
      continue;
    }
    if (isFuture && !FORCE_FUTURE) {
      skipped.push({
        id,
        reason: 'session dans le futur — refus (--force-future pour bypass)',
        title: data.title,
        startAt: data.startAt?.toDate?.()?.toISOString(),
      });
      continue;
    }
    toDelete.push({
      id,
      title: data.title,
      startAt: data.startAt?.toDate?.()?.toISOString(),
      activityId: data.activityId,
      status: data.status,
    });
  }

  if (toDelete.length > 0) {
    console.log(`✅ ${toDelete.length} session(s) prête(s) à être supprimée(s) :\n`);
    toDelete.forEach((s) => {
      console.log(`  - id=${s.id}`);
      console.log(`    title="${s.title}" startAt=${s.startAt}`);
      console.log(`    activityId=${s.activityId} status=${s.status || '(active)'}`);
    });
  }

  if (skipped.length > 0) {
    console.log(`\n⛔ ${skipped.length} session(s) IGNORÉE(S) :\n`);
    skipped.forEach((s) => {
      console.log(`  - id=${s.id} → ${s.reason}`);
      if (s.title) console.log(`    (title="${s.title}" startAt=${s.startAt})`);
    });
  }

  if (toDelete.length === 0) {
    console.log('\n→ Rien à supprimer.');
    process.exit(0);
  }

  if (!APPLY) {
    console.log(`\n📋 Dry-run terminé. Pour exécuter réellement la suppression :`);
    console.log(`   relance la même commande avec --apply à la fin.`);
    process.exit(0);
  }

  console.log('\n🚨 SUPPRESSION EN COURS...\n');
  let bookingsDeleted = 0;
  for (const s of toDelete) {
    // Cascade --with-bookings : supprime les bookings liés
    if (WITH_BOOKINGS) {
      // 1) bookings où sessionId == s.id
      const bookingsSnap = await db
        .collection('bookings')
        .where('sessionId', '==', s.id)
        .get();
      for (const b of bookingsSnap.docs) {
        await b.ref.delete();
        bookingsDeleted++;
        console.log(`    ↳ booking supprimé : ${b.id} (sessionId match)`);
      }
      // 2) bookings.doc(s.id) au cas où l'id booking == l'id session
      //    (legacy flows : sessions auto-créées Phase 9.5 c11 utilisaient
      //    bookingId comme sessionId)
      const sameIdBooking = await db.collection('bookings').doc(s.id).get();
      if (sameIdBooking.exists) {
        await sameIdBooking.ref.delete();
        bookingsDeleted++;
        console.log(`    ↳ booking supprimé : ${s.id} (same-id match)`);
      }
    }
    await db.collection('sessions').doc(s.id).delete();
    console.log(`  ✓ Session supprimée : ${s.id}`);
  }
  console.log(`\n✅ ${toDelete.length} session(s) supprimée(s)${WITH_BOOKINGS ? ` + ${bookingsDeleted} booking(s)` : ''}.`);
  process.exit(0);
})().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
