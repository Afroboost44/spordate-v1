import { db, isFirebaseConfigured } from './firebase';
import { doc, setDoc, getDoc, query, collection, where, getDocs, addDoc, updateDoc, increment, deleteDoc } from 'firebase/firestore';

// Types
export interface UserProfile {
  uid: string;
  email: string;
  sports: string[];
  level: string;
  referralCode: string;
  referredBy?: string;
  partnerMember?: string; // Partner name if referred by partner
  createdAt: Date;
}

export interface Booking {
  id?: string;
  oderId: string;
  profileId: number;
  profileName: string;
  amount: number;
  currency: string;
  status: 'confirmed' | 'pending' | 'cancelled';
  createdAt: Date;
}

export interface GlobalStats {
  totalRevenue: number;
  totalBookings: number;
  lastUpdated: Date;
}

export interface Partner {
  id?: string;
  name: string;
  address: string;
  city: string;
  type: 'Salle' | 'Studio' | 'Club' | 'Association';
  referralId: string;
  logo?: string;
  active: boolean;
  createdAt: Date;
}

// localStorage keys for demo mode
const REVENUE_STORAGE_KEY = 'spordate_revenue';
const BOOKINGS_STORAGE_KEY = 'spordate_bookings';
const TICKETS_STORAGE_KEY = 'spordate_tickets';
const PARTNERS_STORAGE_KEY = 'spordate_partners';

// Default partners for demo
export const DEFAULT_PARTNERS: Partner[] = [
  {
    id: 'partner-1',
    name: 'ArtBoost Studio Paris',
    address: '42 Rue de la Danse',
    city: 'Paris',
    type: 'Studio',
    referralId: 'ARTBOOST-PARIS',
    active: true,
    createdAt: new Date(),
  },
  {
    id: 'partner-2',
    name: 'Afro Fitness Lyon',
    address: '15 Avenue des Sports',
    city: 'Lyon',
    type: 'Salle',
    referralId: 'AFRO-LYON',
    active: true,
    createdAt: new Date(),
  },
  {
    id: 'partner-3',
    name: 'Dance Club Marseille',
    address: '8 Boulevard du Rythme',
    city: 'Marseille',
    type: 'Club',
    referralId: 'DANCE-MARSEILLE',
    active: true,
    createdAt: new Date(),
  },
];

/**
 * Generate a unique referral code in format SPORT-XXXX
 */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'SPORT-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new user profile in Firestore
 */
export async function createUserProfile(
  uid: string,
  email: string,
  sports: string[],
  level: string,
  referredBy?: string
): Promise<UserProfile> {
  const referralCode = generateReferralCode();
  
  const userProfile: UserProfile = {
    uid,
    email,
    sports,
    level,
    referralCode,
    referredBy: referredBy || undefined,
    createdAt: new Date(),
  };

  // Save to Firestore only if configured
  if (isFirebaseConfigured && db) {
    await setDoc(doc(db, 'users', uid), {
      ...userProfile,
      createdAt: userProfile.createdAt.toISOString(),
    });
  } else {
    console.warn('Firebase not configured - profile stored locally only');
  }

  return userProfile;
}

/**
 * Get user profile by UID
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!isFirebaseConfigured || !db) {
    console.warn('Firebase not configured');
    return null;
  }
  
  const docRef = doc(db, 'users', uid);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      ...data,
      createdAt: new Date(data.createdAt),
    } as UserProfile;
  }
  return null;
}

/**
 * Find user by referral code
 */
export async function findUserByReferralCode(code: string): Promise<UserProfile | null> {
  if (!isFirebaseConfigured || !db) {
    console.warn('Firebase not configured');
    return null;
  }
  
  const q = query(collection(db, 'users'), where('referralCode', '==', code));
  const querySnapshot = await getDocs(q);
  
  if (!querySnapshot.empty) {
    const data = querySnapshot.docs[0].data();
    return {
      ...data,
      createdAt: new Date(data.createdAt),
    } as UserProfile;
  }
  return null;
}


/**
 * Register a new booking and update global stats
 * Works with Firestore if configured, otherwise uses localStorage
 */
export async function registerBooking(
  oderId: string,
  profileId: number,
  profileName: string,
  amount: number = 25
): Promise<{ booking: Booking; totalRevenue: number; useFirestore: boolean }> {
  const booking: Booking = {
    oderId,
    profileId,
    profileName,
    amount,
    currency: 'EUR',
    status: 'confirmed',
    createdAt: new Date(),
  };

  let totalRevenue = 0;
  let useFirestore = false;

  // Try Firestore first
  if (isFirebaseConfigured && db) {
    try {
      // Add booking document
      const bookingRef = await addDoc(collection(db, 'bookings'), {
        ...booking,
        createdAt: booking.createdAt.toISOString(),
      });
      booking.id = bookingRef.id;

      // Update global stats (create if doesn't exist)
      const statsRef = doc(db, 'stats', 'global');
      const statsSnap = await getDoc(statsRef);
      
      if (statsSnap.exists()) {
        await updateDoc(statsRef, {
          totalRevenue: increment(amount),
          totalBookings: increment(1),
          lastUpdated: new Date().toISOString(),
        });
        totalRevenue = statsSnap.data().totalRevenue + amount;
      } else {
        totalRevenue = 1250 + amount; // Initial value + new booking
        await setDoc(statsRef, {
          totalRevenue,
          totalBookings: 1,
          lastUpdated: new Date().toISOString(),
        });
      }

      useFirestore = true;
      console.log('[Firestore] Booking registered:', booking.id);
    } catch (error) {
      console.error('[Firestore] Error registering booking:', error);
      // Fall back to localStorage
    }
  }

  // Fallback to localStorage (demo mode)
  if (!useFirestore && typeof window !== 'undefined') {
    try {
      // Save booking
      const existingBookings = JSON.parse(localStorage.getItem(BOOKINGS_STORAGE_KEY) || '[]');
      booking.id = `local-${Date.now()}`;
      existingBookings.push({
        ...booking,
        createdAt: booking.createdAt.toISOString(),
      });
      localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(existingBookings));

      // Update revenue
      const currentRevenue = parseInt(localStorage.getItem(REVENUE_STORAGE_KEY) || '1250');
      totalRevenue = currentRevenue + amount;
      localStorage.setItem(REVENUE_STORAGE_KEY, totalRevenue.toString());

      // Save ticket
      const tickets = JSON.parse(localStorage.getItem(TICKETS_STORAGE_KEY) || '[]');
      if (!tickets.includes(profileId)) {
        tickets.push(profileId);
        localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(tickets));
      }

      console.log('[localStorage] Booking registered (demo mode)');
    } catch (e) {
      console.error('[localStorage] Error:', e);
    }
  }

  return { booking, totalRevenue, useFirestore };
}

/**
 * Get global stats (revenue, bookings count)
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  const defaultStats: GlobalStats = {
    totalRevenue: 1250,
    totalBookings: 0,
    lastUpdated: new Date(),
  };

  // Try Firestore first
  if (isFirebaseConfigured && db) {
    try {
      const statsRef = doc(db, 'stats', 'global');
      const statsSnap = await getDoc(statsRef);
      
      if (statsSnap.exists()) {
        const data = statsSnap.data();
        return {
          totalRevenue: data.totalRevenue || 1250,
          totalBookings: data.totalBookings || 0,
          lastUpdated: new Date(data.lastUpdated),
        };
      }
    } catch (error) {
      console.error('[Firestore] Error getting stats:', error);
    }
  }

  // Fallback to localStorage
  if (typeof window !== 'undefined') {
    try {
      const revenue = localStorage.getItem(REVENUE_STORAGE_KEY);
      const bookings = JSON.parse(localStorage.getItem(BOOKINGS_STORAGE_KEY) || '[]');
      
      return {
        totalRevenue: revenue ? parseInt(revenue) : 1250,
        totalBookings: bookings.length,
        lastUpdated: new Date(),
      };
    } catch (e) {
      console.error('[localStorage] Error getting stats:', e);
    }
  }

  return defaultStats;
}

/**
 * Get confirmed tickets for current session
 */
export function getConfirmedTickets(): number[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const tickets = localStorage.getItem(TICKETS_STORAGE_KEY);
    return tickets ? JSON.parse(tickets) : [];
  } catch (e) {
    return [];
  }
}

// ==================== PARTNERS FUNCTIONS ====================

/**
 * Generate a unique partner referral ID
 */
export function generatePartnerReferralId(name: string): string {
  const prefix = name.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 6);
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

/**
 * Get all partners
 */
export async function getPartners(): Promise<Partner[]> {
  // Try Firestore first
  if (isFirebaseConfigured && db) {
    try {
      const querySnapshot = await getDocs(collection(db, 'partners'));
      if (!querySnapshot.empty) {
        return querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: new Date(doc.data().createdAt),
        })) as Partner[];
      }
    } catch (error) {
      console.error('[Firestore] Error getting partners:', error);
    }
  }

  // Fallback to localStorage
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(PARTNERS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('[localStorage] Error getting partners:', e);
    }
  }

  return DEFAULT_PARTNERS;
}

/**
 * Add a new partner
 */
export async function addPartner(partner: Omit<Partner, 'id' | 'referralId' | 'createdAt'>): Promise<Partner> {
  const newPartner: Partner = {
    ...partner,
    id: `partner-${Date.now()}`,
    referralId: generatePartnerReferralId(partner.name),
    createdAt: new Date(),
  };

  // Try Firestore first
  if (isFirebaseConfigured && db) {
    try {
      const docRef = await addDoc(collection(db, 'partners'), {
        ...newPartner,
        createdAt: newPartner.createdAt.toISOString(),
      });
      newPartner.id = docRef.id;
      console.log('[Firestore] Partner added:', newPartner.id);
    } catch (error) {
      console.error('[Firestore] Error adding partner:', error);
    }
  }

  // Also save to localStorage
  if (typeof window !== 'undefined') {
    try {
      const existing = await getPartners();
      const updated = [...existing.filter(p => p.id !== newPartner.id), newPartner];
      localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('[localStorage] Error saving partner:', e);
    }
  }

  return newPartner;
}

/**
 * Delete a partner
 */
export async function deletePartner(partnerId: string): Promise<void> {
  // Try Firestore
  if (isFirebaseConfigured && db) {
    try {
      await deleteDoc(doc(db, 'partners', partnerId));
    } catch (error) {
      console.error('[Firestore] Error deleting partner:', error);
    }
  }

  // Update localStorage
  if (typeof window !== 'undefined') {
    try {
      const existing = await getPartners();
      const updated = existing.filter(p => p.id !== partnerId);
      localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('[localStorage] Error deleting partner:', e);
    }
  }
}

/**
 * Find partner by referral ID
 */
export async function findPartnerByReferralId(referralId: string): Promise<Partner | null> {
  const partners = await getPartners();
  return partners.find(p => p.referralId === referralId) || null;
}

/**
 * Get partner referral URL
 */
export function getPartnerReferralUrl(referralId: string): string {
  const baseUrl = typeof window !== 'undefined' 
    ? window.location.origin 
    : (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '');
  return `${baseUrl}/?ref=${referralId}`;
}

