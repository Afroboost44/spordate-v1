/**
 * Phase 9.5 c29a CH2 — Migration script : sessions legacy avec pricingTiers vide.
 *
 * Contexte (cf. audit c29) : avant c29a, certaines sessions ont été créées avec
 * `pricingTiers: []` (Activity sans defaultPricingTiers + bypass du throw via
 * un input explicit []), provoquant l'affichage 0/0/0 CHF sur /sessions/{id}
 * et un free booking silencieux côté checkout. Cette migration scanne toutes
 * les sessions, charge l'Activity associée, et reseed pricingTiers via le
 * fallback automatique computeFallbackTiers(activity.price).
 *
 * Sécurité :
 * - Idempotent : skip si pricingTiers déjà non vide
 * - DryRun par défaut côté API : doit explicitement passer `dryRun: false` pour écrire
 * - Logs détaillés par session pour audit post-mortem
 *
 * Appel typique :
 *   - depuis /api/admin/migrate-pricing/route.ts (bouton admin)
 *   - depuis un standalone CLI si besoin (init admin SDK séparément + appeler
 *     migrateEmptyPricingTiers(adminDb, { dryRun: false }))
 */

import { computeFallbackTiers } from '@/services/firestore';
import type { Activity, PricingTier } from '@/types/firestore';

export interface MigrationResult {
  dryRun: boolean;
  totalScanned: number;
  totalMigrated: number;
  totalSkipped: number;
  errors: Array<{ sessionId: string; reason: string }>;
  migrations: Array<{
    sessionId: string;
    activityId: string;
    activityPrice: number;
    tiersGenerated: PricingTier[];
  }>;
}

// Type minimal pour ne pas dépendre du SDK admin (test seam friendly).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminFirestore = any;

export async function migrateEmptyPricingTiers(
  adminDb: AdminFirestore,
  options: { dryRun: boolean } = { dryRun: true },
): Promise<MigrationResult> {
  const result: MigrationResult = {
    dryRun: options.dryRun,
    totalScanned: 0,
    totalMigrated: 0,
    totalSkipped: 0,
    errors: [],
    migrations: [],
  };

  const sessionsSnap = await adminDb.collection('sessions').get();
  result.totalScanned = sessionsSnap.size;

  for (const sessionDoc of sessionsSnap.docs) {
    const sessionId = sessionDoc.id;
    const data = sessionDoc.data();
    const tiers = data?.pricingTiers as PricingTier[] | undefined;

    // Skip si déjà configuré (idempotence).
    if (Array.isArray(tiers) && tiers.length > 0) {
      result.totalSkipped++;
      continue;
    }

    const activityId = data?.activityId as string | undefined;
    if (!activityId) {
      result.errors.push({ sessionId, reason: 'session has no activityId' });
      continue;
    }

    const activitySnap = await adminDb.collection('activities').doc(activityId).get();
    if (!activitySnap.exists) {
      result.errors.push({ sessionId, reason: `activity ${activityId} not found` });
      continue;
    }
    const activity = activitySnap.data() as Activity;
    if (!activity.price || activity.price <= 0) {
      result.errors.push({
        sessionId,
        reason: `activity ${activityId} has no price (${activity.price})`,
      });
      continue;
    }

    const generated = computeFallbackTiers(activity.price);
    result.migrations.push({
      sessionId,
      activityId,
      activityPrice: activity.price,
      tiersGenerated: generated,
    });

    if (!options.dryRun) {
      const earlyTier = generated.find((t) => t.kind === 'early');
      await sessionDoc.ref.update({
        pricingTiers: generated,
        // Reset currentTier/currentPrice cohérent (cf. createSession initialization)
        currentTier: 'early',
        currentPrice: earlyTier?.price ?? 0,
      });
    }
    result.totalMigrated++;
  }

  return result;
}
