/**
 * LOT B — « QUELLES OFFRES CE COMPTE PEUT-IL METTRE EN AVANT ? »
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE CHANGE, ET CE QU'IL NE CHANGE PAS
 * ─────────────────────────────────────────────────────────────────────────
 * Jusqu'ici, une offre `admin` entrait dans « Où pratiquer ? » toute seule,
 * du seul fait d'être publiée. Personne ne l'avait CHOISIE. Ce module fournit
 * la matière du choix : la liste, pour un compte donné, des offres qu'il a le
 * droit de mettre en avant.
 *
 * Il ne touche PAS à R3c : tant que le LOT C n'est pas passé, les offres admin
 * publiques continuent d'apparaître automatiquement. C'est voulu — retirer la
 * règle automatique avant qu'un écran permette de choisir viderait le modal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX COMPTES, DEUX LISTES, ET AUCUNE INTERSECTION
 * ─────────────────────────────────────────────────────────────────────────
 * ADMINISTRATEUR (preuve serveur du LOT A) → les offres `admin`. Elles
 * appartiennent à la plateforme ; il n'a rien à payer pour les mettre en avant.
 *
 * PARTENAIRE (identité résolue par R3b-ID) → SES offres, c'est-à-dire celles
 * dont le `proprietaireId` est EXACTEMENT son `afroboostPartnerId`. Jamais
 * « toutes les offres publiques » : ce serait rejouer, sur un écran d'achat,
 * l'erreur d'attribution que le FIX ATTRIBUTION a corrigée.
 *
 * Être administrateur ne donne aucune offre partenaire, et posséder une offre
 * ne donne aucune offre de la plateforme. Les deux listes sont disjointes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE FILTRE DE TYPE EST LE MÊME QUE PARTOUT AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 * On réutilise `TYPES_OFFRE_BOOSTABLES` — `single_class` et `event`. Un pack,
 * un produit, un abonnement, une adhésion n'ont jamais été des lieux où l'on
 * pratique, et ce n'est pas un écran de sélection qui va les y faire entrer.
 * Redéfinir la règle ici la ferait diverger au premier changement.
 *
 * PURE : aucune base, aucun réseau. La liste des offres et l'identité du compte
 * lui sont DONNÉES ; il ne va les chercher nulle part.
 */

import type { OffrePublique } from '@/lib/afroboost/offers';
import { TYPES_OFFRE_BOOSTABLES } from '@/lib/boost/autorisationAfroboost';

/** Ce que l'écran de sélection a besoin de savoir. Aucune donnée privée. */
export interface OffreSelectionnable {
  id: string;
  nom: string;
  prix: number | null;
  ville: string | null;
  lieuTexte: string | null;
  image: string | null;
  typeOffre: OffrePublique['typeOffre'];
  proprietaire: OffrePublique['proprietaire'];
  /** `admin-gratuit` ou `partenaire-achete` — ce que coûtera la mise en avant. */
  voie: 'admin-gratuit' | 'partenaire-achete';
}

export interface IdentiteDuCompte {
  /** Résultat de `estAdminAfroboostAutorise`. Jamais une valeur du navigateur. */
  adminProuve?: boolean;
  /** Résultat de `resoudreProprietaireAfroboost` (R3b-ID). */
  proprietaireAfroboost?: string | null;
}

/** Le type se pratique-t-il quelque part ? Même règle que R3b-2 et R3c. */
function typeAdmis(offre: OffrePublique): boolean {
  return TYPES_OFFRE_BOOSTABLES.has(offre.typeOffre);
}

/**
 * LA LISTE, pour CE compte. Ordre du catalogue préservé.
 *
 * Une offre qui n'a pas d'identifiant, ou dont le type n'est pas pratiquable,
 * n'apparaît jamais — quel que soit le compte. Ensuite seulement vient la
 * question de la propriété.
 *
 * ⚠️ Ce module NE VÉRIFIE PAS la ville. Une offre sans ville structurée peut
 * être sélectionnée ici, mais R3c refusera de l'afficher (`sans-ville`). Les
 * séparer est délibéré : la sélection dit « c'est à moi et c'est du bon type »,
 * l'affichage dit « je sais où la ranger ». Fusionner les deux ferait
 * disparaître de l'écran une offre que son propriétaire cherche, sans lui dire
 * pourquoi. L'appelant est libre d'avertir.
 */
export function offresSelectionnablesPour(
  offres: ReadonlyArray<OffrePublique> | null | undefined,
  identite: IdentiteDuCompte,
): OffreSelectionnable[] {
  if (!Array.isArray(offres)) return [];
  const proprietaire = String(identite?.proprietaireAfroboost || '').trim();
  const estAdmin = identite?.adminProuve === true;

  const retenues: OffreSelectionnable[] = [];
  for (const offre of offres) {
    if (!offre || !String(offre.id || '').trim()) continue;
    if (!typeAdmis(offre)) continue;

    let voie: OffreSelectionnable['voie'] | null = null;
    if (offre.proprietaire === 'admin') {
      // La plateforme : réservé à l'administrateur PROUVÉ, et gratuit.
      if (estAdmin) voie = 'admin-gratuit';
    } else if (offre.proprietaire === 'partner') {
      // Le partenaire : ses offres, et EXACTEMENT les siennes.
      const idOffre = String(offre.proprietaireId || '').trim();
      if (proprietaire && idOffre && idOffre === proprietaire) voie = 'partenaire-achete';
    }
    // `unknown` : aucune voie. Une propriété qu'on ne sait pas nommer ne se
    // met pas en avant.
    if (!voie) continue;

    retenues.push({
      id: offre.id,
      nom: offre.nom,
      prix: offre.prix,
      ville: offre.ville,
      lieuTexte: offre.lieuTexte || offre.adresse || null,
      image: offre.image,
      typeOffre: offre.typeOffre,
      proprietaire: offre.proprietaire,
      voie,
    });
  }
  return retenues;
}

/**
 * « Cette offre précise est-elle sélectionnable par ce compte ? »
 *
 * Le serveur s'en sert pour REFAIRE, à l'activation, la vérification que
 * l'écran a déjà faite. Un filtrage d'interface est un confort ; il n'a jamais
 * protégé personne.
 */
export function offreSelectionnablePar(
  offres: ReadonlyArray<OffrePublique> | null | undefined,
  identite: IdentiteDuCompte,
  offreId: string | null | undefined,
): OffreSelectionnable | null {
  const cherche = String(offreId || '').trim();
  if (!cherche) return null;
  return offresSelectionnablesPour(offres, identite).find((o) => o.id === cherche) || null;
}
