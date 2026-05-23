/**
 * Fix #122 — GET /api/proxy-video?url=...
 *
 * Proxy server-side pour les vidéos Firebase Storage. Contourne CORS qui
 * empêche le client de fetch directement la vidéo et extraire une frame
 * via canvas. Le serveur fetch sans contrainte CORS et stream back en
 * same-origin → blob URL côté client → <video> joue + canvas.drawImage
 * extrait la frame sans tainted-canvas error.
 *
 * Sécurité : limite stricte aux URLs Firebase Storage du projet pour
 * empêcher d'utiliser le proxy comme open relay.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = [
  'firebasestorage.googleapis.com',
  'firebasestorage.app',
];

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url).searchParams.get('url');
    if (!url) {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return NextResponse.json({ error: 'invalid url' }, { status: 400 });
    }

    // Whitelist Firebase Storage hosts uniquement
    const hostOk = ALLOWED_HOSTS.some((h) => target.hostname.endsWith(h));
    if (!hostOk) {
      return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
    }

    const upstream = await fetch(target.toString(), { method: 'GET' });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'upstream failed', status: upstream.status },
        { status: upstream.status },
      );
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await upstream.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('[/api/proxy-video] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
