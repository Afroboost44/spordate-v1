/**
 * Verify Payment API — Belt-and-suspenders credit granting
 * Called by payment success page to ensure credits are granted
 * even if the Stripe webhook hasn't fired yet.
 * Idempotent: checks transactions collection before granting.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

export async function POST(request: NextRequest) {
  try {
    const { sessionId, userId } = await request.json();

    if (!sessionId || !userId) {
      return NextResponse.json({ error: 'sessionId and userId required' }, { status: 400 });
    }

    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }

    // 1. Retrieve the Stripe session
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(apiKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed', status: session.payment_status }, { status: 402 });
    }

    // Verify the userId matches
    const meta = session.metadata || {};
    if (meta.userId !== userId) {
      return NextResponse.json({ error: 'User mismatch' }, { status: 403 });
    }

    const { db, FV } = await initAdmin();
    const creditsToGrant = parseInt(meta.creditsToGrant || '0');
    const packageId = meta.packageId || '';

    // 2. Idempotency check — has the webhook already processed this?
    const existing = await db.collection('transactions')
      .where('stripeSessionId', '==', sessionId)
      .limit(1)
      .get();

    if (!existing.empty) {
      // Already processed — just return current credits
      const userDoc = await db.collection('users').doc(userId).get();
      const credits = userDoc.exists ? (userDoc.data()?.credits || 0) : 0;
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        credits,
        creditsGranted: creditsToGrant,
      });
    }

    // 3. Webhook hasn't fired yet — grant credits ourselves
    const batch = db.batch();

    // Transaction record
    const txRef = db.collection('transactions').doc();
    batch.set(txRef, {
      transactionId: txRef.id,
      stripeSessionId: sessionId,
      stripePaymentIntentId: session.payment_intent || '',
      userId,
      type: 'credit_purchase',
      amount: session.amount_total || 0,
      currency: 'CHF',
      paymentMethod: 'card',
      status: 'succeeded',
      metadata: meta,
      package: packageId,
      creditsGranted: creditsToGrant,
      source: 'verify-payment-fallback',
      createdAt: FV.serverTimestamp(),
      completedAt: FV.serverTimestamp(),
    });

    // Grant credits
    if (creditsToGrant > 0) {
      const userRef = db.collection('users').doc(userId);
      batch.update(userRef, {
        credits: FV.increment(creditsToGrant),
        updatedAt: FV.serverTimestamp(),
      });

      const creditRef = db.collection('credits').doc();
      batch.set(creditRef, {
        creditId: creditRef.id,
        userId,
        type: 'purchase',
        amount: creditsToGrant,
        balance: 0,
        description: `Achat ${creditsToGrant} date(s) — verify-fallback`,
        relatedId: txRef.id,
        createdAt: FV.serverTimestamp(),
      });
    }

    // Premium activation
    if (meta.isPremium === 'true') {
      batch.update(db.collection('users').doc(userId), {
        isPremium: true,
        premiumPackage: packageId,
        premiumStartedAt: FV.serverTimestamp(),
        updatedAt: FV.serverTimestamp(),
      });
    }

    // Notification
    const nRef = db.collection('notifications').doc();
    batch.set(nRef, {
      notificationId: nRef.id,
      userId,
      type: 'payment',
      title: 'Paiement confirmé',
      body: `${creditsToGrant} crédit(s) ajouté(s) à votre compte`,
      data: { transactionId: txRef.id, packageId },
      isRead: false,
      createdAt: FV.serverTimestamp(),
    });

    await batch.commit();

    // Return updated credits
    const userDoc = await db.collection('users').doc(userId).get();
    const credits = userDoc.exists ? (userDoc.data()?.credits || 0) : 0;

    return NextResponse.json({
      success: true,
      alreadyProcessed: false,
      credits,
      creditsGranted: creditsToGrant,
    });
  } catch (error: unknown) {
    console.error('[VerifyPayment] Error:', error);
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
