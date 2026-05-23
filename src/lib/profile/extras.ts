/**
 * BUG #71 — Constantes options pour les champs profileExtras (style Hinge).
 *
 * Centralise les labels FR + valeurs enum. Utilisé par /profile (édition)
 * et /profile/[uid] (affichage public).
 *
 * Note design : la doctrine Hinge utilise des libellés courts et "humains"
 * (ex: "Parfois" plutôt que "Sometimes / Occasional"). Pas de jargon clinique.
 */

// =====================================================================
// Frequency (alcohol / smoking / cannabis / drugs)
// =====================================================================

export type ProfileFrequency = 'never' | 'sometimes' | 'often';

export const FREQUENCY_LABELS: Record<ProfileFrequency, string> = {
  never: 'Non',
  sometimes: 'Parfois',
  often: 'Souvent',
};

export const FREQUENCY_OPTIONS: Array<{ value: ProfileFrequency; label: string }> = [
  { value: 'never', label: 'Non' },
  { value: 'sometimes', label: 'Parfois' },
  { value: 'often', label: 'Souvent' },
];

// =====================================================================
// Children
// =====================================================================

export type OpenToChildren = 'yes' | 'no' | 'maybe';

export const CHILDREN_LABELS: Record<OpenToChildren, string> = {
  yes: 'Ouvert aux enfants',
  no: 'Pas d\'enfants',
  maybe: 'Peut-être',
};

export const CHILDREN_OPTIONS: Array<{ value: OpenToChildren; label: string }> = [
  { value: 'yes', label: 'Ouvert aux enfants' },
  { value: 'no', label: 'Pas d\'enfants' },
  { value: 'maybe', label: 'Peut-être' },
];

// =====================================================================
// Studies
// =====================================================================

export type StudiesLevel =
  | 'high_school'
  | 'apprenticeship'
  | 'bachelor'
  | 'master'
  | 'phd'
  | 'other';

export const STUDIES_LABELS: Record<StudiesLevel, string> = {
  high_school: 'Lycée / Gymnase',
  apprenticeship: 'Apprentissage / CFC',
  bachelor: 'Bachelor / Licence',
  master: 'Master',
  phd: 'Doctorat',
  other: 'Autre',
};

export const STUDIES_OPTIONS: Array<{ value: StudiesLevel; label: string }> = [
  { value: 'high_school', label: 'Lycée / Gymnase' },
  { value: 'apprenticeship', label: 'Apprentissage / CFC' },
  { value: 'bachelor', label: 'Bachelor / Licence' },
  { value: 'master', label: 'Master' },
  { value: 'phd', label: 'Doctorat' },
  { value: 'other', label: 'Autre' },
];

// =====================================================================
// Religion
// =====================================================================

export type Religion =
  | 'spiritual'
  | 'atheist'
  | 'agnostic'
  | 'christian'
  | 'muslim'
  | 'jewish'
  | 'buddhist'
  | 'hindu'
  | 'other';

export const RELIGION_LABELS: Record<Religion, string> = {
  spiritual: 'Spirituel·le',
  atheist: 'Athée',
  agnostic: 'Agnostique',
  christian: 'Chrétien·ne',
  muslim: 'Musulman·e',
  jewish: 'Juif·ve',
  buddhist: 'Bouddhiste',
  hindu: 'Hindou·e',
  other: 'Autre',
};

export const RELIGION_OPTIONS: Array<{ value: Religion; label: string }> = [
  { value: 'spiritual', label: 'Spirituel·le' },
  { value: 'atheist', label: 'Athée' },
  { value: 'agnostic', label: 'Agnostique' },
  { value: 'christian', label: 'Chrétien·ne' },
  { value: 'muslim', label: 'Musulman·e' },
  { value: 'jewish', label: 'Juif·ve' },
  { value: 'buddhist', label: 'Bouddhiste' },
  { value: 'hindu', label: 'Hindou·e' },
  { value: 'other', label: 'Autre' },
];

// =====================================================================
// Relationship goals + style
// =====================================================================

export type RelationshipGoals = 'long_term' | 'short_term' | 'casual' | 'open';

export const RELATIONSHIP_GOALS_LABELS: Record<RelationshipGoals, string> = {
  long_term: 'Relation longue durée',
  short_term: 'Relation courte ou intermédiaire',
  casual: 'Amitié, fun, sport ensemble',
  open: 'Ouvert·e à voir où ça mène',
};

export const RELATIONSHIP_GOALS_OPTIONS: Array<{ value: RelationshipGoals; label: string }> = [
  { value: 'long_term', label: 'Relation longue durée' },
  { value: 'short_term', label: 'Relation courte ou intermédiaire' },
  { value: 'casual', label: 'Amitié, fun, sport ensemble' },
  { value: 'open', label: 'Ouvert·e à voir où ça mène' },
];

export type RelationshipStyle = 'monogamy' | 'polyamory' | 'open' | 'undecided';

export const RELATIONSHIP_STYLE_LABELS: Record<RelationshipStyle, string> = {
  monogamy: 'Monogamie',
  polyamory: 'Polyamour',
  open: 'Relation ouverte',
  undecided: 'Je découvre encore',
};

export const RELATIONSHIP_STYLE_OPTIONS: Array<{ value: RelationshipStyle; label: string }> = [
  { value: 'monogamy', label: 'Monogamie' },
  { value: 'polyamory', label: 'Polyamour' },
  { value: 'open', label: 'Relation ouverte' },
  { value: 'undecided', label: 'Je découvre encore' },
];

// =====================================================================
// Gender label (sur la base de UserProfile.gender existant)
// =====================================================================

export const GENDER_LABELS: Record<'male' | 'female' | 'other', string> = {
  male: 'Homme',
  female: 'Femme',
  other: 'Autre',
};

// =====================================================================
// Limits
// =====================================================================

export const HEIGHT_MIN_CM = 130;
export const HEIGHT_MAX_CM = 220;
export const HOMETOWN_MAX_LENGTH = 60;
export const PROFESSION_MAX_LENGTH = 80;
export const ETHNICITY_MAX_LENGTH = 80;

// =====================================================================
// Compute age from birthDate (Timestamp ou Date)
// =====================================================================

/**
 * Calcule l'âge depuis une birthDate. Renvoie null si invalide.
 * Accepte Firestore Timestamp, JS Date, ou objet avec seconds (Firestore raw).
 */
export function computeAge(
  birthDate: { toDate?: () => Date; seconds?: number } | Date | undefined | null,
): number | null {
  if (!birthDate) return null;
  let date: Date | null = null;
  if (birthDate instanceof Date) {
    date = birthDate;
  } else if (typeof birthDate === 'object' && typeof (birthDate as { toDate?: () => Date }).toDate === 'function') {
    date = (birthDate as { toDate: () => Date }).toDate();
  } else if (typeof birthDate === 'object' && typeof (birthDate as { seconds?: number }).seconds === 'number') {
    date = new Date((birthDate as { seconds: number }).seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const m = now.getMonth() - date.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < date.getDate())) {
    age--;
  }
  return age >= 0 && age < 130 ? age : null;
}
