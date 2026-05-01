/**
 * Spordateur V2 — Stripe webhook handlers (extraits de route.ts)
 *
 * Ce fichier sibling contient TOUTE la logique métier du webhook.
 * `route.ts` est un thin wrapper qui n'expose que POST/GET (contrainte Next.js).
 *
 * Phase 3 : ajout du dispatch sur metadata.mode='session' (handleSessionPayment).
 * Le mode 'package' (existant, défaut) reste strictement inchangé.
 */

import { computePricingTier, isSessionBookable } from '@/services/firestore';
import type { Session, PricingTierKind, SessionStatus } from '@/types/firestore';

// Lazy init — partagé entre tous les handlers
let _db: FirebaseFirestore.Firestore | null = null;
let _FV: typeof import('firebase-admin/firestore').FieldValue | null = null;

export async function initAdmin() {
  if (_db) return { db: _db, FV: _FV! };

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
    }
  }

  _db = getFirestore();
  _FV = FieldValue;
  return { db: _db, FV: _FV };
}

const PACKAGES: Record<string, { credits: number }> = {
  '1_date': { credits: 1 },
  '3_dates': { credits: 3 },
  '10_dates': { credits: 10 },
  'partner_monthly': { credits: 0 },
};

// =============================================================
/** @internal — exporté aussi pour les tests (tests/sessions-checkout.test.ts). */
export async function handlePaymentSuccess(session: Record<string, unknown>, stripe: InstanceType<typeof import('stripe').default>) {
  const meta = (session.metadata || {}) as Record<string, string>;

  // Phase 3 : dispatch sur metadata.mode. Si 'session' → branche nouvelle (achat de session datée).
  // Sinon (défaut, rétrocompatible) → flow 'package' (achat de crédits / abonnement).
  if (meta.mode === 'session') {
    return handleSessionPayment(session, stripe);
  }

  const { db, FV } = await initAdmin();
  const userId = meta.userId;
  const packageId = meta.packageId || '';
  const creditsToGrant = parseInt(meta.creditsToGrant || '0');
  const matchId = meta.matchId || '';
  const referralCode = meta.referralCode || '';
  const amountTotal = (session.amount_total as number) || 0;
  const sessionId = session.id as string;

  if (!userId) {
    await logErr(db, FV, 'Paiement sans userId', sessionId);
    return;
  }

  // Idempotency
  const existing = await db.collection('transactions').where('stripeSessionId', '==', sessionId).limit(1).get();
  if (!existing.empty) return;

  // Detect payment method
  let pm = 'card';
  const pmTypes = session.payment_method_types as string[] | undefined;
  if (pmTypes?.includes('twint')) {
    try {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
      if (pi.payment_method_types?.includes('twint')) pm = 'twint';
    } catch { /* ok */ }
  }

  const batch = db.batch();

  // 1. Transaction
  const txRef = db.collection('transactions').doc();
  batch.set(txRef, {
    transactionId: txRef.id, stripeSessionId: sessionId,
    stripePaymentIntentId: session.payment_intent || '',
    userId, type: packageId === 'partner_monthly' ? 'partner_subscription' : 'credit_purchase',
    amount: amountTotal, currency: 'CHF', paymentMethod: pm, status: 'succeeded',
    metadata: meta, package: packageId, creditsGranted: creditsToGrant,
    createdAt: FV.serverTimestamp(), completedAt: FV.serverTimestamp(),
  });

  // 2. Credits
  if (creditsToGrant > 0) {
    const userRef = db.collection('users').doc(userId);
    batch.update(userRef, { credits: FV.increment(creditsToGrant), updatedAt: FV.serverTimestamp() });

    const snap = await userRef.get();
    const cur = snap.exists ? (snap.data()?.credits || 0) : 0;
    const creditRef = db.collection('credits').doc();
    batch.set(creditRef, {
      creditId: creditRef.id, userId, type: 'purchase', amount: creditsToGrant,
      balance: cur + creditsToGrant,
      description: `Achat ${PACKAGES[packageId]?.credits || creditsToGrant} date(s)`,
      relatedId: txRef.id, createdAt: FV.serverTimestamp(),
    });
  }

  // 3. Unlock chat
  if (matchId) {
    batch.update(db.collection('matches').doc(matchId), { chatUnlocked: true });
    const msgRef = db.collection('chats').doc(matchId).collection('messages').doc();
    batch.set(msgRef, {
      messageId: msgRef.id, senderId: 'system',
      text: 'Le chat est débloqué ! Planifiez votre Sport Date',
      type: 'system', readBy: [], createdAt: FV.serverTimestamp(),
    });
  }

  // 4. Analytics
  batch.set(db.collection('analytics').doc('global'), {
    totalRevenue: FV.increment(amountTotal / 100), lastUpdated: FV.serverTimestamp(),
  }, { merge: true });

  const today = new Date().toISOString().split('T')[0];
  batch.set(db.collection('analytics').doc(`daily_${today}`), {
    date: today, revenue: FV.increment(amountTotal / 100),
    creditsPurchased: FV.increment(creditsToGrant),
    [`byPaymentMethod.${pm}`]: FV.increment(amountTotal / 100),
  }, { merge: true });

  // 5. Activate Premium if applicable
  const isPremium = meta.isPremium === 'true';
  if (isPremium) {
    const userRef = db.collection('users').doc(userId);
    batch.update(userRef, {
      isPremium: true,
      premiumPackage: packageId,
      premiumStartedAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
    });
  }

  // 5b. Activate Partner subscription if applicable
  const partnerId = meta.partnerId;
  if (packageId === 'partner_monthly' && partnerId) {
    const partnerRef = db.collection('partners').doc(partnerId);
    const partnerSnap = await partnerRef.get();
    if (partnerSnap.exists) {
      batch.update(partnerRef, {
        subscriptionStatus: 'active',
        subscriptionEnd: null,
        updatedAt: FV.serverTimestamp(),
      });
    }
  } else if (packageId === 'partner_monthly' && !partnerId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userEmail = userDoc.data()?.email;
      if (userEmail) {
        const pSnap = await db.collection('partners').where('email', '==', userEmail).limit(1).get();
        if (!pSnap.empty) {
          batch.update(pSnap.docs[0].ref, {
            subscriptionStatus: 'active',
            updatedAt: FV.serverTimestamp(),
          });
        }
      }
    }
  }

  // 6. Notification
  const nRef = db.collection('notifications').doc();
  const notifBody = isPremium
    ? 'Votre abonnement Premium est activé ! Profitez du matching illimité.'
    : `${creditsToGrant} crédit(s) ajouté(s)`;
  batch.set(nRef, {
    notificationId: nRef.id, userId, type: 'payment',
    title: isPremium ? 'Premium activé !' : 'Paiement confirmé',
    body: notifBody,
    data: { transactionId: txRef.id, packageId }, isRead: false,
    createdAt: FV.serverTimestamp(),
  });

  await batch.commit();

  // 7. Affiliation
  if (referralCode) {
    try { await processCommission(db, FV, userId, amountTotal, referralCode); }
    catch (e) { await logErr(db, FV, `Erreur affiliation: ${e}`, sessionId); }
  }
}

// =============================================================
// Phase 3 — Branche 'session' : achat direct d'une session datée
// =============================================================

/** Formate un Timestamp Firestore en string FR : "12 juin à 17:00". Pour la notif post-paiement. */
function formatNotifDate(ts: { toDate: () => Date } | { toMillis: () => number }): string {
  const d = 'toDate' in ts ? ts.toDate() : new Date(ts.toMillis());
  const day = d.getDate();
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const month = months[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} à ${hh}:${mm}`;
}

/**
 * Branche 'session' du webhook Stripe : traitement d'un paiement de session datée.
 * Cf. plan Phase 3 section B pour le détail du flow + idempotency #1 (transactions.stripeSessionId).
 */
async function handleSessionPayment(
  stripeCheckout: Record<string, unknown>,
  stripe: InstanceType<typeof import('stripe').default>,
): Promise<void> {
  const { db, FV } = await initAdmin();
  const meta = (stripeCheckout.metadata || {}) as Record<string, string>;

  const sessionId = meta.sessionId;
  const userId = meta.userId;
  const matchId = meta.matchId || '';
  const referralCode = meta.referralCode || '';
  const tierFromMeta = (meta.tier as PricingTierKind) || 'early';
  const amountFromMeta = parseInt(meta.amount || '0');
  const bundleCredits = parseInt(meta.bundleCredits || '50');
  const stripeSessionId = stripeCheckout.id as string;
  const paymentIntentId = (stripeCheckout.payment_intent as string) || '';
  const amountTotal = (stripeCheckout.amount_total as number) || 0;

  if (!userId || !sessionId) {
    await logErr(db, FV, 'Paiement session sans userId/sessionId', stripeSessionId);
    return;
  }

  // 1. Idempotency #1 — transaction stripeSessionId déjà créée ?
  const existingTx = await db.collection('transactions').where('stripeSessionId', '==', stripeSessionId).limit(1).get();
  if (!existingTx.empty) return;

  // 2. Detect payment method
  let pm = 'card';
  const pmTypes = stripeCheckout.payment_method_types as string[] | undefined;
  if (pmTypes?.includes('twint') && paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.payment_method_types?.includes('twint')) pm = 'twint';
    } catch { /* ok */ }
  }

  // 3. Transaction atomique
  let bookingIdResult = '';
  let sessionTitleForNotif = '';
  let sessionStartAtForNotif: { toDate: () => Date } | null = null;
  try {
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('sessions').doc(sessionId);
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) throw new Error(`Session ${sessionId} introuvable`);
      const session = sessionSnap.data() as unknown as Session;

      // 3a. Verify bookable
      if (!isSessionBookable(session, new Date())) {
        throw new Error(
          `Session non réservable (status=${session.status}, ${session.currentParticipants}/${session.maxParticipants})`,
        );
      }

      // 3c. Re-compute tier defensive
      const computed = computePricingTier(session, new Date());
      if (computed.tier !== tierFromMeta || computed.price !== amountFromMeta) {
        console.warn(
          `[handleSessionPayment] Tier mismatch: meta=(${tierFromMeta}, ${amountFromMeta}) computed=(${computed.tier}, ${computed.price}). Using meta values.`,
        );
      }

      // 3d. Create booking
      const bookingRef = db.collection('bookings').doc();
      bookingIdResult = bookingRef.id;
      tx.set(bookingRef, {
        bookingId: bookingRef.id,
        userId, userName: '', matchId,
        activityId: session.activityId, partnerId: session.partnerId, sport: session.sport,
        ticketType: 'solo', sessionDate: session.startAt,
        status: 'confirmed', transactionId: '',
        amount: amountTotal, currency: 'CHF', creditsUsed: 0,
        sessionId, paymentIntentId, tier: tierFromMeta,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
      });

      // 3e. Increment session.currentParticipants + recompute tier/price/status
      const newParticipants = session.currentParticipants + 1;
      const { tier: newTier, price: newPrice } = computePricingTier(session, new Date(), newParticipants);
      const newStatus: SessionStatus = newParticipants >= session.maxParticipants ? 'full' : 'open';
      tx.update(sessionRef, {
        currentParticipants: newParticipants,
        currentTier: newTier,
        currentPrice: newPrice,
        status: newStatus,
        updatedAt: FV.serverTimestamp(),
      });

      // 3f. Match chat unlock
      if (matchId) {
        tx.update(db.collection('matches').doc(matchId), {
          chatUnlocked: true,
          sessionId,
        });
      }

      // 3g. Grant chatCreditsBundle au user
      tx.update(db.collection('users').doc(userId), {
        credits: FV.increment(bundleCredits),
        updatedAt: FV.serverTimestamp(),
      });
      const creditRef = db.collection('credits').doc();
      tx.set(creditRef, {
        creditId: creditRef.id, userId,
        type: 'purchase', amount: bundleCredits,
        balance: 0,
        description: `Bundle chat : ${session.title}`,
        relatedId: bookingRef.id,
        createdAt: FV.serverTimestamp(),
      });

      // 3h. Create transaction doc
      const txRef = db.collection('transactions').doc();
      tx.set(txRef, {
        transactionId: txRef.id, stripeSessionId,
        stripePaymentIntentId: paymentIntentId,
        userId, type: 'session_purchase',
        amount: amountTotal, currency: 'CHF', paymentMethod: pm,
        status: 'succeeded', metadata: meta,
        package: '', creditsGranted: bundleCredits,
        sessionId, bookingId: bookingRef.id,
        createdAt: FV.serverTimestamp(), completedAt: FV.serverTimestamp(),
      });

      // Capture pour la notif post-commit
      sessionTitleForNotif = session.title;
      sessionStartAtForNotif = session.startAt as unknown as { toDate: () => Date };
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logErr(db, FV, `[handleSessionPayment] ${errMsg}`, stripeSessionId);
    try {
      const nRef = db.collection('notifications').doc();
      await nRef.set({
        notificationId: nRef.id, userId, type: 'payment',
        title: 'Réservation impossible',
        body: 'Cette session était déjà pleine au moment du paiement. Vous serez remboursé sous 48h.',
        data: { stripeSessionId, sessionId }, isRead: false,
        createdAt: FV.serverTimestamp(),
      });
    } catch { /* notif best effort */ }
    return;
  }

  // 4. Post-commit (best effort)
  try {
    const dateStr = sessionStartAtForNotif ? formatNotifDate(sessionStartAtForNotif) : '';
    const nRef = db.collection('notifications').doc();
    await nRef.set({
      notificationId: nRef.id, userId, type: 'booking',
      title: 'Réservation confirmée',
      body: `🎉 ${sessionTitleForNotif}${dateStr ? ` le ${dateStr}` : ''}. Tu as reçu ${bundleCredits} crédits chat pour échanger avec les autres participants pendant et après l'activité. À bientôt !`,
      data: { sessionId, bookingId: bookingIdResult }, isRead: false,
      createdAt: FV.serverTimestamp(),
    });
  } catch { /* silent */ }

  try {
    await db.collection('analytics').doc('global').set({
      totalRevenue: FV.increment(amountTotal / 100),
      totalBookings: FV.increment(1),
      lastUpdated: FV.serverTimestamp(),
    }, { merge: true });

    const today = new Date().toISOString().split('T')[0];
    await db.collection('analytics').doc(`daily_${today}`).set({
      date: today,
      revenue: FV.increment(amountTotal / 100),
      bookings: FV.increment(1),
      [`byPaymentMethod.${pm}`]: FV.increment(amountTotal / 100),
    }, { merge: true });
  } catch { /* silent */ }

  if (referralCode) {
    try { await processCommission(db, FV, userId, amountTotal, referralCode); }
    catch (e) { await logErr(db, FV, `Erreur affiliation session: ${e}`, stripeSessionId); }
  }
}

// =============================================================
async function processCommission(
  db: FirebaseFirestore.Firestore, FV: typeof import('firebase-admin/firestore').FieldValue,
  userId: string, amount: number, code: string,
) {
  const creatorSnap = await db.collection('creators').where('referralCode', '==', code).where('isActive', '==', true).limit(1).get();
  if (!creatorSnap.empty) {
    const creator = creatorSnap.docs[0];
    const rate = creator.data().commissionRate || 0.10;
    const commission = Math.round(amount * rate);
    const batch = db.batch();
    batch.update(creator.ref, {
      totalEarnings: FV.increment(commission / 100),
      pendingPayout: FV.increment(commission / 100),
      totalPurchases: FV.increment(1),
    });
    const rSnap = await db.collection('referrals').where('referredUserId', '==', userId).where('referrerId', '==', creator.id).limit(1).get();
    if (!rSnap.empty) {
      batch.update(rSnap.docs[0].ref, {
        totalPurchases: FV.increment(1),
        totalCommission: FV.increment(commission / 100),
        status: 'active',
      });
    }
    const nRef = db.collection('notifications').doc();
    batch.set(nRef, {
      notificationId: nRef.id, userId: creator.id, type: 'affiliation',
      title: 'Commission reçue !',
      body: `+${(commission / 100).toFixed(2)} CHF de commission sur un achat de ton filleul`,
      data: { referredUserId: userId }, isRead: false, createdAt: FV.serverTimestamp(),
    });
    await batch.commit();
  }

  const referrerSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
  if (!referrerSnap.empty) {
    const referrer = referrerSnap.docs[0];
    const referrerId = referrer.id;
    if (referrerId === userId) return;
    const REFERRAL_BONUS_CREDITS = 1;
    const batch = db.batch();
    batch.update(referrer.ref, {
      credits: FV.increment(REFERRAL_BONUS_CREDITS),
      updatedAt: FV.serverTimestamp(),
    });
    const creditRef = db.collection('credits').doc();
    batch.set(creditRef, {
      creditId: creditRef.id, userId: referrerId, type: 'referral_bonus',
      amount: REFERRAL_BONUS_CREDITS,
      balance: 0,
      description: 'Bonus parrainage — ton filleul a acheté des crédits',
      relatedId: userId, createdAt: FV.serverTimestamp(),
    });
    const nRef = db.collection('notifications').doc();
    batch.set(nRef, {
      notificationId: nRef.id, userId: referrerId, type: 'referral',
      title: 'Crédit bonus reçu !',
      body: `+${REFERRAL_BONUS_CREDITS} crédit gratuit — ton ami a fait un achat`,
      data: { referredUserId: userId }, isRead: false, createdAt: FV.serverTimestamp(),
    });
    await batch.commit();
  }
}

// =============================================================
export async function handleExpired(session: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const sid = session.id as string;
  const tx = await db.collection('transactions').where('stripeSessionId', '==', sid).limit(1).get();
  if (!tx.empty) await tx.docs[0].ref.update({ status: 'failed' });
  const uid = (session.metadata as Record<string, string>)?.userId;
  if (uid) await logErr(db, FV, `Session expirée: ${sid}`, uid);
}

export async function handleSubCancelled(sub: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const meta = (sub.metadata || {}) as Record<string, string>;
  const pid = meta.partnerId;
  if (pid) {
    await db.collection('partners').doc(pid).update({
      subscriptionStatus: 'cancelled',
      isActive: false,
      updatedAt: FV.serverTimestamp(),
    });
  } else if (meta.packageId === 'partner_monthly' && meta.userId) {
    const userDoc = await db.collection('users').doc(meta.userId).get();
    if (userDoc.exists) {
      const email = userDoc.data()?.email;
      if (email) {
        const pSnap = await db.collection('partners').where('email', '==', email).limit(1).get();
        if (!pSnap.empty) {
          await pSnap.docs[0].ref.update({
            subscriptionStatus: 'cancelled',
            isActive: false,
            updatedAt: FV.serverTimestamp(),
          });
        }
      }
    }
  }

  const userId = meta.userId;
  const isPremium = meta.isPremium === 'true';
  if (userId && isPremium) {
    await db.collection('users').doc(userId).update({
      isPremium: false,
      premiumCancelledAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
    });
    const nRef = db.collection('notifications').doc();
    await nRef.set({
      notificationId: nRef.id, userId, type: 'payment',
      title: 'Abonnement Premium annulé',
      body: 'Votre abonnement Premium a été annulé. Vous conservez vos crédits restants.',
      data: {}, isRead: false, createdAt: FV.serverTimestamp(),
    });
  }
}

export async function handleSubUpdated(sub: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const meta = (sub.metadata || {}) as Record<string, string>;
  const userId = meta.userId;
  const status = sub.status as string;
  if (userId && meta.isPremium === 'true') {
    const isPremiumActive = status === 'active' || status === 'trialing';
    await db.collection('users').doc(userId).update({
      isPremium: isPremiumActive,
      updatedAt: FV.serverTimestamp(),
    });
  }
}

export async function handleInvoicePaid(invoice: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const subId = invoice.subscription as string;
  if (!subId) return;

  const lines = invoice.lines as Record<string, unknown>;
  const data = (lines?.data as Array<Record<string, unknown>>) || [];
  if (data.length === 0) return;

  const subMeta = (data[0]?.metadata || {}) as Record<string, string>;
  const userId = subMeta.userId;
  const isPremium = subMeta.isPremium === 'true';
  const packageId = subMeta.packageId || '';

  if (!userId || !isPremium) return;

  const RENEWAL_CREDITS: Record<string, number> = {
    'premium_monthly': 5,
    'premium_yearly': 5,
  };
  const credits = RENEWAL_CREDITS[packageId] || 5;

  const batch = db.batch();
  const userRef = db.collection('users').doc(userId);
  batch.update(userRef, {
    credits: FV.increment(credits),
    isPremium: true,
    updatedAt: FV.serverTimestamp(),
  });

  const creditRef = db.collection('credits').doc();
  batch.set(creditRef, {
    creditId: creditRef.id, userId, type: 'purchase', amount: credits,
    balance: 0,
    description: `Renouvellement Premium — ${credits} crédits`,
    relatedId: subId, createdAt: FV.serverTimestamp(),
  });

  const nRef = db.collection('notifications').doc();
  batch.set(nRef, {
    notificationId: nRef.id, userId, type: 'payment',
    title: 'Premium renouvelé',
    body: `${credits} crédits ajoutés à votre compte.`,
    data: { packageId }, isRead: false, createdAt: FV.serverTimestamp(),
  });

  const amountPaid = ((invoice.amount_paid as number) || 0) / 100;
  batch.set(db.collection('analytics').doc('global'), {
    totalRevenue: FV.increment(amountPaid), lastUpdated: FV.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
}

export async function handleInvoiceFailed(invoice: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const lines = invoice.lines as Record<string, unknown>;
  const data = (lines?.data as Array<Record<string, unknown>>) || [];
  if (data.length === 0) return;

  const subMeta = (data[0]?.metadata || {}) as Record<string, string>;
  const userId = subMeta.userId;
  if (!userId) return;

  const nRef = db.collection('notifications').doc();
  await nRef.set({
    notificationId: nRef.id, userId, type: 'payment',
    title: 'Échec de paiement',
    body: 'Le renouvellement de votre abonnement a échoué. Mettez à jour votre moyen de paiement.',
    data: {}, isRead: false, createdAt: FV.serverTimestamp(),
  });
}

async function logErr(db: FirebaseFirestore.Firestore, FV: typeof import('firebase-admin/firestore').FieldValue, msg: string, rid: string) {
  const ref = db.collection('errorLogs').doc();
  await ref.set({
    logId: ref.id, source: 'backend', level: 'error', message: msg,
    stackTrace: '', userId: rid, url: '/api/webhooks/stripe', userAgent: 'server',
    metadata: {}, resolved: false, resolvedAt: null, createdAt: FV.serverTimestamp(),
  });
}
