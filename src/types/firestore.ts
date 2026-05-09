/**
 * Spordateur V2 — Firestore Schema Types
 * Toutes les interfaces TypeScript pour les collections Firestore
 */

import { Timestamp, GeoPoint } from 'firebase/firestore';

// ===================== USERS =====================
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  bio: string;
  gender: 'male' | 'female' | 'other';
  birthDate: Timestamp;
  city: string;
  canton: string;
  sports: SportEntry[];
  credits: number;
  referralCode: string;
  referredBy: string;
  isCreator: boolean;
  role: 'user' | 'creator' | 'admin';
  isPremium: boolean;
  fcmToken: string;
  language: 'fr' | 'en' | 'de';
  onboardingComplete: boolean;
  lastActive: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // ----- Phase 7 sub-chantier 3 / Sanctions denorm (preparation, NON écrit Phase 7) -----
  /** Phase 7 sub-chantier 3 (additif). Doc-id de la sanction active courante.
   *  Cosmétique fast-check : authoritative source = getActiveUserSanction() query.
   *  Phase 8 polish : Cloud Function denormalisera via Admin SDK. */
  activeSanctionId?: string;
  /** Phase 7 sub-chantier 3 (additif). Niveau sanction courante. Cf. activeSanctionId. */
  activeSanctionLevel?: 'warning' | 'suspension_7d' | 'suspension_30d' | 'ban_permanent';
  /** Phase 7 sub-chantier 3 (additif). Fin sanction courante. null pour warning + ban_permanent. */
  activeSanctionEndsAt?: Timestamp;
  // ----- Phase 8 sub-chantier 0 / IA suggestions opt-in (additif) -----
  /** Phase 8 sub-chantier 0 (additif). Opt-out user sur les suggestions IA dans le chat post-event.
   *  Default-on (doctrine §D.Q1) : `undefined === true` (opt-in implicite cohérent intérêt légitime nLPD Art. 31).
   *  `true` ou absent = recevoir suggestions ; `false` = opt-out explicite via /profile (Confidentialité).
   *  Consensus opt-out : si un seul membre du chat est `false`, aucune suggestion n'est générée pour ce chat.
   *  Cf. CGU section 7.quinquies + Privacy section 8 (Phase 8 disclosures, commit `d54c7a9`). */
  aiSuggestionsOptIn?: boolean;
  // ----- Phase 8 sub-chantier 2 / Anti-leak L4 admin escalation (additif) -----
  /** Phase 8 SC2 (additif). Flag levé à `true` quand l'utilisateur a déclenché L4 admin
   *  (5+ hits anti-leak dans une conv) → email admin envoyé + flag pour review manuelle.
   *  Doctrine §B.Q3 "L4 escalation manuelle Phase 8" (volume faible attendu, biais algo
   *  = risque LCD si auto-quarantine). Reset manuel admin via Firebase Console SC2 ;
   *  UI admin tab dédiée Phase 9. Boolean simple ; count denorm Phase 9 si scale. */
  leakFlagged?: boolean;
  // ----- Phase 9 SC3 c3/5 / Web Push notifications opt-in (additif) -----
  /** Phase 9 SC3 c3/5 (additif). Opt-out user pour push notifications.
   *  Default-on (cohérent aiSuggestionsOptIn pattern Phase 8 SC0) : `undefined === true`.
   *  `true` ou absent = recevoir push notifications ; `false` = opt-out explicite via /profile.
   *  Sans `fcmToken` set → email fallback (Q3=B). Toggle UI dans /profile section Confidentialité. */
  pushNotificationsEnabled?: boolean;
  // ----- Phase 8 SC5 c3/5 / Banlist anonymization (additif) -----
  /** Phase 8 SC5 c3/5 (additif). Timestamp d'anonymisation PII pour les users bannis
   *  permanent depuis > 24 mois (doctrine LPD/nLPD : conservation limitée).
   *  Si défini : displayName/email/photoURL/phoneNumber ont été nullifiés.
   *  Idempotency : cron purge skip si déjà set. */
  anonymizedAt?: Timestamp;

  // ----- Phase 9 SC4 c5/6 / IA modération bio profil (additif) -----
  /** Phase 9 SC4 c5/6 (additif). Suggestion IA Genkit (Gemini Flash) pour modération
   *  admin de la bio user. Set fire-and-forget post-updateUser si bio non vide (Q4=B).
   *  Admin garde la décision finale (Q3=A) — bio reste visible Q7=A no UX disruption.
   *  Si Gemini fail/error → recommendation='approve' + motive='ai-error' (Phase 9 permissif). */
  bioModeration?: {
    toxicity: number;
    profanity: number;
    contactLeak: number;
    recommendation: 'approve' | 'flag';
    motive: string;
    modelVersion: string;
    scoredAt: Timestamp;
  };

  // ----- Phase 9 SC5 c3/4 — Aggregated rating denorm pour matching algo (additif) -----
  /** Phase 9 SC5 c3/4 (additif). Note moyenne reçue en tant que reviewee (status='published').
   *  Denormalized field — recomputed fire-and-forget post-publish via /api/users/[id]/recompute-rating.
   *  Utilisé par computeMatchScore (algo matching discovery) — Q2=B multiplier × 0.7 si <3.5★ + Q4=B min 3 reviews. */
  averageRatingAsReviewee?: number;
  /** Phase 9 SC5 c3/4 (additif). Nombre de reviews published reçues. Anti-faux-positif Q4=B. */
  reviewCountAsReviewee?: number;

  // ----- Phase 9 SC6 c3/4 — Soft delete UI RGPD/nLPD Art. 17 (additif) -----
  /** Phase 9 SC6 c3/4 (additif). Timestamp à laquelle user a déclenché la suppression de compte.
   *  Si présent : compte en cours de suppression (grace period 30j Q5=A — restaurable via UI).
   *  Set par softDeleteUser service ; cleared par restoreSoftDeletedUser pendant grace.
   *  Cf. architecture.md ligne 899 + §H — RGPD/nLPD Art. 17 droit à l'effacement. */
  softDeletedAt?: Timestamp;
  /** Phase 9 SC6 c3/4 (additif). Timestamp = softDeletedAt + 30j → cron purge-old-data anonymise PII.
   *  Indexed pour query cron efficient (composite index users: softDeleteScheduledPurgeAt+anonymizedAt). */
  softDeleteScheduledPurgeAt?: Timestamp;
  /** Phase 9 SC6 c3/4 (additif). Raison libre user (max 500 chars, optionnelle, audit). */
  softDeleteReason?: string;
}

export interface SportEntry {
  name: string;
  level: 'beginner' | 'intermediate' | 'advanced';
}

// ===================== DANCE ACTIVITIES =====================
export type DanceCategory =
  | 'afroboost'
  | 'zumba'
  | 'afro_dance'
  | 'dance_fitness'
  | 'salsa'
  | 'bachata'
  | 'hiphop'
  | 'dance_workout';

export type DanceLevel = 'debutant' | 'intermediaire' | 'avance';

export interface DanceEntry {
  category: DanceCategory;
  level: DanceLevel;
}

export const DANCE_ACTIVITIES: Record<DanceCategory, { label: string; emoji: string; color: string; description: string }> = {
  afroboost:      { label: 'Afroboost',       emoji: '🔥', color: 'from-orange-500 to-red-600',    description: 'Énergie afro, cardio intense, bonne humeur garantie' },
  zumba:          { label: 'Zumba',            emoji: '💃', color: 'from-pink-500 to-rose-600',     description: 'Danse latine, fitness fun et rythmes entraînants' },
  afro_dance:     { label: 'Afro Dance',       emoji: '🥁', color: 'from-amber-500 to-orange-600',  description: 'Mouvements africains authentiques, expression libre' },
  dance_fitness:  { label: 'Dance Fitness',    emoji: '⚡', color: 'from-violet-500 to-purple-600', description: 'Cardio dansé, sculpte ton corps en t\'éclatant' },
  salsa:          { label: 'Salsa',            emoji: '🌶️', color: 'from-red-500 to-rose-600',      description: 'Rythmes latins, connexion et passion' },
  bachata:        { label: 'Bachata',          emoji: '🎶', color: 'from-fuchsia-500 to-pink-600',  description: 'Sensualité et douceur, danse à deux' },
  hiphop:         { label: 'Hip-Hop',          emoji: '🎤', color: 'from-slate-600 to-zinc-800',    description: 'Grooves urbains, freestyle et attitude' },
  dance_workout:  { label: 'Dance Workout',    emoji: '💪', color: 'from-emerald-500 to-teal-600',  description: 'Entraînement complet en mode danse' },
};

export const DANCE_LEVELS: Record<DanceLevel, { label: string; emoji: string }> = {
  debutant:      { label: 'Débutant',       emoji: '🌱' },
  intermediaire: { label: 'Intermédiaire',  emoji: '⭐' },
  avance:        { label: 'Avancé',         emoji: '🏆' },
};

export interface UserPreferences {
  ageRange: { min: number; max: number };
  genderPreference: 'male' | 'female' | 'all';
  maxDistance: number;
  preferredSports: string[];
  likesDancing: boolean;
  danceLevel: DanceLevel | null;
  preferredDanceStyles: DanceCategory[];
}

// ===================== MATCHES =====================
export interface Match {
  matchId: string;
  userIds: [string, string]; // Toujours trié alphabétiquement
  user1: MatchUser;
  user2: MatchUser;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  activityId: string;
  sport: string;
  chatUnlocked: boolean;
  initiatedBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  /** Phase 1 (additif). Référence optionnelle vers la session liée. Absence = match legacy. */
  sessionId?: string;
}

export interface MatchUser {
  uid: string;
  displayName: string;
  photoURL: string;
}

// ===================== ACTIVITIES =====================
/** Phase 9.5 c4 — Media item rich pour MediaManager partner UI.
 *  Backward compat : `Activity.imageUrls` reste lu en fallback si `mediaUrls` absent
 *  (helper getMediaItems() centralise la logique). */
export type MediaItemType = 'image' | 'video';
export type MediaItemSource = 'upload' | 'url';
export type MediaItemProvider = 'youtube' | 'vimeo' | 'drive' | 'direct';

export interface MediaItem {
  /** URL d'affichage (Firebase Storage download URL OU URL externe). */
  url: string;
  /** Type média : image (rendered <img>) ou video (rendered <iframe> embed). */
  type: MediaItemType;
  /** Origine : 'upload' (Firebase Storage partner) OU 'url' (lien externe collé). */
  source: MediaItemSource;
  /** Provider video pour générer l'embedUrl correct. Absent si type='image'. */
  provider?: MediaItemProvider;
  /** Embed URL pré-calculée (iframe src). Set par mediaParser pour video URLs. */
  embedUrl?: string;
}

export interface Activity {
  activityId: string;
  title: string;
  sport: string;
  description: string;
  partnerId: string;
  partnerName: string;
  city: string;
  address: string;
  geoPoint: GeoPoint;
  price: number;
  currency: 'CHF';
  duration: number; // minutes
  maxParticipants: number;
  currentParticipants: number;
  schedule: ActivitySchedule[];
  images: string[];
  /** Phase 9.5 c4 — Media items rich (image upload/URL OU video embed YouTube/Vimeo/Drive).
   *  Si présent : utilisé prioritairement par MediaCarousel + MediaManager partner.
   *  Si absent : fallback sur `images: string[]` (backward compat) via getMediaItems() helper. */
  mediaUrls?: MediaItem[];
  tags: string[];
  isActive: boolean;
  rating: number;
  reviewCount: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // ----- Phase 1 / Sessions (additif, optionnel) -----
  /** Template de paliers copié dans chaque session générée à partir de cette activity. Modifiable session par session. */
  defaultPricingTiers?: PricingTier[];
  /** Combien de minutes avant startAt le chat des sessions s'ouvre (défaut Phase 4 : 120 = H-2). */
  chatOpenOffsetMinutes?: number;
  // ----- Phase 2 / Sessions UI (additif, optionnel) -----
  /** Phase 2 (additif). Miniature affichée sur les cards de session.
   *  Le partenaire choisit entre image OU vidéo lors de la création.
   *  Cf. architecture.md section 9.bis pour les détails UX/UI Phase 5. */
  thumbnailMedia?: {
    type: 'image' | 'video';
    url: string;
    /** Pour les vidéos = frame de preview. Optionnel pour les images. */
    posterUrl?: string;
  };
  // ----- Phase 3 / Bundle credits chat (additif, optionnel) -----
  /** Phase 3 (additif). Nombre de crédits chat accordés à l'acheteur d'une session de cette activity.
   *  Si absent, défaut 50 dans le code (checkout + webhook). */
  chatCreditsBundle?: number;
  // ----- Phase 7 / Trust & Safety (additif, optionnel — préparation, sans UI active) -----
  /** Phase 7 (additif). Audience cible de l'activity. Préparation data model SANS UI active.
   *  Activation Phase 9 (women-priority quota) + Phase 10+ (women-only stricte si demande forte).
   *  Défaut undefined = 'all' (rétro-compatible activities existantes).
   *  Modifiable via Admin SDK / Firebase Console / test seed Phase 7 (pas via UI partner).
   *  Cf. architecture.md §9.sexies G pour la doctrine female-safety complète. */
  audienceType?: 'all' | 'women-only' | 'men-only' | 'mixed-priority-women';
}

export interface ActivitySchedule {
  day: 'lundi' | 'mardi' | 'mercredi' | 'jeudi' | 'vendredi' | 'samedi' | 'dimanche';
  start: string; // "09:00"
  end: string;   // "18:00"
}

// ===================== SESSIONS =====================
// Phase 1 du système "Dates par Activités" (additif).
// Une Session = occurrence datée et payante d'une Activity.
// Une Activity (cours Afroboost récurrent) génère N sessions, une par date.
// La session porte le compte à rebours, les paliers de prix, et la fenêtre temporelle du chat.

export type SessionStatus =
  | 'scheduled'    // créée mais pas encore ouverte aux réservations
  | 'open'         // ouverte aux réservations
  | 'full'         // toutes les places sont prises
  | 'in_progress'  // l'activité est en cours
  | 'completed'    // terminée — chat en lecture seule
  | 'cancelled';   // annulée

export type PricingTierKind = 'early' | 'standard' | 'last_minute';

/**
 * Un palier de prix progressif. Le palier ACTIF est le PLUS HAUT (early < standard < last_minute)
 * dont au moins une des deux conditions est satisfaite (temps OU remplissage). Si aucune n'est
 * satisfaite, 'early' s'applique par défaut.
 */
export interface PricingTier {
  kind: PricingTierKind;
  /**
   * Prix en CHF centimes (cohérent avec Transaction.amount, Booking.amount, et Stripe unit_amount).
   * À NE PAS confondre avec settings/pricing.packages.X.priceCHF qui est en CHF (lisibilité admin) —
   * c'est un système distinct (packages de crédits génériques).
   */
  price: number;
  /**
   * Active ce palier quand le temps restant (en minutes) avant startAt descend SOUS ce seuil.
   * null = aucun déclencheur temporel pour ce palier.
   * Exemple : 4320 = J-3, 1440 = J-1.
   */
  activateMinutesBeforeStart: number | null;
  /**
   * Active ce palier quand le taux de remplissage (currentParticipants / maxParticipants) atteint
   * ou dépasse ce seuil. Valeur 0.0..1.0. null = aucun déclencheur de remplissage pour ce palier.
   * Exemple : 0.5 = à 50% rempli.
   */
  activateAtFillRate: number | null;
}

export interface Session {
  sessionId: string;
  /** Référence vers l'Activity parent. */
  activityId: string;
  // Champs dénormalisés depuis Activity (pour des listes rapides sans get supplémentaire) :
  partnerId: string;
  creatorId: string;
  sport: string;
  title: string;
  city: string;

  // ----- Timing -----
  startAt: Timestamp;
  endAt: Timestamp;
  /** Ouverture du chat (par défaut : startAt - Activity.chatOpenOffsetMinutes ?? 120). */
  chatOpenAt: Timestamp;
  /** Fermeture du chat (par défaut : endAt). Après cela, chat en lecture seule. */
  chatCloseAt: Timestamp;

  // ----- Capacité -----
  maxParticipants: number;
  /** Mis à jour UNIQUEMENT côté serveur (webhook Stripe via Admin SDK). Le client ne l'écrit jamais. */
  currentParticipants: number;

  // ----- Pricing -----
  /** Copie indépendante des paliers (issue d'Activity.defaultPricingTiers à la création de la session, modifiable). */
  pricingTiers: PricingTier[];
  /** Cache du palier actif. La source de vérité reste pricingTiers + computePricingTier() (Phase 2). */
  currentTier: PricingTierKind;
  /** Cache du prix actif en CHF centimes. */
  currentPrice: number;

  // ----- État -----
  status: SessionStatus;

  // ----- Audit -----
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ===================== BOOKINGS =====================
export interface Booking {
  bookingId: string;
  userId: string;
  userName: string;
  matchId: string;
  activityId: string;
  partnerId: string;
  sport: string;
  ticketType: 'solo' | 'duo';
  sessionDate: Timestamp;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'refunded';
  transactionId: string;
  amount: number;
  currency: 'CHF';
  creditsUsed: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Phase 1 (additif). Référence optionnelle vers la session liée. Absence = booking legacy sans session. */
  sessionId?: string;
  /** Phase 2 (additif) — référence Stripe pour les réservations sessions. Sert de clé d'idempotency. */
  paymentIntentId?: string;
  /** Phase 2 (additif) — palier de prix actif au moment de la réservation (traçabilité). */
  tier?: PricingTierKind;
  /** Phase 8 SC5 c2/5 — flag idempotency cron reviewReminder 48h post-session.
   *  True une fois email envoyé (ou tenté en mode dev loggedOnly). Anti-double-email. */
  reviewReminderSent?: boolean;
  /** Phase 9 SC3 c1/5 — flag idempotency cron session-reminders J-1 (24h avant session).
   *  Set après envoi email/push best-effort. Q1=B window 18-30h. Anti-double-reminder. */
  reminderJMinus1Sent?: boolean;
  /** Phase 9 SC3 c1/5 — flag idempotency cron session-reminders T-0 (1h avant session).
   *  Set après envoi email/push best-effort. Q2=A window 30-90min. Anti-double-reminder. */
  reminderTMinus0Sent?: boolean;
  /** Phase 8 SC5 c4/5 — Stripe refund auto level 3 partner no-show.
   *  Set quand refundForSanction() crée le refund Stripe avec succès. */
  refundedAt?: Timestamp;
  /** Phase 8 SC5 c4/5 — Montant remboursé (CHF centimes, cohérent stripe.refunds.create). */
  refundedAmount?: number;
  /** Phase 9 SC2 c4/6 — Q2=C denorm payeur cohérent modes Split/Gift.
   *  - Mode 'individual' (Phase 8 SC4 legacy) : paidByUserId === userId (user paye sa propre booking)
   *  - Mode 'split' (Phase 9 SC2) : paidByUserId === userId (B paye sa part, A's prepay séparé)
   *  - Mode 'gift' (Phase 9 SC2) : paidByUserId === inviter, userId === invitee (A paye pour B)
   *  Utilisé pour traceability + refund routing (Phase 10 polish post-accept refund). */
  paidByUserId?: string;

  // ----- Phase 9 SC5 c1/4 — Excuse pré-session (additif) -----
  /** Phase 9 SC5 c1/4 (additif). Timestamp de l'excuse créée ≥2h avant `session.startAt`.
   *  Si présent : `markNoShow` skip threshold compute (Q5=A doctrine architecture.md ligne 895).
   *  Source-of-truth = doc /excuses/{id} ; ce flag est le denorm fast-check dans Booking. */
  excusedAt?: Timestamp;
}

// ===================== EXCUSES (Phase 9 SC5 — UX no-show grace pré-session) =====================
// Doctrine architecture.md ligne 895 + 2096 : excuse créée ≥2h avant session.startAt =
// no-show NOT comptabilisé (markNoShow skip threshold). Audit trail immuable (no update/delete).
export interface Excuse {
  /** Doc-id Firestore — dénormalisé. */
  excuseId: string;
  /** User qui s'excuse (= booking owner, anti-spoofing rule). */
  userId: string;
  /** Session concernée (denorm pour anti-doublon query). */
  sessionId: string;
  /** Booking de référence (denorm pour update Booking.excusedAt). */
  bookingId: string;
  /** Raison libre 0-300 chars (optionnelle, audit). */
  reason: string;
  /** Server timestamp à la création — anti-backdate via rule. */
  createdAt: Timestamp;
}

// ===================== CREDITS =====================
export type CreditType = 'purchase' | 'referral_bonus' | 'share_bonus' | 'review_bonus' | 'refund' | 'usage';

export interface CreditEntry {
  creditId: string;
  userId: string;
  type: CreditType;
  amount: number; // Positif = ajout, négatif = utilisation
  balance: number; // Solde après opération
  description: string;
  relatedId: string;
  createdAt: Timestamp;
}

// ===================== TRANSACTIONS =====================
export type TransactionType = 'credit_purchase' | 'partner_subscription' | 'refund' | 'session_purchase';
export type PaymentMethod = 'twint' | 'card' | 'apple_pay';
export type TransactionStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type CreditPackage = '1_date' | '3_dates' | '10_dates' | 'partner_monthly';

export interface Transaction {
  transactionId: string;
  stripeSessionId: string;
  stripePaymentIntentId: string;
  userId: string;
  type: TransactionType;
  amount: number; // En centimes
  currency: 'CHF';
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  metadata: Record<string, string>;
  package: CreditPackage;
  creditsGranted: number;
  createdAt: Timestamp;
  completedAt: Timestamp;
  /** Phase 3 (additif). Référence vers le booking créé pour cette transaction (uniquement si type='session_purchase'). */
  bookingId?: string;
  /** Phase 3 (additif). Référence vers la session liée (uniquement si type='session_purchase'). Dénormalisé pour le dashboard admin. */
  sessionId?: string;
}

// Packages de crédits
export const CREDIT_PACKAGES: Record<CreditPackage, { price: number; credits: number; label: string }> = {
  '1_date':  { price: 1000,  credits: 1,  label: '1 Sport Date' },
  '3_dates': { price: 2500,  credits: 3,  label: '3 Sport Dates' },
  '10_dates': { price: 6000, credits: 10, label: '10 Sport Dates' },
  'partner_monthly': { price: 4900, credits: 0, label: 'Abonnement Partenaire' },
};

// ===================== CREATORS =====================
export interface Creator {
  creatorId: string;
  displayName: string;
  referralCode: string;
  referralLink: string;
  commissionRate: number; // 0.10 à 0.20
  totalEarnings: number;
  pendingPayout: number;
  totalReferrals: number;
  totalPurchases: number;
  isActive: boolean;
  payoutMethod: 'twint' | 'bank_transfer';
  payoutDetails: { iban?: string; twintNumber?: string };
  createdAt: Timestamp;
}

// ===================== PARTNERS =====================
export type PartnerType = 'gym' | 'studio' | 'outdoor' | 'pool';
export type PartnerStatus = 'pending_payment' | 'paid' | 'pending_validation' | 'active' | 'refused' | 'suspended' | 'cancelled';
export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'cancelled';

export interface Partner {
  partnerId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  canton: string;
  geoPoint: GeoPoint;
  type: PartnerType;
  description: string;
  logo: string;
  images: string[];
  status: PartnerStatus;           // NEW: main partner lifecycle status
  subscriptionStatus: SubscriptionStatus; // kept for backward compat
  subscriptionEnd: Timestamp;
  monthlyFee: number;
  promoCode: string;
  referralId: string;
  isApproved: boolean;
  isActive: boolean;
  totalBookings: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Phase 9 SC2 c1/6 — Stripe Connect Express account id persisté.
   *  Provenance : `/api/stripe-connect` POST onboarding (account.id `acct_xxx`).
   *  Utilisé pour destination charges modes Split/Gift (transfer_data.destination).
   *  Absent = partner pas onboardé Connect (Stripe Connect required pour invites Split/Gift). */
  stripeAccountId?: string;
}

// ===================== COMMISSION SETTINGS =====================
export interface CommissionSettings {
  enabled: boolean;
  defaultRate: number;  // e.g. 0.20 = 20%
  updatedAt: Timestamp;
}

// ===================== REFERRALS =====================
export interface Referral {
  referralId: string;
  referrerId: string;
  referredUserId: string;
  referralCode: string;
  status: 'registered' | 'first_purchase' | 'active';
  totalPurchases: number;
  totalCommission: number;
  createdAt: Timestamp;
}

// ===================== PAYOUTS =====================
export type PayoutStatus = 'requested' | 'processing' | 'completed' | 'rejected';

export interface Payout {
  payoutId: string;
  creatorId: string;
  amount: number;
  method: 'twint' | 'bank_transfer';
  details: { iban?: string; twintNumber?: string };
  status: PayoutStatus;
  processedBy: string;
  processedAt: Timestamp;
  createdAt: Timestamp;
}

// ===================== ANALYTICS =====================
export interface AnalyticsGlobal {
  totalRevenue: number;
  totalUsers: number;
  totalBookings: number;
  totalMatches: number;
  totalPartners: number;
  totalCreators: number;
  lastUpdated: Timestamp;
}

export interface AnalyticsDaily {
  date: string; // "2026-03-17"
  revenue: number;
  newUsers: number;
  bookings: number;
  matches: number;
  creditsPurchased: number;
  creditsUsed: number;
  byCity: Record<string, { revenue: number; bookings: number }>;
  bySport: Record<string, { revenue: number; bookings: number }>;
  byPartner: Record<string, { revenue: number; bookings: number }>;
  byCreator: Record<string, { revenue: number; referrals: number }>;
  byPaymentMethod: Record<string, number>;
}

// ===================== CHATS =====================
export interface Chat {
  chatId: string; // = matchId
  participants: [string, string];
  lastMessage: string;
  lastMessageAt: Timestamp;
  unreadCount: Record<string, number>;
  // ----- Phase 8 sub-chantier 2 (additif) — anti-leak escalation per-chat per-sender -----
  /** Phase 8 SC2 (additif). Compteur cumulatif des hits anti-leak par sender dans ce chat.
   *  Key = senderId, value = count flagged messages (regex L1 OU IA L2 confirmé).
   *  Triggers UI : 1 → L2 toast soft / 3 → L3 modal rétroactif / 5 → L4 admin email.
   *  Doctrine §B "dans la conv". Cumulative all-time SC2 (rolling Phase 9 si scale).
   *  Self-only update : un sender ne peut incrémenter QUE son propre compteur (rule defense-in-depth). */
  leakBySender?: Record<string, number>;
  // ----- Phase 8 sub-chantier 3 (additif) — Suggestions IA next-activity cooldown -----
  /** Phase 8 SC3 (additif). Timestamp dernière suggestion bot IA générée pour ce chat.
   *  Cadence max 1/72h (doctrine §D.Q2). Server-side check via /api/suggest-activities.
   *  Update via Admin SDK bypass (cohérent senderId='system' bot messages, Q9=A). */
  lastSuggestionAt?: Timestamp;
}

export interface ChatMessage {
  messageId: string;
  /** Auth uid de l'expéditeur, OU `'system'` pour bot messages Phase 8 SC3
   *  (suggestions IA next-activity, créées via Admin SDK serveur uniquement). */
  senderId: string;
  text: string;
  /** Phase 8 SC3 (additif) : `'ai_suggestion'` pour bot messages avec suggestions structurées.
   *  `'text'`/`'image'`/`'system'` = SC1 messages users. */
  type: 'text' | 'image' | 'system' | 'ai_suggestion';
  readBy: string[];
  createdAt: Timestamp;
  /** Phase 8 SC3 (additif). Présent uniquement si type === 'ai_suggestion' — 1-3 cards
   *  avec activityId/title/sport/city/nextSessionAt/reason. Doctrine §D.Q4 inline bot card.
   *  Persisté via Admin SDK serveur (Q9=A) — client lit uniquement. */
  suggestions?: SuggestionCard[];
}

/** Phase 8 SC3 (additif). Card suggestion bot IA pour next-activity (1-3 par message).
 *  Snapshot dénormalisé au moment de la génération (rendu rapide client). */
export interface SuggestionCard {
  /** Doc-id de l'Activity proposée. Validation existence côté serveur Phase 8 SC3 commit 3/6. */
  activityId: string;
  /** Title dénormalisé (snapshot, peut désync si activity edited Phase 9). */
  title: string;
  /** Sport dénormalisé (filtrage sport-affinity §D doctrine). */
  sport: string;
  /** City dénormalisée (filtrage city-affinity §D doctrine). */
  city: string;
  /** Timestamp prochaine session disponible (optional — null si activity sans session schedulée). */
  nextSessionAt?: Timestamp;
  /** Phase 9 SC1 c2/5 — sessionId résolu de la prochaine session future (collection `sessions/`).
   *  Présent si `nextSessionAt` provient d'une session réelle (pas du legacy schedule[] field).
   *  Permet wire `<InviteButton sessionId={...}>` dans SuggestionMessage. */
  nextSessionId?: string;
  /** Justification courte FR affichée dans la card (doctrine §D.Q3 FR uniquement). */
  reason: string;
}

// ===================== AI SCAN LOGS (Phase 8 sub-chantier 1) =====================
// Anti-leak L1 silent log : trace minimaliste de chaque message scanné.
// Doctrine §C.Q2 : score + motif technique + hash anonyme uniquement, jamais
// le contenu lisible. Conservation 30j puis purge cron Phase 9. Lecture admin only.
// Cf. Privacy §7 (commit d54c7a9 SC0 commit 1/3).
export interface AiScanLog {
  /** Document ID — généré Firestore, dénormalisé pour query simplifiée. */
  scanLogId: string;
  /** Doc-id du chat parent (= matchId). */
  chatId: string;
  /** Auth uid de l'expéditeur (pour analyse cross-cutting admin Phase 8+). */
  senderId: string;
  /** Score de risque ∈ [0,1]. SC1 binaire 0|1 (regex hit/no hit). SC2 score IA continu. */
  score: number;
  /** Catégorie technique non-public (FR uniquement Phase 8 doctrine §C.Q3).
   *  Enum SC1+SC2 :
   *  - L1 regex SC1 : 'phone-ch' | 'phone-intl' | 'email' | 'handle' | 'domain' | 'keyword'
   *  - L2 IA SC2     : 'ai-leak-likely' | 'ai-leak-unlikely' | 'ai-error' (fail fallback)
   *  - clean         : aucun match (motive par défaut). */
  motive: string;
  /** Hash SHA-256 du contenu textuel (anonymisation LPD §C.Q2). Jamais stocker
   *  contenu lisible — permet tuning false-positive sans risque privacy. */
  messageHash: string;
  /** Timestamp création (purge automatique +30j cron Phase 9). */
  createdAt: Timestamp;
}

// ===================== REVIEWS (Phase 7 T&S) =====================
// Reviews publiques post-session avec anonymisation graduée selon note.
// 5/4/3★ → publication auto, nominative.
// 2/1★ → status 'pending' jusqu'à modération admin pré-publication, anonymisée.
// Edition/suppression possible dans 24h post-publication (editableUntil cutoff).
// Cf. architecture.md §9.sexies C pour la doctrine complète.

export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export type ReviewStatus = 'pending' | 'published' | 'rejected';

export interface Review {
  /** Document ID — généré Firestore, dénormalisé dans le doc pour query simplifiée. */
  reviewId: string;
  /** Activity sur laquelle porte la review (pas une session spécifique). */
  activityId: string;
  /** Auteur de la review. */
  reviewerId: string;
  /** Cible de la review (autre participant, jamais soi-même). */
  revieweeId: string;
  /** Note 1-5 étoiles. */
  rating: ReviewRating;
  /** Commentaire 10-500 chars (validation rule + service). */
  comment: string;
  /** Statut workflow : pending → published OU pending → rejected. */
  status: ReviewStatus;
  /** True si rating ≤ 2 (publié anonyme comme "Un·e participant·e"). */
  anonymized: boolean;
  /** Création utilisateur. Server timestamp au create. */
  createdAt: Timestamp;
  /** Set quand status passe à 'published' (auto pour 3-5★, manuel admin pour 1-2★). */
  publishedAt?: Timestamp;
  /** Cutoff pour édition/suppression user (24h post-publication). */
  editableUntil?: Timestamp;
  /** Admin uid qui a modéré (1-2★ pré-pub OU rejet). */
  moderatedBy?: string;
  /** Timestamp de la décision modération admin. */
  moderatedAt?: Timestamp;
  /** True une fois le bonus 5 crédits chat alloué (anti-double-bonus). */
  creditsAwarded: boolean;

  // ----- Phase 9 SC4 c2/6 — IA modération reviews 1-2★ (additif) -----
  /** Suggestion IA Genkit (Gemini Flash) pour modération admin. Set fire-and-forget
   *  post-create si rating ≤ 2. Admin garde la décision finale (Q3=A doctrine SC4).
   *  Si Gemini fail/error → recommendation='borderline' + motive='ai-error'. */
  aiSuggestion?: {
    civility: number;
    factuality: number;
    recommendation: 'publish' | 'reject' | 'borderline';
    motive: string;
    modelVersion: string;
    scoredAt: Timestamp;
  };

  // ----- Phase 9 SC4 c4/6 — Détection représailles cross-user (additif) -----
  /** SessionId de la session partagée pour cette review. Persisté pour permettre
   *  la query cross-user same-session (Q5=A heuristique 24h). */
  sessionId?: string;
  /** True si cross-review détectée même session within 24h (Q5=A). */
  flaggedAsRetaliation?: boolean;
  /** Delta ms entre prior cross-review et this review (audit). */
  retaliationDeltaMs?: number;
  /** ReviewId du suspect (review prior cross-user same session). */
  retaliationSuspectReviewId?: string;
}

// ===================== REPORTS + SANCTIONS (Phase 7 T&S sub-chantier 3) =====================
// Reports formels anonymes (anonymat TOTAL côté reported) + sanctions auto/admin.
// Cf. architecture.md §9.sexies D + F pour la doctrine complète.
//
// Anti-fraude : reporter doit avoir partagé une session avec reported (validé service).
// Rate limit : max 3 reports / reporter / jour (rolling 24h).
// Dédup : 2 reports même reporter sur même reported = 1 seul (anti-revanche inflation).
// Thresholds rolling 12 mois (reporters indépendants) : 1=review, 2=AUTO 7j, 3+=AUTO 30j.
// No-show thresholds rolling 90j spécifiques : 1=warning, 2=warning+flag, 3=30j+refund, 4+=ban.

/** 6 catégories doctrine §9.sexies D.2 — enum strict (rule create enforce). */
export type ReportCategory =
  | 'harassment_sexuel'             // 🔴 URGENTE
  | 'comportement_agressif'         // 🟠 Haute
  | 'fake_profile'                  // 🟡 Moyenne
  | 'substance_etat_problematique'  // 🔴 URGENTE
  | 'no_show'                       // 🟢 Basse (auto-handled cf. D.5)
  | 'autre';                        // 🟡 Moyenne — freeText OBLIGATOIRE

export type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';

export type ReportSource = 'user' | 'partner_no_show';

export interface Report {
  /** Document ID Firestore — dénormalisé pour query simplifiée. */
  reportId: string;
  /** Auteur du report. ANONYMISÉ côté reported (jamais exposé en lecture non-admin). */
  reporterId: string;
  /** Cible du report. Jamais == reporterId (validé rule + service). */
  reportedId: string;
  category: ReportCategory;
  /** OBLIGATOIRE si category='autre' (validation rule + service). Optionnel sinon. */
  freeTextReason?: string;
  /** Référence session partagée (validation participation cohérent reviews). */
  sessionId?: string;
  /** Référence activity (utile pour no-show stats par activity). */
  activityId?: string;
  status: ReportStatus;
  /** True si threshold a déclenché une suspension auto au moment du create. */
  autoSuspensionApplied?: boolean;
  /** Durée suspension déclenchée (7 ou 30 jours). */
  autoSuspensionDurationDays?: number;
  /** Admin qui a modéré (sustain ou dismiss). */
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  /** Verdict admin. */
  decision?: 'sustain' | 'dismiss';
  /** Note admin (motif décision). */
  decisionNote?: string;
  resolvedAt?: Timestamp;
  /** Origine — user signale OU partner check-in marque no-show. */
  source: ReportSource;
  createdAt: Timestamp;
}

/** 4 niveaux ban doctrine §9.sexies F. */
export type SanctionLevel = 'warning' | 'suspension_7d' | 'suspension_30d' | 'ban_permanent';

export type SanctionReason = 'reports_threshold' | 'no_show_threshold' | 'manual_admin';

export interface UserSanction {
  /** Document ID Firestore — dénormalisé. */
  sanctionId: string;
  userId: string;
  level: SanctionLevel;
  reason: SanctionReason;
  /** IDs des reports qui ont déclenché cette sanction (anti-recompute + audit). */
  triggeringReportIds: string[];
  startsAt: Timestamp;
  /** null pour 'warning' (pas de fin) et 'ban_permanent' (revue annuelle hors scope ce champ). */
  endsAt?: Timestamp;
  /** False pour level='warning' (pas une sanction au sens doctrine appel D.6). */
  appealable: boolean;
  /** True une fois l'appel utilisé (1× par niveau, doctrine §F). */
  appealUsed?: boolean;
  /** Note rédigée par le user lors de l'appel. */
  appealNote?: string;
  appealResolvedBy?: string;
  appealResolvedAt?: Timestamp;
  /** Verdict admin appel. */
  appealDecision?: 'upheld' | 'overturned';
  /** False si expirée (endsAt passé) OU overturned via appel. */
  isActive: boolean;
  /** Phase 7 Q7 : flag refund partner pour no-show level 3 (suspension_30d).
   *  Traitement manuel admin via Stripe dashboard. Phase 8 = automatisation Stripe API. */
  refundDue?: boolean;
  /** Admin uid si reason='manual_admin'. */
  createdBy?: string;
  createdAt: Timestamp;
}

// UserProfile additions (Phase 7 sub-chantier 3 — preparation denorm fields).
// Note Phase 7 : ces champs sont DÉCLARÉS mais NON ÉCRITS côté client (rule users update
// reste owner/admin only — pas de relaxation pour cosmétique). L'enforcement authoritative
// passe par getActiveUserSanction() (query userSanctions indexed). Phase 8 polish :
// Cloud Function on userSanctions create/update qui denormalise ces champs côté Admin SDK
// pour permettre fast banner UI sans query supplémentaire.
//
// Cf. UserProfile interface au début du fichier — ajout des 3 champs optionnels :
//   activeSanctionId?, activeSanctionLevel?, activeSanctionEndsAt?

// ===================== ADMIN ACTIONS (Phase 7 T&S sub-chantier 5) =====================
// Audit trail des décisions admin sur reviews/reports/sanctions (doctrine §9.sexies H).
// Collection séparée `adminActions/{actionId}` (vs sub-collection users) — query
// plus simple, filtres temporels propres. Conservation 24 mois.
//
// Phase 7 Q7 décision : targetType minimal review|report|sanction. Extension Phase 9 :
// 'block' | 'user' (admin SDK actions futures).

export type AdminActionType =
  | 'review_publish'
  | 'review_reject'
  | 'report_dismiss'
  | 'report_sustain'
  | 'sanction_overturn'
  | 'appeal_resolve_upheld'
  | 'appeal_resolve_overturned'
  | 'sanction_manual_create'
  | 'leak_escalation_l4' // Phase 8 SC2 commit 5/6 — auto-escalation system (adminId='system')
  | 'auto_refund_partner_no_show' // Phase 8 SC5 c4/5 — refund auto level 3 partner no-show (adminId='system')
  | 'auto_refund_invite' // Phase 9 SC2 c5/6 — refund auto invite Split/Gift décliné/expiré (adminId='system')
  | 'review_retaliation_flag' // Phase 9 SC4 c4/6 — heuristique cross-user same-session within 24h (adminId='system')
  | 'profile_bio_flag'; // Phase 9 SC4 c5/6 — IA Genkit modération bio profil (adminId='system', Q7=A silent flag)

export type AdminActionTargetType =
  | 'review'
  | 'report'
  | 'sanction'
  | 'user' // Phase 8 SC2 commit 5/6 — target user pour leak_escalation_l4
  | 'invite'; // Phase 9 SC2 c5/6 — target invite pour auto_refund_invite

export interface AdminAction {
  /** Doc ID Firestore — dénormalisé. */
  actionId: string;
  /** Admin uid qui a effectué l'action. */
  adminId: string;
  actionType: AdminActionType;
  targetType: AdminActionTargetType;
  /** ID de la ressource ciblée (reviewId / reportId / sanctionId). */
  targetId: string;
  /** Note motivée (optionnelle, recommandée pour transparency + audit). */
  reason?: string;
  /** Champs spécifiques à l'action (ex: { level: 'suspension_7d' } pour sanction_manual_create). */
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
}

// ===================== BLOCKS (Phase 7 T&S) =====================
// Block list user-side. Invisibilité mutuelle (sessions/profils/chats) entre blocker et blocked.
// Aucune notification au bloqué (anti-confrontation). Réversible via /profile/blocks.
// Cf. architecture.md §9.sexies E pour la doctrine complète.
//
// Doc-id pattern strict : `${blockerId}_${blockedId}` (déduplication + idempotency au create).
// Enforcement defense-in-depth via Firestore rule create.

export interface Block {
  /** Doc ID = `${blockerId}_${blockedId}`. Dénormalisé pour query simplifiée. */
  blockId: string;
  /** Auteur du block. */
  blockerId: string;
  /** Cible du block. Jamais == blockerId. */
  blockedId: string;
  /** Server timestamp au create. Immuable. */
  createdAt: Timestamp;
}

// ===================== INVITES (Phase 8 sub-chantier 4) =====================
// Invitation 1-on-1 mode Individuel — doctrine §E.Q1 Phase 8 uniquement.
// User A (fromUserId) invite User B (toUserId) à payer/réserver une session activity.
// B accepte → Stripe checkout B (paye sa part) → Booking créé par webhook.
// B refuse → status='declined', A peut inviter autre.
// Modes Split/Gift = Phase 9.
//
// Doc-id pattern strict : `${fromUserId}_${toUserId}_${sessionId}` (anti-doublon Q10=B)
// — un user peut être invité à une session par un même inviteur 1× max.

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/** Phase 9 SC2 c1/6 — Mode de paiement de l'invite (doctrine §E.Q1 Phase 9).
 *  - 'individual' (Phase 8 SC4) : invité paye sa part, inviter ne paye rien (default legacy).
 *  - 'split' (Phase 9 SC2) : inviter paye une portion (10-90%), invité paye le reste.
 *  - 'gift' (Phase 9 SC2) : inviter paye 100%, invité confirme uniquement (no payment).
 *  Mode choisi par inviter à la création (Q1=A). */
export type InviteMode = 'individual' | 'split' | 'gift';

export interface Invite {
  /** Doc ID Firestore — pattern `${fromUserId}_${toUserId}_${sessionId}`. */
  inviteId: string;
  /** Inviteur (auth uid). Immuable post-création. */
  fromUserId: string;
  /** Invité (auth uid). Immuable. Doit être ≠ fromUserId. */
  toUserId: string;
  /** Activity proposée (lecture title/sport/city/etc côté UI). Immuable. */
  activityId: string;
  /** Session spécifique si applicable (sinon activity générique). Immuable. */
  sessionId?: string;
  /** Status courant — transitions strictes côté rule + service. */
  status: InviteStatus;
  /** Expiration : Min(7 jours, sessionStart - 1h) — Q3=C cohérent SC1 cancel policy.
   *  Cron Phase 9 ou expireInvitesIfDue() check à chaque accept tentative. */
  expiresAt: Timestamp;
  /** Q1=A optional message inviter (UX nice — "Tu m'accompagnes ?"). Max 200 chars. */
  message?: string;
  /** Server timestamp create. Immuable. */
  createdAt: Timestamp;
  /** Set quand status passe à 'accepted' (via webhook Stripe SC4 commit 4/6). */
  acceptedAt?: Timestamp;
  /** Set quand status passe à 'declined' (via /api/invites/[id]/decline). */
  declinedAt?: Timestamp;
  // ===== Phase 9 SC2 c1/6 — Modes Split/Gift Stripe Connect destination charges =====
  /** Phase 9 SC2 c1/6 (additif). Default 'individual' (legacy compat Phase 8 SC4 quand absent).
   *  Choisi par inviter (Q1=A) à la création. Validation rule + service. */
  mode?: InviteMode;
  /** Phase 9 SC2 c1/6. Montant inviter en CHF centimes (mode='split'/'gift').
   *  Mode='gift' : inviterAmountCents = totalCents (100%).
   *  Mode='split' : 10%-90% du total (Q5=A range), reste = inviteeAmountCents.
   *  Absent pour mode='individual'. */
  splitInviterAmountCents?: number;
  /** Phase 9 SC2 c1/6. Montant invité en CHF centimes (mode='split' uniquement).
   *  Mode='gift' : 0 (B paye rien).
   *  Mode='individual' : absent (B paye via /api/checkout invite-accept Phase 8 SC4 logic). */
  splitInviteeAmountCents?: number;
  /** Phase 9 SC2 c1/6. Stripe PaymentIntent id du pre-pay inviter (mode='split'/'gift').
   *  Set par webhook Stripe `invite-prepay` (SC2 c4/6). Servira pour refund auto si
   *  decline/expire (SC2 c5/6 cancellation policy Q6=A). */
  inviterPaymentIntentId?: string;
  /** Phase 9 SC2 c1/6. Set quand refund inviter executé (via cron expireInvitesCron OR
   *  /api/invites/[id]/decline → refundForInvite). Idempotency Firestore-side. */
  inviterRefundedAt?: Timestamp;
  /** Phase 9 SC2 c1/6. Montant inviter remboursé (CHF centimes, cohérent
   *  Booking.refundedAmount Phase 8 SC5 c4/5). */
  inviterRefundedAmount?: number;
}

// ===================== NOTIFICATIONS =====================
export type NotificationType = 'match' | 'message' | 'booking' | 'payment' | 'system' | 'promo';

export interface Notification {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  /** Legacy boolean (Phase 1). Phase 9 SC3 c4/5 ajoute `readAt` Timestamp ;
   *  `isRead` reste maintenu pour compat lecture (dérivé : `isRead = readAt != null`). */
  isRead: boolean;
  createdAt: Timestamp;

  // ----- Phase 9 SC3 c4/5 — UX polish badge unread + dismiss flow (additif) -----
  /** Timestamp lecture (set via markNotificationRead/markAll). `null`/absent = unread. */
  readAt?: Timestamp | null;
  /** Soft-delete user (dismiss). Doc reste en Firestore pour audit, masqué côté UI. */
  dismissedAt?: Timestamp | null;
}

// ===================== ERROR LOGS =====================
export type ErrorLevel = 'error' | 'warning' | 'critical';

export interface ErrorLog {
  logId: string;
  source: 'frontend' | 'backend' | 'function';
  level: ErrorLevel;
  message: string;
  stackTrace: string;
  userId: string;
  url: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  resolvedAt: Timestamp;
  createdAt: Timestamp;
}
