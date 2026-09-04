/**
 * LOT R1 — Fin de pile /discovery : quel profil afficher, quelles actions bloquer.
 *
 * LE PROBLÈME. Jusqu'ici, quand `currentIndex` dépassait la dernière carte,
 * `profiles[currentIndex]` valait `undefined` et l'écran basculait sur une
 * grande page noire. L'utilisateur perdait d'un coup la photo, le nom, le
 * pourcentage de compatibilité, la bio, « Réserver » — tout, y compris le
 * sentiment que l'application fonctionne encore.
 *
 * LA RÈGLE. On ne quitte JAMAIS la dernière carte réellement vue :
 *   - il reste des profils devant → carte active, actions ouvertes ;
 *   - la pile est épuisée → on RESTE sur la dernière carte, bandeau discret,
 *     actions verrouillées (elles ont déjà été consommées sur ce profil) ;
 *   - après un rechargement la pile revient vide (les profils swipés sont
 *     filtrés à la source) → on affiche le profil de repli résolu depuis
 *     l'historique like/pass, mêmes règles ;
 *   - aucun profil, aucun historique → état vide propre.
 *
 * Ce module est PUR : aucune dépendance React ni Firestore. Il est la source
 * unique de la décision, partagée par le rendu ET par l'effet qui charge les
 * activités du partenaire affiché — sans quoi « Réserver » proposerait les
 * activités d'un autre profil que celui montré à l'écran.
 *
 * @module
 */

// =====================================================================
// 1. Quelle vue afficher
// =====================================================================

export type DiscoveryViewMode =
  /** Une carte de la pile est encore devant : comportement normal. */
  | 'active'
  /** Pile épuisée : on conserve la dernière carte vue, en lecture seule. */
  | 'last-seen'
  /** Rien à montrer : aucun profil éligible, aucun historique. */
  | 'empty';

export interface DiscoveryViewInput {
  /** Nombre de profils chargés dans la pile courante. */
  profilesLength: number;
  /** Index d'avancement, incrémenté sans borne par les actions de swipe. */
  currentIndex: number;
  /**
   * Un profil de repli (dernier like/pass retrouvé en base) est disponible.
   * Ne sert que si la pile est vide — sinon la pile fait foi.
   */
  hasLastSeenFallback?: boolean;
}

export interface DiscoveryView {
  mode: DiscoveryViewMode;
  /** Index à lire dans `profiles`, ou `null` si on n'affiche pas la pile. */
  displayIndex: number | null;
  /** Vrai quand la carte affichée vient du repli et non de la pile. */
  useFallbackProfile: boolean;
  /** Vrai quand pass / like / chat direct doivent être verrouillés. */
  actionsDisabled: boolean;
  /** Vrai quand le bandeau « plus de nouveau profil » doit s'afficher. */
  showEndBanner: boolean;
}

const VUE_VIDE: DiscoveryView = {
  mode: 'empty',
  displayIndex: null,
  useFallbackProfile: false,
  actionsDisabled: true,
  showEndBanner: false,
};

/**
 * Décide ce que /discovery montre, à partir du seul état de la pile.
 *
 * Défensif par construction : un `currentIndex` négatif, non fini ou
 * fractionnaire ne doit jamais produire un `undefined` côté rendu.
 */
export function resolveDiscoveryView(input: DiscoveryViewInput): DiscoveryView {
  const total = normaliserEntier(input.profilesLength, 0);
  const index = normaliserEntier(input.currentIndex, 0);

  if (total <= 0) {
    // Pile vide : soit on a retrouvé la dernière carte vue, soit rien.
    if (input.hasLastSeenFallback === true) {
      return {
        mode: 'last-seen',
        displayIndex: null,
        useFallbackProfile: true,
        actionsDisabled: true,
        showEndBanner: true,
      };
    }
    return VUE_VIDE;
  }

  if (index < total) {
    return {
      mode: 'active',
      displayIndex: Math.max(0, index),
      useFallbackProfile: false,
      actionsDisabled: false,
      showEndBanner: false,
    };
  }

  // Fin de pile : on reste sur la dernière carte réellement affichée.
  return {
    mode: 'last-seen',
    displayIndex: total - 1,
    useFallbackProfile: false,
    actionsDisabled: true,
    showEndBanner: true,
  };
}

function normaliserEntier(valeur: unknown, defaut: number): number {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return defaut;
  return Math.max(defaut, Math.floor(valeur));
}

// =====================================================================
// 2. Retrouver la dernière carte vue APRÈS un rechargement
// =====================================================================

/**
 * Un document `likes/{from_to}` ou `passes/{from_to}`. Les deux collections
 * portent déjà `toUid` + `createdAt` : aucun champ nouveau n'est nécessaire
 * pour savoir quel profil a été vu en dernier.
 */
export interface SwipeRecord {
  toUid?: unknown;
  createdAt?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface RankedSwipe {
  toUid: string;
  /** Millisecondes epoch, ou `null` si l'horodatage n'est pas encore résolu. */
  at: number | null;
}

/**
 * Convertit les formes d'horodatage que Firestore renvoie selon le chemin :
 * Timestamp (méthode `toMillis`), objet sérialisé `{ seconds }`, `Date`,
 * nombre epoch (ms ou s), chaîne ISO. Retourne `null` si rien d'exploitable —
 * notamment pour un `serverTimestamp()` encore en attente côté client.
 */
export function swipeCreatedAtMillis(valeur: unknown): number | null {
  if (valeur == null) return null;

  if (typeof valeur === 'number') {
    if (!Number.isFinite(valeur)) return null;
    // Heuristique secondes vs millisecondes (seuil : 1e12 ≈ an 2001 en ms).
    return valeur < 1e12 ? Math.round(valeur * 1000) : Math.round(valeur);
  }

  if (typeof valeur === 'string') {
    const parsed = Date.parse(valeur);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (valeur instanceof Date) {
    const ms = valeur.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof valeur === 'object') {
    const objet = valeur as { toMillis?: unknown; seconds?: unknown; _seconds?: unknown };
    if (typeof objet.toMillis === 'function') {
      try {
        const ms = (objet.toMillis as () => number)();
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    }
    const secondes = typeof objet.seconds === 'number' ? objet.seconds : objet._seconds;
    if (typeof secondes === 'number' && Number.isFinite(secondes)) {
      return Math.round(secondes * 1000);
    }
  }

  return null;
}

/**
 * Classe les swipes du plus récent au plus ancien.
 *
 * Les documents sans horodatage exploitable ne sont pas jetés — ils passent
 * en queue, dans leur ordre d'arrivée. Mieux vaut une carte plausible qu'un
 * écran noir ; et un `serverTimestamp()` en vol finit toujours par se résoudre
 * au chargement suivant.
 *
 * Les `toUid` absents, non-string ou vides sont ignorés ; les doublons ne sont
 * gardés qu'une fois, à leur position la plus récente.
 */
export function rankSwipesByRecency(
  ...sources: ReadonlyArray<readonly SwipeRecord[] | null | undefined>
): RankedSwipe[] {
  const dates: Array<{ toUid: string; at: number; ordre: number }> = [];
  const sansDate: Array<{ toUid: string; ordre: number }> = [];
  let ordre = 0;

  for (const docs of sources) {
    if (!docs) continue;
    for (const d of docs) {
      const brut = d?.toUid;
      if (typeof brut !== 'string') continue;
      const toUid = brut.trim();
      if (!toUid) continue;
      const at = swipeCreatedAtMillis(d?.createdAt);
      if (at === null) sansDate.push({ toUid, ordre: ordre++ });
      else dates.push({ toUid, at, ordre: ordre++ });
    }
  }

  dates.sort((a, b) => (b.at - a.at) || (a.ordre - b.ordre));

  const vus = new Set<string>();
  const resultat: RankedSwipe[] = [];
  for (const e of dates) {
    if (vus.has(e.toUid)) continue;
    vus.add(e.toUid);
    resultat.push({ toUid: e.toUid, at: e.at });
  }
  for (const e of sansDate) {
    if (vus.has(e.toUid)) continue;
    vus.add(e.toUid);
    resultat.push({ toUid: e.toUid, at: null });
  }
  return resultat;
}

/** Raccourci : l'uid du dernier profil sur lequel l'utilisateur a agi. */
export function pickLastSwipedUid(
  ...sources: ReadonlyArray<readonly SwipeRecord[] | null | undefined>
): string | null {
  const classe = rankSwipesByRecency(...sources);
  return classe.length > 0 ? classe[0].toUid : null;
}
