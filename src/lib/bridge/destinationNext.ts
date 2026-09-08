/**
 * F3 — OÙ ATTERRIR APRÈS LE PONT, quand afroboost le demande.
 *
 * Le pont d'auto-login (`BridgeAutoLogin`) menait toujours au même endroit
 * (discovery). afroboost veut parfois entrer DIRECTEMENT sur une page précise —
 * « Gérer mon profil » doit ouvrir `/rencontre/profile` déjà connecté, pas
 * discovery. On ajoute donc un paramètre `next`.
 *
 * ⚠️ UN `next` EST UNE URL FOURNIE PAR LE NAVIGATEUR : il faut la traiter comme
 * hostile. Sans garde, `next=https://mechant` ou `next=//mechant` ferait du
 * pont un tremplin de redirection ouverte (open redirect) — on enverrait un
 * utilisateur fraîchement authentifié vers un site tiers. On n'accepte donc
 * QU'un chemin INTERNE : commence par un seul `/`, jamais `//`, jamais de
 * schéma, et — puisque tout Spordateur vit sous le basePath — on force ce
 * préfixe. Tout le reste retombe sur la destination par défaut.
 *
 * PUR : ni fenêtre, ni réseau. Éprouvable exhaustivement.
 */

/** Le chemin interne sûr correspondant à `next`, ou null si `next` est absent
 *  ou refusé (l'appelant retombe alors sur sa destination par défaut). */
export function cheminNextSur(brut: string | null | undefined, basePath?: string | null): string | null {
  const v = (brut || '').trim();
  if (!v) return null;
  // Doit être un chemin absolu du site : un seul slash de tête, jamais `//`
  // (qui vaut « //host » dans un navigateur), jamais de schéma ni de backslash.
  if (v[0] !== '/' || v[1] === '/' || v[1] === '\\') return null;
  if (/[\x00-\x1f]/.test(v)) return null;           // caractères de contrôle
  if (v.includes('://') || v.toLowerCase().includes('javascript:')) return null;

  const base = (basePath || '').replace(/\/+$/, '');
  // Déjà préfixé par le basePath ? on garde. Sinon on le préfixe : le `next`
  // qu'afroboost envoie (« /profile ») est relatif à l'app Spordateur.
  if (base && (v === base || v.startsWith(base + '/'))) return v;
  return `${base}${v}`;
}
