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
// parseServiceAccountKeyDefensive (B2 hotfix)
// =====================================================================

/**
 * Parse défensif de FIREBASE_SERVICE_ACCOUNT_KEY. La valeur téléchargée via
 * `vercel env pull` contient parfois des newlines LITTÉRAUX (char 10) dans
 * la `private_key`, ce qui casse JSON.parse natif avec :
 *   SyntaxError: Bad control character in string literal in JSON at position N
 *
 * Stratégie : try direct, sinon re-escape les newlines (`\n` real → `\\n` JSON
 * escape sequence) et les CR (`\r` real → `\\r`) avant retry. JSON.parse les
 * reconvertit ensuite en char 10/13 dans la string résolue, ce que Firebase
 * Admin SDK `cert()` attend nativement.
 *
 * Exporté pour test unitaire (helper pur).
 */
export function parseServiceAccountKeyDefensive(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    try {
      const repaired = raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      return JSON.parse(repaired);
    } catch (secondErr) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_KEY parse failed (first: ${(firstErr as Error).message} / retry: ${(secondErr as Error).message})`,
      );
    }
  }
}

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
        // B2 hotfix : parseServiceAccountKeyDefensive gère le cas Vercel
        // env pull qui peut sortir des newlines littéraux dans la private_key.
        initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
      } else {
        initializeApp({
          projectId: (
            process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
            process.env.GCLOUD_PROJECT ||
            'spordateur-claude'
          ).trim(),
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
