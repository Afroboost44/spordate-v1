/**
 * F4 — LIER UN COMPTE SPORDATEUR PRÉEXISTANT, APRÈS PREUVE DE POSSESSION.
 *
 * `activate` a répondu `needs_proof` : un compte Spordateur existe déjà pour cet
 * e-mail, et on refuse de le lier sur la seule base de l'e-mail (§4). La PREUVE,
 * c'est que le membre se connecte à CE compte : il présente ici un jeton d'ID
 * Firebase (session Spordateur authentifiée) ET le jeton d'activation afroboost.
 *
 * LA GARDE ANTI-USURPATION (§16-P) : l'e-mail de la session authentifiée DOIT
 * être exactement celui du jeton d'activation. A ne peut donc pas lier le compte
 * de B : le jeton d'activation de A porte l'e-mail de A ; s'y connecter comme B
 * donnerait un e-mail authentifié = celui de B ≠ A -> refus. Et se connecter
 * comme A exige les identifiants de A.
 *
 * Le jti du jeton d'activation est consommé ICI (anti-rejeu) : une même preuve
 * ne relie pas deux fois.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { enregistrerLiaison } from '@/lib/bridge/identityLink';
import { activationDepuisJeton } from '@/lib/bridge/jetonActivation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTION_JETONS = 'bridge_used_tokens';

export async function POST(req: NextRequest) {
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  if (!secret) return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });

  let corps: { t?: string; idToken?: string } = {};
  try { corps = await req.json(); } catch { corps = {}; }
  const jeton = (corps.t || '').trim();
  const idToken = (corps.idToken || '').trim();
  if (!idToken) return NextResponse.json({ error: 'missing_id_token' }, { status: 400 });

  const info = activationDepuisJeton(jeton, secret, Date.now());
  if (!info) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const auth = await getAdminAuth();
  const db = await getAdminDb();

  // PREUVE : la session Spordateur authentifiée. On vérifie le jeton d'ID
  // Firebase — un jeton invalide/expiré/forgé ne prouve rien.
  let authUid = '';
  let authEmail = '';
  try {
    const decoded = await auth.verifyIdToken(idToken);
    authUid = decoded.uid;
    authEmail = (decoded.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid_id_token' }, { status: 401 });
  }
  if (!authUid || !authEmail) {
    return NextResponse.json({ error: 'incomplete_identity' }, { status: 401 });
  }

  // LA GARDE : l'e-mail prouvé DOIT être celui du jeton d'activation. Sinon,
  // c'est une tentative de lier le compte d'un autre -> refus catégorique.
  if (authEmail !== info.email) {
    return NextResponse.json({ error: 'proof_mismatch' }, { status: 403 });
  }

  // Anti-rejeu : la preuve ne relie qu'une fois.
  try {
    await db.collection(COLLECTION_JETONS).doc(info.jti).create({
      email: info.email, usedAt: new Date(), kind: 'link-existing',
    });
  } catch {
    return NextResponse.json({ error: 'already_used' }, { status: 409 });
  }

  try {
    const r = await enregistrerLiaison(db, { uid: authUid, email: info.email, origine: 'compte' });
    if (r.action === 'conflit') {
      console.warn(`[F4] liaison en conflit (${r.motif}) uid=${authUid}`);
      return NextResponse.json({ status: 'conflict' }, { status: 409 });
    }
  } catch (e) {
    console.warn('[F4] liaison (compte existant) non écrite :', e);
    return NextResponse.json({ error: 'link_failed' }, { status: 500 });
  }

  return NextResponse.json({ status: 'linked' }, { status: 200 });
}
