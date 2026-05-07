/**
 * Phase 8 sub-chantier 5 commit 1/5 — GET /api/admin/blocks.
 *
 * Comble Différé Phase 8 ligne 880 architecture.md :
 *   « ⏳ listAllBlocks admin via Admin SDK endpoint »
 *
 * Le helper `listAllBlocks` existe Phase 7 SC4 (`src/lib/blocks/listAllBlocks.ts`)
 * mais utilise le client SDK — la rule Firestore /blocks/ ne permet pas read admin
 * (cohérent doctrine §E "anti-confrontation"). Cet endpoint expose la query via
 * Admin SDK + gating Bearer auth + isAdminRole check côté serveur.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid (Q6=A pattern SC4 verifyAuth)
 *   2. Check users.{uid}.role === 'admin' (server-side, lecture Admin SDK)
 *   3. Parse optional ?limit param (défaut 50, range 1..500)
 *   4. Query blocks orderBy createdAt DESC limit (fallback unsorted si index missing)
 *   5. Return { blocks: Block[], count: number }
 *
 * Error mapping HTTP :
 *   - missing/invalid Bearer → 401 unauthenticated
 *   - role !== 'admin' → 403 forbidden
 *   - limit invalide → 400 invalid-limit
 *   - autres → 500 internal-error
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';

export const runtime = 'nodejs'; // firebase-admin requires Node.js
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/invites)
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;

async function getAdminDb() {
  if (_adminDb) return _adminDb;
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
  _adminDb = getFirestore();
  return _adminDb;
}

async function isAdmin(uid: string): Promise<boolean> {
  if (!uid) return false;
  const db = await getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return data?.role === 'admin';
}

export async function GET(request: NextRequest) {
  try {
    // 1. Verify Bearer
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // 2. Admin role check (server-side)
    if (!(await isAdmin(uid))) {
      return NextResponse.json({ error: 'forbidden', detail: 'admin role required' }, { status: 403 });
    }

    // 3. Parse + validate optional limit param
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    let limit = 50;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) {
        return NextResponse.json(
          { error: 'invalid-limit', detail: 'limit must be 1..500' },
          { status: 400 },
        );
      }
      limit = Math.floor(parsed);
    }

    // 4. Query blocks via Admin SDK (bypass rules — admin gating ci-dessus)
    const db = await getAdminDb();
    let blocksDocs;
    try {
      const snap = await db
        .collection('blocks')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      blocksDocs = snap.docs;
    } catch (err) {
      console.warn('[/api/admin/blocks] orderBy failed, fallback unsorted:', err);
      const snap = await db.collection('blocks').limit(limit).get();
      blocksDocs = snap.docs;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = blocksDocs.map((d: any) => d.data());
    return NextResponse.json({ blocks, count: blocks.length }, { status: 200 });
  } catch (err) {
    console.error('[/api/admin/blocks GET] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
