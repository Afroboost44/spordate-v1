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
}

export interface ChatMessage {
  messageId: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'system';
  readBy: string[];
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
  | 'sanction_manual_create';

export type AdminActionTargetType = 'review' | 'report' | 'sanction';

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

// ===================== NOTIFICATIONS =====================
export type NotificationType = 'match' | 'message' | 'booking' | 'payment' | 'system' | 'promo';

export interface Notification {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  isRead: boolean;
  createdAt: Timestamp;
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
