/**
 * F4 — ACTIVATION VOLONTAIRE DU PROFIL SOCIAL, CÔTÉ SPORDATEUR.
 *
 * Le SEUL endroit (avec `link-existing`) qui a le droit de CRÉER un compte ou
 * d'écrire une liaison. Il n'agit que sur présentation d'un jeton d'activation
 * signé par afroboost ET portant un consentement explicite (`aud:"spordate-
 * activate"`, `consent:true`). Sans lui, rien ne se crée, rien ne se lie.
 *
 * TROIS ISSUES, aucune ne lie par e-mail seul :
 *   - `already_linked` : la liaison existe déjà -> le client entre normalement.
 *   - `needs_proof`    : un compte Spordateur existe déjà pour cet e-mail. On NE
 *                        LE LIE PAS (§4) : le membre doit d'abord PROUVER qu'il
 *                        le contrôle en s'y connectant (voir `link-existing`).
 *                        Aucune création, aucune liaison, aucun jeton consommé.
 *   - `created`        : aucun compte n'existait -> après consentement, on crée
 *                        un compte MINIMAL (e-mail seul, e-mail NON vérifié), on
 *                        écrit la liaison, et on renvoie un customToken pour que
 *                        le membre entre et complète lui-même son profil.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { cleIndexEmail, COLLECTION_INDEX, enregistrerLiaison } from '@/lib/bridge/identityLink';
import { activationDepuisJeton } from '@/lib/bridge/jetonActivation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTION_JETONS = 'bridge_used_tokens';

export async function POST(req: NextRequest) {
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  if (!secret) return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });

  let corps: { t?: string } = {};
  try { corps = await req.json(); } catch { corps = {}; }
  const jeton = (corps.t || '').trim();

  const info = activationDepuisJeton(jeton, secret, Date.now());
  if (!info) {
    // Un seul code : signature, audience, expiration, e-mail OU consentement
    // absent — on ne révèle pas lequel.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { email, jti } = info;

  const db = await getAdminDb();
  const auth = await getAdminAuth();

  // 1 — déjà lié ? (idempotent, aucune écriture)
  try {
    const idx = await db.collection(COLLECTION_INDEX).doc(cleIndexEmail(email)).get();
    if (idx.exists && String((idx.data() || {}).spordateUid || '').trim()) {
      return NextResponse.json({ status: 'already_linked' }, { status: 200 });
    }
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  // 2 — un compte Spordateur existe-t-il déjà pour cet e-mail ?
  let existe = false;
  try {
    await auth.getUserByEmail(email);
    existe = true;
  } catch {
    existe = false;
  }

  if (existe) {
    // §4 : NE PAS LIER SUR LA SEULE BASE DE L'E-MAIL. On demande une preuve de
    // possession (connexion Spordateur), sans rien créer ni consommer ici.
    return NextResponse.json({ status: 'needs_proof' }, { status: 200 });
  }

  // 3 — aucun compte : création MINIMALE après consentement (porté par le jeton).
  //     Anti-rejeu ET anti-double-clic : on consomme le jti AVANT de créer
  //     (`create()` atomique). Un second appel concurrent tombe en 409.
  try {
    await db.collection(COLLECTION_JETONS).doc(jti).create({
      email, usedAt: new Date(), kind: 'activate',
    });
  } catch {
    return NextResponse.json({ error: 'already_used' }, { status: 409 });
  }

  let uid: string;
  try {
    // Compte MINIMAL : e-mail seul, e-mail NON vérifié (afroboost ne l'a pas
    // vérifié). Aucune donnée legacy inventée. Le membre complétera son profil.
    const cree = await auth.createUser({ email, emailVerified: false });
    uid = cree.uid;
  } catch (e) {
    // Course rare (le compte est apparu entre-temps) : on ne devine pas, on
    // renvoie vers la preuve de possession.
    console.warn('[F4] createUser a échoué, repli needs_proof :', e);
    return NextResponse.json({ status: 'needs_proof' }, { status: 200 });
  }

  try {
    const r = await enregistrerLiaison(db, { uid, email, origine: 'compte' });
    if (r.action === 'conflit') {
      console.warn(`[F4] liaison en conflit (${r.motif}) uid=${uid}`);
      return NextResponse.json({ status: 'conflict' }, { status: 409 });
    }
  } catch (e) {
    console.warn('[F4] liaison non écrite après création :', e);
    return NextResponse.json({ error: 'link_failed' }, { status: 500 });
  }

  const customToken = await auth.createCustomToken(uid, { via: 'afroboost-activation' });
  return NextResponse.json({ status: 'created', token: customToken }, { status: 200 });
}
