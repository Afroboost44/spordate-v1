'use client';

/**
 * Pont « une seule clé » — connexion automatique à l'arrivée. V387
 *
 * Un membre connecté sur afroboost.com clique « Spordateur » ; afroboost émet un
 * jeton court et redirige vers /rencontre?t=… Ce composant l'échange contre une
 * session Firebase, sans que le membre ait à saisir quoi que ce soit.
 *
 * LE JETON EST RETIRÉ DE L'URL IMMÉDIATEMENT, avant même l'appel réseau : il
 * transite par la barre d'adresse, donc il finirait sinon dans l'historique du
 * navigateur, dans les favoris et dans l'en-tête Referer des ressources tierces.
 * Un échange raté ne le remet pas : le jeton est à usage unique de toute façon.
 *
 * ÉCHEC = PARCOURS NORMAL. Jeton expiré, déjà utilisé, ou pont non configuré :
 * on ne fait rien de plus et Spordate affiche son login habituel. Un accès
 * direct à /rencontre sans jeton n'est jamais perturbé — ce composant sort
 * immédiatement s'il n'y a pas de `?t=`.
 *
 * L'onboarding n'est PAS géré ici : `AuthContext` route déjà tout compte
 * fraîchement créé vers /onboard/prompts. Un membre venu d'afroboost, dont le
 * compte Firebase vient d'être créé, y arrive donc naturellement.
 */
import { useEffect } from 'react';

export default function BridgeAutoLogin() {
  useEffect(() => {
    let annule = false;

    const params = new URLSearchParams(window.location.search);
    const jeton = params.get('t');
    if (!jeton) return;

    // Nettoyage de l'URL AVANT tout appel réseau.
    try {
      const propre = new URL(window.location.href);
      propre.searchParams.delete('t');
      window.history.replaceState({}, '', propre.pathname + propre.search + propre.hash);
    } catch {
      /* si l'URL est exotique, on continue quand même l'échange */
    }

    (async () => {
      try {
        // `/api/...` est réécrit en `/rencontre/api/...` par ApiBasePathPatch.
        const r = await fetch('/api/bridge/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: jeton }),
        });
        if (!r.ok || annule) return;

        const { token } = await r.json();
        if (!token || annule) return;

        const [{ signInWithCustomToken }, { auth }] = await Promise.all([
          import('firebase/auth'),
          import('@/lib/firebase'),
        ]);
        if (auth && !annule) await signInWithCustomToken(auth, token);
      } catch {
        /* silencieux : le login normal de Spordate prend le relais */
      }
    })();

    return () => { annule = true; };
  }, []);

  return null;
}
