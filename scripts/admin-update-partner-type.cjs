/**
 * Script admin one-shot : met à jour le champ `type` d'un partner Firestore.
 *
 * Usage (depuis le container Docker spordateur) :
 *   node /tmp/admin-update-partner-type.cjs <email> <new-type>
 *
 * Exemples :
 *   node /tmp/admin-update-partner-type.cjs contact.artboost@gmail.com bar
 *   node /tmp/admin-update-partner-type.cjs sambassi@gmail.com club
 *
 * Si l'email n'est pas trouvé : affiche la liste complète des partners
 * pour aider à choisir le bon.
 *
 * Nécessite FIREBASE_SERVICE_ACCOUNT_KEY dans l'env (déjà configuré côté container).
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_EMAIL = process.argv[2];
const NEW_TYPE = process.argv[3] || 'bar';

const VALID_TYPES = ['gym', 'studio', 'outdoor', 'pool', 'bar', 'club', 'restaurant', 'sports-store'];

(async () => {
  if (!TARGET_EMAIL) {
    console.error('Usage: node admin-update-partner-type.cjs <email> [type]');
    console.error('Types valides:', VALID_TYPES.join(', '));
    process.exit(2);
  }
  if (!VALID_TYPES.includes(NEW_TYPE)) {
    console.error(`Type invalide "${NEW_TYPE}". Valides:`, VALID_TYPES.join(', '));
    process.exit(2);
  }

  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });

  const db = getFirestore();
  const snap = await db.collection('partners').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`\nPartners trouvés (${all.length}) :`);
  all.forEach((p) => {
    const flag = p.email === TARGET_EMAIL ? ' ← MATCH' : '';
    console.log(`  - id=${p.id} | email=${p.email || '?'} | type=${p.type || '?'} | name=${p.name || '?'}${flag}`);
  });

  const match = all.find((p) => p.email === TARGET_EMAIL);
  if (!match) {
    console.error(`\n❌ Aucun partner avec email "${TARGET_EMAIL}".`);
    console.error('Relance avec un email visible dans la liste ci-dessus.');
    process.exit(1);
  }

  await db.collection('partners').doc(match.id).update({ type: NEW_TYPE });
  console.log(`\n✅ OK — partner "${match.name || match.id}" (${match.email}) type passé à "${NEW_TYPE}"`);
  process.exit(0);
})().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
