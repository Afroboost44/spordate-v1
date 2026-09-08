/**
 * F3 FINAL — LES DEUX JETONS DE LA RÉSOLUTION DE LIENS.
 *
 * Exécution : npx tsx tests/bridge/resolution-liens.test.ts
 *
 * CE QUE ÇA PROUVE
 *   serveurAfroboostAutorise (jeton serveur-à-serveur `spordate-link-resolve`) :
 *     - jeton valide -> vrai ; mauvaise audience (spordate / spordate-profile /
 *       spordate-profile-view) -> faux ; mauvais émetteur -> faux ; expiré ->
 *       faux ; alg:none -> faux ; signature falsifiée -> faux ; mauvais secret
 *       -> faux.
 *   uidDepuisJetonVue (jeton de vue opaque `spordate-profile-view`) :
 *     - jeton valide -> uid ; mauvaise audience -> null ; expiré -> null ;
 *       uid absent -> null ; forgé -> null.
 *   Séparation des audiences : un jeton de résolution NE VAUT PAS un jeton de
 *   vue, et réciproquement. Une audience = une porte.
 */
import crypto from 'node:crypto';
import {
  serveurAfroboostAutorise, uidDepuisJetonVue,
  AUDIENCE_RESOLUTION, AUDIENCE_VUE_PROFIL, EMETTEUR,
} from '../../src/lib/bridge/jetonResolution';

const SECRET = 'secret-partage-de-test';
const MAINTENANT = 1_800_000_000_000; // ms fixes

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signer(charge: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const entete = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const corps = b64url(JSON.stringify(charge));
  const sig = crypto.createHmac('sha256', secret).update(`${entete}.${corps}`).digest();
  return `${entete}.${corps}.${b64url(sig)}`;
}
const dansUneHeure = Math.floor(MAINTENANT / 1000) + 3600;
const ilYaUneHeure = Math.floor(MAINTENANT / 1000) - 3600;

let _p = 0, _f = 0;
function verifier(libelle: string, cond: boolean, detail = '') {
  if (cond) { console.log('PASS  ' + libelle); _p++; }
  else { console.log('FAIL  ' + libelle + (detail ? '  — ' + detail : '')); _f++; }
}

// ── 1. JETON SERVEUR (résolution) ──────────────────────────────────────────
const jetonResoValide = signer({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR, exp: dansUneHeure });
verifier('résolution: jeton valide -> vrai', serveurAfroboostAutorise(jetonResoValide, SECRET, MAINTENANT) === true);
verifier('résolution: aud spordate -> faux',
  serveurAfroboostAutorise(signer({ aud: 'spordate', iss: EMETTEUR, exp: dansUneHeure }), SECRET, MAINTENANT) === false);
verifier('résolution: aud spordate-profile -> faux',
  serveurAfroboostAutorise(signer({ aud: 'spordate-profile', iss: EMETTEUR, exp: dansUneHeure }), SECRET, MAINTENANT) === false);
verifier('résolution: aud spordate-profile-view -> faux',
  serveurAfroboostAutorise(signer({ aud: AUDIENCE_VUE_PROFIL, iss: EMETTEUR, exp: dansUneHeure }), SECRET, MAINTENANT) === false);
verifier('résolution: mauvais émetteur -> faux',
  serveurAfroboostAutorise(signer({ aud: AUDIENCE_RESOLUTION, iss: 'evil', exp: dansUneHeure }), SECRET, MAINTENANT) === false);
verifier('résolution: expiré -> faux',
  serveurAfroboostAutorise(signer({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR, exp: ilYaUneHeure }), SECRET, MAINTENANT) === false);
verifier('résolution: sans exp -> faux',
  serveurAfroboostAutorise(signer({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR }), SECRET, MAINTENANT) === false);
verifier('résolution: alg none -> faux',
  serveurAfroboostAutorise(signer({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR, exp: dansUneHeure }, SECRET, 'none'), SECRET, MAINTENANT) === false);
verifier('résolution: mauvais secret -> faux',
  serveurAfroboostAutorise(signer({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR, exp: dansUneHeure }, 'autre'), SECRET, MAINTENANT) === false);
// signature falsifiée (on remplace la 3e partie)
const [e1, c1] = jetonResoValide.split('.');
verifier('résolution: signature bidon -> faux',
  serveurAfroboostAutorise(`${e1}.${c1}.${b64url('bidon')}`, SECRET, MAINTENANT) === false);
verifier('résolution: charge modifiée -> faux',
  serveurAfroboostAutorise(`${e1}.${b64url(JSON.stringify({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR, exp: dansUneHeure, x: 1 }))}.${jetonResoValide.split('.')[2]}`, SECRET, MAINTENANT) === false);
verifier('résolution: vide -> faux', serveurAfroboostAutorise('', SECRET, MAINTENANT) === false);

// ── 2. JETON DE VUE (opaque) ───────────────────────────────────────────────
const jetonVueValide = signer({ aud: AUDIENCE_VUE_PROFIL, iss: EMETTEUR, uid: 'UID123', exp: dansUneHeure });
verifier('vue: jeton valide -> uid', uidDepuisJetonVue(jetonVueValide, SECRET, MAINTENANT) === 'UID123');
verifier('vue: aud résolution -> null',
  uidDepuisJetonVue(signer({ aud: AUDIENCE_RESOLUTION, iss: EMETTEUR, uid: 'UID123', exp: dansUneHeure }), SECRET, MAINTENANT) === null);
verifier('vue: aud spordate -> null',
  uidDepuisJetonVue(signer({ aud: 'spordate', iss: EMETTEUR, uid: 'UID123', exp: dansUneHeure }), SECRET, MAINTENANT) === null);
verifier('vue: expiré -> null',
  uidDepuisJetonVue(signer({ aud: AUDIENCE_VUE_PROFIL, iss: EMETTEUR, uid: 'UID123', exp: ilYaUneHeure }), SECRET, MAINTENANT) === null);
verifier('vue: uid absent -> null',
  uidDepuisJetonVue(signer({ aud: AUDIENCE_VUE_PROFIL, iss: EMETTEUR, exp: dansUneHeure }), SECRET, MAINTENANT) === null);
verifier('vue: mauvais émetteur -> null',
  uidDepuisJetonVue(signer({ aud: AUDIENCE_VUE_PROFIL, iss: 'evil', uid: 'UID123', exp: dansUneHeure }), SECRET, MAINTENANT) === null);
verifier('vue: mauvais secret -> null',
  uidDepuisJetonVue(signer({ aud: AUDIENCE_VUE_PROFIL, iss: EMETTEUR, uid: 'UID123', exp: dansUneHeure }, 'autre'), SECRET, MAINTENANT) === null);
verifier('vue: alg none -> null',
  uidDepuisJetonVue(signer({ aud: AUDIENCE_VUE_PROFIL, iss: EMETTEUR, uid: 'UID123', exp: dansUneHeure }, SECRET, 'none'), SECRET, MAINTENANT) === null);

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
