/**
 * Phase 8 sub-chantier 5 commit 4/5 — POST /api/admin/refund-sanction/[sanctionId].
 *
 * Fallback admin manual : retry refund si auto fail dans triggerAutoSanction
 * (Q2=C robust pattern — auto par défaut + safety net admin).
 *
 * Pipeline :
 *   1. Auth — accepte 2 modes :
 *      a) Bearer CRON_SECRET (system auto-trigger via triggerAutoSanction self-call)
 *      b) Bearer ID token + isAdmin (admin manual retry — Q2=C fallback)
 *   2. Call refundAllForSanction(sanctionId) (helper SC5 c4/5)
 *   3. Return { processedCount, errorCount, reason? }
 *
 * Idempotency : refundForSanction uses Stripe idempotency_key — re-runs admin
 * sont safe (no double-refund).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { refundAllForSanction } from '@/lib/stripe/refundForSanction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// =====================================================================
// Lazy Admin SDK init (cohérent /api/admin/blocks)
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
  return snap.data()?.role === 'admin';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sanctionId: string }> },
) {
  try {
    const { sanctionId } = await params;
    if (!sanctionId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'sanctionId required' }, { status: 400 });
    }

    // 1. Auth — system Bearer CRON_SECRET (auto-trigger) OR admin Bearer ID token
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    const isSystemAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isSystemAuth) {
      const uid = await verifyAuth(request);
      if (!uid) {
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
      }
      if (!(await isAdmin(uid))) {
        return NextResponse.json({ error: 'forbidden', detail: 'admin role required' }, { status: 403 });
      }
    }

    // 3. Run refundAllForSanction (idempotency Stripe-side via idempotency_key)
    const result = await refundAllForSanction(sanctionId);

    return NextResponse.json(
      {
        sanctionId,
        processedCount: result.processedCount,
        errorCount: result.errorCount,
        reason: result.reason,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/admin/refund-sanction] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
