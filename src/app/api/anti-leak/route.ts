/**
 * Phase 8 sub-chantier 2 hotfix — API route /api/anti-leak (server-only).
 *
 * Contexte : Genkit dépend de modules Node.js server-only (@grpc/grpc-js,
 * @opentelemetry/sdk-node) qui ne peuvent pas être bundlés côté client. Sans
 * cette isolation, importer classifyMessageL2 depuis src/services/firestore.ts
 * (consommé par Client Components chat/page.tsx) tirait toute la chaîne Genkit
 * dans le bundle webpack client → build Vercel échoue ('fs', 'tls', 'net' not found).
 *
 * Ce route handler isole l'IA Genkit dans un endpoint serveur. sendMessage()
 * client-side fait POST /api/anti-leak au lieu d'importer classifyMessageL2.
 *
 * Rate limiting : déjà géré côté classifier (wrapAiCall SC0 — 10/user/min).
 * Mapping erreurs : AiError 'rate-limit-exceeded' → 429 ; autres → 500.
 *
 * Auth : trust body.userId (cohérent pattern existant /api/checkout, /api/seed).
 * Hardening Bearer ID token = Phase 9 (pattern aucune route /api/ actuelle ne le fait,
 * sauf cron qui utilise CRON_SECRET).
 *
 * Cf. CGU §7.quater + Privacy §5 (commit d54c7a9 SC0 disclosures Genkit sub-processor).
 */

import { NextRequest, NextResponse } from 'next/server';
import { classifyMessageL2 } from '@/ai/flows/anti-leak-classifier';
import { AiError } from '@/ai/genkit';
import type { AntiLeakInput } from '@/ai/types';

export const runtime = 'nodejs'; // Genkit requires Node.js (pas Edge runtime)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validation shape input (anti-injection basique)
    if (
      typeof body?.messageContent !== 'string' ||
      typeof body?.chatId !== 'string' ||
      typeof body?.userId !== 'string' ||
      body.messageContent.length === 0 ||
      body.chatId.length === 0 ||
      body.userId.length === 0
    ) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'messageContent, chatId, userId required (non-empty strings)' },
        { status: 400 },
      );
    }

    // Anti-DoS basique : longueur message bornée (cohérent ChatMessage.text usage)
    if (body.messageContent.length > 5000) {
      return NextResponse.json(
        { error: 'message-too-long', detail: 'max 5000 chars' },
        { status: 413 },
      );
    }

    const input: AntiLeakInput = {
      messageContent: body.messageContent,
      chatId: body.chatId,
      userId: body.userId,
    };

    const result = await classifyMessageL2(input);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // Rate limit Genkit → 429 (caller peut retry next minute)
    if (err instanceof AiError && err.code === 'rate-limit-exceeded') {
      return NextResponse.json(
        { error: 'rate-limit-exceeded', detail: err.message },
        { status: 429 },
      );
    }

    // Autres erreurs (ne devraient pas arriver — classifier catch en interne avec ai-error)
    console.error('[/api/anti-leak] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
