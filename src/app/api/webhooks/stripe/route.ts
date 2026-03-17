/**
 * Spordateur V2 — Webhook Stripe
 * Traite les paiements réussis → crédite utilisateur → MAJ analytics
 * Remplace PostgreSQL/Prisma par Firestore
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Firebase Admin (côté serveur) ---
function getAdminDb() {
  if (!getApps().length) {
    // En production : utiliser un service account
    // En dev : utiliser les env variables
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude',
      });
    }
  }
  return getFirestore();
}

// --- Stripe ---
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
});

// Packages (dupliqué ici pour le serveur)
const PACKAGES: Record<string, { credits: number }> = {
  '1_date':  { credits: 1 },
  '3_dates': { credits: 3 },
  '10_dates': { credits: 10 },
  'partner_monthly': { credits: 0 },
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  // 1. Vérifier la signature Stripe
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(body) as Stripe.Event;
      console.warn('[Webhook] Pas de vérification de signature');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur';
    console.error('[Webhook] Signature invalide:', message);
    return NextResponse.json({ error: `Signature invalide: ${message}` }, { status: 400 });
  }

  console.log('[Webhook] Event:', event.type);

  // 2. Traiter les événements
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handlePaymentSuccess(session);
      break;
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handlePaymentExpired(session);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionCancelled(subscription);
      break;
    }
    default:
      console.log('[Webhook] Event non traité:', event.type);
  }

  return NextResponse.json({ received: true });
}

// ================================================================
// PAIEMENT RÉUSSI
// ================================================================
async function handlePaymentSuccess(session: Stripe.Checkout.Session) {
  const db = getAdminDb();
  const metadata = session.metadata || {};
  const userId = metadata.userId;
  const packageId = metadata.packageId || '';
  const creditsToGrant = parseInt(metadata.creditsToGrant || '0');
  const matchId = metadata.matchId || '';
  const referralCode = metadata.referralCode || '';
  const amountTotal = session.amount_total || 0;

  console.log(`[Webhook] Paiement réussi — User: ${userId}, Package: ${packageId}, Crédits: ${creditsToGrant}`);

  if (!userId) {
    console.error('[Webhook] userId manquant dans metadata');
    await logError(db, 'Paiement sans userId', session.id);
    return;
  }

  // Idempotency : vérifier si déjà traité
  const existingTx = await db.collection('transactions')
    .where('stripeSessionId', '==', session.id)
    .limit(1)
    .get();

  if (!existingTx.empty) {
    console.log('[Webhook] Transaction déjà traitée, skip');
    return;
  }

  // Déterminer la méthode de paiement
  let paymentMethod = 'card';
  if (session.payment_method_types?.includes('twint')) {
    try {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
      if (pi.payment_method_types?.includes('twint') || (pi as Record<string, unknown>).payment_method === 'twint') {
        paymentMethod = 'twint';
      }
    } catch { /* ignore */ }
  }

  const batch = db.batch();

  // 1. Créer la transaction
  const txRef = db.collection('transactions').doc();
  batch.set(txRef, {
    transactionId: txRef.id,
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent || '',
    userId,
    type: packageId === 'partner_monthly' ? 'partner_subscription' : 'credit_purchase',
    amount: amountTotal,
    currency: 'CHF',
    paymentMethod,
    status: 'succeeded',
    metadata,
    package: packageId,
    creditsGranted: creditsToGrant,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
  });

  // 2. Créditer l'utilisateur
  if (creditsToGrant > 0) {
    const userRef = db.collection('users').doc(userId);
    batch.update(userRef, {
      credits: FieldValue.increment(creditsToGrant),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Historique des crédits
    const creditRef = db.collection('credits').doc();
    const userSnap = await userRef.get();
    const currentCredits = userSnap.exists ? (userSnap.data()?.credits || 0) : 0;

    batch.set(creditRef, {
      creditId: creditRef.id,
      userId,
      type: 'purchase',
      amount: creditsToGrant,
      balance: currentCredits + creditsToGrant,
      description: `Achat ${PACKAGES[packageId]?.credits || creditsToGrant} date(s)`,
      relatedId: txRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 3. Débloquer le chat si matchId fourni
  if (matchId) {
    const matchRef = db.collection('matches').doc(matchId);
    batch.update(matchRef, { chatUnlocked: true });

    // Message système dans le chat
    const chatMsgRef = db.collection('chats').doc(matchId).collection('messages').doc();
    batch.set(chatMsgRef, {
      messageId: chatMsgRef.id,
      senderId: 'system',
      text: 'Le chat est débloqué ! Planifiez votre Sport Date',
      type: 'system',
      readBy: [],
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 4. Analytics global
  const globalRef = db.collection('analytics').doc('global');
  batch.set(globalRef, {
    totalRevenue: FieldValue.increment(amountTotal / 100),
    lastUpdated: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 5. Analytics daily
  const today = new Date().toISOString().split('T')[0];
  const dailyRef = db.collection('analytics').doc(`daily_${today}`);
  batch.set(dailyRef, {
    date: today,
    revenue: FieldValue.increment(amountTotal / 100),
    creditsPurchased: FieldValue.increment(creditsToGrant),
    [`byPaymentMethod.${paymentMethod}`]: FieldValue.increment(amountTotal / 100),
  }, { merge: true });

  // 6. Notification à l'utilisateur
  const notifRef = db.collection('notifications').doc();
  batch.set(notifRef, {
    notificationId: notifRef.id,
    userId,
    type: 'payment',
    title: 'Paiement confirmé',
    body: `${creditsToGrant} crédit(s) ajouté(s) à ton compte`,
    data: { transactionId: txRef.id, packageId },
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  // COMMIT
  await batch.commit();
  console.log(`[Webhook] Traitement terminé — ${creditsToGrant} crédits ajoutés à ${userId}`);

  // 7. Traiter l'affiliation (hors batch car peut échouer indépendamment)
  if (referralCode) {
    try {
      await processReferralCommission(db, userId, amountTotal, referralCode);
    } catch (e) {
      console.error('[Webhook] Erreur affiliation:', e);
      await logError(db, `Erreur affiliation: ${e}`, session.id);
    }
  }
}

// ================================================================
// AFFILIATION — Commission sur achat
// ================================================================
async function processReferralCommission(
  db: FirebaseFirestore.Firestore,
  userId: string,
  amountCentimes: number,
  referralCode: string
) {
  // Trouver le créateur par son code
  const creatorSnap = await db.collection('creators')
    .where('referralCode', '==', referralCode)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (creatorSnap.empty) return;

  const creator = creatorSnap.docs[0];
  const creatorData = creator.data();
  const commissionRate = creatorData.commissionRate || 0.10;
  const commission = Math.round(amountCentimes * commissionRate); // En centimes

  const batch = db.batch();

  // MAJ le créateur
  batch.update(creator.ref, {
    totalEarnings: FieldValue.increment(commission / 100),
    pendingPayout: FieldValue.increment(commission / 100),
    totalPurchases: FieldValue.increment(1),
  });

  // MAJ ou créer le referral
  const referralSnap = await db.collection('referrals')
    .where('referredUserId', '==', userId)
    .where('referrerId', '==', creator.id)
    .limit(1)
    .get();

  if (!referralSnap.empty) {
    batch.update(referralSnap.docs[0].ref, {
      totalPurchases: FieldValue.increment(1),
      totalCommission: FieldValue.increment(commission / 100),
      status: 'active',
    });
  }

  // Analytics créateur
  const today = new Date().toISOString().split('T')[0];
  const dailyRef = db.collection('analytics').doc(`daily_${today}`);
  batch.set(dailyRef, {
    [`byCreator.${creator.id}.revenue`]: FieldValue.increment(commission / 100),
  }, { merge: true });

  await batch.commit();
  console.log(`[Webhook] Commission ${(commission / 100).toFixed(2)} CHF versée au créateur ${creator.id}`);
}

// ================================================================
// PAIEMENT EXPIRÉ
// ================================================================
async function handlePaymentExpired(session: Stripe.Checkout.Session) {
  const db = getAdminDb();
  const userId = session.metadata?.userId;

  // Vérifier s'il y a une transaction pending
  const txSnap = await db.collection('transactions')
    .where('stripeSessionId', '==', session.id)
    .limit(1)
    .get();

  if (!txSnap.empty) {
    await txSnap.docs[0].ref.update({ status: 'failed' });
  }

  if (userId) {
    await logError(db, `Session Stripe expirée: ${session.id}`, userId);
  }
}

// ================================================================
// ABONNEMENT ANNULÉ (partenaire)
// ================================================================
async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
  const db = getAdminDb();
  const partnerId = subscription.metadata?.partnerId;

  if (partnerId) {
    await db.collection('partners').doc(partnerId).update({
      subscriptionStatus: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

// ================================================================
// ERROR LOG helper
// ================================================================
async function logError(db: FirebaseFirestore.Firestore, message: string, relatedId: string) {
  const ref = db.collection('errorLogs').doc();
  await ref.set({
    logId: ref.id,
    source: 'backend',
    level: 'error',
    message,
    stackTrace: '',
    userId: relatedId,
    url: '/api/webhooks/stripe',
    userAgent: 'server',
    metadata: {},
    resolved: false,
    resolvedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    webhook: 'stripe-firestore-v2',
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    webhookSecretConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
    firebaseProject: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude',
  });
}
