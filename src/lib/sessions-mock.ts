/**
 * Spordateur — Phase 5
 * Données mockées pour la stratégie anti-ghost-town au lancement.
 *
 * Toutes les constantes sont préfixées MOCK_* pour distinguer clairement
 * du contenu réel (qui vit dans Firestore).
 *
 * Migration future :
 * - MOCK_HERO_STORY → Phase 8 admin lit depuis settings/site
 * - MOCK_TESTIMONIALS → Phase 8 admin lit depuis settings/site
 * - MOCK_WAITLIST_CITIES → Phase 8 admin lit depuis settings/waitlist_cities
 * - MOCK_INTEREST_COUNT → Phase 6 agrège depuis analytics/sessionViews
 * - MOCK_PAST_SESSIONS_FALLBACK → ⚠️ DO NOT USE IN PRODUCTION UI — kept for dev/test only.
 *   PastSessionsGallery utilise /src/data/past-afroboost-sessions.ts (vraies photos uniquement,
 *   doctrine no-fake-content). Cf. architecture.md §9.ter Tactique 3 + LCD Suisse Art. 3.
 */

export interface MockWaitlistCity {
  city: string;
  /** Étiquette de la phase d'expansion. */
  expectedDate: string;
  /** Pour le compteur d'intérêt par ville (mocké). */
  interested?: number;
}

export interface MockTestimonial {
  authorName: string;
  authorAge?: number;
  text: string;
}

export interface MockPastSession {
  title: string;
  imageUrl: string;
  /** Texte relatif court (ex: "il y a 2 semaines"). */
  date: string;
  city: string;
  testimonial?: string;
}

// =============================================================
// Hero story — section "Notre histoire" (Tactique 7)
// =============================================================

export const MOCK_HERO_STORY = {
  title: 'Notre histoire',
  paragraphs: [
    "Spordate est né à Genève d'une idée simple : transformer chaque cours sportif en occasion de rencontrer quelqu'un qui partage votre énergie. Pas de swipe sur des photos. Du sport ensemble, et le reste vient.",
    "On a commencé avec l'Afroboost — la danse-fitness afro qui mêle cardio, rythme et bonne humeur. Au bord du lac, dans des studios, en plein air. Vous bookez votre place, vous venez bouger, vous rencontrez les autres participants pendant et après le cours.",
    "Aujourd'hui, des dizaines de Sport Dates par mois entre Genève et Lausanne. Demain, toute la Suisse romande, puis la Suisse alémanique. Ce qui compte, c'est qu'à chaque session, vous repartez avec plus que des courbatures.",
  ],
} as const;

// =============================================================
// Testimonials (Tactique 3 — social proof)
// =============================================================

export const MOCK_TESTIMONIALS: MockTestimonial[] = [
  {
    authorName: 'Marie',
    authorAge: 28,
    text: "Mon premier cours Afroboost m'a fait rencontrer trois personnes formidables. On va boire un verre tous les jeudis soir maintenant.",
  },
  {
    authorName: 'Julien',
    authorAge: 34,
    text: "Je n'aurais jamais pensé que la danse pourrait remplacer mes apps de rencontre. J'ai trouvé mieux : une vraie tribu.",
  },
  {
    authorName: 'Sandra',
    authorAge: 41,
    text: "Ce qui change tout, c'est qu'on partage un effort physique avant de se parler. La glace est cassée naturellement.",
  },
];

// =============================================================
// Waitlist cities (Tactiques 4 + 6 — pre-fill villes "Bientôt")
// =============================================================

export const MOCK_WAITLIST_CITIES: MockWaitlistCity[] = [
  { city: 'Lausanne', expectedDate: 'Été 2026', interested: 23 },
  { city: 'Zürich', expectedDate: 'Automne 2026', interested: 41 },
  { city: 'Bern', expectedDate: 'Hiver 2026', interested: 17 },
];

// =============================================================
// Interest counter (Tactique 5 — "47 membres intéressés")
// =============================================================

/** Compteur cumulatif mocké pour Phase 5. À remplacer Phase 6 par agrégation analytics/sessionViews. */
export const MOCK_INTEREST_COUNT = 47;

// =============================================================
// Past sessions — ⚠️ MOCK DEV/TEST ONLY (NOT FOR PRODUCTION UI)
// Doctrine no-fake-content : la galerie de photos passées (Tactique 3) DOIT utiliser
// exclusivement des photos réelles. Ce mock reste disponible pour storybook / tests
// Phase 7 mais n'est importé par aucun composant UI de production.
// Cf. architecture.md §9.ter Tactique 3 + LCD Suisse Art. 3.
// =============================================================

/** Images Picsum (fiable, neutre) — variante deterministic via /seed/{seed}/{w}/{h}. */
function picsum(seed: string, w = 600, h = 800): string {
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

export const MOCK_PAST_SESSIONS_FALLBACK: MockPastSession[] = [
  {
    title: 'Afroboost au bord du lac',
    imageUrl: picsum('afroboost-1'),
    date: 'il y a 2 semaines',
    city: 'Genève',
    testimonial: '15 personnes au coucher du soleil. Inoubliable.',
  },
  {
    title: 'Cours Afro Dance studio',
    imageUrl: picsum('afroboost-2'),
    date: 'il y a 3 semaines',
    city: 'Genève',
  },
  {
    title: 'Session matinale au parc',
    imageUrl: picsum('afroboost-3'),
    date: 'il y a 1 mois',
    city: 'Genève',
    testimonial: 'Ambiance familiale, niveaux mélangés.',
  },
  {
    title: 'Afroboost intensif',
    imageUrl: picsum('afroboost-4'),
    date: 'il y a 1 mois',
    city: 'Genève',
  },
  {
    title: 'Cours après-midi',
    imageUrl: picsum('afroboost-5'),
    date: 'il y a 2 mois',
    city: 'Genève',
  },
  {
    title: 'Soirée découverte',
    imageUrl: picsum('afroboost-6'),
    date: 'il y a 2 mois',
    city: 'Genève',
    testimonial: 'Beaucoup de débutants, super accueil.',
  },
];
