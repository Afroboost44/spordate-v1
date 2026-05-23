/**
 * Fix #127 — POST /api/partners/contact
 *
 * Endpoint pour le formulaire "Nous contacter" sur la home page (section partenaires).
 * Envoie un email à contact@spordateur.com avec replyTo = email expéditeur.
 *
 * Anti-spam :
 *  - Rate limit IP (3 requêtes / 10 minutes) via Map in-memory (best-effort,
 *    suffisant pour un endpoint marketing low-traffic)
 *  - Honeypot field `_hp` (caché en CSS côté client) : si rempli → silent OK
 *    (les bots remplissent toujours tous les champs)
 *  - Validation stricte : email regex + longueurs max
 *
 * Pipeline :
 *   1. Parse body { fromName, fromEmail, studioName?, phone?, city?, message, _hp? }
 *   2. Honeypot check → si _hp non-vide, return 200 silent (anti-bot)
 *   3. Validation : champs requis + format email + longueurs max
 *   4. Rate limit IP → 429 si dépassé
 *   5. sendEmail() vers contact@spordateur.com avec template 'partnerContactRequest'
 *      replyTo = fromEmail (permet de répondre directement au visiteur)
 *   6. Return { ok: true } / { ok: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/sendEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Destinataire fixe (côté serveur — pas configurable client-side). */
const CONTACT_RECIPIENT = process.env.PARTNERS_CONTACT_EMAIL || 'contact@spordateur.com';

/** Rate limit : 3 requêtes par fenêtre de 10 min par IP. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

/** In-memory rate limit map. Reset à chaque cold start (acceptable best-effort). */
const ipHits: Map<string, number[]> = new Map();

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  // Cleanup occasionnel des IPs inactives (1% des requêtes)
  if (Math.random() < 0.01) {
    for (const [k, v] of ipHits.entries()) {
      const fresh = v.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) ipHits.delete(k);
      else ipHits.set(k, fresh);
    }
  }
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Honeypot anti-bot : si rempli, on retourne OK silencieusement
    if (body?._hp && String(body._hp).trim().length > 0) {
      console.log('[/api/partners/contact] honeypot triggered, silent OK');
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const fromName = (body?.fromName || '').toString().trim();
    const fromEmail = (body?.fromEmail || '').toString().trim();
    const studioName = (body?.studioName || '').toString().trim();
    const phone = (body?.phone || '').toString().trim();
    const city = (body?.city || '').toString().trim();
    const message = (body?.message || '').toString().trim();

    if (!fromName || fromName.length > 120) {
      return NextResponse.json({ ok: false, error: 'invalid-name' }, { status: 400 });
    }
    if (!fromEmail || !EMAIL_RE.test(fromEmail) || fromEmail.length > 200) {
      return NextResponse.json({ ok: false, error: 'invalid-email' }, { status: 400 });
    }
    if (!message || message.length < 5 || message.length > 2000) {
      return NextResponse.json({ ok: false, error: 'invalid-message' }, { status: 400 });
    }
    if (studioName.length > 200 || phone.length > 50 || city.length > 100) {
      return NextResponse.json({ ok: false, error: 'invalid-optional' }, { status: 400 });
    }

    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      console.warn('[/api/partners/contact] rate-limited', { ip });
      return NextResponse.json(
        { ok: false, error: 'rate-limited', detail: 'Trop de demandes, réessaie dans quelques minutes.' },
        { status: 429 },
      );
    }

    const result = await sendEmail({
      to: CONTACT_RECIPIENT,
      replyTo: fromEmail,
      templateName: 'partnerContactRequest',
      templateData: {
        fromName,
        fromEmail,
        studioName: studioName || undefined,
        phone: phone || undefined,
        city: city || undefined,
        message,
      },
    });

    if (!result.ok) {
      console.error('[/api/partners/contact] sendEmail failed', { error: result.error });
      return NextResponse.json(
        { ok: false, error: 'send-failed', detail: result.error },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, loggedOnly: !!result.loggedOnly }, { status: 200 });
  } catch (err) {
    console.error('[/api/partners/contact] unexpected', err);
    return NextResponse.json(
      { ok: false, error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
