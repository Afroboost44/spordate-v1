/**
 * ROTATION #2 — UN ÉCHEC DE PARSING NE DOIT JAMAIS IMPRIMER LA CLÉ.
 *
 * Exécution :
 *   npx tsx tests/auth/service-account-parse.test.ts
 *
 * POURQUOI CE BANC EXISTE
 * Le 07/09/2026, la clé privée ACTIVE du compte de service `spordate-prod` a
 * été imprimée en entier dans un terminal. La cause n'était pas le parser du
 * dépôt — c'était un script d'audit écrit à côté, qui faisait un
 * `JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)` NU, au premier niveau
 * d'un fichier. Node, face à une exception non attrapée, imprime la ligne
 * fautive : ici, la valeur elle-même.
 *
 * Ce banc verrouille les deux moitiés du problème :
 *   A. le parser défensif ne recopie JAMAIS la valeur dans son erreur ;
 *   B. aucun `JSON.parse` nu sur cette variable ne subsiste dans le dépôt.
 *
 * Il ne lit aucun secret : il fabrique ses propres fausses valeurs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseServiceAccountKeyDefensive } from '../../src/lib/auth/verifyAuth';

let _p = 0, _f = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _p++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _f++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie') { if (!c) pass(l); else fail(l, d); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

// Une fausse clé, reconnaissable, jamais réelle.
const SECRET = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBK-FAUSSE-CLE-DE-TEST-0123456789';
const MARQUEUR = 'FAUSSE-CLE-DE-TEST';

section('A — le parser ne recopie jamais la valeur dans son erreur');
const casInvalides: Array<[string, string]> = [
  ['A1 JSON echappe a la main', `{\\"type\\":\\"service_account\\",\\"private_key\\":\\"${SECRET}\\"}`],
  ['A2 JSON tronque', `{"type":"service_account","private_key":"${SECRET}"`],
  ['A3 valeur nue', SECRET],
  ['A4 base64 non decode', Buffer.from(`{"private_key":"${SECRET}"}`).toString('base64')],
];
for (const [nom, entree] of casInvalides) {
  let message = '';
  try { parseServiceAccountKeyDefensive(entree); message = '(aucune erreur levee)'; }
  catch (e) { message = (e as Error).message; }
  faux(`${nom} → le message ne contient pas le secret`, message.includes(MARQUEUR), `message: ${message.slice(0, 80)}`);
  faux(`${nom} → ni un fragment de 24 caracteres`, message.includes(SECRET.slice(0, 24)));
}

section('B — le chemin valide fonctionne toujours');
const valide = JSON.stringify({ type: 'service_account', project_id: 'p', private_key: '-----BEGIN-----\\nX\\n-----END-----\\n', client_email: 'a@b.c' });
const obj = parseServiceAccountKeyDefensive(valide);
vrai('B1 un JSON propre est accepte', obj.type === 'service_account');
// Le cas historique du parser : des sauts de ligne LITTERAUX dans la cle.
const avecSautsReels = '{"type":"service_account","private_key":"-----BEGIN-----\nX\n-----END-----\n"}';
const obj2 = parseServiceAccountKeyDefensive(avecSautsReels);
vrai('B2 les sauts de ligne litteraux sont repares', obj2.type === 'service_account');

section('C — aucun `JSON.parse` nu sur cette variable dans le depot');
// On balaie les sources ET les scripts : c'est un script hors `src/` qui avait
// provoque la fuite, donc restreindre la garde a `src/` la rendrait inutile.
const racine = join(__dirname, '..', '..');
const exclus = new Set(['node_modules', '.next', '.git', 'out', 'dist', 'coverage', '.turbo']);
const fautifs: string[] = [];
function balayer(rep: string) {
  for (const e of readdirSync(rep)) {
    if (exclus.has(e)) continue;
    const p = join(rep, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { balayer(p); continue; }
    if (!/\.(ts|tsx|js|cjs|mjs)$/.test(e)) continue;
    if (p.includes('tests/auth/service-account-parse.test.ts')) continue;
    const src = readFileSync(p, 'utf8');
    // `JSON.parse(...FIREBASE_SERVICE_ACCOUNT_KEY...)` sous toutes ses formes.
    // On ignore les lignes de COMMENTAIRE : deux scripts de migration citent le
    // motif dans leur en-tete pour expliquer ce qu'ils remplacent. Les compter
    // rendrait la garde bruyante, donc a terme ignoree.
    const lignesFautives = src.split('\n').filter((ligne) => {
      const nue = ligne.trim();
      if (nue.startsWith('//') || nue.startsWith('*') || nue.startsWith('/*')) return false;
      // On ignore aussi le motif CITE dans une chaine : `migrate-admin-init*.ts`
      // sont les codemods qui ont justement migre `src/` vers le parser
      // defensif — ils CHERCHENT ce texte, ils ne l'executent pas. Le
      // discriminant est le caractere qui precede : un guillemet = une citation.
      return /(^|[^'"`])JSON\.parse\s*\([^)]*FIREBASE_SERVICE_ACCOUNT_KEY/.test(ligne);
    });
    if (lignesFautives.length > 0) {
      fautifs.push(p.slice(racine.length + 1));
    }
  }
}
balayer(racine);
vrai('C1 aucun JSON.parse nu sur FIREBASE_SERVICE_ACCOUNT_KEY', fautifs.length === 0, `fichiers: ${fautifs.join(', ')}`);
vrai('C2 le parser defensif existe et est exporte', typeof parseServiceAccountKeyDefensive === 'function');

section('D — aucune cle ne doit vivre dans le depot');
const suspects: string[] = [];
function chercherCles(rep: string) {
  for (const e of readdirSync(rep)) {
    if (exclus.has(e)) continue;
    const p = join(rep, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { chercherCles(p); continue; }
    if (!/\.(json|env|txt|pem|key)$/.test(e) && !/^\.env/.test(e)) continue;
    if (st.size > 200000) continue;
    let src = ''; try { src = readFileSync(p, 'utf8'); } catch { continue; }
    if (src.includes('BEGIN PRIVATE KEY') || /"type"\s*:\s*"service_account"/.test(src)) {
      suspects.push(p.slice(racine.length + 1));
    }
  }
}
chercherCles(racine);
// `.env.local` est ignore par git : il peut porter la cle, ce n'est pas une fuite.
const versionnes = suspects.filter((f) => !/^\.env/.test(f) && !f.includes('/.env'));
vrai('D1 aucun fichier versionne ne porte une cle de compte de service', versionnes.length === 0, `fichiers: ${versionnes.join(', ')}`);

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
