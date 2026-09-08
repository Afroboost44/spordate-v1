/**
 * F3 — CE QU'AFROBOOST A LE DROIT D'ÉCRIRE DANS LE PROFIL SPORDATEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA LISTE BLANCHE D'ÉCRITURE — SYMÉTRIQUE DE CELLE DE LECTURE, EN PLUS STRICTE
 * ─────────────────────────────────────────────────────────────────────────
 * En lecture (F2), sept champs sortent. En écriture, ENCORE MOINS entrent : on
 * n'accepte QUE les champs texte que l'éditeur Spordateur lui-même laisse
 * modifier — `bio`, `city`, `sports`. Tout le reste d'un corps de requête,
 * quel qu'il soit, est ignoré : un `credits`, un `role`, un `uid`, un
 * `isPremium` envoyés par un client malveillant ne peuvent pas s'écrire, parce
 * qu'ils ne sont jamais recopiés — c'est l'inverse d'un `update(corps)` qui
 * ferait du mass-assignment.
 *
 * ⚠️ `canton` N'EST PAS ici : l'éditeur Spordateur ne le modifie pas. Le rendre
 * modifiable depuis afroboost créerait une divergence de règles entre les deux
 * écrans — exactement ce que F3 veut éviter. `displayName` et les photos sont
 * un chantier séparé (le GO les met à part).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MÊMES VALIDATIONS QUE SPORDATEUR (GO §12)
 * ─────────────────────────────────────────────────────────────────────────
 *   bio    : coupée à 300 caractères, comme le `maxLength={300}` de l'éditeur ;
 *   city   : chaîne libre, coupée à une longueur raisonnable ;
 *   sports : chaque entrée réduite à `{name, level}`, `name` dans la liste
 *            fermée de l'éditeur, `level` dans {beginner, intermediate,
 *            advanced}. Une valeur hors liste est REJETÉE, jamais stockée.
 *
 * PUR. Aucune base, aucun réseau. La route valide avec ces fonctions, puis
 * écrit le résultat — jamais le corps brut.
 */

/** Les sports proposés par l'éditeur Spordateur (`AVAILABLE_SPORTS`), plus les
 *  danses. La casse est normalisée à la comparaison. Une valeur inconnue est
 *  refusée : un champ fermé refuse plutôt que de stocker n'importe quoi. */
export const SPORTS_AUTORISES = [
  'tennis', 'fitness', 'running', 'yoga', 'crossfit', 'football', 'natation',
  'padel', 'escalade', 'afroboost', 'zumba', 'afro dance', 'dance fitness',
  'salsa', 'bachata', 'hip-hop', 'danse', 'cardio', 'renforcement',
] as const;

export const NIVEAUX = ['beginner', 'intermediate', 'advanced'] as const;
export const BIO_MAX = 300;
export const CITY_MAX = 80;
export const SPORTS_MAX = 12;

/** Les SEULES clés qu'une requête d'écriture peut porter. Le reste est ignoré. */
export const CHAMPS_MODIFIABLES = ['bio', 'city', 'sports'] as const;

export type SportEcrit = { name: string; level: string };
export type ProfilModifiable = { bio?: string; city?: string; sports?: SportEcrit[] };

/**
 * Un sport valide, ou null. `name` doit appartenir à la liste fermée (casse
 * ignorée, mais la casse d'origine est CONSERVÉE) ; `level` par défaut
 * 'beginner' s'il est absent ou hors liste — jamais une valeur arbitraire.
 */
function sportValide(x: unknown): SportEcrit | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const name = (typeof o.name === 'string' ? o.name : '').trim();
  if (!name) return null;
  if (!SPORTS_AUTORISES.includes(name.toLowerCase() as typeof SPORTS_AUTORISES[number])) return null;
  let level = (typeof o.level === 'string' ? o.level : '').trim().toLowerCase();
  if (!(NIVEAUX as readonly string[]).includes(level)) level = 'beginner';
  return { name, level };
}

/**
 * LE FILTRE D'ÉCRITURE. Prend un corps quelconque, rend l'objet — RÉDUIT aux
 * champs modifiables et validés — à écrire dans Firestore. Un champ absent du
 * corps n'est PAS écrit (mise à jour partielle) ; un champ présent mais
 * invalide est soit corrigé (coupé), soit ignoré.
 *
 * `sansEffet` est vrai quand, après validation, il n'y a RIEN à écrire :
 * l'appelant peut alors répondre sans toucher la base.
 */
export function versEcritureProfil(brut: unknown): { patch: ProfilModifiable; sansEffet: boolean } {
  const o = (brut && typeof brut === 'object') ? (brut as Record<string, unknown>) : {};
  const patch: ProfilModifiable = {};

  if (typeof o.bio === 'string') {
    patch.bio = o.bio.slice(0, BIO_MAX);
  }
  if (typeof o.city === 'string') {
    patch.city = o.city.trim().slice(0, CITY_MAX);
  }
  if (Array.isArray(o.sports)) {
    const out: SportEcrit[] = [];
    for (const s of o.sports) {
      const v = sportValide(s);
      if (v) out.push(v);
      if (out.length >= SPORTS_MAX) break;
    }
    patch.sports = out;
  }

  return { patch, sansEffet: Object.keys(patch).length === 0 };
}
