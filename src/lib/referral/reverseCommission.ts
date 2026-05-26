/**
 * Vague 2 — Reverse-commission helper pour les Stripe refunds.
 *
 * Pourquoi ?
 * ---------
 * Aujourd'hui (avant ce fix), si Bassi rembourse un client via Stripe (full ou
 * partiel), la commission partenaire / parrainage qui avait été appliquée par
 * `processCommission` reste créditée comme si de rien n'était. Bassi rembourse
 * 100% au client mais le partenaire reste payé → incohérence comptable.
 *
 * Ce module rejoue *à l'envers* la logique de `processCommission` quand le
 * webhook Stripe `charge.refunded` arrive :
 *  1. Retrouve la transaction d'origine via `stripePaymentIntentId`.
 *  2. Re-cherche le code de parrainage (creators + users) — exactement les
 *     mêmes lookups que processCommission, pour garantir qu'on touche les bons
 *     comptes.
 *  3. Recompute la commission qui avait été appliquée (centimes) en fonction
 *     de la `user.commission.{creator|invite}` config.
 *  4. Applique le prorata refund_amount / total_amount → reverse exactement
 *     la part remboursée (refund partiel → reverse partiel).
 *  5. Décrémente atomiquement :
 *       - creators/{id}.pendingPayout
 *       - creators/{id}.totalEarnings
 *       - creators/{id}.totalPurchases  (-1 sur full refund, 0 sur partial)
 *     ou pour le mode free-class :
 *       - users/{id}.credits  (best-effort — si le parrain a déjà dépensé les
 *         crédits, on log une dette négative côté `commissionReversals` mais on
 *         ne force PAS un solde négatif côté client si les rules le bloquent).
 *  6. Logge un doc `commissionReversals/{auto-id}` pour la comptabilité.
 *
 * Idempotence : la collection `commissionReversals` est indexée par
 * `(stripePaymentIntentId, refundId)`. Avant tout write, on check si un reverse
 * existe déjà pour ce couple (Stripe peut rejouer `charge.refunded`). Si oui,
 * on skip. L'idempotence vague 1 (event.id Firestore) protège déjà au niveau
 * webhook event, donc ce check est une ceinture en plus de la bretelle.
 *
 * NOTE produit ouverte (Bassi à confirmer) :
 *  - Notification au partenaire / parrain ? OUI — branchée depuis Fix #N :
 *    après chaque commit /commissionReversals, un doc /notifications best-effort
 *    est créé via tPush (clés referral_commission_reversed / referral_free_class_reversed_*).
 *    Best-effort = si la notif échoue, on log mais la réversion comptable reste
 *    valide. Pas d'email pour l'instant (à confirmer par Bassi si besoin).
 *  - Solde négatif autorisé pour creator.pendingPayout ? Aujourd'hui ce helper
 *    décrément même si ça passe sous 0 (FV.increment(-x) ne clamp pas). Si on
 *    veut clamp, faire un read+write transactionnel ici. Pas critique tant que
 *    le partenaire n'a pas encore touché — sinon Bassi le règle hors-app.
 *
 * @module
 */

import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import {
  resolveUserCommission,
  computePercentCommission,
  computeFreeClassCredits,
  type CommissionConfig,
  type CommissionSlot,
} from './commission';
import {
  tPush,
  coerceLang,
  DEFAULT_LANG,
  type ServerLang,
  type MessageKey,
} from '@/lib/i18n/serverTranslations';

// firebase-admin/firestore FieldValue — typeof shape, ne pas importer la classe
// pour rester compatible avec le caller (inject `FV` comme processCommission).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldValueLike = any;

export interface ReverseCommissionArgs {
  db: Firestore;
  FV: FieldValueLike;
  /** Stripe PaymentIntent ID du paiement remboursé (charge.payment_intent). */
  paymentIntentId: string;
  /** Montant remboursé en centimes CHF (charge.amount_refunded delta). */
  refundAmountCents: number;
  /** Montant total payé à l'origine en centimes CHF (charge.amount). */
  totalAmountCents: number;
  /** Stripe Refund ID (ru_...) — clé d'idempotence couplée au paymentIntent. */
  refundId?: string;
}

export interface ReverseCommissionResult {
  /** True si au moins une commission a été reversée. */
  reversed: boolean;
  /** Si non reversé, raison textuelle (pour log/debug). */
  reason?: string;
  /** Nombre de reversals créés (peut être 2 si creator+invite ont matché). */
  reversalsCreated: number;
}

/**
 * Reverse la commission d'un paiement remboursé (full ou partiel).
 * À appeler depuis le webhook handler du `charge.refunded` Stripe.
 */
export async function reverseCommissionForRefund(
  args: ReverseCommissionArgs,
): Promise<ReverseCommissionResult> {
  const { db, FV, paymentIntentId, refundAmountCents, totalAmountCents, refundId } = args;

  if (!paymentIntentId) {
    return { reversed: false, reason: 'missing-payment-intent', reversalsCreated: 0 };
  }
  if (!Number.isFinite(refundAmountCents) || refundAmountCents <= 0) {
    return { reversed: false, reason: 'invalid-refund-amount', reversalsCreated: 0 };
  }
  if (!Number.isFinite(totalAmountCents) || totalAmountCents <= 0) {
    return { reversed: false, reason: 'invalid-total-amount', reversalsCreated: 0 };
  }

  // 1. Retrouve la transaction d'origine.
  const txSnap = await db
    .collection('transactions')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();
  if (txSnap.empty) {
    // Pas une transaction Spordateur (peut-être un paiement test, ou hors-app).
    return { reversed: false, reason: 'transaction-not-found', reversalsCreated: 0 };
  }
  const originalTx = txSnap.docs[0];
  const txData = originalTx.data() as Record<string, unknown>;
  const meta = (txData.metadata || {}) as Record<string, string>;
  const referralCode = meta.referralCode || '';
  if (!referralCode) {
    // Aucune commission n'a été appliquée à l'origine → rien à reverser.
    return { reversed: false, reason: 'no-referral-code', reversalsCreated: 0 };
  }
  const payerUserId = (txData.userId as string) || meta.userId || '';

  // 2. Idempotence — un reverse pour ce (paymentIntentId, refundId) existe ?
  let alreadyReversedQ = db
    .collection('commissionReversals')
    .where('paymentIntentId', '==', paymentIntentId);
  if (refundId) {
    alreadyReversedQ = alreadyReversedQ.where('refundId', '==', refundId);
  }
  const alreadyReversedSnap = await alreadyReversedQ.limit(1).get();
  if (!alreadyReversedSnap.empty) {
    return { reversed: false, reason: 'already-reversed', reversalsCreated: 0 };
  }

  // 3. Ratio refund partiel (1.0 si full refund).
  const refundRatio = Math.min(1, refundAmountCents / totalAmountCents);
  const isFullRefund = refundAmountCents >= totalAmountCents;

  let reversalsCreated = 0;

  // 4. Chemin créateur (creators.referralCode) — mirror processCommission.
  const creatorSnap = await db
    .collection('creators')
    .where('referralCode', '==', referralCode)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  if (!creatorSnap.empty) {
    const creatorDoc = creatorSnap.docs[0];
    if (!payerUserId || creatorDoc.id !== payerUserId) {
      const userSnap = await db.collection('users').doc(creatorDoc.id).get();
      const config = resolveUserCommission(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userSnap.exists ? (userSnap.data() as any) : null,
        'creator',
      );
      const created = await reverseSlot({
        db,
        FV,
        slot: 'creator',
        recipientId: creatorDoc.id,
        creatorDocRef: creatorDoc.ref,
        config,
        totalAmountCents,
        refundRatio,
        isFullRefund,
        originalTxId: originalTx.id,
        paymentIntentId,
        refundAmountCents,
        refundId,
        referralCode,
      });
      if (created) reversalsCreated += 1;
    }
  }

  // 5. Chemin invitation user (users.referralCode) — mirror processCommission.
  const referrerSnap = await db
    .collection('users')
    .where('referralCode', '==', referralCode)
    .limit(1)
    .get();
  if (!referrerSnap.empty) {
    const referrerDoc = referrerSnap.docs[0];
    if (!payerUserId || referrerDoc.id !== payerUserId) {
      const config = resolveUserCommission(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        referrerDoc.data() as any,
        'invite',
      );
      const created = await reverseSlot({
        db,
        FV,
        slot: 'invite',
        recipientId: referrerDoc.id,
        creatorDocRef: db.collection('creators').doc(referrerDoc.id),
        config,
        totalAmountCents,
        refundRatio,
        isFullRefund,
        originalTxId: originalTx.id,
        paymentIntentId,
        refundAmountCents,
        refundId,
        referralCode,
      });
      if (created) reversalsCreated += 1;
    }
  }

  return {
    reversed: reversalsCreated > 0,
    reversalsCreated,
    reason: reversalsCreated === 0 ? 'no-matching-recipient' : undefined,
  };
}

// =============================================================================
// Helpers internes — notification reversal (best-effort).
// =============================================================================

/**
 * Lit users/{uid}.language → ServerLang (fallback DEFAULT_LANG). Pattern miroir
 * de processCommission.loadRecipientLang — duppliqué localement pour éviter une
 * dépendance entre les deux modules referral.
 */
async function loadRecipientLang(db: Firestore, recipientId: string): Promise<ServerLang> {
  try {
    const snap = await db.collection('users').doc(recipientId).get();
    if (!snap.exists) return DEFAULT_LANG;
    const data_ = snap.data() || {};
    return coerceLang((data_ as { language?: unknown }).language ?? DEFAULT_LANG);
  } catch {
    return DEFAULT_LANG;
  }
}

/**
 * Pousse un doc /notifications best-effort pour informer le recipient qu'une
 * commission / un crédit a été reversé suite à un refund Stripe. NE THROW PAS :
 * un échec ici ne doit pas casser la réversion de commission (qui a déjà été
 * committée par le batch appelant).
 */
async function notifyReversalRecipient(args: {
  db: Firestore;
  FV: FieldValueLike;
  recipientId: string;
  slot: CommissionSlot;
  messageKey: MessageKey;
  params: Record<string, string | number | undefined>;
  reversalId: string;
  paymentIntentId: string;
}): Promise<void> {
  const { db, FV, recipientId, slot, messageKey, params, reversalId, paymentIntentId } = args;
  try {
    const lang = await loadRecipientLang(db, recipientId);
    const tr = tPush(lang, messageKey, params);
    const nRef = db.collection('notifications').doc();
    await nRef.set({
      notificationId: nRef.id,
      userId: recipientId,
      type: slot === 'creator' ? 'affiliation_reversal' : 'referral_reversal',
      title: tr.title,
      body: tr.body,
      data: { reversalId, paymentIntentId },
      isRead: false,
      createdAt: FV.serverTimestamp(),
    });
  } catch (err) {
    // Best-effort : on log mais on n'échoue pas — la réversion comptable a déjà
    // été committée. Une notif manquée ≠ état Firestore incohérent.
    console.warn('[reverseCommission] notify failed', {
      recipientId,
      reversalId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Reverse d'un slot (creator ou invite) — applique le delta sur les soldes +
// logge un doc /commissionReversals.
// =============================================================================

interface ReverseSlotArgs {
  db: Firestore;
  FV: FieldValueLike;
  slot: CommissionSlot;
  recipientId: string;
  /** Doc creator à debiter (creator path direct, OU côté invite si déjà créé). */
  creatorDocRef: DocumentReference;
  config: CommissionConfig;
  totalAmountCents: number;
  refundRatio: number;
  isFullRefund: boolean;
  originalTxId: string;
  paymentIntentId: string;
  refundAmountCents: number;
  refundId?: string;
  referralCode: string;
}

async function reverseSlot(args: ReverseSlotArgs): Promise<boolean> {
  const { db, FV, slot, recipientId, creatorDocRef, config, totalAmountCents, refundRatio,
    isFullRefund, originalTxId, paymentIntentId, refundAmountCents, refundId, referralCode } = args;

  // Recompute la commission qui avait été appliquée à l'origine.
  if (config.mode === 'percent') {
    const originalCommissionCents = computePercentCommission(totalAmountCents, config.value);
    if (originalCommissionCents <= 0) return false;

    // Prorata refund (arrondi centime entier).
    const commissionToReverseCents = Math.round(originalCommissionCents * refundRatio);
    if (commissionToReverseCents <= 0) return false;

    // Si le doc creator n'existe pas (cas pathologique : invite mode percent
    // sans creator doc auto-créé), on log mais on n'ajoute pas de delta.
    const creatorSnapBefore = await creatorDocRef.get();
    const creatorExists = creatorSnapBefore.exists;

    const batch = db.batch();

    if (creatorExists) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: Record<string, any> = {
        totalEarnings: FV.increment(-commissionToReverseCents / 100),
        pendingPayout: FV.increment(-commissionToReverseCents / 100),
      };
      if (isFullRefund) {
        update.totalPurchases = FV.increment(-1);
      }
      batch.update(creatorDocRef, update);
    }

    const reversalRef = db.collection('commissionReversals').doc();
    batch.set(reversalRef, {
      reversalId: reversalRef.id,
      originalTransactionId: originalTxId,
      paymentIntentId,
      refundId: refundId || null,
      slot,
      recipientId,
      referralCode,
      mode: 'percent',
      originalCommissionCents,
      commissionReversedCents: commissionToReverseCents,
      refundAmountCents,
      totalAmountCents,
      refundRatio,
      isFullRefund,
      creatorDocApplied: creatorExists,
      reason: 'stripe-refund',
      refundedAt: FV.serverTimestamp(),
      createdAt: FV.serverTimestamp(),
    });

    await batch.commit();

    // Notification best-effort au partenaire (creator ou invite percent).
    // On notifie uniquement si on a effectivement appliqué le delta côté creator
    // (sinon rien n'a bougé pour lui, pas de raison de l'alerter).
    if (creatorExists) {
      await notifyReversalRecipient({
        db,
        FV,
        recipientId,
        slot,
        messageKey: 'referral_commission_reversed',
        params: { amount: (commissionToReverseCents / 100).toFixed(2) },
        reversalId: reversalRef.id,
        paymentIntentId,
      });
    }
    return true;
  }

  // Mode free-class — décrémente les credits du parrain (best-effort).
  const originalCredits = computeFreeClassCredits(config.value);
  if (originalCredits <= 0) return false;

  // Prorata : sur refund partiel, on ne reverse que si le ratio "vaut" au
  // moins un crédit entier. Sinon on garde le crédit (granularité = 1 crédit).
  // Sur un full refund, on reverse l'intégralité des credits offerts.
  const creditsToReverse = isFullRefund
    ? originalCredits
    : Math.floor(originalCredits * refundRatio);
  if (creditsToReverse <= 0) {
    // Log quand même un doc reversal "no-op" pour traçabilité — utile pour
    // l'audit côté Bassi (sait qu'on a vu le refund mais < seuil 1 crédit).
    const reversalRef = db.collection('commissionReversals').doc();
    await reversalRef.set({
      reversalId: reversalRef.id,
      originalTransactionId: originalTxId,
      paymentIntentId,
      refundId: refundId || null,
      slot,
      recipientId,
      referralCode,
      mode: 'free-class',
      originalCredits,
      creditsReversed: 0,
      refundAmountCents,
      totalAmountCents,
      refundRatio,
      isFullRefund,
      reason: 'stripe-refund-below-credit-threshold',
      refundedAt: FV.serverTimestamp(),
      createdAt: FV.serverTimestamp(),
    });
    return true;
  }

  // Best-effort : on lit le solde du user — si insuffisant on log une "dette"
  // (negativeBalanceFlagged=true, creditsActuallyDeducted = min(balance, X))
  // au lieu de forcer un solde négatif côté Firestore (les rules client peuvent
  // refuser une lecture incohérente, et Bassi préfère gérer ces cas à la main).
  const userRef = db.collection('users').doc(recipientId);
  const userSnap = await userRef.get();
  const currentCredits = userSnap.exists ? Number(userSnap.data()?.credits || 0) : 0;
  const actuallyDeductible = Math.min(currentCredits, creditsToReverse);
  const debt = creditsToReverse - actuallyDeductible;

  const batch = db.batch();
  if (actuallyDeductible > 0) {
    batch.update(userRef, {
      credits: FV.increment(-actuallyDeductible),
      updatedAt: FV.serverTimestamp(),
    });
  }

  const reversalRef = db.collection('commissionReversals').doc();
  batch.set(reversalRef, {
    reversalId: reversalRef.id,
    originalTransactionId: originalTxId,
    paymentIntentId,
    refundId: refundId || null,
    slot,
    recipientId,
    referralCode,
    mode: 'free-class',
    originalCredits,
    creditsExpectedReversal: creditsToReverse,
    creditsActuallyDeducted: actuallyDeductible,
    creditsOutstandingDebt: debt,
    negativeBalanceFlagged: debt > 0,
    refundAmountCents,
    totalAmountCents,
    refundRatio,
    isFullRefund,
    reason: debt > 0 ? 'stripe-refund-partial-debt' : 'stripe-refund',
    refundedAt: FV.serverTimestamp(),
    createdAt: FV.serverTimestamp(),
  });

  await batch.commit();

  // Notification best-effort au parrain (mode free-class crédits). On notifie
  // uniquement si on a effectivement retiré au moins 1 crédit — sinon le
  // solde du parrain n'a pas bougé (cas dette intégrale) et alerter d'un
  // retrait qui n'a pas eu lieu côté UI serait trompeur. La dette reste
  // tracée dans /commissionReversals pour le reporting Bassi.
  if (actuallyDeductible > 0) {
    const variantKey: MessageKey =
      actuallyDeductible === 1
        ? 'referral_free_class_reversed_one'
        : 'referral_free_class_reversed_other';
    await notifyReversalRecipient({
      db,
      FV,
      recipientId,
      slot,
      messageKey: variantKey,
      params: { credits: actuallyDeductible },
      reversalId: reversalRef.id,
      paymentIntentId,
    });
  }
  return true;
}
