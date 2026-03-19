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
}

export interface ActivitySchedule {
  day: 'lundi' | 'mardi' | 'mercredi' | 'jeudi' | 'vendredi' | 'samedi' | 'dimanche';
  start: string; // "09:00"
  end: string;   // "18:00"
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
}

// ===================== CREDITS =====================
export type CreditType = 'purchase' | 'referral_bonus' | 'share_bonus' | 'refund' | 'usage';

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
export type TransactionType = 'credit_purchase' | 'partner_subscription' | 'refund';
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
