import { NextRequest, NextResponse } from 'next/server';

// Fixed packages - NEVER accept amounts from frontend (for validation)
const PACKAGES = {
  solo: 25.00,
  duo: 50.00,
} as const;

type PackageType = keyof typeof PACKAGES;

// This route proxies to the FastAPI backend running on port 8001
// This is necessary because the infrastructure routes /api/* to the backend,
// but there might be connectivity issues. This ensures we have a fallback.

export async function POST(request: NextRequest) {
  console.log('[Checkout Proxy] Request received');
  
  try {
    const body = await request.json();
    const { packageType, originUrl, metadata = {} } = body;
    
    console.log('[Checkout Proxy] Body:', { packageType, originUrl });
    
    // Validate package type
    if (!packageType || !PACKAGES[packageType as PackageType]) {
      return NextResponse.json(
        { error: 'Invalid package type. Must be "solo" or "duo"' },
        { status: 400 }
      );
    }
    
    // Validate origin URL
    if (!originUrl) {
      return NextResponse.json(
        { error: 'Origin URL is required' },
        { status: 400 }
      );
    }
    
    // Try to call the FastAPI backend first
    // In Kubernetes, backend is accessible via internal service name or localhost
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8001';
    try {
      console.log('[Checkout Proxy] Attempting to call FastAPI backend...');
      const backendResponse = await fetch(`${backendUrl}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageType, originUrl, metadata }),
      });
      
      if (backendResponse.ok) {
        const data = await backendResponse.json();
        console.log('[Checkout Proxy] Backend response:', data);
        return NextResponse.json(data);
      }
      
      console.log('[Checkout Proxy] Backend returned error:', backendResponse.status);
    } catch (backendError) {
      console.log('[Checkout Proxy] Backend call failed:', backendError);
    }
    
    // Fallback: Use Stripe directly from Next.js
    console.log('[Checkout Proxy] Falling back to direct Stripe call...');
    
    const Stripe = (await import('stripe')).default;
    const apiKey = process.env.STRIPE_SECRET_KEY;
    
    if (!apiKey) {
      console.error('[Checkout Proxy] STRIPE_SECRET_KEY not configured');
      return NextResponse.json(
        { error: 'Stripe is not configured' },
        { status: 503 }
      );
    }
    
    const stripe = new Stripe(apiKey, { apiVersion: '2025-01-27.acacia' });
    const amount = PACKAGES[packageType as PackageType];
    
    const successUrl = `${originUrl}/discovery?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${originUrl}/discovery?payment=cancelled`;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: packageType === 'duo' ? 'Séance Duo Afroboost (2 places)' : 'Séance Solo Afroboost',
            description: packageType === 'duo' 
              ? 'Ticket pour 2 personnes - Offrez une séance à votre partenaire'
              : 'Ticket individuel pour une séance sportive',
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { ...metadata, packageType, amount: amount.toString() },
    });
    
    console.log('[Checkout Proxy] Session created:', session.id);
    
    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    });
    
  } catch (error) {
    console.error('[Checkout Proxy] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to create checkout session', details: message },
      { status: 500 }
    );
  }
}
