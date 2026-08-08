/**
 * V409 — tâches de fond démarrées AVEC le serveur.
 *
 * ⚠️ POURQUOI ICI, ET PAS UN CRON. `vercel.json` déclare des crons, mais ce site
 * tourne sur COOLIFY : ces crons ne s'exécutent jamais. C'est exactement le piège
 * déjà rencontré côté afroboost, où les rappels de réservation et le
 * renouvellement n'étaient appelés par personne. Next.js appelle `register()` une
 * fois au démarrage du serveur : c'est l'équivalent des boucles asyncio
 * d'afroboost, et ça ne dépend d'aucune configuration externe.
 *
 * ⚠️ GARDES INDISPENSABLES :
 *   - `NEXT_RUNTIME === 'nodejs'` : ce fichier est aussi chargé par le runtime
 *     edge, où ni Firebase Admin ni `setInterval` long ne tiennent ;
 *   - phase de BUILD exclue : `next build` importe ce module, et lancer une
 *     boucle pendant la compilation la ferait tourner dans le conteneur de build ;
 *   - erreurs avalées : une tâche de fond ne doit JAMAIS empêcher le serveur de
 *     démarrer. Un site debout sans rappels vaut mieux qu'un site à terre.
 */

/** Toutes les 6 h. La fenêtre de ciblage fait ±12 h, donc aucun abonné n'est manqué. */
const INTERVALLE_MS = 6 * 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const tour = async () => {
    try {
      const { envoyerRappelsFinPremium } = await import('@/lib/premium/rappelFin');
      const r = await envoyerRappelsFinPremium(false);
      if (r.concernes > 0) {
        console.log(`[rappel-premium] ${r.envoyes}/${r.concernes} rappel(s) de fin envoyé(s)`);
      }
    } catch (e) {
      console.error('[rappel-premium] tour ignoré :', e instanceof Error ? e.message : String(e));
    }
  };

  // Premier passage différé de 60 s : au démarrage, Firebase Admin et le réseau
  // ne sont pas encore prêts, et un échec immédiat ne servirait à rien.
  setTimeout(tour, 60_000);
  setInterval(tour, INTERVALLE_MS);
  console.log('[rappel-premium] boucle de fond démarrée (toutes les 6 h)');
}
