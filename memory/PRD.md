# Spordateur - Product Requirements Document

## Original Problem Statement
Build and optimize "spordateur.com", a sports community web app with:
- User onboarding and referrals
- Demo Mode → Production transition
- Stripe payment integration (Solo 25€ / Duo 50€)
- Partner directory with QR codes
- Admin dashboard

## Architecture
- **Stack**: Next.js 15 (App Router) + TypeScript + Tailwind CSS + ShadCN UI
- **Database**: Firebase (Firestore) with localStorage fallback
- **Payment**: Stripe Checkout (LIVE keys)
- **Port**: 3000 only (no secondary backend)

## What's Been Implemented

### Phase 1 - Core Features ✅
- User onboarding flow with referral system
- Discovery page with profile cards
- Partner directory integration
- Admin dashboard with sports management

### Phase 2 - Payment Integration ✅ (Jan 24, 2026)
- Stripe Checkout integration (LIVE keys)
- Solo ticket (25€) and Duo ticket (50€)
- Free session support (0€ → "SÉANCE D'ESSAI")
- SuccessTicket modal with:
  - WhatsApp sharing (partner name + time)
  - Google Calendar integration
  - .ics file download
- Stripe webhook for payment confirmation

### Phase 3 - Architecture Cleanup ✅ (Jan 24, 2026)
- Removed FastAPI backend (port 8001)
- Centralized API in `/api/checkout/route.ts`
- Fixed hardcoded URLs (now use `window.location.origin`)
- Build passes with `npm run build`

## API Endpoints

### POST /api/checkout
Creates a Stripe Checkout session or handles free bookings.

**Request:**
```json
{
  "packageType": "solo" | "duo" | "free",
  "amount": number, // optional, for free sessions
  "originUrl": "https://...",
  "metadata": { ... }
}
```

**Response (paid):**
```json
{
  "url": "https://checkout.stripe.com/...",
  "sessionId": "cs_live_..."
}
```

**Response (free):**
```json
{
  "url": "/discovery?payment=success&free=true",
  "sessionId": "free_...",
  "isFree": true
}
```

### POST /api/webhooks/stripe
Handles Stripe webhook events (checkout.session.completed).

## User Flows

### Free Session (0€)
1. User clicks "Séance d'essai gratuite"
2. Frontend calls `/api/checkout` with `amount: 0`
3. API returns `isFree: true`
4. Frontend shows SuccessTicket modal immediately

### Paid Session (25€/50€)
1. User clicks "Payer XX€"
2. Frontend calls `/api/checkout`
3. API creates Stripe session, returns URL
4. User redirected to Stripe Checkout
5. On success, redirected to `/discovery?payment=success&session_id=...`
6. Frontend polls status, shows SuccessTicket

## Credentials

### Admin Access
- `/admin/sports`: code `AFRO2026`
- `/admin/dashboard`: email `contact.artboost@gmail.com`

### Stripe (LIVE)
- Keys stored in `/app/.env.local`
- Webhook secret configured

## Backlog (P1/P2)

### P1 - High Priority
- [ ] Real-time partner list sync (admin → discovery)
- [ ] Full Firebase integration (remove localStorage fallback)

### P2 - Medium Priority
- [ ] Real email notifications via Resend API
- [ ] Payment tracking dashboard in admin
- [ ] Component refactoring (discovery/page.tsx is large)

## Files of Reference
- `/app/src/app/api/checkout/route.ts` - Payment API
- `/app/src/app/api/webhooks/stripe/route.ts` - Webhook handler
- `/app/src/app/discovery/page.tsx` - Main discovery page
- `/app/.env.local` - Environment variables (Stripe keys)
