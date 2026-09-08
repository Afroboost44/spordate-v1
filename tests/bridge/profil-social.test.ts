/**
 * F2 — LE PROFIL SOCIAL NE LAISSE PASSER QUE CE QU'IL DOIT.
 *
 * Exécution :
 *   npx tsx tests/bridge/profil-social.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Un document `users` de Spordateur mêle le public (photo, bio, ville) et
 * l'interne (crédits, rôle, fcmToken, sanctions). Ce banc lui donne un `users`
 * TRUFFÉ de champs sensibles et vérifie qu'aucun ne ressort — et que le jeton
 * qui déclenche la lecture ne peut être ni forgé, ni rejoué d'un canal à
 * l'autre, ni expiré.
 *
 * Tout est pur : aucune base, aucun réseau. La route (auth + Firestore) est
 * vérifiée par lecture de sa source, là où l'émulateur n'apporterait rien.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

import {
  versProfilSocial, CHAMPS_SOCIAUX, CHAMPS_INTERDITS,
} from '../../src/lib/bridge/profilSocial';
import {
  emailDepuisJetonProfil, AUDIENCE_PROFIL, EMETTEUR,
} from '../../src/lib/bridge/jetonProfil';
import {
  versEcritureProfil, CHAMPS_MODIFIABLES, BIO_MAX,
} from '../../src/lib/bridge/profilSocialEcriture';

let _p = 0, _f = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _p++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _f++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie') { if (!c) pass(l); else fail(l, d); }
function egal(l: string, o: unknown, a: unknown) {
  if (JSON.stringify(o) === JSON.stringify(a)) pass(l);
  else fail(l, `obtenu ${JSON.stringify(o)}, attendu ${JSON.stringify(a)}`);
}
function section(t: string) { console.log(`\n--- ${t} ---`); }

// Un `users` réaliste : tout le social ET tout l'interne, comme en base.
const USERS_COMPLET = {
  uid: 'uid-bassi', email: 'bassi@example.test',
  displayName: 'BASSI BASSI', photoURL: 'https://firebasestorage.googleapis.com/p0.jpg',
  photos: ['https://firebasestorage.googleapis.com/p1.jpg', 'https://firebasestorage.googleapis.com/p2.jpg'],
  bio: 'Coach afrobeat à Neuchâtel.', city: 'Neuchâtel', canton: 'NE',
  sports: [{ name: 'Afroboost', level: 'advanced', secretInterne: 'x' }, { name: 'Course', level: 'beginner' }],
  // — tout ce qui ne doit JAMAIS sortir —
  credits: 999, isPremium: true, role: 'admin', referralCode: 'AFR-XYZ', referredBy: 'q',
  commission: { creator: { mode: 'percent', value: 10 } }, fcmToken: 'FCM-SECRET-TOKEN',
  language: 'fr', activeSanctionId: 's1', activeSanctionLevel: 'ban_permanent',
  leakFlagged: true, pushNotificationsEnabled: false, isCreator: true, gender: 'male',
  birthDate: { seconds: 12345 }, createdAt: 'x', updatedAt: 'y', lastActive: 'z',
};

section('A — SEULS LES SEPT CHAMPS DU CONTRAT SORTENT');
const dto = versProfilSocial(USERS_COMPLET);
egal('A1 les clés du DTO sont exactement la liste blanche',
  Object.keys(dto).sort(), [...CHAMPS_SOCIAUX].sort());
vrai('A2 displayName', dto.displayName === 'BASSI BASSI');
vrai('A3 bio', dto.bio === 'Coach afrobeat à Neuchâtel.');
vrai('A4 ville / canton', dto.city === 'Neuchâtel' && dto.canton === 'NE');
egal('A5 photos (tableau prioritaire)', dto.photos, USERS_COMPLET.photos);
vrai('A6 photoURL', dto.photoURL === 'https://firebasestorage.googleapis.com/p0.jpg');
egal('A7 sports réduits à {name, level}', dto.sports,
  [{ name: 'Afroboost', level: 'advanced' }, { name: 'Course', level: 'beginner' }]);
faux('A8 aucune clé parasite dans un sport',
  JSON.stringify(dto.sports).includes('secretInterne'));

section('B — AUCUN CHAMP INTERNE NE TRAVERSE (I, J du GO)');
const brut = JSON.stringify(dto);
for (const champ of CHAMPS_INTERDITS) {
  faux(`B.${champ} absent du DTO`, Object.prototype.hasOwnProperty.call(dto, champ));
}
faux('B-token la valeur du fcmToken n\'apparaît nulle part', brut.includes('FCM-SECRET-TOKEN'));
faux('B-role la valeur du rôle n\'apparaît pas', brut.includes('admin'));
faux('B-referral le code de parrainage n\'apparaît pas', brut.includes('AFR-XYZ'));
faux('B-credits la valeur des crédits n\'apparaît pas', brut.includes('999'));

section('C — UN CHAMP SENSIBLE AJOUTÉ DEMAIN RESTE INVISIBLE (J du GO)');
const avecNouveauSecret = versProfilSocial({
  ...USERS_COMPLET, ibanBancaire: 'CH93-0076-...', nouveauChampSecret: 'valeur-2027',
});
faux('C1 un champ inconnu n\'apparaît pas', 'nouveauChampSecret' in avecNouveauSecret);
faux('C2 sa valeur non plus', JSON.stringify(avecNouveauSecret).includes('valeur-2027'));
faux('C3 un IBAN ajouté par erreur ne sort pas', JSON.stringify(avecNouveauSecret).includes('CH93'));

section('D — PROFIL PARTIEL OU VIDE : DTO SAIN (K, L du GO)');
const vide = versProfilSocial({});
egal('D1 tout vide → structure stable', vide,
  { displayName: '', photoURL: null, photos: [], bio: '', city: '', canton: '', sports: [] });
const sansPhotos = versProfilSocial({ displayName: 'X', photoURL: 'https://s/p.jpg' });
egal('D2 photoURL seul → photos = [photoURL]', sansPhotos.photos, ['https://s/p.jpg']);
const photosSales = versProfilSocial({ photos: ['ok', '', null, 42, '  ', 'ok2'] });
egal('D3 les entrées non-chaîne sont jetées', photosSales.photos, ['ok', 'ok2']);
egal('D4 sports non-tableau → []', versProfilSocial({ sports: 'afro' }).sports, []);

section('E — LES DEUX LISTES NE SE CHEVAUCHENT PAS');
const inter = CHAMPS_SOCIAUX.filter((c) => (CHAMPS_INTERDITS as readonly string[]).includes(c));
egal('E1 aucun champ à la fois social et interdit', inter, []);

// ─────────────────── LE JETON ───────────────────
const SECRET = 'secret-partage-de-test';
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function forger(charge: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const e = b64url(Buffer.from(JSON.stringify({ alg, typ: 'JWT' })));
  const c = b64url(Buffer.from(JSON.stringify(charge)));
  if (alg === 'none') return `${e}.${c}.`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${e}.${c}`).digest());
  return `${e}.${c}.${sig}`;
}
const dansUneHeure = Math.floor(Date.now() / 1000) + 3600;
const chargeValide = { email: 'bassi@example.test', aud: AUDIENCE_PROFIL, iss: EMETTEUR, exp: dansUneHeure };
const MAINTENANT = Date.now();

section('F — LE JETON VALIDE REND L\'E-MAIL (A du GO)');
egal('F1 jeton bien formé → e-mail', emailDepuisJetonProfil(forger(chargeValide), SECRET, MAINTENANT), 'bassi@example.test');
egal('F2 e-mail normalisé en minuscules',
  emailDepuisJetonProfil(forger({ ...chargeValide, email: 'BASSI@Example.Test' }), SECRET, MAINTENANT), 'bassi@example.test');

section('G — TOUT JETON DOUTEUX EST REFUSÉ (B, C, D du GO)');
egal('G1 signature avec un AUTRE secret → null', emailDepuisJetonProfil(forger(chargeValide, 'mauvais'), SECRET, MAINTENANT), null);
egal('G2 alg:"none" → null', emailDepuisJetonProfil(forger(chargeValide, SECRET, 'none'), SECRET, MAINTENANT), null);
egal('G3 audience du PONT (spordate) refusée ici', emailDepuisJetonProfil(forger({ ...chargeValide, aud: 'spordate' }), SECRET, MAINTENANT), null);
egal('G4 mauvais émetteur → null', emailDepuisJetonProfil(forger({ ...chargeValide, iss: 'autre' }), SECRET, MAINTENANT), null);
egal('G5 jeton expiré → null', emailDepuisJetonProfil(forger({ ...chargeValide, exp: Math.floor(Date.now() / 1000) - 10 }), SECRET, MAINTENANT), null);
egal('G6 sans exp → null', emailDepuisJetonProfil(forger({ email: 'x@y.z', aud: AUDIENCE_PROFIL, iss: EMETTEUR }), SECRET, MAINTENANT), null);
egal('G7 sans e-mail → null', emailDepuisJetonProfil(forger({ aud: AUDIENCE_PROFIL, iss: EMETTEUR, exp: dansUneHeure }), SECRET, MAINTENANT), null);
egal('G8 jeton vide → null', emailDepuisJetonProfil('', SECRET, MAINTENANT), null);
egal('G9 secret vide → null', emailDepuisJetonProfil(forger(chargeValide), '', MAINTENANT), null);
egal('G10 forme non-JWT → null', emailDepuisJetonProfil('pas.un.jwt', SECRET, MAINTENANT), null);

// ─────────────────── LA ROUTE, LUE DANS SA SOURCE ───────────────────
const ROUTE = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'api', 'bridge', 'unified-profile', 'route.ts'), 'utf8');
const JETON = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'bridge', 'jetonProfil.ts'), 'utf8');

section('H — LA ROUTE : AUCUNE ÉCRITURE, BRIDGE OBLIGATOIRE (F, G, H, N du GO)');
// Le bloc de LECTURE (POST) n'écrit jamais ; l'écriture est isolée dans PATCH
// (éprouvée en section L). On borne l'assertion au POST.
const POST_BLOC = ROUTE.slice(ROUTE.indexOf('export async function POST'), ROUTE.indexOf('export async function PATCH'));
faux('H1 la LECTURE (POST) n\'écrit jamais', /\.(set|update|delete|add)\s*\(/.test(POST_BLOC));
vrai('H2 elle vérifie le jeton avant toute lecture', ROUTE.indexOf('emailDepuisJetonProfil(jeton') < ROUTE.indexOf('COLLECTION_INDEX).doc'));
vrai('H3 l\'identité vient du jeton, pas du corps', /emailDepuisJetonProfil\(jeton, secret/.test(ROUTE));
faux('H4 l\'e-mail n\'est JAMAIS lu du corps de la requête', /corps\.(email|e_mail)/.test(ROUTE));
vrai('H5 le uid vient de l\'index bridge, jamais du client', /COLLECTION_INDEX\)\.doc\(emailKey\)/.test(ROUTE));
vrai('H6 sans liaison → lie:false (fermeture sûre)', /lie: false, motif: 'non_lie'/.test(ROUTE));
vrai('H7 users introuvable → lie:false, pas d\'erreur', /lie: false, motif: 'introuvable'/.test(ROUTE));
vrai('H8 la sortie passe TOUJOURS par la liste blanche', /versProfilSocial\(userDoc\)/.test(ROUTE));
faux('H9 le document users brut n\'est jamais renvoyé', /json\(\s*\{[^}]*userDoc[^}]*\}\s*\)/.test(ROUTE) || /NextResponse\.json\(userDoc/.test(ROUTE));

section('I — LES GARDES CRYPTO DU JETON SONT INTACTES');
vrai('I1 l\'algorithme est exigé (pas d\'alg:none)', /alg !== 'HS256'/.test(JETON));
vrai('I2 comparaison en temps constant', /timingSafeEqual/.test(JETON));
vrai('I3 audience et émetteur vérifiés', /charge\.aud !== AUDIENCE_PROFIL/.test(JETON) && /charge\.iss !== EMETTEUR/.test(JETON));
vrai('I4 l\'expiration est vérifiée', /exp \* 1000 <= maintenantMs/.test(JETON));


section('J — L\'ÉCRITURE : LISTE BLANCHE, PAS DE MASS-ASSIGNMENT (I, J, K, L, M, N du GO)');
// Un corps hostile : des vrais champs mêlés à tout ce qu'un attaquant tenterait.
const CORPS_HOSTILE = {
  bio: 'Nouvelle bio.', city: 'Genève',
  sports: [{ name: 'Tennis', level: 'advanced' }],
  // — tentatives d'écriture interdites —
  credits: 99999, role: 'admin', isPremium: true, fcmToken: 'VOL',
  uid: 'uid-de-la-victime', spordateUid: 'uid-de-la-victime', email: 'victime@x.y',
  activeSanctionId: null, leakFlagged: false, displayName: 'USURPÉ',
  canton: 'VD', photos: ['http://mechant/x.jpg'], photoURL: 'http://mechant/x.jpg',
};
const { patch, sansEffet } = versEcritureProfil(CORPS_HOSTILE);
egal('J1 seules les 3 clés modifiables ressortent', Object.keys(patch).sort(), ['bio', 'city', 'sports']);
for (const c of ['credits', 'role', 'isPremium', 'fcmToken', 'uid', 'spordateUid', 'email', 'displayName', 'photos', 'photoURL', 'activeSanctionId', 'leakFlagged', 'canton']) {
  faux(`J.${c} ne peut pas s'écrire`, Object.prototype.hasOwnProperty.call(patch, c));
}
vrai('J2 la bio valide passe', patch.bio === 'Nouvelle bio.');
vrai('J3 la ville valide passe', patch.city === 'Genève');
faux('J4 rien de sensible dans le patch', JSON.stringify(patch).includes('99999') || JSON.stringify(patch).includes('admin') || JSON.stringify(patch).includes('VOL'));

section('K — VALIDATION DES CHAMPS (mêmes règles que Spordateur)');
vrai('K1 bio coupée à 300', versEcritureProfil({ bio: 'x'.repeat(500) }).patch.bio!.length === BIO_MAX);
egal('K2 sport hors liste rejeté', versEcritureProfil({ sports: [{ name: 'Boxe illégale', level: 'x' }] }).patch.sports, []);
egal('K3 sport valide, niveau inconnu → beginner', versEcritureProfil({ sports: [{ name: 'Yoga', level: 'zzz' }] }).patch.sports, [{ name: 'Yoga', level: 'beginner' }]);
egal('K4 sport valide conservé', versEcritureProfil({ sports: [{ name: 'Running', level: 'intermediate' }] }).patch.sports, [{ name: 'Running', level: 'intermediate' }]);
vrai('K5 corps vide → sans effet', versEcritureProfil({}).sansEffet === true);
vrai('K6 corps sans champ modifiable → sans effet', versEcritureProfil({ credits: 5, role: 'admin' }).sansEffet === true);
egal('K7 CHAMPS_MODIFIABLES est exactement bio/city/sports', [...CHAMPS_MODIFIABLES].sort(), ['bio', 'city', 'sports']);

section('L — LA ROUTE PATCH : MÊMES GARDES + AUCUN uid CLIENT (C, D, E, F, G, H, O du GO)');
vrai('L1 PATCH vérifie le jeton avant toute écriture',
  ROUTE.indexOf('emailDepuisJetonProfil(jeton, secret, Date.now())', ROUTE.indexOf('export async function PATCH')) > 0);
vrai('L2 le uid vient de l\'index bridge, jamais du corps',
  /COLLECTION_INDEX\)\.doc\(emailKey\)/.test(ROUTE.slice(ROUTE.indexOf('export async function PATCH'))));
faux('L3 le corps ne fournit jamais le uid',
  /corps\.(uid|spordateUid)/.test(ROUTE));
vrai('L4 sans liaison → pas d\'écriture (fermeture sûre)',
  /if \(!uid\) \{[\s\S]{0,120}non_lie/.test(ROUTE.slice(ROUTE.indexOf('export async function PATCH'))));
vrai('L5 l\'écriture passe par le filtre, jamais le corps brut',
  /versEcritureProfil\(corps\.profil\)/.test(ROUTE));
faux('L6 aucun set/update du corps brut',
  /\.(set|update)\(\s*corps/.test(ROUTE));
vrai('L7 le merge n\'écrit que le patch validé + updatedAt',
  /\.set\(\s*\{ \.\.\.patch, updatedAt/.test(ROUTE));
vrai('L8 la réponse repasse par la liste blanche de lecture',
  (ROUTE.match(/versProfilSocial\(userDoc\)/g) || []).length >= 2);

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
