/**
 * Phase 9.5 c36 — Migration boosts.partnerId legacy "partner-{uid}" → "{uid}".
 *
 * Contexte (audit c36) : les boosts créés AVANT c33 via /api/boost-checkout
 * (Stripe flow) avaient partnerId = body.partnerId = state.partnerId =
 * "partner-{uid}" (la convention Partner doc id de setup-partner/login/seed).
 * Le webhook a persisté tel quel. Post-c33 le serveur force partnerId = uid pur.
 * Symétrique à c34 qui a fait pareil pour Activity.partnerId.
 *
 * Logique migration :
 *  1. Lire toutes les boosts/
 *  2. Pour chaque doc dont partnerId commence par "partner-" :
 *     a. Strip le préfixe (regex /^partner-/)
 *     b. Verify users/{stripped} exists (safety check, évite de créer un partnerId
 *        invalide si Partner doc n'a aucun user matching)
 *     c. Si OK : update doc.partnerId = stripped
 *  3. Idempotent : si pas de préfixe, skip (totalAlreadyOk++)
 *
 * Appel via /api/admin/migrate-boost-partner/route.ts (Bearer + isAdmin).
 */

export interface BoostMigrationResult {
  dryRun: boolean;
  totalScanned: number;
  totalMigrated: number;
  totalAlreadyOk: number;
  errors: Array<{ boostId: string; reason: string }>;
  migrations: Array<{
    boostId: string;
    oldPartnerId: string;
    newPartnerId: string;
  }>;
}

// Type minimal pour ne pas dépendre du SDK admin (test seam friendly).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminFirestore = any;

export async function migrateBoostPartnerIds(
  adminDb: AdminFirestore,
  options: { dryRun: boolean } = { dryRun: true },
): Promise<BoostMigrationResult> {
  const result: BoostMigrationResult = {
    dryRun: options.dryRun,
    totalScanned: 0,
    totalMigrated: 0,
    totalAlreadyOk: 0,
    errors: [],
    migrations: [],
  };

  const boostsSnap = await adminDb.collection('boosts').get();
  result.totalScanned = boostsSnap.size;

  for (const boostDoc of boostsSnap.docs) {
    const boostId = boostDoc.id;
    const data = boostDoc.data() as { partnerId?: string };
    const currentPartnerId = data?.partnerId;

    if (!currentPartnerId) {
      result.errors.push({ boostId, reason: 'no partnerId field' });
      continue;
    }

    // Idempotence : si pas de préfixe "partner-", skip (déjà uid pur).
    if (!currentPartnerId.startsWith('partner-')) {
      result.totalAlreadyOk++;
      continue;
    }

    const stripped = currentPartnerId.replace(/^partner-/, '');
    if (!stripped) {
      result.errors.push({
        boostId,
        reason: `partnerId "${currentPartnerId}" devient vide après strip`,
      });
      continue;
    }

    // Safety check : verify users/{stripped} existe avant d'écrire.
    const userSnap = await adminDb.collection('users').doc(stripped).get();
    if (!userSnap.exists) {
      result.errors.push({
        boostId,
        reason: `users/${stripped} introuvable (strip de "${currentPartnerId}")`,
      });
      continue;
    }

    result.migrations.push({
      boostId,
      oldPartnerId: currentPartnerId,
      newPartnerId: stripped,
    });

    if (!options.dryRun) {
      await boostDoc.ref.update({ partnerId: stripped });
    }
    result.totalMigrated++;
  }

  return result;
}
