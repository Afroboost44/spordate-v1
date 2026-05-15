/**
 * Phase B — `processCommission` extracté du webhook Stripe handler (anciennement
 * `src/app/api/webhooks/stripe/handler.ts:840-901`).
 *
 * Pourquoi un module séparé ?
 *  1. Permet la TDD via Firebase emulator (tests/referral/process-commission-modes).
 *     Le webhook handler est gigantesque + signature Stripe → non-testable directement.
 *  2. Sépare la logique commission (paramétrable via user.commission) de la
 *     plomberie Stripe webhook.
 *
 * Appel :
 *   import { processCommission } from '@/lib/referral/processCommission';
 *   await processCommission({ db, FV, payerUserId, amount, code });
 *
 * Behavior :
 *   - Cherche le code dans `creators` puis dans `users` (peut hit les deux si
 *     un user a été auto-promoté creator).
 *   - Pour chaque hit, lit user.commission.{creator|invite} via resolveUserCommission.
 *   - mode 'percent'    → CHF dans creators.totalEarnings + pendingPayout
 *                         (auto-create creators doc côté invite si manquant)
 *   - mode 'free-class' → +N credits 'creator_voucher_class' sur user.credits
 *   - Anti self-referral (skip si payer === referrer)
 *   - Notif + (côté creator) update du doc /referrals associé
 *
 * Idempotent côté call : un même run produit un effet uniforme. Le webhook
 * Stripe garantit lui-même qu'il ne fire pas deux fois la même session.
 *
 * @module
 */

import type { Firestore } from 'firebase-admin/firestore';
import {
  resolveUserCommission,
  computePercentCommission,
  computeFreeClassCredits,
  type CommissionConfig,
  type CommissionSlot,
} from './commission';

// firebase-admin/firestore FieldValue — typeof shape, ne pas importer la classe
// pour rester compatible avec le caller existant qui injecte `FV`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldValueLike = any;

export interface ProcessCommissionArgs {
  db: Firestore;
  FV: FieldValueLike;
  /** UID du user qui a effectué l'achat (le "filleul"). */
  payerUserId: string;
  /** Montant de l'achat en centimes CHF. */
  amount: number;
  /** Code de parrainage présent dans Stripe metadata.referralCode. */
  code: string;
}

export async function processCommission(args: ProcessCommissionArgs): Promise<void> {
  const { db, FV, payerUserId, amount, code } = args;
  if (!code) return;

  // === CHEMIN CRÉATEUR =========================================================
  const creatorSnap = await db
    .collection('creators')
    .where('referralCode', '==', code)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (!creatorSnap.empty) {
    const creatorDoc = creatorSnap.docs[0];
    if (creatorDoc.id !== payerUserId) {
      const userSnap = await db.collection('users').doc(creatorDoc.id).get();
      const config = resolveUserCommission(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userSnap.exists ? (userSnap.data() as any) : null,
        'creator',
      );
      await applyReward({
        db,
        FV,
        slot: 'creator',
        recipientId: creatorDoc.id,
        creatorDocRef: creatorDoc.ref,
        config,
        amount,
        payerUserId,
        code,
      });
    }
  }

  // === CHEMIN INVITATION USER ==================================================
  const referrerSnap = await db
    .collection('users')
    .where('referralCode', '==', code)
    .limit(1)
    .get();

  if (!referrerSnap.empty) {
    const referrerDoc = referrerSnap.docs[0];
    if (referrerDoc.id !== payerUserId) {
      const config = resolveUserCommission(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        referrerDoc.data() as any,
        'invite',
      );
      await applyReward({
        db,
        FV,
        slot: 'invite',
        recipientId: referrerDoc.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        referrerDisplayName: (referrerDoc.data() as any)?.displayName || '',
        config,
        amount,
        payerUserId,
        code,
      });
    }
  }
}

// =============================================================================
// Application d'une récompense (mode percent OU free-class) pour un slot donné.
// =============================================================================

interface ApplyRewardArgs {
  db: Firestore;
  FV: FieldValueLike;
  slot: CommissionSlot;
  recipientId: string;
  /** Ref vers le doc /creators si slot='creator' (déjà fetché). */
  creatorDocRef?: FirebaseFirestore.DocumentReference;
  /** displayName du user si slot='invite' (pour auto-create creators si percent). */
  referrerDisplayName?: string;
  config: CommissionConfig;
  amount: number;
  payerUserId: string;
  code: string;
}

async function applyReward(args: ApplyRewardArgs): Promise<void> {
  const { db, FV, slot, recipientId, config, amount, payerUserId, code } = args;

  if (config.mode === 'percent') {
    const commissionCents = computePercentCommission(amount, config.value);
    if (commissionCents <= 0) return;
    await applyPercentReward({ ...args, commissionCents });
  } else {
    const credits = computeFreeClassCredits(config.value);
    if (credits <= 0) return;
    await applyFreeClassReward({ ...args, credits });
  }

  // Marquer le doc /referrals comme 'active' (creator path uniquement — tracking
  // de la relation referrer→referred initialisée par processReferralSignup).
  if (slot === 'creator') {
    const rSnap = await db
      .collection('referrals')
      .where('referredUserId', '==', payerUserId)
      .where('referrerId', '==', recipientId)
      .limit(1)
      .get();
    if (!rSnap.empty) {
      const commissionChf =
        config.mode === 'percent'
          ? computePercentCommission(amount, config.value) / 100
          : 0;
      await rSnap.docs[0].ref.update({
        totalPurchases: FV.increment(1),
        totalCommission: FV.increment(commissionChf),
        status: 'active',
      });
    }
  }
  // Suppression de la variable inutilisée (lint) — `code` n'est utilisé que dans
  // applyPercentReward pour auto-create le creator doc côté invite. C'est OK.
  void code;
}

// -----------------------------------------------------------------------------
// Mode 'percent' — crédite CHF dans creators.{totalEarnings, pendingPayout}.
// Auto-create le doc /creators côté invite si nécessaire.
// -----------------------------------------------------------------------------
async function applyPercentReward(
  args: ApplyRewardArgs & { commissionCents: number },
): Promise<void> {
  const { db, FV, slot, recipientId, creatorDocRef, referrerDisplayName, code, commissionCents, payerUserId } = args;

  const batch = db.batch();
  let creatorRef = creatorDocRef;

  if (slot === 'invite' && !creatorRef) {
    creatorRef = db.collection('creators').doc(recipientId);
    const existingDoc = await creatorRef.get();
    if (!existingDoc.exists) {
      // Auto-create : le user invitant n'avait pas de creator doc → on en pose
      // un avec les champs minimaux requis. Cohérent avec processReferralSignup
      // qui auto-promeut les users en creator au signup d'un filleul.
      batch.set(creatorRef, {
        creatorId: recipientId,
        displayName: referrerDisplayName ?? '',
        referralCode: code,
        referralLink: `https://spordateur.com/?ref=${code}`,
        // Mirror pour back-compat /creator/dashboard qui affiche encore commissionRate.
        commissionRate: args.config.value / 100,
        totalEarnings: 0,
        pendingPayout: 0,
        totalReferrals: 0,
        totalPurchases: 0,
        isActive: true,
        payoutMethod: 'twint',
        payoutDetails: {},
        createdAt: FV.serverTimestamp(),
      });
    }
  }

  if (!creatorRef) return; // safety: shouldn't happen

  batch.update(creatorRef, {
    totalEarnings: FV.increment(commissionCents / 100),
    pendingPayout: FV.increment(commissionCents / 100),
    totalPurchases: FV.increment(1),
  });

  const nRef = db.collection('notifications').doc();
  batch.set(nRef, {
    notificationId: nRef.id,
    userId: recipientId,
    type: slot === 'creator' ? 'affiliation' : 'referral',
    title: 'Commission reçue !',
    body: `+${(commissionCents / 100).toFixed(2)} CHF de commission sur un achat de ton filleul`,
    data: { referredUserId: payerUserId },
    isRead: false,
    createdAt: FV.serverTimestamp(),
  });

  await batch.commit();
}

// -----------------------------------------------------------------------------
// Mode 'free-class' — N crédits 'creator_voucher_class' sur user.credits.
// -----------------------------------------------------------------------------
async function applyFreeClassReward(
  args: ApplyRewardArgs & { credits: number },
): Promise<void> {
  const { db, FV, slot, recipientId, credits, payerUserId, creatorDocRef } = args;

  const batch = db.batch();
  const userRef = db.collection('users').doc(recipientId);
  batch.update(userRef, {
    credits: FV.increment(credits),
    updatedAt: FV.serverTimestamp(),
  });

  // Côté creator : bump aussi totalPurchases pour cohérence des stats.
  if (slot === 'creator' && creatorDocRef) {
    batch.update(creatorDocRef, { totalPurchases: FV.increment(1) });
  }

  const creditRef = db.collection('credits').doc();
  batch.set(creditRef, {
    creditId: creditRef.id,
    userId: recipientId,
    type: 'creator_voucher_class',
    amount: credits,
    balance: 0,
    source: 'commission',
    description:
      slot === 'creator'
        ? `+${credits} cours offert${credits > 1 ? 's' : ''} — commission créateur`
        : `+${credits} cours offert${credits > 1 ? 's' : ''} — bonus parrainage`,
    relatedId: payerUserId,
    createdAt: FV.serverTimestamp(),
  });

  const nRef = db.collection('notifications').doc();
  batch.set(nRef, {
    notificationId: nRef.id,
    userId: recipientId,
    type: slot === 'creator' ? 'affiliation' : 'referral',
    title: credits === 1 ? 'Cours offert reçu !' : `${credits} cours offerts reçus !`,
    body:
      slot === 'creator'
        ? `+${credits} cours offert${credits > 1 ? 's' : ''} via ton lien créateur`
        : `+${credits} cours offert${credits > 1 ? 's' : ''} — ton ami a fait un achat`,
    data: { referredUserId: payerUserId },
    isRead: false,
    createdAt: FV.serverTimestamp(),
  });

  await batch.commit();
}
