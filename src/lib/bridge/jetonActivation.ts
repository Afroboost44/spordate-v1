/**
 * F4 — LE JETON D'ACTIVATION VOLONTAIRE DU PROFIL SOCIAL.
 *
 * Le pont d'ACCÈS (`aud:"spordate"`) ouvre une session. Le pont de PROFIL
 * (`aud:"spordate-profile"`) lit un profil. Ni l'un ni l'autre ne doit pouvoir
 * CRÉER un compte ni écrire une liaison sur simple entrée — c'est précisément
 * ce que F4 corrige.
 *
 * Ce jeton-ci, `aud:"spordate-activate"`, atteste DEUX choses qu'afroboost seul
 * peut affirmer : « voici QUI (e-mail signé) » et « cette personne a CONSENTI
 * explicitement à activer son profil social ». Sans ce jeton — donc sans
 * consentement — aucune création ni liaison n'a lieu. Une audience = une porte.
 *
 * `consent:true` est EXIGÉ dans la charge : un jeton d'activation sans preuve de
 * consentement est refusé, comme s'il était invalide. Le doute ferme la porte.
 *
 * HS256 recopié (comme jetonProfil / jetonResolution) pour ne pas toucher la
 * porte du pont ; un test de source vérifie les deux gardes essentielles.
 */
import crypto from 'node:crypto';

export const AUDIENCE_ACTIVATION = 'spordate-activate';
export const EMETTEUR = 'afroboost';

export type ChargeActivation = {
  email?: string;
  consent?: boolean;
  jti?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
};

function depuisB64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function verifierHs256(jeton: string, secret: string): ChargeActivation | null {
  const parties = jeton.split('.');
  if (parties.length !== 3) return null;
  const [entete, charge, signature] = parties;
  let alg = '';
  try {
    alg = JSON.parse(depuisB64Url(entete).toString('utf8'))?.alg;
  } catch {
    return null;
  }
  if (alg !== 'HS256') return null; // `alg:"none"` doit échouer
  const attendue = crypto.createHmac('sha256', secret).update(`${entete}.${charge}`).digest();
  const recue = depuisB64Url(signature);
  if (attendue.length !== recue.length) return null;
  if (!crypto.timingSafeEqual(attendue, recue)) return null; // temps constant
  try {
    return JSON.parse(depuisB64Url(charge).toString('utf8')) as ChargeActivation;
  } catch {
    return null;
  }
}

/**
 * L'e-mail CONSENTANT porté par un jeton d'activation, ou null si quoi que ce
 * soit cloche : signature, audience, émetteur, expiration, e-mail absent, OU
 * consentement absent/faux. `null` = porte fermée, aucune création ni liaison.
 * `jti` est renvoyé à part pour l'anti-rejeu (il n'a de sens que si le reste est
 * valide). `maintenantMs` injecté pour tester l'expiration sans horloge réelle.
 */
export function activationDepuisJeton(
  jeton: string,
  secret: string,
  maintenantMs: number,
): { email: string; jti: string } | null {
  if (!jeton || !secret) return null;
  const charge = verifierHs256(jeton, secret);
  if (!charge) return null;
  if (charge.aud !== AUDIENCE_ACTIVATION) return null;
  if (charge.iss !== EMETTEUR) return null;
  if (charge.consent !== true) return null; // pas de consentement -> pas d'activation
  const exp = typeof charge.exp === 'number' ? charge.exp : 0;
  if (!exp || exp * 1000 <= maintenantMs) return null;
  const email = (charge.email || '').trim().toLowerCase();
  const jti = (charge.jti || '').trim();
  if (!email || !jti) return null;
  return { email, jti };
}
