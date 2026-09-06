/**
 * FIX ATTRIBUTION — LES ACTIVITÉS MONTRÉES SOUS UN PROFIL SONT LES SIENNES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE PASSAIT (discovery/page.tsx, « Fix #183 », ligne 1759)
 * ─────────────────────────────────────────────────────────────────────────
 * Trois branches, dans cet ordre : les activités actives du partenaire, puis
 * ses activités boostées, puis — si aucune des deux ne rendait quoi que ce
 * soit — `return visibleActivities`, c'est-à-dire **toutes les activités
 * boostées du système**.
 *
 * Concrètement : on swipe un utilisateur ordinaire, qui ne possède rien, et sa
 * carte proposait les activités payantes d'autres partenaires. Le bouton
 * « Réserver » de cette carte présélectionnait `partnerActivities[0]` — donc
 * l'activité de quelqu'un d'autre. C'était une attribution fausse juste avant
 * un paiement.
 *
 * L'intention d'origine était compréhensible (« que l'utilisateur puisse
 * réserver quelque chose depuis n'importe quelle carte »), mais elle mélange
 * deux choses qui ne doivent jamais l'être : *découvrir une activité* et
 * *l'attribuer à un profil*. « Où pratiquer ? » fait déjà la première, et il
 * ne passe pas par ici.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, DÉSORMAIS
 * ─────────────────────────────────────────────────────────────────────────
 * Une activité n'apparaît sous un profil que si son `partnerId` est EXACTEMENT
 * l'identifiant de ce profil. Sans attribution prouvée : **liste vide**. Les
 * deux points d'appel savent déjà l'afficher — un état vide explicite existe
 * (`discovery_no_active_activity_partner`) et le CTA « Réserver » émet un toast
 * au lieu d'ouvrir une fenêtre. Rien de neuf n'est à dessiner.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ON REVÉRIFIE AUSSI LA LISTE « DÉJÀ FILTRÉE » — ET CE N'EST PAS DE LA PARANOÏA
 * ─────────────────────────────────────────────────────────────────────────
 * `partnerOwnedActivities` est chargée par un effet asynchrone
 * (`where('partnerId','==',uid)`), et elle N'EST PAS VIDÉE au moment du swipe :
 * entre le changement de carte et la réponse de la requête, elle contient
 * encore les activités du profil PRÉCÉDENT. Le rendu, lui, a déjà lieu. C'est
 * exactement la même fuite, par une autre porte, et une seconde de décalage
 * suffit à la produire.
 *
 * On refiltre donc les DEUX listes sur le profil courant. Pour un partenaire
 * légitime le résultat est identique — la requête filtrait déjà sur ce même
 * `partnerId` — et la course cesse d'être exploitable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 * Il ne décide RIEN sur les boosts : `visibleActivities` arrive déjà filtrée
 * sur `boost.active` et `boost.expiresAt` par la page. Il ne touche pas à
 * « Où pratiquer ? » (`groupBoostedActivitiesByCity`), qui n'a jamais eu ce
 * repli. Il ne connaît ni Stripe, ni wallet, ni commission, ni les offres
 * Afroboost — R3c les branchera ailleurs, et cette garde sera déjà en place.
 */

/** Le strict minimum exigé d'une activité : à qui elle est. */
export type ActiviteAttribuable = { partnerId?: string | null };

export type EntreeAttribution<T extends ActiviteAttribuable> = {
  /** `firestoreUid` du profil actuellement affiché. Vide/absent -> aucune activité. */
  profilUid?: string | null;
  /** Activités ACTIVES du partenaire, chargées par l'effet dédié. */
  activitesPossedees?: readonly T[] | null;
  /** Activités boostées visibles — toutes propriétaires confondus. */
  activitesBoostees?: readonly T[] | null;
};

/** Un identifiant utilisable, ou `''`. Les blancs ne sont pas une identité. */
function identifiant(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Les activités RÉELLEMENT attribuées au profil affiché.
 *
 * PURE : aucune base, aucun réseau, aucune horloge. C'est ce qui la rend
 * éprouvable, et c'est la raison pour laquelle elle vit ici plutôt que dans
 * une fermeture au milieu de 2 000 lignes de JSX.
 *
 * L'ORDRE DES DEUX SOURCES est conservé tel quel : les activités actives
 * d'abord (elles incluent les non-boostées, cf. Fix #207), les boostées
 * ensuite en repli — mais les deux passent par le même filtre de propriété.
 */
export function activitesDuProfil<T extends ActiviteAttribuable>(
  entree: EntreeAttribution<T>,
): T[] {
  const uid = identifiant(entree?.profilUid);
  if (!uid) return [];

  const luiAppartient = (a: T | null | undefined): boolean =>
    !!a && identifiant(a.partnerId) === uid;

  const possedees = Array.isArray(entree?.activitesPossedees)
    ? (entree.activitesPossedees as readonly T[]).filter(luiAppartient)
    : [];
  if (possedees.length > 0) return possedees;

  const boostees = Array.isArray(entree?.activitesBoostees)
    ? (entree.activitesBoostees as readonly T[]).filter(luiAppartient)
    : [];
  if (boostees.length > 0) return boostees;

  // AUCUN REPLI. C'était `return visibleActivities` — la fuite que ce lot ferme.
  return [];
}
