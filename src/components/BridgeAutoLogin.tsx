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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OÙ ATTERRIT-ON ? (SPORDATE_DIRECT_DISCOVERY)
 * ─────────────────────────────────────────────────────────────────────────
 * Jusqu'ici : NULLE PART. Ce composant ouvrait la session et rendait `null` —
 * le membre restait donc sur la page où il était arrivé, c'est-à-dire la
 * LANDING. Il devait ensuite cliquer « Rejoindre », traverser /activities, et
 * enfin trouver les Rencontres. Quatre écrans pour une promesse d'un clic.
 *
 * `signInWithCustomToken` ne passe NI par `login`, NI par `signup`, NI par
 * `loginWithGoogle` : les `router.push('/activities')` de `AuthContext` ne le
 * concernent pas. Il n'existait donc aucune destination pour ce chemin — ce
 * n'est pas une redirection à corriger, c'est une destination à écrire.
 *
 * DESTINATION : `/discovery`. L'accès n'y demande RIEN d'autre qu'une session
 * (`AuthGuard`) : `onboardingComplete` filtre les profils AFFICHÉS, pas
 * l'entrée. Un membre sans profil voit donc les cartes immédiatement, et
 * complétera le sien quand il le voudra. C'est le minimum demandé, et l'audit
 * confirme qu'aucun champ n'est obligatoire pour arriver là.
 *
 * DERRIÈRE UN DRAPEAU : `NEXT_PUBLIC_SPORDATE_DIRECT_DISCOVERY`. Absent ou
 * « false » -> comportement d'AVANT, au caractère près : la session s'ouvre et
 * rien ne bouge. Le lot est donc INACTIF à la livraison, et s'active en posant
 * la variable.
 *
 * ⚠️ CE DRAPEAU EST LU AU BUILD, PAS À L'EXÉCUTION. `NEXT_PUBLIC_*` est inliné
 * par Next.js dans le bundle : le changer exige un REDÉPLOIEMENT (~4 min), il
 * ne se bascule pas à chaud comme un drapeau Mongo côté afroboost. Le dire
 * autrement serait mentir sur le coût du rollback. Deux voies de retour, donc :
 * remettre la variable à « false » et redéployer, ou `git revert` de ce commit
 * — dans les deux cas, aucune donnée n'est touchée et rien n'est à migrer.
 *
 * CE QUE CE LOT NE TOUCHE PAS : la signature du jeton, l'anti-rejeu, la
 * recherche ou la création du compte, les rôles, les profils, les crédits.
 * Une seule chose change : où l'on arrive.
 */
import { useEffect } from 'react';
import { destinationApresPont, drapeauActif } from '@/lib/bridge/destination';

/** La destination, décidée par une fonction PURE et éprouvée à part. */
const DESTINATION = destinationApresPont({
  directDiscovery: drapeauActif(process.env.NEXT_PUBLIC_SPORDATE_DIRECT_DISCOVERY),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
});

/** Lève le voile posé par le script inline du `layout`. Idempotent. */
function leverLeVoile() {
  try {
    document.documentElement.removeAttribute('data-pont-afroboost');
  } catch {
    /* document indisponible : rien à lever */
  }
}

export default function BridgeAutoLogin() {
  useEffect(() => {
    let annule = false;

    const params = new URLSearchParams(window.location.search);
    const jeton = params.get('t');
    // Le script inline masque dès qu'il voit un `t=` dans l'URL. Si ce `t`
    // n'est pas le nôtre, personne ne lèverait le voile : on le fait ici.
    if (!jeton) { leverLeVoile(); return; }

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
        if (!r.ok || annule) { leverLeVoile(); return; }

        const { token } = await r.json();
        if (!token || annule) { leverLeVoile(); return; }

        const [{ signInWithCustomToken }, { auth }] = await Promise.all([
          import('firebase/auth'),
          import('@/lib/firebase'),
        ]);
        if (!auth || annule) { leverLeVoile(); return; }
        await signInWithCustomToken(auth, token);
        // Session ouverte mais drapeau fermé : on reste ici, donc on montre.
        if (annule || !DESTINATION) { leverLeVoile(); return; }
        // `replace` et non `push` : la landing ne doit pas rester dans
        // l'historique, sinon le « retour » du navigateur y ramène le membre
        // et lui redemande de « Rejoindre » alors qu'il est déjà connecté.
        //
        // `window.location` et non le routeur Next : la session vient d'être
        // écrite par Firebase, et une navigation cliente ferait rendre
        // `/discovery` avant que `onAuthStateChanged` n'ait propagé l'état —
        // `AuthGuard` renverrait alors vers le login. Un vrai chargement de
        // page repart d'un état propre.
        // Le voile reste posé JUSQU'AU BOUT : le lever avant la navigation
        // ferait apparaître la landing pendant la fraction de seconde qui
        // sépare l'ordre de redirection du chargement de la page suivante —
        // c'est-à-dire exactement le flash qu'on corrige.
        window.location.replace(DESTINATION);
      } catch {
        /* silencieux : le login normal de Spordate prend le relais */
        leverLeVoile();
      }
    })();

    return () => { annule = true; };
  }, []);

  return null;
}
