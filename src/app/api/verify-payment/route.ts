/**
 * Verify Payment API - Stripe-only verification
 * Returns verified payment info so the CLIENT can grant credits via Firestore client SDK.
 * This avoids the need for Firebase Admin SDK credentials on the server.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' });

const PACKAGE_CREDITS: Record<string, number> = {
  test_1chf: 1,
  '1_date': 1,
  '3_dates': 3,
  '10_dates': 10,
  premium_monthly: 5,
  premium_yearly: 60,
  partner_monthly: 0,
};

export async function POST(req: NextRequest) {
  try {
    const { sessionId, userId } = await req.json();

    if (!sessionId || !userId) {
      return NextResponse.json({ error: 'Missing sessionId or userId' }, { status: 400 });
    }

    console.log('[VerifyPayment] Verifying session:', sessionId, 'for user:', userId);

    // Retrieve the Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      console.log('[VerifyPayment] Payment not completed:', session.payment_status);
      return NextResponse.json({ error: 'Payment not completed' }, { status: 400 });
    }

    // Extract package info from metadata
    const packageId = session.metadata?.packageId || session.metadata?.package_id || '';
    const metaCredits = parseInt(session.metadata?.credits || '0', 10);
    const metaUserId = session.metadata?.userId || session.metadata?.user_id || '';

    // Verify the user matches
    if (metaUserId && metaUserId !== userId) {
      console.log('[VerifyPayment] User mismatch:', metaUserId, '!=', userId);
      return NextResponse.json({ error: 'User mismatch' }, { status: 403 });
    }

    // Determine credits to grant
    const credits = metaCredits || PACKAGE_CREDITS[packageId] || 0;

    if (credits <= 0) {
      console.log('[VerifyPayment] No credits for package:', packageId);
      return NextResponse.json({ error: 'No credits to grant' }, { status: 400 });
    }

    console.log('[VerifyPayment] Verified! Credits:', credits, 'Package:', packageId);

    // Return verified payment info - CLIENT will write to Firestore
    return NextResponse.json({
      verified: true,
      credits,
      packageId,
      sessionId: session.id,
      paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
    });
  } catch (err: any) {
    console.error('[VerifyPayment] Error:', err?.message || err);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
