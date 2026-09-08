/**
 * Pont « une seule clé » — côté Spordate. V387
 *
 * Reçoit le jeton court émis par afroboost (`POST /api/spordate/access`), le
 * vérifie, et renvoie un `customToken` Firebase que le client échange contre
 * une session. Le membre entre sans se reconnecter.
 *
 * L'e-mail est la clé d'identité : le compte Firebase du même e-mail est
 * retrouvé, ou créé s'il n'existe pas encore. C'est l'équivalent Firebase du
 * lien magique Supabase utilisé par le pont du live.
 *
 * SIGNATURE vérifiée avec `node:crypto` — HS256 en une vingtaine de lignes,
 * plutôt qu'une dépendance de plus dans un build déjà lourd. Comparaison en
 * temps constant (`timingSafeEqual`) : une comparaison naïve fuirait le secret
 * octet par octet.
 *
 * ANTI-REJEU tenu ICI et non chez afroboost : c'est ce endpoint qui consomme le
 * jeton, donc lui seul sait si l'échange a réellement abouti. Le `jti` est
 * enregistré dans Firestore ; un second passage est refusé.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { enregistrerLiaison, cleIndexEmail, COLLECTION_INDEX } from '@/lib/bridge/identityLink';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTION_JETONS = 'bridge_used_tokens';

function depuisB64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

type Charge = {
  email?: string;
  jti?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  /** LOT U2b — par quelle porte afroboost a reconnu le membre. Purement
   *  descriptif : AUCUNE décision de ce fichier ne le lit. Absent des jetons
   *  émis avant, et c'est sans conséquence. */
  origine?: string;
};

/** Vérifie la signature HS256 et renvoie la charge utile, ou null. */
function verifierHs256(jeton: string, secret: string): Charge | null {
  const parties = jeton.split('.');
  if (parties.length !== 3) return null;
  const [entete, charge, signature] = parties;

  // L'algorithme est lu dans l'en-tête et EXIGÉ : sans ce contrôle, un jeton
  // forgé avec `"alg":"none"` passerait.
  let alg = '';
  try {
    alg = JSON.parse(depuisB64Url(entete).toString('utf8'))?.alg;
  } catch {
    return null;
  }
  if (alg !== 'HS256') return null;

  const attendue = crypto.createHmac('sha256', secret).update(`${entete}.${charge}`).digest();
  const recue = depuisB64Url(signature);
  if (attendue.length !== recue.length) return null;
  if (!crypto.timingSafeEqual(attendue, recue)) return null;

  try {
    return JSON.parse(depuisB64Url(charge).toString('utf8')) as Charge;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  if (!secret) {
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

  const charge = verifierHs256(jeton, secret);
  if (!charge) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });

  // Émetteur et destinataire attendus : un jeton valide mais destiné à un autre
  // service ne doit pas ouvrir de session ici.
  if (charge.aud !== 'spordate' || charge.iss !== 'afroboost') {
    return NextResponse.json({ error: 'wrong_audience' }, { status: 401 });
  }

  const maintenant = Math.floor(Date.now() / 1000);
  if (!charge.exp || charge.exp < maintenant) {
    return NextResponse.json({ error: 'expired' }, { status: 401 });
  }

  const email = (charge.email || '').trim().toLowerCase();
  const jti = (charge.jti || '').trim();
  if (!email || !jti) return NextResponse.json({ error: 'incomplete_token' }, { status: 400 });

  const db = await getAdminDb();
  const auth = await getAdminAuth();

  // ─── F4 — VERROU D'ACTIVATION VOLONTAIRE ──────────────────────────────────
  // Par défaut (drapeau absent), comportement HISTORIQUE strictement inchangé :
  // le pont crée/retrouve le compte et laisse entrer. Quand `SPORDATE_ACTIVATION
  // _REQUIRED` est activé, un membre NON encore lié n'est PLUS créé ni lié
  // silencieusement à l'entrée : on renvoie `needs_activation`, et c'est le
  // parcours d'activation (consentement + preuve) qui, LUI SEUL, crée/lie. Un
  // membre DÉJÀ lié entre comme avant — aucune régression pour l'existant.
  // Placé AVANT la consommation du jeton : un `needs_activation` ne le gaspille
  // pas (le membre pourra activer puis réutiliser le pont).
  if (process.env.SPORDATE_ACTIVATION_REQUIRED === 'true') {
    try {
      const idx = await db.collection(COLLECTION_INDEX).doc(cleIndexEmail(email)).get();
      const dejaLie = idx.exists && String((idx.data() || {}).spordateUid || '').trim();
      if (!dejaLie) {
        return NextResponse.json({ needs_activation: true }, { status: 200 });
      }
    } catch {
      // Lecture de l'index impossible : on NE ferme PAS le pont pour l'existant
      // (leçon V310c). On retombe sur le comportement historique ci-dessous.
    }
  }

  // Anti-rejeu. `create()` échoue si le document existe déjà : l'écriture est
  // donc atomique côté Firestore, sans lecture-puis-écriture qui laisserait une
  // fenêtre entre les deux si le lien était ouvert deux fois simultanément.
  try {
    await db.collection(COLLECTION_JETONS).doc(jti).create({
      email,
      usedAt: new Date(),
      expiresAt: new Date(charge.exp * 1000),
    });
  } catch {
    return NextResponse.json({ error: 'already_used' }, { status: 409 });
  }

  // Compte Firebase de cet e-mail : retrouvé, ou créé silencieusement.
  let uid: string;
  try {
    const existant = await auth.getUserByEmail(email);
    uid = existant.uid;
  } catch {
    const cree = await auth.createUser({ email, emailVerified: true });
    uid = cree.uid;
  }

  // ─── LOT U2b — liaison d'identité persistante ─────────────────────────────
  // ON N'EN EST ICI QUE SI TOUT A ÉTÉ PROUVÉ : signature HS256 vérifiée en
  // temps constant, `aud`/`iss` attendus, jeton non expiré, `jti` consommé une
  // seule fois, et `uid` confirmé par Firebase Auth lui-même. Une identité de
  // ChatWidget non authentifiée n'arrive jamais jusqu'ici : afroboost lui
  // refuse le jeton (403 `identity_required`), donc il n'y a rien à vérifier
  // de plus de ce côté — et rien à desserrer.
  //
  // NON BLOQUANTE, DÉLIBÉRÉMENT. Le pont prime : si l'écriture échoue
  // (Firestore indisponible, conflit de droits), le membre entre quand même.
  // Une correspondance manquante se rattrape au passage suivant ; une session
  // refusée, non. C'est pour cela que ce bloc vient APRÈS tout le reste et
  // qu'il n'a aucun pouvoir sur la réponse.
  try {
    const r = await enregistrerLiaison(db, { uid, email, origine: charge.origine });
    if (r.action === 'conflit') {
      // Consigné en base ET dans les journaux : c'est une information à
      // trancher par un humain, pas une panne à réessayer.
      console.warn(`[U2b] liaison en conflit (${r.motif}) uid=${uid}`);
    }
  } catch (e) {
    console.warn('[U2b] liaison non écrite — le pont continue :', e);
  }

  // `via` sert au client à savoir qu'il faut proposer l'onboarding minimal si le
  // profil est vide — un membre venu d'afroboost n'a jamais rempli le sien.
  const customToken = await auth.createCustomToken(uid, { via: 'afroboost' });

  return NextResponse.json({ token: customToken, email });
}
