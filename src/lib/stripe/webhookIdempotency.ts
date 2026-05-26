/**
 * Spordateur — Stripe webhook idempotency helper.
 *
 * Stripe rejoue les webhooks en cas de timeout réseau ou de 5xx côté serveur
 * (retry policy : jusqu'à 3 jours, plusieurs dizaines de tentatives). Si on ne
 * gate pas explicitement sur `event.id`, le même paiement peut être traité
 * plusieurs fois → double-crédit, double-commission, double-activation premium,
 * double-booking. Le check `transactions.stripeSessionId` historique couvre la
 * branche `handlePaymentSuccess` mais pas les flows `handleExpired`,
 * `handleSubCancelled`, `handleSubUpdated`, `handleInvoicePaid`,
 * `handleInvoiceFailed` qui ne créent pas tous une transaction.
 *
 * Cette gate stocke chaque `event.id` Stripe dans la collection
 * `stripeWebhookEvents` (un doc par event, `event.id` = docId) avec un statut
 * `processing | completed | failed`. La création est faite via une transaction
 * Firestore (atomique check + create) pour éviter qu'un retry concurrent passe
 * la barrière en double.
 *
 * Politique de retry (souple, décision Bassi 2026-05) :
 *  - doc absent           → claim en `processing`, processe
 *  - doc `processing`     → skip (concurrence, un autre worker est en cours)
 *  - doc `completed`      → skip définitif (jamais de rejeu)
 *  - doc `failed` < 10min → skip (cooldown anti-hammering)
 *  - doc `failed` >=10min → reset en `processing`, incrémente `retryCount`,
 *    re-processe — sauf si `retryCount >= MAX_RETRIES` (bloc définitif pour
 *    éviter une boucle infinie sur un bug récurrent).
 *
 * Usage côté handler :
 *
 *   const claim = await claimWebhookEvent(event.id, event.type);
 *   if (claim.alreadyProcessed) return; // skip — déjà traité, en cours, ou cooldown
 *   try {
 *     // ...switch(event.type) { ... }
 *     await markWebhookCompleted(event.id);
 *   } catch (err) {
 *     await markWebhookFailed(event.id, err);
 *     throw err;
 *   }
 *
 * Sécurité Firestore : la collection est server-only (Admin SDK bypass des
 * rules). L'agent règles Firestore ajoute en parallèle une règle qui bloque
 * tout accès client à `/stripeWebhookEvents`.
 *
 * @module
 */

import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';

const COLLECTION = 'stripeWebhookEvents';

/**
 * Délai en minutes après lequel un event en status `failed` peut être retenté
 * par Stripe. En dessous → skip (cooldown anti-hammering). Au-dessus → on
 * remet le doc en `processing` et on rejoue le handler.
 */
export const RETRY_COOLDOWN_MINUTES = 10;

/**
 * Nombre maximum de tentatives (claim initial inclus). Au-delà, même après
 * cooldown, on bloque définitivement pour éviter une boucle infinie de retry
 * sur un bug récurrent côté handler. Bassi devra inspecter manuellement.
 */
export const MAX_RETRIES = 5;

// Lazy init — partagé entre les helpers.
let _db: FirebaseFirestore.Firestore | null = null;
let _FV: typeof import('firebase-admin/firestore').FieldValue | null = null;

async function getAdmin(): Promise<{
  db: FirebaseFirestore.Firestore;
  FV: typeof import('firebase-admin/firestore').FieldValue;
}> {
  if (_db && _FV) return { db: _db, FV: _FV };

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({
        credential: cert(
          parseServiceAccountKeyDefensive(
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
          ) as Parameters<typeof cert>[0],
        ),
      });
    } else {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude',
      });
    }
  }

  _db = getFirestore();
  _FV = FieldValue;
  return { db: _db, FV: _FV };
}

export type WebhookProcessingStatus = 'processing' | 'completed' | 'failed';

/**
 * Raison structurée pour expliquer pourquoi un claim a été refusé. Permet au
 * caller (route.ts) de logger un message précis et différencier les cas dans
 * les dashboards de monitoring.
 */
export type ClaimSkipReason =
  | 'completed'        // déjà traité avec succès — skip définitif
  | 'processing'       // un autre worker est en cours — race condition
  | 'failed_cooldown'  // failed récent, on attend RETRY_COOLDOWN_MINUTES
  | 'failed_max_retries'; // trop de retries, blocage manuel requis

export interface ClaimResult {
  /**
   * `true` si l'event doit être skip par le caller (déjà processé, en cours,
   * ou en cooldown). `false` si on vient juste de poser la claim — le caller
   * doit exécuter le handler puis appeler `markWebhookCompleted` /
   * `markWebhookFailed`.
   */
  alreadyProcessed: boolean;
  /** Statut existant lu en base si `alreadyProcessed === true`, sinon undefined. */
  existingStatus?: WebhookProcessingStatus;
  /** Raison structurée du skip (uniquement si `alreadyProcessed === true`). */
  skipReason?: ClaimSkipReason;
  /**
   * Nombre de tentatives effectuées sur cet event (1 au claim initial, puis
   * incrémenté à chaque retry passé en `processing` après cooldown).
   * Présent quand `alreadyProcessed === false` (pour log) et aussi quand on
   * skip pour cooldown (pour debug).
   */
  retryCount?: number;
  /** `true` si ce claim correspond à un retry après échec (>= 2e passage). */
  isRetry?: boolean;
}

/**
 * Atomiquement vérifie l'état de l'event dans `stripeWebhookEvents` et applique
 * la politique de retry souple (cf. docstring module). Utilise une transaction
 * Firestore pour éviter qu'un retry concurrent Stripe ne franchisse la gate
 * en double.
 *
 * Matrice :
 *  - doc absent           → claim en `processing` (retryCount=1), processe
 *  - doc `processing`     → skip (skipReason='processing')
 *  - doc `completed`      → skip définitif (skipReason='completed')
 *  - doc `failed` < 10min → skip (skipReason='failed_cooldown')
 *  - doc `failed` >=10min ET retryCount < MAX → reset en `processing`,
 *    incrémente retryCount, re-processe
 *  - doc `failed` ET retryCount >= MAX → skip (skipReason='failed_max_retries')
 */
export async function claimWebhookEvent(
  eventId: string,
  eventType: string,
): Promise<ClaimResult> {
  if (!eventId) {
    // Pas d'event.id → on ne peut pas dedupliquer. Laisse passer pour ne pas
    // bloquer un payload non standard, mais log un warning.
    console.warn('[webhookIdempotency] claimWebhookEvent appelé sans eventId — skip dedup');
    return { alreadyProcessed: false };
  }

  const { db, FV } = await getAdmin();
  const ref = db.collection(COLLECTION).doc(eventId);
  const cooldownMs = RETRY_COOLDOWN_MINUTES * 60 * 1000;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      // Cas 1 : doc absent → claim initial.
      tx.set(ref, {
        eventId,
        eventType,
        processingStatus: 'processing' as WebhookProcessingStatus,
        processedAt: FV.serverTimestamp(),
        retryCount: 1,
      });
      console.log(
        `[webhookIdempotency] event ${eventId} (${eventType}) claimed (status=processing, retryCount=1)`,
      );
      return { alreadyProcessed: false, retryCount: 1, isRetry: false };
    }

    const data = snap.data() as
      | {
          processingStatus?: WebhookProcessingStatus;
          failedAt?: FirebaseFirestore.Timestamp;
          retryCount?: number;
        }
      | undefined;
    const existingStatus: WebhookProcessingStatus =
      (data?.processingStatus as WebhookProcessingStatus) || 'processing';
    const retryCount = typeof data?.retryCount === 'number' ? data.retryCount : 1;

    // Cas 2 : doc en `completed` → skip définitif.
    if (existingStatus === 'completed') {
      console.log(
        `[webhookIdempotency] event ${eventId} (${eventType}) already completed — skip définitif`,
      );
      return {
        alreadyProcessed: true,
        existingStatus,
        skipReason: 'completed',
        retryCount,
      };
    }

    // Cas 3 : doc en `processing` → race, skip.
    if (existingStatus === 'processing') {
      console.log(
        `[webhookIdempotency] event ${eventId} (${eventType}) currently processing — skip (concurrence)`,
      );
      return {
        alreadyProcessed: true,
        existingStatus,
        skipReason: 'processing',
        retryCount,
      };
    }

    // Cas 4/5/6 : doc en `failed`. Vérifier cooldown + plafond retry.
    // existingStatus === 'failed' à partir d'ici.
    if (retryCount >= MAX_RETRIES) {
      console.error(
        `[webhookIdempotency] event ${eventId} (${eventType}) failed ${retryCount}x (>= MAX_RETRIES=${MAX_RETRIES}) — blocage définitif, intervention manuelle requise`,
      );
      return {
        alreadyProcessed: true,
        existingStatus,
        skipReason: 'failed_max_retries',
        retryCount,
      };
    }

    const failedAtMs = data?.failedAt?.toMillis?.() ?? 0;
    const ageMs = failedAtMs ? Date.now() - failedAtMs : Number.POSITIVE_INFINITY;

    if (failedAtMs && ageMs < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - ageMs) / 1000);
      console.log(
        `[webhookIdempotency] event ${eventId} (${eventType}) failed il y a ${Math.round(
          ageMs / 1000,
        )}s — cooldown actif (${remainingSec}s restants), skip`,
      );
      return {
        alreadyProcessed: true,
        existingStatus,
        skipReason: 'failed_cooldown',
        retryCount,
      };
    }

    // Cas final : failed mais cooldown écoulé (ou failedAt manquant) ET sous
    // le plafond MAX_RETRIES → on retente. Reset en `processing` et incrémente.
    const nextRetryCount = retryCount + 1;
    tx.set(
      ref,
      {
        eventId,
        eventType,
        processingStatus: 'processing' as WebhookProcessingStatus,
        processedAt: FV.serverTimestamp(),
        retryCount: nextRetryCount,
        // failedAt est laissé en place pour audit historique (Bassi peut voir
        // quand la dernière failure a eu lieu). errorMessage idem.
      },
      { merge: true },
    );
    console.log(
      `[webhookIdempotency] event ${eventId} (${eventType}) retry après failure (retryCount=${nextRetryCount}/${MAX_RETRIES}, cooldown ${RETRY_COOLDOWN_MINUTES}min écoulé) — re-processing`,
    );
    return {
      alreadyProcessed: false,
      retryCount: nextRetryCount,
      isRetry: true,
    };
  });
}

/**
 * Marque l'event comme `completed` après succès du handler. Best-effort : si
 * l'update échoue (ex : Firestore down), on log et on continue — le doc reste
 * en `processing`, ce qui bloquera un retry futur sur cet event (acceptable).
 */
export async function markWebhookCompleted(eventId: string): Promise<void> {
  if (!eventId) return;
  try {
    const { db, FV } = await getAdmin();
    await db.collection(COLLECTION).doc(eventId).set(
      {
        processingStatus: 'completed' as WebhookProcessingStatus,
        completedAt: FV.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`[webhookIdempotency] event ${eventId} marked completed`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[webhookIdempotency] failed to mark event ${eventId} completed: ${msg}`,
    );
  }
}

/**
 * Marque l'event comme `failed` avec un message d'erreur stocké pour audit.
 * Stocke `failedAt: serverTimestamp()` — cette date est lue par
 * `claimWebhookEvent` pour décider du cooldown (cf. RETRY_COOLDOWN_MINUTES).
 * Best-effort : ne throw jamais, le caller continue son flow d'erreur.
 */
export async function markWebhookFailed(
  eventId: string,
  error: unknown,
): Promise<void> {
  if (!eventId) return;
  try {
    const { db, FV } = await getAdmin();
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? 'unknown error');
    await db.collection(COLLECTION).doc(eventId).set(
      {
        processingStatus: 'failed' as WebhookProcessingStatus,
        errorMessage: errorMessage.slice(0, 2000),
        failedAt: FV.serverTimestamp(),
      },
      { merge: true },
    );
    console.error(
      `[webhookIdempotency] event ${eventId} marked failed: ${errorMessage}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[webhookIdempotency] failed to mark event ${eventId} failed: ${msg}`,
    );
  }
}
