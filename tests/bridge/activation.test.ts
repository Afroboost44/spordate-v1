/**
 * F4 — LE JETON D'ACTIVATION : CONSENTEMENT SIGNÉ, OU RIEN.
 *
 * Exécution : npx tsx tests/bridge/activation.test.ts
 *
 * CE QUE ÇA PROUVE (§16)
 *   - jeton valide (aud spordate-activate, consent:true, e-mail, jti, non expiré)
 *     -> {email, jti} ;
 *   - consentement absent ou faux -> null (§16-B : pas d'activation sans consent) ;
 *   - mauvaise audience (spordate / spordate-profile / …) -> null ;
 *   - mauvais émetteur, expiré, alg:none, signature falsifiée, mauvais secret,
 *     e-mail ou jti absent -> null (l'e-mail est SIGNÉ : un client ne peut pas le
 *     forger, §16-G) ;
 *   - séparation d'audiences : un jeton d'accès (aud spordate) NE vaut PAS un
 *     jeton d'activation.
 */
import crypto from 'node:crypto';
import { activationDepuisJeton, AUDIENCE_ACTIVATION, EMETTEUR } from '../../src/lib/bridge/jetonActivation';

const SECRET = 'secret-activation-de-test';
const NOW = 1_800_000_000_000;

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signer(charge: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const e = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const c = b64url(JSON.stringify(charge));
  const s = crypto.createHmac('sha256', secret).update(`${e}.${c}`).digest();
  return `${e}.${c}.${b64url(s)}`;
}
const exp1h = Math.floor(NOW / 1000) + 3600;
const exp_1h = Math.floor(NOW / 1000) - 3600;

let _p = 0, _f = 0;
function ok(l: string, cond: boolean, d = '') { if (cond) { console.log('PASS  ' + l); _p++; } else { console.log('FAIL  ' + l + (d ? '  — ' + d : '')); _f++; } }

const base = { aud: AUDIENCE_ACTIVATION, iss: EMETTEUR, email: 'a@b.c', consent: true, jti: 'J1', exp: exp1h };

// valide
const r = activationDepuisJeton(signer(base), SECRET, NOW);
ok('valide -> {email, jti}', !!r && r.email === 'a@b.c' && r.jti === 'J1', JSON.stringify(r));
ok('valide -> e-mail normalisé minuscules', activationDepuisJeton(signer({ ...base, email: 'A@B.C' }), SECRET, NOW)?.email === 'a@b.c');

// consentement
ok('consent absent -> null', activationDepuisJeton(signer({ aud: AUDIENCE_ACTIVATION, iss: EMETTEUR, email: 'a@b.c', jti: 'J', exp: exp1h }), SECRET, NOW) === null);
ok('consent:false -> null', activationDepuisJeton(signer({ ...base, consent: false }), SECRET, NOW) === null);
ok('consent:"true" (string) -> null', activationDepuisJeton(signer({ ...base, consent: 'true' }), SECRET, NOW) === null);

// audience
ok('aud spordate (accès) -> null', activationDepuisJeton(signer({ ...base, aud: 'spordate' }), SECRET, NOW) === null);
ok('aud spordate-profile -> null', activationDepuisJeton(signer({ ...base, aud: 'spordate-profile' }), SECRET, NOW) === null);
ok('aud spordate-link-resolve -> null', activationDepuisJeton(signer({ ...base, aud: 'spordate-link-resolve' }), SECRET, NOW) === null);

// émetteur / expiration / intégrité
ok('mauvais émetteur -> null', activationDepuisJeton(signer({ ...base, iss: 'evil' }), SECRET, NOW) === null);
ok('expiré -> null', activationDepuisJeton(signer({ ...base, exp: exp_1h }), SECRET, NOW) === null);
ok('sans exp -> null', activationDepuisJeton(signer({ aud: AUDIENCE_ACTIVATION, iss: EMETTEUR, email: 'a@b.c', consent: true, jti: 'J' }), SECRET, NOW) === null);
ok('alg none -> null', activationDepuisJeton(signer(base, SECRET, 'none'), SECRET, NOW) === null);
ok('mauvais secret -> null', activationDepuisJeton(signer(base, 'autre'), SECRET, NOW) === null);
ok('e-mail absent -> null', activationDepuisJeton(signer({ aud: AUDIENCE_ACTIVATION, iss: EMETTEUR, consent: true, jti: 'J', exp: exp1h }), SECRET, NOW) === null);
ok('jti absent -> null', activationDepuisJeton(signer({ aud: AUDIENCE_ACTIVATION, iss: EMETTEUR, email: 'a@b.c', consent: true, exp: exp1h }), SECRET, NOW) === null);
ok('vide -> null', activationDepuisJeton('', SECRET, NOW) === null);

// signature falsifiée
const v = signer(base);
const [e1, c1] = v.split('.');
ok('signature bidon -> null', activationDepuisJeton(`${e1}.${c1}.${b64url('bidon')}`, SECRET, NOW) === null);
ok('charge modifiée (consent ajouté après coup) -> null',
   activationDepuisJeton(`${e1}.${b64url(JSON.stringify({ ...base, email: 'autre@x.c' }))}.${v.split('.')[2]}`, SECRET, NOW) === null);

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
