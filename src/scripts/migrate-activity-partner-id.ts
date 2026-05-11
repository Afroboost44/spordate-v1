/**
 * Phase 9.5 c34 BUG#5 — Migration Activity.partnerId legacy → user.uid.
 *
 * Contexte : avant c33, certaines Activities ont été créées avec
 * `partnerId = Partner.id` (doc id de la collection partners/, parfois
 * différent de user.uid). Côté c33 on a forcé tous les nouveaux Activity
 * writes à `partnerId = user.uid` (partner/offers handleSubmit). Mais les
 * docs legacy conservent l'ancien partnerId → la boost match (qui utilise
 * user.uid) échoue silencieusement côté /discovery.
 *
 * Logique migration :
 *  1. Lire toutes les activities/
 *  2. Pour chaque Activity dont partnerId NE matche PAS un users/{uid} valide :
 *     a. Chercher partners/{Activity.partnerId} (Partner doc avec ce id)
 *     b. Récupérer Partner.email
 *     c. Trouver users/ where email == Partner.email (limit 1)
 *     d. Si trouvé : update Activity.partnerId = user.uid
 *  3. Idempotent : si Activity.partnerId est déjà un valid user.uid, skip
 *  4. DRY RUN par défaut, --apply pour exécuter
 *
 * Appel via /api/admin/migrate-activity-partner/route.ts (Bearer + isAdmin).
 */

import type { Activity, Partner } from '@/types/firestore';

export interface ActivityMigrationResult {
  dryRun: boolean;
  totalScanned: number;
  totalMigrated: number;
  totalAlreadyOk: number;
  errors: Array<{ activityId: string; reason: string }>;
  migrations: Array<{
    activityId: string;
    oldPartnerId: string;
    newUserUid: string;
    partnerEmail: string;
  }>;
}

// Type minimal pour ne pas dépendre du SDK admin (test seam friendly).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminFirestore = any;

export async function migrateActivityPartnerIds(
  adminDb: AdminFirestore,
  options: { dryRun: boolean } = { dryRun: true },
): Promise<ActivityMigrationResult> {
  const result: ActivityMigrationResult = {
    dryRun: options.dryRun,
    totalScanned: 0,
    totalMigrated: 0,
    totalAlreadyOk: 0,
    errors: [],
    migrations: [],
  };

  const activitiesSnap = await adminDb.collection('activities').get();
  result.totalScanned = activitiesSnap.size;

  for (const activityDoc of activitiesSnap.docs) {
    const activityId = activityDoc.id;
    const data = activityDoc.data() as Activity;
    const currentPartnerId = data?.partnerId;

    if (!currentPartnerId) {
      result.errors.push({ activityId, reason: 'no partnerId field' });
      continue;
    }

    // Step 1 : tester si currentPartnerId est déjà un valid user.uid.
    const directUserSnap = await adminDb.collection('users').doc(currentPartnerId).get();
    if (directUserSnap.exists) {
      result.totalAlreadyOk++;
      continue;
    }

    // Step 2 : currentPartnerId pointe vraisemblablement vers un Partner doc.
    const partnerSnap = await adminDb.collection('partners').doc(currentPartnerId).get();
    if (!partnerSnap.exists) {
      result.errors.push({
        activityId,
        reason: `partnerId ${currentPartnerId} ne matche ni users/ ni partners/`,
      });
      continue;
    }
    const partner = partnerSnap.data() as Partner;
    if (!partner.email) {
      result.errors.push({
        activityId,
        reason: `Partner ${currentPartnerId} n'a pas d'email pour résoudre user.uid`,
      });
      continue;
    }

    // Step 3 : trouver users/ where email == Partner.email
    const usersQuery = await adminDb
      .collection('users')
      .where('email', '==', partner.email)
      .limit(1)
      .get();
    if (usersQuery.empty) {
      result.errors.push({
        activityId,
        reason: `Aucun user trouvé pour email ${partner.email}`,
      });
      continue;
    }
    const userUid = usersQuery.docs[0].id;

    result.migrations.push({
      activityId,
      oldPartnerId: currentPartnerId,
      newUserUid: userUid,
      partnerEmail: partner.email,
    });

    if (!options.dryRun) {
      await activityDoc.ref.update({ partnerId: userUid });
    }
    result.totalMigrated++;
  }

  return result;
}
