/**
 * F3 FINAL — LES DEUX JETONS DU PROFIL SOCIAL DES AUTRES COMPTES LIÉS.
 *
 * Problème résolu : afroboost veut, pour un utilisateur qu'il affiche DÉJÀ
 * légitimement, savoir s'il est lié à Spordateur et pouvoir ouvrir son profil —
 * SANS jamais exposer au navigateur « qui est inscrit sur l'app de rencontre »,
 * et SANS API interrogeable par e-mail. La correspondance e-mail → uid vit ici
 * (`bridge_identity_index`) : c'est donc ICI qu'on la lit, pour le SERVEUR
 * afroboost uniquement, jamais pour un navigateur.
 *
 * DEUX AUDIENCES DISTINCTES, chacune pour une chose et une seule :
 *   - `spordate-link-resolve` : prouve « c'est le SERVEUR afroboost qui
 *     demande », pour la route batch e-mails → liés. Ne porte PAS d'e-mail :
 *     les e-mails voyagent dans le corps, le jeton n'authentifie que l'appelant.
 *   - `spordate-profile-view` : capacité OPAQUE de navigation vers UN profil.
 *     Émis par afroboost, il porte le `uid` cible et une expiration courte. Le
 *     navigateur le reçoit à la place du uid en clair et ne peut ni le forger
 *     ni énumérer : la garde `/u/[jeton]` le vérifie avant d'ouvrir le profil.
 *
 * Ni l'une ni l'autre ne se confond avec `spordate` (ouvre une session) ou
 * `spordate-profile` (lit un profil) : une audience = une porte.
 *
 * La crypto HS256 est RECOPIÉE (comme dans jetonProfil.ts) pour ne pas toucher
 * la porte du pont ; un test de source vérifie les deux gardes essentielles.
 */
import crypto from 'node:crypto';

export const AUDIENCE_RESOLUTION = 'spordate-link-resolve';
export const AUDIENCE_VUE_PROFIL = 'spordate-profile-view';
export const EMETTEUR = 'afroboost';

type Charge = {
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  uid?: string;
};

function depuisB64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Vérifie la signature HS256 et renvoie la charge, ou null. Copie fidèle. */
function verifierHs256(jeton: string, secret: string): Charge | null {
  const parties = jeton.split('.');
  if (parties.length !== 3) return null;
  const [entete, charge, signature] = parties;
  let alg = '';
  try {
    alg = JSON.parse(depuisB64Url(entete).toString('utf8'))?.alg;
  } catch {
    return null;
  }
  // L'algorithme est EXIGÉ : `"alg":"none"` doit échouer.
  if (alg !== 'HS256') return null;
  const attendue = crypto.createHmac('sha256', secret).update(`${entete}.${charge}`).digest();
  const recue = depuisB64Url(signature);
  if (attendue.length !== recue.length) return null;
  // Comparaison en TEMPS CONSTANT.
  if (!crypto.timingSafeEqual(attendue, recue)) return null;
  try {
    return JSON.parse(depuisB64Url(charge).toString('utf8')) as Charge;
  } catch {
    return null;
  }
}

/**
 * Vrai si le jeton prouve que le SERVEUR afroboost demande une résolution de
 * liens (audience dédiée, bon émetteur, non expiré). Rien d'autre : ce jeton
 * n'ouvre aucune session et ne lit aucun profil.
 */
export function serveurAfroboostAutorise(
  jeton: string,
  secret: string,
  maintenantMs: number,
): boolean {
  if (!jeton || !secret) return false;
  const charge = verifierHs256(jeton, secret);
  if (!charge) return false;
  if (charge.aud !== AUDIENCE_RESOLUTION) return false;
  if (charge.iss !== EMETTEUR) return false;
  const exp = typeof charge.exp === 'number' ? charge.exp : 0;
  return !!exp && exp * 1000 > maintenantMs;
}

/**
 * Le `uid` porté par un jeton de VUE opaque, ou null si quoi que ce soit cloche
 * (signature, audience, émetteur, expiration, uid absent). `null` = porte
 * fermée. C'est la seule façon d'obtenir le uid d'un jeton `/u/[jeton]`.
 */
export function uidDepuisJetonVue(
  jeton: string,
  secret: string,
  maintenantMs: number,
): string | null {
  if (!jeton || !secret) return null;
  const charge = verifierHs256(jeton, secret);
  if (!charge) return null;
  if (charge.aud !== AUDIENCE_VUE_PROFIL) return null;
  if (charge.iss !== EMETTEUR) return null;
  const exp = typeof charge.exp === 'number' ? charge.exp : 0;
  if (!exp || exp * 1000 <= maintenantMs) return null;
  const uid = (charge.uid || '').trim();
  return uid || null;
}
