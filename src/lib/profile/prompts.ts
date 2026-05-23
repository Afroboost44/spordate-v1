/**
 * BUG #70 — Catalogue des "prompts" profil (style Hinge).
 *
 * 20 questions thématiques adaptées à Spordateur (sport + lifestyle + voyage
 * + rencontre). L'utilisateur en choisit 3 à l'inscription et y répond
 * personnellement. Les réponses sont affichées sur la page profil publique
 * dans des cards style éditorial (question grande + réponse en gras).
 *
 * Format :
 *  - id : stable (immutable), utilisé en clé Firestore pour ne pas casser
 *    les profils existants si on renomme la question text
 *  - text : texte affiché à l'utilisateur (FR)
 *  - placeholder : suggestion pour aider l'utilisateur à répondre
 *  - category : pour grouper visuellement à l'édition (sport/lifestyle/voyage/rencontre)
 */

export type PromptCategory = 'sport' | 'lifestyle' | 'voyage' | 'rencontre';

export interface ProfilePrompt {
  id: string;
  text: string;
  placeholder: string;
  category: PromptCategory;
}

export const PROFILE_PROMPTS: readonly ProfilePrompt[] = [
  // ===== SPORT (signature Spordateur) =====
  {
    id: 'sport_favori',
    text: 'Mon sport favori c\'est…',
    placeholder: 'Le yoga en plein air, parce que…',
    category: 'sport',
  },
  {
    id: 'sport_a_essayer',
    text: 'Le prochain sport que je veux essayer…',
    placeholder: 'L\'escalade en falaise, ça me tente depuis 1 an',
    category: 'sport',
  },
  {
    id: 'defi_sportif',
    text: 'Mon défi sportif dont je suis le plus fier·e…',
    placeholder: 'Mon premier semi-marathon en 2024',
    category: 'sport',
  },
  {
    id: 'endroit_transpirer',
    text: 'Mon endroit préféré pour transpirer en Suisse…',
    placeholder: 'Les sentiers de Crans-Montana au lever du soleil',
    category: 'sport',
  },
  {
    id: 'sport_ou_netflix',
    text: 'Sport ou Netflix le dimanche soir ?',
    placeholder: 'Toujours sport, sauf quand…',
    category: 'sport',
  },
  {
    id: 'sport_m_a_appris',
    text: 'Le sport m\'a appris…',
    placeholder: 'À ne jamais abandonner avant la dernière minute',
    category: 'sport',
  },
  {
    id: 'partenaire_ideal',
    text: 'Mon partenaire d\'entraînement idéal…',
    placeholder: 'Motivé·e, fun, jamais en retard',
    category: 'sport',
  },

  // ===== LIFESTYLE =====
  {
    id: 'dimanche_parfait',
    text: 'Un dimanche parfait selon moi…',
    placeholder: 'Brunch, balade, et bon livre',
    category: 'lifestyle',
  },
  {
    id: 'plus_jamais',
    text: 'Une chose que je ne ferai plus jamais, c\'est…',
    placeholder: 'Du saut à l\'élastique 😅',
    category: 'lifestyle',
  },
  {
    id: 'plus_beau_souvenir',
    text: 'Mon plus beau souvenir des derniers mois…',
    placeholder: 'Une nuit à la belle étoile dans les Alpes',
    category: 'lifestyle',
  },
  {
    id: 'ick',
    text: 'Mon ick rédhibitoire chez quelqu\'un…',
    placeholder: 'Mâcher la bouche ouverte 🙃',
    category: 'lifestyle',
  },
  {
    id: 'grandi_en_croyant',
    text: 'J\'ai grandi en croyant que…',
    placeholder: 'Tout le monde aimait le sport autant que moi',
    category: 'lifestyle',
  },

  // ===== VOYAGE =====
  {
    id: 'conseils_voyage',
    text: 'Donne-moi des conseils de voyage pour…',
    placeholder: 'Valencia ☀️',
    category: 'voyage',
  },
  {
    id: 'pays_marquant',
    text: 'Le pays qui m\'a marqué·e à vie…',
    placeholder: 'Le Japon, pour le sens du détail',
    category: 'voyage',
  },
  {
    id: 'diner_ideal_suisse',
    text: 'Mon dîner idéal en Suisse…',
    placeholder: 'Fondue au refuge avec vue sur le Cervin',
    category: 'voyage',
  },

  // ===== RENCONTRE =====
  {
    id: 'cherche_ici',
    text: 'Ce que je cherche ici en 3 mots…',
    placeholder: 'Aventure · Fun · Connexion',
    category: 'rencontre',
  },
  {
    id: 'premier_date_ideal',
    text: 'Mon premier date idéal serait…',
    placeholder: 'Une rando + apéro au coucher du soleil',
    category: 'rencontre',
  },
  {
    id: 'on_apprend',
    text: 'Une chose qu\'on apprend en me connaissant…',
    placeholder: 'Je suis 100% lève-tôt mais 0% matinale',
    category: 'rencontre',
  },
  {
    id: 'red_flag',
    text: 'Mon red flag personnel…',
    placeholder: 'Je teste 5 nouveaux sports par mois 🤷',
    category: 'rencontre',
  },
  {
    id: 'matche_si',
    text: 'On match si tu…',
    placeholder: 'Aimes courir le matin et flâner le soir',
    category: 'rencontre',
  },
] as const;

/** Récupère un prompt par son id stable. Renvoie null si id inconnu. */
export function getPromptById(id: string): ProfilePrompt | null {
  return PROFILE_PROMPTS.find((p) => p.id === id) ?? null;
}

/** Labels FR par catégorie (pour grouper visuellement à l'édition). */
export const CATEGORY_LABELS: Record<PromptCategory, string> = {
  sport: 'Sport',
  lifestyle: 'Lifestyle',
  voyage: 'Voyage',
  rencontre: 'Rencontre',
};

/** Limite de caractères par réponse (UX type Hinge — concis). */
export const PROMPT_ANSWER_MAX_LENGTH = 200;

/** Nombre de prompts obligatoires à l'inscription (Hinge = 3). */
export const REQUIRED_PROMPT_COUNT = 3;

/**
 * Type de l'entrée stockée dans Firestore (users/{uid}.profilePrompts).
 *
 * Note : on copie aussi `question` à l'écriture pour ne pas dépendre du
 * catalogue runtime (si le texte change un jour, les profils existants
 * gardent la version originale). Le `questionId` reste la source de vérité
 * pour matcher avec PROFILE_PROMPTS.
 */
export interface UserPromptAnswer {
  questionId: string;
  question: string;
  answer: string;
}
