/**
 * Phase 8 sub-chantier 4 commit 3/6 — Bearer ID token verifier (server-side).
 *
 * Hardening auth pour /api/invites/* (vs trust-body pattern utilisé /api/anti-leak,
 * /api/suggest-activities, /api/checkout). Nécessaire pour SC4 car les routes Invite
 * écrivent via Admin SDK (bypass rules) — sans Bearer verify, un user pourrait spoof
 * fromUserId dans le body et créer des invites au nom d'autrui.
 *
 * DI seam `__setVerifyAuthForTesting` permet aux tests d'injecter une auth mockée
 * sans avoir à générer de vrais ID tokens via emulator Firebase Auth.
 *
 * Pattern lazy Admin SDK init cohérent /api/checkout.
 */

import type { NextRequest } from 'next/server';

// =====================================================================
// DI seam (cohérent SC1+SC2+SC3 __set*ForTesting)
// =====================================================================

type VerifyAuthFn = (req: NextRequest) => Promise<string | null>;

let _verifyOverride: VerifyAuthFn | null = null;

/**
 * @internal — utilisé UNIQUEMENT par tests/invites/api.test.ts pour injecter
 * une fonction qui renvoie un uid mocké (sans Firebase Auth real).
 */
export function __setVerifyAuthForTesting(fn: VerifyAuthFn | null): void {
  _verifyOverride = fn;
}

// =====================================================================
// verifyAuth
// =====================================================================

/**
 * Extrait + verify le Bearer ID token Firebase. Returns auth uid si valide,
 * `null` sinon. Caller mappe `null` → HTTP 401.
 *
 * Production : import dynamique firebase-admin/auth (lazy) + verifyIdToken().
 * Tests : DI seam override (skip vérification crypto).
 */
export async function verifyAuth(req: NextRequest): Promise<string | null> {
  if (_verifyOverride) return _verifyOverride(req);

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
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
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch (err) {
    console.warn('[verifyAuth] verifyIdToken failed:', err);
    return null;
  }
}
