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
faux('H1 la route n\'écrit jamais (aucun set/update/delete/add)', /\.(set|update|delete|add)\s*\(/.test(ROUTE));
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

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
