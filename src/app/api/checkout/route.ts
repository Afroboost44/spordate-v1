import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// Fixed packages - NEVER accept amounts from frontend
const PACKAGES = {
  solo: 25.00,  // 25€
  duo: 50.00,   // 50€
  free: 0,      // Gratuit
} as const;

type PackageType = keyof typeof PACKAGES;

// Debug: Log Stripe key status at module load
console.log('[Checkout API] Module loaded');
console.log('[Checkout API] Stripe Key Loaded:', !!process.env.STRIPE_SECRET_KEY);

export async function POST(request: NextRequest) {
  console.log('[Checkout API] POST request received');
  
  try {
    // Parse request body
    let body;
    try {
      body = await request.json();
      console.log('[Checkout API] Request body:', JSON.stringify(body));
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { 
      packageType, 
      originUrl,
      amount: clientAmount, // Optional: client can send amount for free sessions
      metadata = {} 
    } = body as {
      packageType: PackageType;
      originUrl: string;
      amount?: number;
      metadata?: Record<string, string>;
    };

    // Validate origin URL
    if (!originUrl) {
      console.log('[Checkout API] Missing originUrl');
      return NextResponse.json(
        { error: 'Origin URL is required' },
        { status: 400 }
      );
    }

    // Determine the amount
    let amount: number;
    if (packageType && PACKAGES[packageType] !== undefined) {
      amount = PACKAGES[packageType];
    } else if (typeof clientAmount === 'number') {
      amount = clientAmount;
    } else {
      console.log('[Checkout API] Invalid package type:', packageType);
      return NextResponse.json(
        { error: 'Invalid package type. Must be "solo", "duo", or "free"' },
        { status: 400 }
      );
    }

    console.log('[Checkout API] Processing payment:', { packageType, amount, originUrl });

    // LOGIC: If amount is 0, skip Stripe and return success directly
    if (amount === 0) {
      console.log('[Checkout API] Free booking - skipping Stripe');
      return NextResponse.json({
        url: `${originUrl}/discovery?payment=success&free=true`,
        sessionId: `free_${Date.now()}`,
        isFree: true,
      });
    }

    // LOGIC: If amount > 0, use Stripe
    console.log('[Checkout API] Paid booking - using Stripe');
    console.log('[Checkout API] Stripe Key Loaded:', !!process.env.STRIPE_SECRET_KEY);

    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      console.error('[Checkout API] STRIPE_SECRET_KEY not configured');
      return NextResponse.json(
        { error: 'Stripe is not configured. Please add STRIPE_SECRET_KEY.' },
        { status: 503 }
      );
    }

    // Dynamic import Stripe to avoid issues at build time
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(apiKey);

    // Build URLs - use originUrl from frontend, fallback to NEXTAUTH_URL or APP_URL
    const baseUrl = originUrl || process.env.NEXTAUTH_URL || process.env.APP_URL || '';
    const successUrl = `${baseUrl}/discovery?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/discovery?payment=cancelled`;

    console.log('[Checkout API] Creating Stripe session...');
    console.log('[Checkout API] Base URL:', baseUrl);
    console.log('[Checkout API] Success URL:', successUrl);

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: packageType === 'duo' 
              ? 'Séance Duo Afroboost (2 places)' 
              : 'Séance Solo Afroboost',
            description: packageType === 'duo'
              ? 'Ticket pour 2 personnes - Offrez une séance à votre partenaire'
              : 'Ticket individuel pour une séance sportive',
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        ...metadata,
        packageType: packageType || 'custom',
        amount: amount.toString(),
      },
    });

    console.log('[Checkout API] Session created:', session.id);

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    });

  } catch (error) {
    console.error('[Checkout API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // ALWAYS return JSON to avoid "Unexpected token 'W'" error
    return NextResponse.json(
      { error: 'Failed to create checkout session', details: message },
      { status: 500 }
    );
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    timestamp: new Date().toISOString(),
  });
}
