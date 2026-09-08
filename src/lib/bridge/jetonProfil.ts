/**
 * F2 — LE JETON QUI PROUVE « afroboost a authentifié cette personne ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN JETON, ET PAS UN E-MAIL DANS LE CORPS
 * ─────────────────────────────────────────────────────────────────────────
 * La route de profil unifié résout un e-mail → un `uid` Spordateur → un profil.
 * Si l'e-mail arrivait en clair dans le corps de la requête, n'importe qui
 * pourrait lire le profil de n'importe qui en changeant une chaîne. L'e-mail
 * doit donc arriver DANS un jeton signé qu'afroboost seul peut produire :
 * c'est la signature HS256, avec le secret partagé `AFRO_SPORDATE_SHARED_SECRET`,
 * qui atteste « c'est bien afroboost qui a authentifié cette personne, et voici
 * qui ». Le même mécanisme que le pont d'accès — même secret, même algorithme.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE AUDIENCE DISTINCTE : `spordate-profile`, JAMAIS `spordate`
 * ─────────────────────────────────────────────────────────────────────────
 * Le pont d'accès émet `aud:"spordate"` : ce jeton-là OUVRE UNE SESSION
 * Firebase (il crée un `customToken`). Un jeton de LECTURE de profil ne doit
 * jamais pouvoir faire ça, et réciproquement. On leur donne donc des audiences
 * DIFFÉRENTES, et chaque route n'accepte que la sienne. Sans cette séparation,
 * un jeton volé sur un canal servirait sur l'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER DUPLIQUE `verifierHs256` DU PONT
 * ─────────────────────────────────────────────────────────────────────────
 * `bridge/verify/route.ts` porte sa propre `verifierHs256`. La partager
 * imposerait de modifier cette route — la porte d'entrée du pont, celle qu'on
 * ne veut surtout pas régresser. On recopie donc les ~20 lignes de crypto ici,
 * à l'identique, et un test de source vérifie que les deux gardes essentielles
 * y sont : l'algorithme EXIGÉ (sinon `alg:"none"` passe) et la comparaison en
 * temps constant (sinon la signature fuit octet par octet).
 */
import crypto from 'node:crypto';

export const AUDIENCE_PROFIL = 'spordate-profile';
export const EMETTEUR = 'afroboost';

export type ChargeProfil = {
  email?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
};

function depuisB64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Vérifie la signature HS256 et renvoie la charge, ou null. Copie fidèle de
 *  celle du pont — voir l'en-tête pour le pourquoi. */
function verifierHs256(jeton: string, secret: string): ChargeProfil | null {
  const parties = jeton.split('.');
  if (parties.length !== 3) return null;
  const [entete, charge, signature] = parties;
  let alg = '';
  try {
    alg = JSON.parse(depuisB64Url(entete).toString('utf8'))?.alg;
  } catch {
    return null;
  }
  // L'algorithme est EXIGÉ : un jeton forgé avec `"alg":"none"` doit échouer.
  if (alg !== 'HS256') return null;
  const attendue = crypto.createHmac('sha256', secret).update(`${entete}.${charge}`).digest();
  const recue = depuisB64Url(signature);
  if (attendue.length !== recue.length) return null;
  // Comparaison en TEMPS CONSTANT : une comparaison naïve fuirait le secret.
  if (!crypto.timingSafeEqual(attendue, recue)) return null;
  try {
    return JSON.parse(depuisB64Url(charge).toString('utf8')) as ChargeProfil;
  } catch {
    return null;
  }
}

/**
 * L'E-MAIL AUTHENTIFIÉ porté par le jeton, ou null si QUOI QUE CE SOIT cloche :
 * signature invalide, mauvaise audience, mauvais émetteur, jeton expiré, e-mail
 * absent. `null` est le seul retour d'échec — l'appelant ne peut pas confondre
 * « jeton valide sans e-mail » et « jeton invalide ». Le doute ferme la porte.
 *
 * `maintenantMs` est injecté pour que le test de l'expiration ne dépende pas de
 * l'horloge réelle.
 */
export function emailDepuisJetonProfil(
  jeton: string,
  secret: string,
  maintenantMs: number,
): string | null {
  if (!jeton || !secret) return null;
  const charge = verifierHs256(jeton, secret);
  if (!charge) return null;
  if (charge.aud !== AUDIENCE_PROFIL) return null;
  if (charge.iss !== EMETTEUR) return null;
  const exp = typeof charge.exp === 'number' ? charge.exp : 0;
  if (!exp || exp * 1000 <= maintenantMs) return null;
  const email = (charge.email || '').trim().toLowerCase();
  return email || null;
}
