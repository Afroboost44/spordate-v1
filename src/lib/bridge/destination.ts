/**
 * Où atterrit un membre venu d'afroboost par le pont ? Décision PURE.
 *
 * Elle vit à part pour une raison simple : c'est la seule chose que ce lot
 * change, et une décision qu'on peut éprouver sans navigateur, sans Firebase
 * et sans émulateur vaut mieux qu'une condition noyée dans un `useEffect`.
 *
 * RENDRE `null` N'EST PAS UN ÉCHEC. C'est le comportement d'AVANT ce lot :
 * la session s'ouvre, et l'on ne bouge pas. Le drapeau fermé doit être
 * indiscernable de l'absence de ce code — sinon le rollback n'en est pas un.
 */

/** Le chemin de la page de rencontres, dans l'application Spordateur. */
export const CHEMIN_DISCOVERY = '/discovery';

export type ContextePont = {
  /** `NEXT_PUBLIC_SPORDATE_DIRECT_DISCOVERY` — lu au BUILD, pas à l'exécution. */
  directDiscovery: boolean;
  /** `NEXT_PUBLIC_BASE_PATH` — « /rencontre » en mode intégré, vide sinon. */
  basePath?: string | null;
};

/**
 * L'URL vers laquelle rediriger après l'ouverture de session, ou `null` pour
 * ne rien faire.
 *
 * LE `basePath` EST PRÉFIXÉ ICI, et c'est indispensable : la redirection se
 * fait par `window.location`, qui ne connaît pas le routeur Next et n'ajoute
 * donc rien. Sans ce préfixe, un membre intégré serait envoyé sur
 * `afroboost.com/discovery` — une page qui n'existe pas de ce côté.
 */
export function destinationApresPont(ctx: ContextePont): string | null {
  if (!ctx.directDiscovery) return null;
  const base = (ctx.basePath || '').replace(/\/+$/, '');
  return `${base}${CHEMIN_DISCOVERY}`;
}

/** Lit le drapeau comme le ferait le composant. « true » seul vaut vrai. */
export function drapeauActif(valeur?: string | null): boolean {
  return String(valeur || '').trim().toLowerCase() === 'true';
}

/**
 * Sommes-nous dans l'expérience INTÉGRÉE à afroboost, ou sur le Spordateur
 * autonome ?
 *
 * LA RÉPONSE VIENT DU `basePath`, jamais d'un nom de domaine codé en dur :
 * l'application n'est servie sous un préfixe QUE lorsqu'elle est montée dans
 * un autre site. Un test sur « afroboost.com » serait faux le jour d'un
 * domaine de recette, et muet en local.
 *
 * CE QUE CE MODE CHANGE : ce qu'on AFFICHE, et rien d'autre. Aucune route
 * n'est supprimée, aucune fonction n'est coupée — le mode autonome garde sa
 * navigation entière, et c'est ce qui rend ce lot réversible.
 */
export function estModeIntegre(basePath?: string | null): boolean {
  return Boolean((basePath || '').trim());
}

/** La valeur pour l'application en cours, lue au build. */
export const EN_MODE_INTEGRE = estModeIntegre(process.env.NEXT_PUBLIC_BASE_PATH);
