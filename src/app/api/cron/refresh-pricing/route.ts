/**
 * Spordateur — Phase 6 anti-cheat
 * /api/cron/refresh-pricing — endpoint trigger pour refresh sessions pricing.
 *
 * Auth : header `Authorization: Bearer ${CRON_SECRET}` requis (env var Vercel Production).
 *
 * Méthode : POST uniquement (semantique state-changing — écrit Firestore).
 *
 * Consommateurs :
 *   - Cloud Functions Scheduler (functions/src/scheduler/refresh-pricing.ts) — POST toutes les 15 min
 *   - Phase 8 admin UI (POST manuel pour debug + dryRun + limit override)
 *
 * Query params optionnels (utiles admin debug Phase 8) :
 *   - ?dryRun=true   → log mais ne write pas Firestore
 *   - ?limit=N       → override REFRESH_BATCH_LIMIT (défaut 500, range autorisé 1..500)
 *
 * Returns : RefreshResult shape (cf. helper anti-cheat/refresh-pricing.ts) en JSON.
 *
 * Runtime : nodejs (Edge ne supporte pas firebase-admin).
 * maxDuration : 60s (Vercel Pro default ; Vercel Hobby = 10s ⚠️ peut tronquer si beaucoup de sessions).
 */

import { NextRequest, NextResponse } from 'next/server';
import { refreshAllOpenSessionsPricing } from '@/services/anti-cheat/refresh-pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // 1. Auth check
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 2. Parse optional query params
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === 'true';
  const limitParam = searchParams.get('limit');
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) {
      return NextResponse.json(
        { error: 'invalid limit param (must be 1..500)' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    limit = Math.floor(parsed);
  }

  // 3. Run helper + return result
  try {
    const result = await refreshAllOpenSessionsPricing({ dryRun, limit });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    // Le helper ne throw normalement jamais (errors agrégées), mais safety net.
    const errMsg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'cron-failed', details: errMsg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
