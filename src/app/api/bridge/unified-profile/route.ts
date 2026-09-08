/**
 * F2 — LE PROFIL SOCIAL, LU DEPUIS afroboost, SANS RIEN DUPLIQUER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE FAIT, DANS L'ORDRE — ET CE QU'ELLE NE FAIT JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 * afroboost authentifie SON utilisateur (JWT signé), puis émet un jeton HS256
 * `aud:"spordate-profile"` portant l'e-mail prouvé, et appelle cette route.
 * Ici, côté Spordateur — seul détenteur du bridge et du profil — on :
 *   1. vérifie le jeton (signature, audience, émetteur, expiration) ;
 *   2. résout `sha256(email)` → `bridge_identity_index` → un `uid` Spordateur ;
 *   3. lit `users/{uid}` ;
 *   4. le réduit au DTO whitelisté et le renvoie.
 *
 * ELLE N'ÉCRIT RIEN. Aucune liaison n'est créée, aucun `users` touché, aucun
 * jeton consommé. Une lecture de profil est idempotente : la rejouer ne fait
 * que relire le même profil public de la même personne.
 *
 * FUSION PAR E-MAIL ? NON. L'e-mail n'est pas comparé à `users.email` : il sert
 * UNIQUEMENT à retrouver une liaison bridge PRÉEXISTANTE. Sans liaison — le cas
 * de la quasi-totalité des comptes aujourd'hui — la réponse est `lie:false`, et
 * c'est un état normal, pas une erreur. On ne rattache jamais deux comptes au
 * prétexte qu'ils partagent une adresse.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { cleIndexEmail, COLLECTION_INDEX } from '@/lib/bridge/identityLink';
import { emailDepuisJetonProfil } from '@/lib/bridge/jetonProfil';
import { versProfilSocial, type ReponseProfilUnifie } from '@/lib/bridge/profilSocial';
import { versEcritureProfil } from '@/lib/bridge/profilSocialEcriture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTION_USERS = 'users';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  if (!secret) {
    // Même refus que le pont : sans secret partagé, aucune confiance possible.
    return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
  }

  let corps: { t?: string } = {};
  try {
    corps = await req.json();
  } catch {
    corps = {};
  }
  const jeton = (corps.t || '').trim();
  if (!jeton) return NextResponse.json({ error: 'missing_token' }, { status: 400 });

  const email = emailDepuisJetonProfil(jeton, secret, Date.now());
  if (!email) {
    // Un seul code pour tous les échecs de jeton (signature, audience, exp,
    // e-mail absent) : ne rien révéler de la raison précise à un attaquant.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = await getAdminDb();

  // 2 — l'index inverse : sha256(email) → uid. C'est le SEUL pont d'identité,
  //     celui que le pont d'accès a écrit après vérification de signature.
  const emailKey = cleIndexEmail(email);
  let uid = '';
  try {
    const snapIndex = await db.collection(COLLECTION_INDEX).doc(emailKey).get();
    if (snapIndex.exists) {
      uid = String((snapIndex.data() || {}).spordateUid || '').trim();
    }
  } catch {
    // Base injoignable : on ferme, on ne devine pas. Mieux vaut « non lié »
    // affiché à tort une seconde que l'inverse.
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const nonLie: ReponseProfilUnifie = { lie: false, motif: 'non_lie' };
  if (!uid) return NextResponse.json(nonLie, { status: 200 });

  // 3 — le profil. Une liaison sans document `users` est un état sûr, pas une
  //     erreur : le compte a été lié mais n'a pas (encore) de profil.
  let userDoc: Record<string, unknown> | null = null;
  try {
    const snapUser = await db.collection(COLLECTION_USERS).doc(uid).get();
    if (snapUser.exists) userDoc = (snapUser.data() || {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  if (!userDoc) {
    const introuvable: ReponseProfilUnifie = { lie: false, motif: 'introuvable' };
    return NextResponse.json(introuvable, { status: 200 });
  }

  // 4 — LA LISTE BLANCHE. C'est ici, et seulement ici, que le document quitte
  //     Spordateur — réduit à sept champs, jamais entier.
  const reponse: ReponseProfilUnifie = { lie: true, profil: versProfilSocial(userDoc) };
  return NextResponse.json(reponse, { status: 200 });
}


/**
 * F3 — ÉCRITURE. Le coach modifie SON profil social depuis afroboost ; on
 * l'enregistre ICI, dans le vrai `users/{uid}` Spordateur — jamais dans un
 * profil parallèle.
 *
 * MÊMES GARDES QUE LA LECTURE, PLUS UNE. Le jeton signé prouve l'identité,
 * l'index bridge donne le uid — JAMAIS le client. En plus : `versEcritureProfil`
 * réduit le corps à trois champs texte validés (bio, city, sports). Un `uid`,
 * un `credits`, un `role` glissés dans le corps ne sont pas recopiés : ils
 * n'existent pas pour ce filtre. Aucun mass-assignment possible.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  if (!secret) return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });

  let corps: { t?: string; profil?: unknown } = {};
  try { corps = await req.json(); } catch { corps = {}; }
  const jeton = (corps.t || '').trim();
  if (!jeton) return NextResponse.json({ error: 'missing_token' }, { status: 400 });

  const email = emailDepuisJetonProfil(jeton, secret, Date.now());
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Le corps modifiable, RÉDUIT et VALIDÉ, avant même de toucher la base.
  const { patch, sansEffet } = versEcritureProfil(corps.profil);

  const db = await getAdminDb();
  const emailKey = cleIndexEmail(email);
  let uid = '';
  try {
    const snapIndex = await db.collection(COLLECTION_INDEX).doc(emailKey).get();
    if (snapIndex.exists) uid = String((snapIndex.data() || {}).spordateUid || '').trim();
  } catch { return NextResponse.json({ error: 'unavailable' }, { status: 503 }); }

  // PAS DE LIAISON -> PAS D'ÉCRITURE. On ne crée pas de compte, on ne devine pas
  // de uid : sans liaison prouvée, il n'y a rien à écrire (fermeture sûre).
  if (!uid) {
    const nonLie: ReponseProfilUnifie = { lie: false, motif: 'non_lie' };
    return NextResponse.json(nonLie, { status: 200 });
  }

  // Rien de valide à écrire : on relit et on renvoie, sans toucher la base.
  if (!sansEffet) {
    try {
      // `set(..., {merge:true})` n'écrit QUE les clés présentes dans `patch` —
      // les trois champs validés, jamais un de plus.
      await db.collection(COLLECTION_USERS).doc(uid).set(
        { ...patch, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    } catch {
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
  }

  // On relit le document et on renvoie le DTO whitelisté — jamais le brut.
  let userDoc: Record<string, unknown> | null = null;
  try {
    const snapUser = await db.collection(COLLECTION_USERS).doc(uid).get();
    if (snapUser.exists) userDoc = (snapUser.data() || {}) as Record<string, unknown>;
  } catch { return NextResponse.json({ error: 'unavailable' }, { status: 503 }); }
  if (!userDoc) {
    const introuvable: ReponseProfilUnifie = { lie: false, motif: 'introuvable' };
    return NextResponse.json(introuvable, { status: 200 });
  }
  const reponse: ReponseProfilUnifie = { lie: true, profil: versProfilSocial(userDoc) };
  return NextResponse.json(reponse, { status: 200 });
}
