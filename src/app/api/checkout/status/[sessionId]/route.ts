import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// Initialize Stripe
const getStripe = () => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(apiKey);
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return NextResponse.json({
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
    });

  } catch (error) {
    console.error('[Stripe] Error checking session status:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: 'Invalid session ID' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to check payment status' },
      { status: 500 }
    );
  }
}
