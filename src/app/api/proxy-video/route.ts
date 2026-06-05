/**
 * Fix #122 / #207 — GET /api/proxy-video?url=...
 *
 * Proxy server-side pour les vidéos Firebase Storage. Contourne CORS qui
 * empêche le client de fetch directement la vidéo et extraire une frame
 * via canvas. Le serveur fetch sans contrainte CORS et stream back en
 * same-origin → <video> joue + canvas.drawImage extrait la frame sans
 * tainted-canvas error.
 *
 * Fix #207 — SUPPORT DES RANGE REQUESTS (HTTP 206 Partial Content).
 *   Avant : le proxy bufferait toute la vidéo (arrayBuffer) et renvoyait
 *   TOUJOURS un 200 sans `Accept-Ranges`. Conséquence : le <video> HTML5 ne
 *   pouvait PAS seek en avant (flux non-seekable) → le décodeur restait bloqué
 *   à la frame 0 → les 5 miniatures extraites étaient toutes identiques
 *   (actualTime=0). En local ça passait car le fichier entier bufferait
 *   instantanément ; en prod (réseau lent) le seek échouait.
 *
 *   Maintenant : on FORWARD le header `Range` du client vers Firebase Storage
 *   (qui supporte nativement les Range), on renvoie le status upstream (206 si
 *   partiel) + `Content-Range` / `Content-Length` / `Accept-Ranges`, et on
 *   STREAME le body (plus de buffering complet → TTFB rapide + mémoire stable).
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

/** Headers upstream à repasser tels quels au client (s'ils existent). */
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

async function proxy(request: NextRequest, includeBody: boolean) {
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

    // Fix #207 — forward le header Range reçu du client (s'il existe) vers
    // Firebase Storage pour obtenir une réponse partielle 206 seekable.
    const range = request.headers.get('range');
    const upstream = await fetch(target.toString(), {
      method: includeBody ? 'GET' : 'HEAD',
      headers: range ? { Range: range } : {},
    });

    // 2xx (200 OK ou 206 Partial) attendu. Tout le reste = erreur upstream.
    if (upstream.status >= 400) {
      return NextResponse.json(
        { error: 'upstream failed', status: upstream.status },
        { status: upstream.status },
      );
    }

    const headers = new Headers();
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Garantit que le client sait qu'il peut seek (Firebase le renvoie déjà,
    // mais on force au cas où). Cache court privé (URLs signées).
    if (!headers.has('content-type')) headers.set('content-type', 'video/mp4');
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'private, max-age=300');

    // Stream passthrough (pas de buffering complet). upstream.body est un
    // ReadableStream web que NextResponse accepte directement.
    return new NextResponse(includeBody ? upstream.body : null, {
      status: upstream.status, // 206 si Range, sinon 200
      headers,
    });
  } catch (err) {
    console.error('[/api/proxy-video] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, true);
}

// Certains navigateurs émettent un HEAD pour sonder Accept-Ranges/Content-Length
// avant de seek. On le supporte pour ne pas casser la détection seekable.
export async function HEAD(request: NextRequest) {
  return proxy(request, false);
}
