/**
 * P0.1 — LES TROIS ROUTES ADMIN CRITIQUES, EPROUVEES DE BOUT EN BOUT.
 *
 * Exécution :
 *   npm run test:admin:gardes-critiques
 *   (= firebase emulators:exec --only firestore,auth "npx tsx tests/admin-routes/gardes-critiques.test.ts")
 *
 * CE QUE CE BANC PROUVE
 * Ces trois routes suppriment un compte, versent de l'argent et remboursent.
 * Leur garde lisait `users/{uid}.role` — un champ que le client ecrivait
 * jusqu'au P0. Elle interroge desormais la racine d'autorite : l'adresse du
 * compte dans FIREBASE AUTHENTICATION, confrontee a ADMIN_EMAILS, ET le role.
 *
 * AUCUNE ACTION DESTRUCTIVE N'EST DECLENCHEE. Chaque appel « autorise » vise
 * une cible INEXISTANTE : franchir la garde se lit alors dans un 400 ou un 404
 * — la preuve que l'autorisation a reussi, sans que rien ne soit supprime,
 * verse ni rembourse. Un 403 prouve l'inverse. C'est la seule facon d'eprouver
 * une garde qui protege une destruction sans rien detruire.
 *
 *   A. administrateur reellement prouve   → franchit la garde
 *   B. utilisateur ordinaire              → 403
 *   C. role='admin' en base, SEUL         → 403   (l'adresse ne suit pas)
 *   D. adresse admin dans Firestore SEULE → 403   (l'annuaire dit la verite)
 *   E. Bearer absent                      → 401
 *   F. Bearer invalide                    → 401
 *   G. compte absent de l'annuaire        → 403   (fermeture sure)
 */

import { readFileSync } from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { ADMIN_EMAILS } from '../../src/lib/sports';

let _passes = 0;
let _failures = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _passes++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _failures++; }
function section(t: string) { console.log(`\n--- ${t} ---`); }

const ADMIN_EMAIL = ADMIN_EMAILS[0];
const UID_ADMIN = 'uid_admin_prouve';
const UID_NORMAL = 'uid_normal';
const UID_ROLE_SEUL = 'uid_role_sans_adresse';
const UID_ADRESSE_SEULE = 'uid_adresse_sans_role';
const UID_FANTOME = 'uid_absent_de_l_annuaire';

/** Une requete minimale, telle que les routes la lisent. */
function requete(corps: Record<string, unknown>, entetes: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => entetes[k.toLowerCase()] ?? null },
    json: async () => corps,
    url: 'http://localhost/api/test',
  } as never;
}

/** 403/401 = la garde a REFUSE. Tout le reste = elle a ete franchie. */
function refuse(status: number) { return status === 401 || status === 403; }

async function statut(handler: (r: never, c?: never) => Promise<Response>, r: never, ctx?: never) {
  const rep = await handler(r, ctx as never);
  return rep.status;
}

async function main() {
  if (!getApps().length) initializeApp({ projectId: 'demo-spordate-gardes' });
  const auth = getAuth();
  const db = getFirestore();

  // ── L'annuaire d'identite : c'est LUI qui fait autorite sur l'adresse.
  await auth.createUser({ uid: UID_ADMIN, email: ADMIN_EMAIL });
  await auth.createUser({ uid: UID_NORMAL, email: 'quelquun@exemple.invalid' });
  await auth.createUser({ uid: UID_ROLE_SEUL, email: 'attaquant@exemple.invalid' });
  await auth.createUser({ uid: UID_ADRESSE_SEULE, email: ADMIN_EMAIL.replace('@', '+autre@') });
  // UID_FANTOME n'existe PAS dans l'annuaire — volontairement.

  // ── Les documents, tels qu'un client pourrait les avoir ecrits.
  await db.collection('users').doc(UID_ADMIN).set({ uid: UID_ADMIN, email: ADMIN_EMAIL, role: 'admin' });
  await db.collection('users').doc(UID_NORMAL).set({ uid: UID_NORMAL, email: 'quelquun@exemple.invalid', role: 'user' });
  // C : le role fabrique, sans l'adresse.
  await db.collection('users').doc(UID_ROLE_SEUL).set({ uid: UID_ROLE_SEUL, email: 'attaquant@exemple.invalid', role: 'admin', isAdmin: true });
  // D : l'adresse de l'administrateur INSCRITE DANS FIRESTORE, sans le role reel.
  await db.collection('users').doc(UID_ADRESSE_SEULE).set({ uid: UID_ADRESSE_SEULE, email: ADMIN_EMAIL, role: 'admin' });
  await db.collection('users').doc(UID_FANTOME).set({ uid: UID_FANTOME, email: ADMIN_EMAIL, role: 'admin' });

  const { POST: supprimerCompte } = await import('../../src/app/api/admin/delete-user/route');
  const { POST: validerVersement } = await import('../../src/app/api/admin/payouts/complete/route');
  const { POST: rembourser } = await import('../../src/app/api/admin/refund-sanction/[sanctionId]/route');

  const routes: Array<{ nom: string; appel: (uid: string | null) => Promise<number> }> = [
    {
      nom: 'admin/delete-user',
      // Cible INEXISTANTE : la garde franchie se lit dans un 400/404, rien n'est supprime.
      appel: async (uid) => {
        __setVerifyAuthForTesting(async () => uid);
        return statut(supprimerCompte as never, requete({ uid: 'compte_qui_n_existe_pas' }));
      },
    },
    {
      nom: 'admin/payouts/complete',
      appel: async (uid) => {
        __setVerifyAuthForTesting(async () => uid);
        return statut(validerVersement as never, requete({ payoutId: 'versement_inexistant' }));
      },
    },
    {
      nom: 'admin/refund-sanction',
      appel: async (uid) => {
        __setVerifyAuthForTesting(async () => uid);
        return statut(
          rembourser as never,
          requete({}),
          { params: Promise.resolve({ sanctionId: 'sanction_inexistante' }) } as never,
        );
      },
    },
  ];

  for (const r of routes) {
    section(r.nom);

    const a = await r.appel(UID_ADMIN);
    if (!refuse(a)) pass(`A. administrateur prouve -> garde franchie (statut ${a}, aucune action)`);
    else fail('A. administrateur prouve -> devrait passer', `statut ${a}`);

    for (const [cas, uid, quoi] of [
      ['B', UID_NORMAL, 'utilisateur ordinaire'],
      ['C', UID_ROLE_SEUL, "role='admin' + isAdmin=true fabriques, adresse non autorisee"],
      ['D', UID_ADRESSE_SEULE, "adresse admin ECRITE DANS FIRESTORE, annuaire dit autre chose"],
      ['G', UID_FANTOME, 'compte absent de l\'annuaire'],
    ] as Array<[string, string, string]>) {
      const s = await r.appel(uid);
      if (refuse(s)) pass(`${cas}. ${quoi} -> refuse (${s})`);
      else fail(`${cas}. ${quoi} -> devrait etre refuse`, `statut ${s}`);
    }

    // E / F : le Bearer lui-meme. `verifyAuth` rend null -> 401.
    const e = await r.appel(null);
    if (e === 401 || e === 403) pass(`E/F. Bearer absent ou invalide -> refuse (${e})`);
    else fail('E/F. Bearer absent -> devrait etre refuse', `statut ${e}`);
  }

  __setVerifyAuthForTesting(null);

  section('Le helper partage, et lui seul');
  const sources = [
    'src/app/api/admin/delete-user/route.ts',
    'src/app/api/admin/payouts/complete/route.ts',
    'src/app/api/admin/refund-sanction/[sanctionId]/route.ts',
  ];
  for (const chemin of sources) {
    const code = readFileSync(chemin, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    if (code.includes('estAdminAfroboostAutorise')) pass(`H. ${chemin} passe par le helper unique`);
    else fail(`H. ${chemin} n'utilise pas le helper`, '');
    if (!/data\(\)\?\.role\s*===\s*'admin'|role\s*!==\s*'admin'/.test(code)) pass(`I. ${chemin} ne relit plus le role en base`);
    else fail(`I. ${chemin} relit encore le role`, '');
    if (!/\.isAdmin\s*===\s*true/.test(code)) pass(`J. ${chemin} n'accepte plus le champ isAdmin`);
    else fail(`J. ${chemin} accepte encore isAdmin`, '');
  }

  console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
  console.log('Comptes supprimes : 0 — versements : 0 — remboursements : 0 — donnees production : 0');
  if (_failures > 0) process.exit(1);
}

main().catch((e) => { console.log('FAIL  banc interrompu —', e); process.exit(1); });
