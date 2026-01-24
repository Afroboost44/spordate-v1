import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { sendBookingConfirmationEmail, sendPartnerNotificationEmail } from '@/lib/email';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Prevent timeout during webhook processing

// Initialize Stripe
const getStripe = () => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(apiKey);
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    console.error('[Stripe Webhook] No signature provided');
    return NextResponse.json(
      { error: 'No signature provided' },
      { status: 400 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  // If no webhook secret, log and process anyway (for development)
  if (!webhookSecret) {
    console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured - processing without verification');
  }

  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    
    if (webhookSecret) {
      // Verify webhook signature in production
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } else {
      // Parse without verification in development
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 }
    );
  }

  console.log('[Stripe Webhook] Received event:', event.type);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log('[Stripe Webhook] Checkout completed:', {
        sessionId: session.id,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
        metadata: session.metadata,
      });

      // Only process if payment was successful
      if (session.payment_status === 'paid') {
        try {
          await handleSuccessfulPayment(session);
        } catch (error) {
          console.error('[Stripe Webhook] Error processing payment:', error);
          // Don't return error - acknowledge receipt to Stripe
        }
      }
      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('[Stripe Webhook] Checkout expired:', session.id);
      // Could clean up pending bookings here
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log('[Stripe Webhook] Payment failed:', paymentIntent.id);
      break;
    }

    default:
      console.log('[Stripe Webhook] Unhandled event type:', event.type);
  }

  // Return 200 to acknowledge receipt
  return NextResponse.json({ received: true });
}

/**
 * Handle successful payment - update database and send notifications
 */
async function handleSuccessfulPayment(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {};
  const customerEmail = session.customer_details?.email;
  const amountPaid = (session.amount_total || 0) / 100; // Convert from cents
  
  const bookingDetails = {
    sessionId: session.id,
    userId: metadata.userId || '',
    profileName: metadata.profileName || 'Partenaire',
    profileId: metadata.profileId || '',
    sport: metadata.sport || 'Afroboost',
    partnerId: metadata.partnerId || '',
    partnerName: metadata.partnerName || '',
    partnerAddress: metadata.partnerAddress || '',
    ticketType: (metadata.packageType === 'duo' ? 'Duo' : 'Solo') as 'Solo' | 'Duo',
    amount: amountPaid,
    customerEmail: customerEmail || '',
    status: 'confirmed' as const,
    createdAt: new Date().toISOString(),
  };

  console.log('[Stripe Webhook] Processing booking:', bookingDetails);

  // Update booking in Firestore (if configured)
  // Note: In a real app, you would update the booking document here
  // For now, we'll just log it as the frontend handles the UI update
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💳 PAIEMENT CONFIRMÉ PAR WEBHOOK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔢 Session ID: ${session.id}`);
  console.log(`👤 User ID: ${bookingDetails.userId}`);
  console.log(`🎟️ Type: ${bookingDetails.ticketType}`);
  console.log(`💰 Montant: ${bookingDetails.amount}€`);
  console.log(`👤 Profil: ${bookingDetails.profileName}`);
  console.log(`🏃 Sport: ${bookingDetails.sport}`);
  console.log(`📍 Partenaire: ${bookingDetails.partnerName || 'Non défini'}`);
  console.log(`📧 Email client: ${customerEmail || 'Non fourni'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Send confirmation emails
  try {
    // Email to customer
    if (customerEmail) {
      await sendBookingConfirmationEmail({
        to: customerEmail,
        customerName: 'Sportif', // Could be extracted from session if collected
        profileName: bookingDetails.profileName,
        partnerName: bookingDetails.partnerName || 'Lieu à définir',
        partnerAddress: bookingDetails.partnerAddress,
        ticketType: bookingDetails.ticketType,
        amount: bookingDetails.amount,
        bookingId: session.id,
      });
    }

    // Email to partner (if we have partner email - would need to fetch from DB)
    // For now, we'll use the notification service which logs to console
    if (bookingDetails.partnerId) {
      await sendPartnerNotificationEmail({
        partnerName: bookingDetails.partnerName,
        customerEmail: customerEmail || 'Client anonyme',
        ticketType: bookingDetails.ticketType,
        amount: bookingDetails.amount,
        bookingId: session.id,
      });
    }
  } catch (emailError) {
    console.error('[Stripe Webhook] Error sending emails:', emailError);
    // Don't throw - emails are not critical for webhook acknowledgment
  }
}
