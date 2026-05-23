/**
 * BUG #117 — Endpoint test-push pour valider la chaîne FCM end-to-end.
 *
 * Usage : depuis le client connecté, fetch('/api/test-push', { method: 'POST',
 * headers: { Authorization: 'Bearer ' + idToken } }). Envoie une push système
 * directement à l'utilisateur authentifié via son fcmToken Firestore.
 *
 * Permet de diagnostiquer rapidement :
 *   - ✅ Push reçue (banner Android / iOS) → la chaîne FCM marche. Le bug est
 *     côté events (like, message ne déclenchent pas notifyUser actuellement).
 *   - ❌ ok: false reason: 'no-token' → toggle pas activé / SW pas registered
 *   - ❌ ok: false reason: 'token-invalid' → token périmé, faut re-register
 *   - ❌ ok: false reason: 'fcm-fail' → problème payload ou serveur FCM
 *
 * À retirer ou protéger admin-only en prod long terme (pas critique car safe :
 * la push va à l'utilisateur lui-même via son propre token).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { notifyUser } from '@/lib/notifications/notifyUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const uid = await verifyAuth(request);
  if (!uid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const result = await notifyUser({
    uid,
    title: '🎉 Test Spordateur',
    body: 'Si tu lis ceci, les push fonctionnent. Tu peux fermer cette notif.',
    clickUrl: '/notifications',
    data: { type: 'test', source: 'api-test-push', ts: String(Date.now()) },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'POST avec Authorization Bearer pour envoyer une push test à l\'utilisateur.',
  });
}
