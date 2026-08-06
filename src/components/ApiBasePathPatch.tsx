'use client';

/**
 * Préfixe les appels d'API par le basePath, quand il y en a un.
 *
 * POURQUOI. Spordate est servi à deux endroits : à la racine sur spordateur.com,
 * et sous /rencontre sur afroboost.com. `basePath` de Next.js préfixe les liens,
 * les assets et le routeur — mais PAS un `fetch('/api/…')` écrit en dur. Or le
 * code en compte 65. Sous /rencontre, ces requêtes partiraient donc vers
 * afroboost.com/api/… : mesuré, 8 familles de routes entrent en collision avec
 * de vraies routes d'afroboost (/api/users, /api/credits, /api/admin,
 * /api/checkout, /api/chat, /api/contacts, /api/notifications, /api/reviews).
 * Pas des 404 inoffensifs — des endpoints qui existent des deux côtés avec des
 * sémantiques différentes.
 *
 * COMMENT. On enveloppe `window.fetch` une seule fois, au chargement du module —
 * donc avant tout rendu, et donc avant le premier appel. Le correctif est ainsi
 * valable pour TOUS les appels, y compris ceux des chunks chargés à la demande :
 * ils appellent le `window.fetch` déjà remplacé.
 *
 * Spordate n'utilise ni axios, ni XMLHttpRequest, ni sendBeacon, ni EventSource,
 * ni WebSocket (vérifié : 0 occurrence). `fetch` seul suffit donc à tout couvrir.
 *
 * INERTE à la racine : `NEXT_PUBLIC_BASE_PATH` y est vide, rien n'est enveloppé,
 * spordateur.com se comporte exactement comme avant.
 */

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

// Marqueur pour ne jamais envelopper deux fois (Fast Refresh, double montage en
// mode strict, remontage d'un chunk…) : un double appel préfixerait deux fois.
const MARQUEUR = '__spordateApiBasePathPatch';

function aPrefixer(chemin: string): boolean {
  // Uniquement nos routes internes, et jamais si c'est déjà préfixé.
  return chemin.startsWith('/api/') && !chemin.startsWith(`${BASE}/api/`);
}

if (typeof window !== 'undefined' && BASE && !(window as any)[MARQUEUR]) {
  (window as any)[MARQUEUR] = true;

  const fetchOrigine = window.fetch.bind(window);

  window.fetch = function (entree: RequestInfo | URL, init?: RequestInit) {
    try {
      // Cas 1 — chaîne : le cas de loin le plus fréquent dans le code.
      if (typeof entree === 'string') {
        return fetchOrigine(aPrefixer(entree) ? BASE + entree : entree, init);
      }

      // Cas 2 — URL ou Request : on ne touche QUE le même origine. Les appels
      // vers Stripe, Firebase ou toute API tierce doivent passer intacts.
      const brut = entree instanceof URL ? entree.href : (entree as Request)?.url;
      if (brut) {
        const u = new URL(brut, window.location.origin);
        if (u.origin === window.location.origin && aPrefixer(u.pathname)) {
          const reecrite = BASE + u.pathname + u.search + u.hash;
          return fetchOrigine(
            entree instanceof URL ? reecrite : new Request(reecrite, entree as Request),
            init,
          );
        }
      }
    } catch {
      // Une URL exotique ne doit jamais faire échouer la requête : on laisse
      // passer telle quelle plutôt que de casser l'application.
    }
    return fetchOrigine(entree as RequestInfo, init);
  } as typeof window.fetch;
}

/** Ne rend rien : le travail est fait au chargement du module, ci-dessus. */
export default function ApiBasePathPatch() {
  return null;
}
