/**
 * Phase 9 sub-chantier 2 commit 3/6 — Stripe Connect helpers (server-side).
 *
 * Helpers pour modes Split/Gift Phase 9 SC2 :
 *  - getPartnerStripeAccount(partnerId) : Admin SDK lookup partners/{id}.stripeAccountId
 *  - assertConnectChargesEnabled(accountId) : Stripe API account.retrieve + check charges_enabled
 *
 * Pattern DI seam cohérent SC5 c4/5 refundForSanction.ts :
 *  - __setStripeForTesting(mock) : inject mock Stripe pour tests
 *  - __setConnectDbForTesting(mockDb) : inject Admin SDK Firestore emulator
 *
 * Errors :
 *  - ConnectError code 'partner-not-found' (404) : partner doc absent
 *  - ConnectError code 'partner-not-onboarded' (412) : stripeAccountId absent OU charges_enabled=false
 *  - ConnectError code 'stripe-error' (500/503) : Stripe API call fail
 */

import { getSharedStripe, __setSharedStripeForTesting } from './sharedStripe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbOverride: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbReal: any = null;

/** @internal — DI seam tests/invites/checkout-split.test.ts.
 *  Wrapper de sharedStripe seam pour API ergonomique cohérent SC5. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setStripeForTesting(mock: any): void {
  __setSharedStripeForTesting(mock);
}

/** @internal — DI seam tests pour Admin SDK Firestore. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setConnectDbForTesting(mockDb: any): void {
  _dbOverride = mockDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDb(): Promise<any> {
  if (_dbOverride) return _dbOverride;
  if (_dbReal) return _dbReal;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _dbReal = getFirestore();
  return _dbReal;
}

export type ConnectErrorCode =
  | 'partner-not-found'
  | 'partner-not-onboarded'
  | 'stripe-error';

export class ConnectError extends Error {
  public readonly code: ConnectErrorCode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly details?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(code: ConnectErrorCode, message: string, details?: any) {
    super(message);
    this.name = 'ConnectError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Récupère le `stripeAccountId` d'un partner via Admin SDK.
 *
 * @throws ConnectError 'partner-not-found' si partner doc absent
 * @throws ConnectError 'partner-not-onboarded' si stripeAccountId absent
 */
export async function getPartnerStripeAccount(partnerId: string): Promise<string> {
  if (!partnerId) {
    throw new ConnectError('partner-not-found', 'partnerId required');
  }
  const db = await getDb();
  const snap = await db.collection('partners').doc(partnerId).get();
  if (!snap.exists) {
    throw new ConnectError('partner-not-found', `Partner ${partnerId} introuvable`);
  }
  const data = snap.data();
  const accountId = data?.stripeAccountId as string | undefined;
  if (!accountId) {
    throw new ConnectError(
      'partner-not-onboarded',
      `Partner ${partnerId} n'a pas terminé l'onboarding Stripe Connect`,
    );
  }
  return accountId;
}

/**
 * Vérifie que `account.charges_enabled === true` via Stripe API.
 *
 * @throws ConnectError 'partner-not-onboarded' si charges_enabled !== true
 * @throws ConnectError 'stripe-error' si Stripe API call fail
 */
export async function assertConnectChargesEnabled(accountId: string): Promise<void> {
  if (!accountId) {
    throw new ConnectError('partner-not-onboarded', 'accountId required');
  }
  const stripe = await getSharedStripe();
  let account;
  try {
    account = await stripe.accounts.retrieve(accountId);
  } catch (err) {
    throw new ConnectError(
      'stripe-error',
      `Stripe accounts.retrieve fail: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!account?.charges_enabled) {
    throw new ConnectError(
      'partner-not-onboarded',
      `Stripe account ${accountId} charges_enabled=false (onboarding incomplete)`,
    );
  }
}
