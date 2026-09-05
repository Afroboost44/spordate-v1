/**
 * LOT R2 — LE SEUL CHEMIN PAR LEQUEL LES OFFRES AFROBOOST ENTRENT.
 *
 * LECTURE SEULE. Aucune écriture Firestore, aucune activité créée, aucun boost,
 * aucune réservation, aucun paiement. Cette route lit et normalise, rien de plus.
 *
 * POURQUOI SERVEUR-À-SERVEUR ET NON UN APPEL DEPUIS LE NAVIGATEUR.
 * Deux raisons, et la seconde est la vraie. D'abord le CORS d'Afroboost
 * n'autorise aujourd'hui aucun domaine Rencontres. Ensuite — et surtout —
 * `GET /api/offers` renvoie `coach_id`, qui EST l'adresse e-mail du coach :
 * laisser le navigateur appeler Afroboost directement, ce serait publier ces
 * e-mails dans l'onglet réseau de chaque visiteur. Passer par le serveur nous
 * donne le seul endroit où l'on peut les retirer AVANT de servir.
 *
 * AUCUNE UI. Rien de ce module n'est encore branché sur « Où pratiquer ? » ni
 * sur la pile de profils. R1 reste strictement intact.
 */
import { NextResponse } from 'next/server';
import { adapterOffres, repli, type LectureOffres } from '@/lib/afroboost/offers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** L'origine d'Afroboost. Réglable par l'environnement pour pouvoir viser un
 *  environnement de test sans toucher au code. */
const ORIGINE = (process.env.AFROBOOST_API_ORIGIN || 'https://afroboost.com').replace(/\/+$/, '');

/** 2,5 s. Au-delà, la découverte n'attend pas : Rencontres doit rester
 *  utilisable même quand Afroboost est lent ou absent. */
const DELAI_MAX_MS = 2500;

/** 5 minutes. Un catalogue d'offres ne change pas à la seconde, et sans cache
 *  chaque rendu déclencherait un appel sortant. */
const DUREE_CACHE_MS = 5 * 60 * 1000;

/**
 * LE CACHE VIT DANS LE PROCESSUS, ET C'EST SUFFISANT ICI.
 * Pas de Redis, pas de collection miroir : dupliquer les offres dans Firestore
 * créerait une seconde vérité qui divergerait au premier changement de prix.
 * Un cache mémoire se vide au redémarrage — ce qui coûte un appel, pas une
 * incohérence.
 */
let cache: { a: number; valeur: LectureOffres } | null = null;

/** Exposé pour les bancs : un test ne doit pas hériter du cache du précédent. */
export function _viderCache(): void {
  cache = null;
}

export async function lireOffres(maintenant: number = Date.now()): Promise<LectureOffres & { cache: boolean }> {
  if (cache && maintenant - cache.a < DUREE_CACHE_MS) {
    return { ...cache.valeur, cache: true };
  }

  const stop = new AbortController();
  const minuteur = setTimeout(() => stop.abort(), DELAI_MAX_MS);
  let lecture: LectureOffres;
  try {
    const reponse = await fetch(`${ORIGINE}/api/offers`, {
      signal: stop.signal,
      headers: { accept: 'application/json' },
      // On ne veut pas du cache HTTP de Next : la fraîcheur est gérée ici,
      // en un seul endroit, avec une durée qu'on peut lire et tester.
      cache: 'no-store',
    });
    if (!reponse.ok) {
      lecture = repli(`afroboost a repondu ${reponse.status}`);
    } else {
      // UN JSON ILLISIBLE EST UN REPLI, PAS UNE EXCEPTION. Et la décision se
      // prend en UNE fois : une première version posait le repli puis le
      // réécrasait à la ligne suivante — un verdict juste, perdu par une
      // condition de trop.
      let charge: unknown;
      let lisible = true;
      try {
        charge = await reponse.json();
      } catch {
        lisible = false;
      }
      lecture = lisible ? adapterOffres(charge) : repli('reponse illisible');
    }
  } catch (e) {
    const nom = (e as { name?: string } | null)?.name;
    lecture = repli(nom === 'AbortError' ? 'delai depasse' : 'afroboost injoignable');
  } finally {
    clearTimeout(minuteur);
  }

  // ON NE MET EN CACHE QUE CE QUI A ABOUTI. Garder un repli 5 minutes ferait
  // durer une panne d'une seconde bien après qu'elle soit finie.
  if (lecture.etat === 'ok') cache = { a: maintenant, valeur: lecture };
  return { ...lecture, cache: false };
}

export async function GET() {
  const lecture = await lireOffres();
  // `no-store` côté client : la fraîcheur est décidée ici, pas par un
  // intermédiaire qui pourrait servir un catalogue d'hier sans le dire.
  return NextResponse.json(
    { offres: lecture.offres, etat: lecture.etat, motif: lecture.motif, cache: lecture.cache },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
