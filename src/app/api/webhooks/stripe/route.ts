import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import prisma from '@/lib/prisma';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  typescript: true,
});

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  console.log('[Stripe Webhook] Received webhook event');

  let event: Stripe.Event;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } else {
      event = JSON.parse(body) as Stripe.Event;
      console.log('[Stripe Webhook] Warning: No signature verification');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stripe Webhook] Signature verification failed:', message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  console.log('[Stripe Webhook] Event type:', event.type);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('[Stripe Webhook] Processing checkout.session.completed');
      
      try {
        await handleSuccessfulPayment(session);
      } catch (error) {
        console.error('[Stripe Webhook] Error processing payment:', error);
      }
      break;
    }
    
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('[Stripe Webhook] Session expired:', session.id);
      
      try {
        await prisma.booking.updateMany({
          where: { sessionId: session.id },
          data: { paymentStatus: 'expired' },
        });
      } catch (error) {
        console.log('[Stripe Webhook] No booking found for expired session');
      }
      break;
    }
    
    default:
      console.log('[Stripe Webhook] Unhandled event type:', event.type);
  }

  return NextResponse.json({ received: true });
}

/**
 * Handle successful payment - Create Booking in PostgreSQL database
 */
async function handleSuccessfulPayment(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {};
  const customerEmail = session.customer_details?.email;
  const amountPaid = (session.amount_total || 0) / 100;

  // Extract metadata
  const ticketType = metadata.ticketType || 'solo';
  const profileName = metadata.profileName || 'Partenaire';
  const sport = metadata.sport || 'Afroboost';
  const partnerName = metadata.partnerName || null;
  const partnerAddress = metadata.partnerAddress || null;
  const partnerId = metadata.partnerId || null;
  const profileId = metadata.profileId || '';
  let userId = metadata.userId;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💳 CREATING BOOKING IN POSTGRESQL');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔢 Session ID: ${session.id}`);
  console.log(`👤 User ID: ${userId || 'will create'}`);
  console.log(`🎟️ Ticket Type: ${ticketType}`);
  console.log(`💰 Amount: ${amountPaid}€`);
  console.log(`👤 Profile: ${profileName}`);
  console.log(`🏃 Sport: ${sport}`);
  console.log(`📍 Partner: ${partnerName || 'Non défini'}`);
  console.log(`📧 Email: ${customerEmail || 'Non fourni'}`);

  try {
    // First, ensure user exists (create if not)
    let user;
    
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    }
    
    if (!user && customerEmail) {
      user = await prisma.user.findUnique({ where: { email: customerEmail } });
    }
    
    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          id: userId || undefined,
          email: customerEmail || null,
          name: profileName,
        },
      });
      console.log('✅ New user created:', user.id);
    }
    
    userId = user.id;

    // Check if booking already exists
    const existingBooking = await prisma.booking.findUnique({
      where: { sessionId: session.id },
    });

    if (existingBooking) {
      console.log('[Stripe Webhook] Booking already exists for this session');
      return existingBooking;
    }

    // Create booking in database
    const booking = await prisma.booking.create({
      data: {
        sessionId: session.id,
        paymentStatus: 'paid',
        userId: userId,
        userEmail: customerEmail || null,
        profileId: profileId,
        profileName: profileName,
        sport: sport,
        partnerId: partnerId,
        partnerName: partnerName,
        partnerAddress: partnerAddress,
        ticketType: ticketType,
        amount: amountPaid,
        currency: session.currency?.toUpperCase() || 'EUR',
      },
    });

    console.log('✅ BOOKING CREATED:', booking.id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return booking;
  } catch (error) {
    console.error('❌ ERROR CREATING BOOKING:', error);
    throw error;
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    webhook: 'stripe',
    database: 'postgresql',
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    webhookSecretConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
}
