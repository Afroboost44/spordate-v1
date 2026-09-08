/**
 * F3 FINAL — RÉSOLUTION DE LIENS, SERVEUR À SERVEUR UNIQUEMENT.
 *
 * afroboost, pour une liste d'utilisateurs qu'il affiche DÉJÀ légitimement,
 * demande lesquels sont liés à Spordateur. Réponse par e-mail : lié ou non, et
 * si lié, le `uid` (que seul le SERVEUR afroboost reçoit, jamais un navigateur).
 *
 * POURQUOI CE N'EST PAS L'API D'APPARTENANCE INTERDITE (§5) :
 *   - le jeton `spordate-link-resolve` prouve que c'est le SERVEUR afroboost —
 *     un navigateur ne peut pas le forger (secret partagé jamais exposé) ;
 *   - afroboost n'appelle cette route QUE pour des e-mails d'utilisateurs qu'il
 *     est déjà autorisé à afficher, jamais sur saisie libre d'un visiteur ;
 *   - le navigateur, lui, ne reçoit jamais le uid : afroboost le réemballe en
 *     jeton de vue opaque (`spordate-profile-view`).
 * Autrement dit : le mapping ne quitte jamais le périmètre serveur.
 *
 * La route de LECTURE authentifiée que le module identityLink annonçait.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { cleIndexEmail, COLLECTION_INDEX } from '@/lib/bridge/identityLink';
import { serveurAfroboostAutorise } from '@/lib/bridge/jetonResolution';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Plafond dur : une requête ne résout pas plus de 200 e-mails. Borne le coût et
// coupe court à toute idée d'énumération massive, même depuis le serveur.
const MAX_EMAILS = 200;

type Corps = { t?: string; emails?: unknown };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  if (!secret) {
    return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
  }

  let corps: Corps = {};
  try {
    corps = await req.json();
  } catch {
    corps = {};
  }

  const jeton = (typeof corps.t === 'string' ? corps.t : '').trim();
  if (!serveurAfroboostAutorise(jeton, secret, Date.now())) {
    // Un seul code : ne rien révéler de la raison (signature/audience/exp).
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Normalisation + déduplication + plafond. On ignore tout ce qui n'est pas une
  // chaîne non vide, sans faire échouer la requête entière.
  const brut = Array.isArray(corps.emails) ? corps.emails : [];
  const emails: string[] = [];
  const vus = new Set<string>();
  for (const e of brut) {
    if (typeof e !== 'string') continue;
    const norm = e.trim().toLowerCase();
    if (!norm || vus.has(norm)) continue;
    vus.add(norm);
    emails.push(norm);
    if (emails.length >= MAX_EMAILS) break;
  }

  const db = await getAdminDb();

  // Lecture de l'index inverse, e-mail par e-mail. `getAll` sur les clés SHA-256
  // évite N allers-retours. Une base injoignable ferme la porte (503), on ne
  // devine jamais un lien.
  const resultats: Record<string, { lie: boolean; uid?: string }> = {};
  if (emails.length > 0) {
    try {
      const refs = emails.map((e) => db.collection(COLLECTION_INDEX).doc(cleIndexEmail(e)));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap: FirebaseFirestore.DocumentSnapshot, i: number) => {
        const email = emails[i];
        const uid = snap.exists ? String((snap.data() || {}).spordateUid || '').trim() : '';
        resultats[email] = uid ? { lie: true, uid } : { lie: false };
      });
    } catch {
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
  }

  return NextResponse.json({ resultats }, { status: 200 });
}
