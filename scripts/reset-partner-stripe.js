/**
 * Script admin one-shot pour reset le stripeAccountId d'un partner Firestore.
 *
 * Use case : migration TEST → LIVE Stripe Connect. Le partner avait un acct_test_
 * stocké. On le supprime pour forcer une nouvelle inscription LIVE via
 * POST /api/stripe-connect.
 *
 * Usage:
 *   docker exec -w /app -e PARTNER_UID=BvvVC4Ac8qWlPvri6S9lSYKzr7E3 spordateur node scripts/reset-partner-stripe.js
 *
 * Le script :
 *   1. Cherche le partner doc via 3 conventions (direct, prefix `partner-`, email fallback)
 *   2. Affiche les champs Stripe actuels (stripeAccountId, stripeAccountStatus...)
 *   3. Delete stripeAccountId + champs liés
 *   4. Confirme la suppression
 */
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const partnerUid = process.env.PARTNER_UID;
if (!partnerUid) {
  console.error('PARTNER_UID requis (env var).');
  process.exit(1);
}

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

(async () => {
  if (!getApps().length) {
    initializeApp({
      credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  const db = getFirestore();

  console.log(`[reset-partner-stripe] partnerUid=${partnerUid}`);

  // Chercher le partner doc (3 conventions cohérent avec findPartnerDoc())
  let partnerSnap = await db.collection('partners').doc(partnerUid).get();
  let partnerDocId = partnerUid;

  if (!partnerSnap.exists) {
    partnerSnap = await db.collection('partners').doc(`partner-${partnerUid}`).get();
    partnerDocId = `partner-${partnerUid}`;
  }

  if (!partnerSnap.exists) {
    const userSnap = await db.collection('users').doc(partnerUid).get();
    const userEmail = userSnap.exists ? userSnap.data()?.email : null;
    if (userEmail) {
      const q = await db.collection('partners').where('email', '==', userEmail).limit(1).get();
      if (!q.empty) {
        partnerSnap = q.docs[0];
        partnerDocId = partnerSnap.id;
      }
    }
  }

  if (!partnerSnap.exists) {
    console.error(`[reset-partner-stripe] AUCUN partner doc trouvé pour ${partnerUid}`);
    process.exit(2);
  }

  const data = partnerSnap.data();
  console.log(`[reset-partner-stripe] Trouvé : partners/${partnerDocId}`);
  console.log('  stripeAccountId       :', data.stripeAccountId || '(absent)');
  console.log('  stripeAccountStatus   :', data.stripeAccountStatus || '(absent)');
  console.log('  stripeOnboardedAt     :', data.stripeOnboardedAt || '(absent)');
  console.log('  stripeChargesEnabled  :', data.stripeChargesEnabled);

  if (!data.stripeAccountId) {
    console.log('[reset-partner-stripe] Pas de stripeAccountId à supprimer — already clean.');
    process.exit(0);
  }

  // Delete les champs Stripe pour forcer ré-onboarding LIVE
  await db.collection('partners').doc(partnerDocId).update({
    stripeAccountId: FieldValue.delete(),
    stripeAccountStatus: FieldValue.delete(),
    stripeOnboardedAt: FieldValue.delete(),
    stripeChargesEnabled: FieldValue.delete(),
  });
  console.log('[reset-partner-stripe] ✓ Champs Stripe supprimés.');
  console.log('  → Maintenant POST /api/stripe-connect va créer un nouveau compte LIVE');
  console.log('  → Le partner devra refaire l\'onboarding (KYC, IBAN)');
  process.exit(0);
})().catch((err) => {
  console.error('[reset-partner-stripe] ERROR:', err);
  process.exit(99);
});
