/**
 * Test #122 — Endpoint diagnostic minimal pour vérifier si Next.js peut
 * compiler de nouveaux fichiers du tout. Si ce fichier compile, c'est que
 * le problème vient du contenu de notre route, pas du build lui-même.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    marker: 'PING-PONG-TEST-2026',
    timestamp: Date.now(),
  });
}
