/**
 * Spordateur — Phase 5
 * Source de vérité des photos de sessions Afroboost passées (Tactique 3 anti-ghost-town).
 *
 * ⚠️ DOCTRINE NO-FAKE-CONTENT : ce fichier contient EXCLUSIVEMENT des références
 * vers de vraies photos d'événements Afroboost passés. Aucun mock, aucun placeholder.
 * Cf. architecture.md §9.ter Tactique 3 + LCD Suisse Art. 3 (publicité trompeuse).
 *
 * Workflow d'ajout d'une photo :
 *   1. Déposer le fichier dans /public/past-sessions/ (ex: 2024-09-bord-lac.jpg)
 *   2. Ajouter une entrée dans PAST_AFROBOOST_SESSIONS ci-dessous
 *   3. Vérifier le rendu : npm run dev → http://localhost:3000/sessions
 *   4. git add + commit + push → Vercel rebuild automatique
 *
 * Format date : ISO YYYY-MM-DD (jour exact ou 1er du mois si seul le mois est connu).
 * Permet le tri lexical (= chronologique) sans Date object dans PastSessionsGallery.
 *
 * Migration Phase 7 (planifiée) :
 *   - Collection Firestore `pastSessionPhotos/{photoId}` (admin SDK write-only)
 *   - Admin UI dans /admin pour upload + crop + tag (sport/ville/date)
 *   - Storage : firebasestorage.googleapis.com (à whitelister next.config.ts à ce moment-là)
 *   - PastSessionsGallery passera de prop par défaut → fetch Firestore SSR
 */

export interface PastAfroboostSession {
  /** Path public depuis /public/past-sessions/ (ex: '/past-sessions/1.jpg'). */
  photoSrc: string;
  /** Sport pratiqué (badge top-left). Ex: 'Afro Dance'. */
  sport: string;
  /** Ville (footer). Ex: 'Genève'. */
  city: string;
  /** Date ISO YYYY-MM-DD (formatée FR par PastSessionsGallery via Intl.DateTimeFormat). */
  date: string;
  /** Alt text descriptif (a11y, obligatoire). */
  alt: string;
}

/**
 * Liste réelle des photos de sessions Afroboost passées.
 * Si length < 3, PastSessionsGallery ne s'affiche pas (doctrine no-fake-content).
 */
export const PAST_AFROBOOST_SESSIONS: PastAfroboostSession[] = [
  {
    photoSrc: '/past-sessions/1.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Cours Afroboost Silent en plein air aux Jeunes-Rives de Neuchâtel : danse Afrobeat avec casques sans fil immersifs",
  },
  {
    photoSrc: '/past-sessions/2.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Participants Afroboost Silent dansant ensemble aux Jeunes-Rives, Neuchâtel",
  },
  {
    photoSrc: '/past-sessions/3.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Ambiance énergique d'une session Afroboost Silent en bord de lac à Neuchâtel",
  },
  {
    photoSrc: '/past-sessions/4.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Groupe en mouvement lors d'un Afroboost Silent aux Jeunes-Rives de Neuchâtel",
  },
  {
    photoSrc: '/past-sessions/5.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Cours Afroboost Silent en plein air aux Jeunes-Rives de Neuchâtel",
  },
  {
    photoSrc: '/past-sessions/6.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Participantes Afroboost Silent dansant aux Jeunes-Rives, Neuchâtel",
  },
  {
    photoSrc: '/past-sessions/7.jpg',
    sport: 'Afroboost Silent',
    city: 'Neuchâtel',
    date: '2025-10-30',
    alt: "Atmosphère d'une session Afroboost Silent aux Jeunes-Rives, Neuchâtel",
  },
];
