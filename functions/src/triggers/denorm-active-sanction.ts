/**
 * Spordateur — Phase 8 sub-chantier 5 commit 2/5
 * Cloud Functions Trigger — denormalize UserProfile.activeSanction* on userSanctions write.
 *
 * Comble Différé Phase 8 ligne 881 architecture.md :
 *   « ⏳ Cloud Function denorm `users.{uid}.activeSanction*` on userSanctions create/update »
 *
 * Q4=A : single trigger `onDocumentWritten` (idiomatic Firestore CF v2).
 * Gère create / update / delete via change.before/after pattern.
 *
 * Doctrine §F (Phase 7 Q3) : `users.{uid}` rule update reste owner+admin only.
 * Cette CF utilise Admin SDK pour bypass rules → permet de denormaliser fast-check
 * fields sans relâcher les rules client-side. Authoritative source reste
 * `getActiveUserSanction()` query Phase 7 ; ce denorm est cosmétique (banner).
 *
 * Logique :
 *   1. Extract userId du document avant/après (cohérent les deux côtés)
 *   2. Query userSanctions where userId==X AND isActive==true ORDER BY createdAt DESC LIMIT 1
 *      (utilise index existant `userId+isActive+createdAt DESC` Phase 7)
 *   3. Si présent → denorm activeSanctionId/Level/EndsAt sur users.{userId}
 *      Si absent  → unset/null sur users.{userId} (FieldValue.delete())
 *
 * Best-effort : log error mais ne throw pas. CF re-essaiera 1× via Functions retry.
 *
 * Déploiement :
 *   cd functions && npm install && npm run build && cd ..
 *   firebase deploy --only functions:denormActiveSanctionTrigger --project spordate-prod
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

const LOG_PREFIX = '[denorm-active-sanction]';

if (!getApps().length) {
  initializeApp();
}

export const denormActiveSanctionTrigger = onDocumentWritten(
  {
    document: 'userSanctions/{sanctionId}',
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
    retry: false, // KISS — log error, pas de retry pour Phase 8 (volume faible)
  },
  async (event) => {
    const { sanctionId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Extract userId — peut être absent si delete (before) ou create (after)
    const userId = (after?.userId as string | undefined) ?? (before?.userId as string | undefined);
    if (!userId) {
      logger.warn(LOG_PREFIX, {
        event: 'no-user-id',
        sanctionId,
      });
      return;
    }

    try {
      const db = getFirestore();
      // Query active sanction la plus récente (utilise index Phase 7)
      const snap = await db
        .collection('userSanctions')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      const userRef = db.collection('users').doc(userId);

      if (snap.empty) {
        // Pas de sanction active → unset denorm fields
        await userRef.update({
          activeSanctionId: FieldValue.delete(),
          activeSanctionLevel: FieldValue.delete(),
          activeSanctionEndsAt: FieldValue.delete(),
        });
        logger.info(LOG_PREFIX, {
          event: 'denorm-cleared',
          sanctionId,
          userId,
        });
        return;
      }

      const active = snap.docs[0].data();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: any = {
        activeSanctionId: active.sanctionId,
        activeSanctionLevel: active.level,
      };
      if (active.endsAt) {
        update.activeSanctionEndsAt = active.endsAt;
      } else {
        update.activeSanctionEndsAt = FieldValue.delete();
      }

      await userRef.update(update);

      logger.info(LOG_PREFIX, {
        event: 'denorm-updated',
        sanctionId,
        userId,
        activeSanctionId: active.sanctionId,
        activeSanctionLevel: active.level,
      });
    } catch (err) {
      logger.error(LOG_PREFIX, {
        event: 'denorm-failed',
        sanctionId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
