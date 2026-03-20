/**
 * Stripe Connect — Create connected account & onboarding link
 * POST: Create a new connected account for a partner
 * GET: Get account status / dashboard link
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key);
}

// POST — Create connected account + onboarding link
export async function POST(req: NextRequest) {
  try {
    const { partnerId, email, name } = await req.json();
    if (!partnerId || !email) {
      return NextResponse.json({ error: 'partnerId and email required' }, { status: 400 });
    }

    const stripe = getStripe();
    const origin = req.headers.get('origin') || 'https://spordateur.com';

    // Create a Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'CH',
      email,
      business_type: 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        partnerId,
        partnerName: name || '',
      },
    });

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/partner/wallet?refresh=true`,
      return_url: `${origin}/partner/wallet/return?account=${account.id}&partnerId=${partnerId}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({
      accountId: account.id,
      onboardingUrl: accountLink.url,
    });
  } catch (err: any) {
    console.error('[Stripe Connect] POST error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create connected account' },
      { status: 500 }
    );
  }
}

// GET — Check account status or get dashboard link
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const action = searchParams.get('action'); // 'status' or 'dashboard'

    if (!accountId) {
      return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    }

    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(accountId);

    if (action === 'dashboard') {
      // Generate a login link for the Express dashboard
      const loginLink = await stripe.accounts.createLoginLink(accountId);
      return NextResponse.json({
        dashboardUrl: loginLink.url,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      });
    }

    // Default: return account status
    return NextResponse.json({
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      email: account.email,
    });
  } catch (err: any) {
    console.error('[Stripe Connect] GET error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to get account info' },
      { status: 500 }
    );
  }
}
