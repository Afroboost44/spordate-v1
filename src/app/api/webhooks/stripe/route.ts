/**
 * Spordateur V2 — Webhook Stripe
 * Lazy-loaded Firebase Admin + Stripe pour éviter les erreurs au build
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Lazy init
let _db: FirebaseFirestore.Firestore | null = null;
let _FV: typeof import('firebase-admin/firestore').FieldValue | null = null;

async function initAdmin() {
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
export async function POST(request: NextRequest) {
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Record<string, unknown>;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET) as unknown as Record<string, unknown>;
    } else {
      event = JSON.parse(body);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const type = event.type as string;
  const obj = (event.data as Record<string, unknown>).object as Record<string, unknown>;

  switch (type) {
    case 'checkout.session.completed':
      await handlePaymentSuccess(obj, stripe);
      break;
    case 'checkout.session.expired':
      await handleExpired(obj);
      break;
    case 'customer.subscription.deleted':
      await handleSubCancelled(obj);
      break;
    case 'customer.subscription.updated':
      await handleSubUpdated(obj);
      break;
    case 'invoice.payment_succeeded':
      await handleInvoicePaid(obj);
      break;
    case 'invoice.payment_failed':
      await handleInvoiceFailed(obj);
      break;
  }

  return NextResponse.json({ received: true });
}

// =============================================================
async function handlePaymentSuccess(session: Record<string, unknown>, stripe: InstanceType<typeof import('stripe').default>) {
  const { db, FV } = await initAdmin();
  const meta = (session.metadata || {}) as Record<string, string>;
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
        subscriptionEnd: null, // Managed by Stripe recurring
        updatedAt: FV.serverTimestamp(),
      });
    }
  } else if (packageId === 'partner_monthly' && !partnerId) {
    // Try to find partner by userId (email match)
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

  // 6. Affiliation
  if (referralCode) {
    try { await processCommission(db, FV, userId, amountTotal, referralCode); }
    catch (e) { await logErr(db, FV, `Erreur affiliation: ${e}`, sessionId); }
  }
}

// =============================================================
async function processCommission(
  db: FirebaseFirestore.Firestore, FV: typeof import('firebase-admin/firestore').FieldValue,
  userId: string, amount: number, code: string
) {
  // 1. Commission créateur (si le code appartient à un créateur actif)
  const creatorSnap = await db.collection('creators').where('referralCode', '==', code).where('isActive', '==', true).limit(1).get();
  if (!creatorSnap.empty) {
    const creator = creatorSnap.docs[0];
    const rate = creator.data().commissionRate || 0.10;
    const commission = Math.round(amount * rate); // en centimes
    const batch = db.batch();

    // MAJ créateur
    batch.update(creator.ref, {
      totalEarnings: FV.increment(commission / 100),
      pendingPayout: FV.increment(commission / 100),
      totalPurchases: FV.increment(1),
    });

    // MAJ referral
    const rSnap = await db.collection('referrals').where('referredUserId', '==', userId).where('referrerId', '==', creator.id).limit(1).get();
    if (!rSnap.empty) {
      batch.update(rSnap.docs[0].ref, {
        totalPurchases: FV.increment(1),
        totalCommission: FV.increment(commission / 100),
        status: 'active',
      });
    }

    // Notification au créateur
    const nRef = db.collection('notifications').doc();
    batch.set(nRef, {
      notificationId: nRef.id, userId: creator.id, type: 'affiliation',
      title: 'Commission reçue !',
      body: `+${(commission / 100).toFixed(2)} CHF de commission sur un achat de ton filleul`,
      data: { referredUserId: userId }, isRead: false, createdAt: FV.serverTimestamp(),
    });

    await batch.commit();
  }

  // 2. Bonus crédit automatique au parrain (user qui a invité via son code perso)
  const referrerSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
  if (!referrerSnap.empty) {
    const referrer = referrerSnap.docs[0];
    const referrerId = referrer.id;

    // Anti self-referral
    if (referrerId === userId) return;

    const REFERRAL_BONUS_CREDITS = 1; // 1 crédit gratuit par achat d'un filleul
    const batch = db.batch();

    // Ajouter crédits au parrain
    batch.update(referrer.ref, {
      credits: FV.increment(REFERRAL_BONUS_CREDITS),
      updatedAt: FV.serverTimestamp(),
    });

    // Entrée crédit
    const creditRef = db.collection('credits').doc();
    batch.set(creditRef, {
      creditId: creditRef.id, userId: referrerId, type: 'referral_bonus',
      amount: REFERRAL_BONUS_CREDITS,
      balance: 0, // Approximatif — le solde exact nécessiterait une lecture
      description: 'Bonus parrainage — ton filleul a acheté des crédits',
      relatedId: userId, createdAt: FV.serverTimestamp(),
    });

    // Notification au parrain
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
async function handleExpired(session: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const sid = session.id as string;
  const tx = await db.collection('transactions').where('stripeSessionId', '==', sid).limit(1).get();
  if (!tx.empty) await tx.docs[0].ref.update({ status: 'failed' });
  const uid = (session.metadata as Record<string, string>)?.userId;
  if (uid) await logErr(db, FV, `Session expirée: ${sid}`, uid);
}

async function handleSubCancelled(sub: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const meta = (sub.metadata || {}) as Record<string, string>;

  // Handle partner subscription cancellation
  const pid = meta.partnerId;
  if (pid) {
    await db.collection('partners').doc(pid).update({
      subscriptionStatus: 'cancelled',
      isActive: false,
      updatedAt: FV.serverTimestamp(),
    });
  } else if (meta.packageId === 'partner_monthly' && meta.userId) {
    // Find partner by user email
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

  // Handle user premium cancellation
  const userId = meta.userId;
  const isPremium = meta.isPremium === 'true';
  if (userId && isPremium) {
    await db.collection('users').doc(userId).update({
      isPremium: false,
      premiumCancelledAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
    });
    // Notify user
    const nRef = db.collection('notifications').doc();
    await nRef.set({
      notificationId: nRef.id, userId, type: 'payment',
      title: 'Abonnement Premium annulé',
      body: 'Votre abonnement Premium a été annulé. Vous conservez vos crédits restants.',
      data: {}, isRead: false, createdAt: FV.serverTimestamp(),
    });
  }
}

async function handleSubUpdated(sub: Record<string, unknown>) {
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

async function handleInvoicePaid(invoice: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const subId = invoice.subscription as string;
  if (!subId) return;

  // Get subscription metadata to find user
  const lines = invoice.lines as Record<string, unknown>;
  const data = (lines?.data as Array<Record<string, unknown>>) || [];
  if (data.length === 0) return;

  const subMeta = (data[0]?.metadata || {}) as Record<string, string>;
  const userId = subMeta.userId;
  const isPremium = subMeta.isPremium === 'true';
  const packageId = subMeta.packageId || '';

  if (!userId || !isPremium) return;

  // Grant monthly credits for premium renewal
  const RENEWAL_CREDITS: Record<string, number> = {
    'premium_monthly': 5,
    'premium_yearly': 5, // 5 per month even on annual (60/12)
  };
  const credits = RENEWAL_CREDITS[packageId] || 5;

  const batch = db.batch();

  // Add credits
  const userRef = db.collection('users').doc(userId);
  batch.update(userRef, {
    credits: FV.increment(credits),
    isPremium: true,
    updatedAt: FV.serverTimestamp(),
  });

  // Credit entry
  const creditRef = db.collection('credits').doc();
  batch.set(creditRef, {
    creditId: creditRef.id, userId, type: 'purchase', amount: credits,
    balance: 0, // Will be overwritten by actual read if needed
    description: `Renouvellement Premium — ${credits} crédits`,
    relatedId: subId, createdAt: FV.serverTimestamp(),
  });

  // Notification
  const nRef = db.collection('notifications').doc();
  batch.set(nRef, {
    notificationId: nRef.id, userId, type: 'payment',
    title: 'Premium renouvelé',
    body: `${credits} crédits ajoutés à votre compte.`,
    data: { packageId }, isRead: false, createdAt: FV.serverTimestamp(),
  });

  // Analytics
  const amountPaid = ((invoice.amount_paid as number) || 0) / 100;
  batch.set(db.collection('analytics').doc('global'), {
    totalRevenue: FV.increment(amountPaid), lastUpdated: FV.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
}

async function handleInvoiceFailed(invoice: Record<string, unknown>) {
  const { db, FV } = await initAdmin();
  const lines = invoice.lines as Record<string, unknown>;
  const data = (lines?.data as Array<Record<string, unknown>>) || [];
  if (data.length === 0) return;

  const subMeta = (data[0]?.metadata || {}) as Record<string, string>;
  const userId = subMeta.userId;
  if (!userId) return;

  // Notify user of failed payment
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

export async function GET() {
  return NextResponse.json({
    status: 'ok', webhook: 'stripe-firestore-v2',
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    webhookSecretConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
}
