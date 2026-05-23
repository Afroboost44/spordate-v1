/**
 * Phase 9.5 c45 — POST /api/checkout/credits.
 *
 * ⚠️ BUG #83 (2026-05-21) — ROUTE DÉSACTIVÉE
 * ------------------------------------------------
 * Décision Bassi : les activités/sessions ne se payent JAMAIS avec des crédits.
 * Les crédits servent UNIQUEMENT aux services intra-site (messages texte/audio,
 * likes, boost partner). Toute tentative d'utiliser cette route renvoie 410.
 *
 * Si tu cherches à réserver une session : utilise /api/checkout (Stripe).
 *
 * L'historique du flow (atomic debit credits + create booking + decrement seats)
 * est conservé dans l'historique Git (avant ce fix) au cas où la doctrine
 * business changerait. NE PAS restaurer sans valider avec Bassi.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
  void _request;
  return NextResponse.json(
    {
      error: 'feature-disabled',
      detail:
        "Les activités se payent uniquement par carte ou TWINT, pas avec les crédits. " +
        'Les crédits servent uniquement aux services intra-site (messages, likes, boost).',
    },
    { status: 410 },
  );
}
