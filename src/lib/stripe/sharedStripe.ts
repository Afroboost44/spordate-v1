/**
 * Phase 9 SC2 c3/6 — Shared Stripe lazy-init avec DI seam.
 *
 * Module partagé pour éviter duplication des Stripe lazy-init patterns dans
 * /api/checkout/route.ts + /api/verify-payment/route.ts + connectHelpers.ts +
 * refundForSanction.ts.
 *
 * DI seam unique : __setSharedStripeForTesting(mock) — override pour tous les
 * consommateurs cohérent (cohérent SC5 c4/5 refundForSanction.ts pattern).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _override: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _real: any = null;

/** @internal — DI seam pour tests (cohérent SC5 c4/5 + SC2 c3/6 connectHelpers). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setSharedStripeForTesting(mock: any): void {
  _override = mock;
}

/** Lazy-init Stripe instance (ou override pour tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSharedStripe(): Promise<any> {
  if (_override) return _override;
  if (_real) return _real;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  const Stripe = (await import('stripe')).default;
  _real = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  return _real;
}
