/**
 * Spordateur V2 — Service Firestore central
 * Remplace l'ancien db.ts avec support complet de toutes les collections
 */

import { db, isFirebaseConfigured } from '@/lib/firebase';
import {
  doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, collection, where, orderBy, limit, onSnapshot,
  increment, serverTimestamp, Timestamp, writeBatch, runTransaction,
  type DocumentReference, type Query, type Unsubscribe, type Firestore,
  startAfter, type DocumentSnapshot, type FieldValue,
} from 'firebase/firestore';

import type {
  UserProfile, UserPreferences, Match, Activity, Booking,
  CreditEntry, Transaction, Creator, Partner, Referral,
  Payout, Chat, ChatMessage, Notification, ErrorLog,
  AnalyticsGlobal, AnalyticsDaily, CreditPackage, CreditType,
  Session, SessionStatus, PricingTier, PricingTierKind,
} from '@/types/firestore';
import { CREDIT_PACKAGES } from '@/types/firestore';

// ===================== HELPERS =====================

function getCollection(name: string) {
  if (!db) throw new Error('Firestore non initialisé');
  return collection(db, name);
}

function getDocRef(collectionName: string, docId: string) {
  if (!db) throw new Error('Firestore non initialisé');
  return doc(db, collectionName, docId);
}

/** Générer un code referral unique SPORT-XXXX */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'SPORT-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/** Date du jour au format YYYY-MM-DD */
function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

// ===================== USERS =====================

export async function createUser(data: Partial<UserProfile> & { uid: string; email: string }): Promise<UserProfile> {
  const user: Partial<UserProfile> = {
    uid: data.uid,
    email: data.email,
    displayName: data.displayName || '',
    photoURL: data.photoURL || '',
    bio: data.bio || '',
    gender: data.gender || 'other',
    city: data.city || '',
    canton: data.canton || '',
    sports: data.sports || [],
    credits: 0,
    referralCode: data.referralCode || generateReferralCode(),
    referredBy: data.referredBy || '',
    isCreator: false,
    role: 'user',
    isPremium: false,
    fcmToken: '',
    language: 'fr',
    onboardingComplete: false,
    lastActive: serverTimestamp() as unknown as Timestamp,
    createdAt: serverTimestamp() as unknown as Timestamp,
    updatedAt: serverTimestamp() as unknown as Timestamp,
  };

  await setDoc(getDocRef('users', data.uid), user);

  // Mettre à jour analytics global
  await updateAnalyticsOnNewUser();

  // Traiter le parrainage si referredBy existe
  if (data.referredBy) {
    await processReferralSignup(data.uid, data.referredBy);
  }

  return user as UserProfile;
}

export async function getUser(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(getDocRef('users', uid));
  return snap.exists() ? ({ ...snap.data(), uid: snap.id } as UserProfile) : null;
}

export async function updateUser(uid: string, data: Partial<UserProfile>): Promise<void> {
  await updateDoc(getDocRef('users', uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserCredits(uid: string, amount: number, type: CreditType, description: string, relatedId = ''): Promise<number> {
  if (!db) throw new Error('Firestore non initialisé');

  const batch = writeBatch(db);
  const userRef = getDocRef('users', uid);

  // Lire le solde actuel
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error('Utilisateur non trouvé');
  const currentCredits = userSnap.data().credits || 0;
  const newBalance = currentCredits + amount;

  if (newBalance < 0) throw new Error('Crédits insuffisants');

  // Mettre à jour le solde user
  batch.update(userRef, { credits: increment(amount), updatedAt: serverTimestamp() });

  // Créer l'entrée dans credits
  const creditRef = doc(getCollection('credits'));
  batch.set(creditRef, {
    creditId: creditRef.id,
    userId: uid,
    type,
    amount,
    balance: newBalance,
    description,
    relatedId,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  return newBalance;
}

export async function getUsersByReferralCode(code: string): Promise<UserProfile | null> {
  const q = query(getCollection('users'), where('referralCode', '==', code), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { ...snap.docs[0].data(), uid: snap.docs[0].id } as UserProfile;
}

// ===================== MATCHES =====================

export async function createMatch(data: Omit<Match, 'matchId' | 'createdAt'>): Promise<string> {
  if (!db) throw new Error('Firestore non initialisé');

  const ref = doc(getCollection('matches'));
  const matchData = {
    ...data,
    matchId: ref.id,
    userIds: data.userIds.sort(), // Toujours trié
    chatUnlocked: false,
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, matchData);

  // Créer le chat associé (chatId = matchId)
  await setDoc(getDocRef('chats', ref.id), {
    chatId: ref.id,
    participants: matchData.userIds,
    lastMessage: '',
    lastMessageAt: serverTimestamp(),
    unreadCount: { [matchData.userIds[0]]: 0, [matchData.userIds[1]]: 0 },
  });

  // Notifications aux 2 utilisateurs
  for (const uid of data.userIds) {
    await createNotification(uid, 'match', 'Nouveau match !', 'Tu as un nouveau Sport Date potentiel', { matchId: ref.id });
  }

  return ref.id;
}

export async function getMatch(matchId: string): Promise<Match | null> {
  const snap = await getDoc(getDocRef('matches', matchId));
  return snap.exists() ? (snap.data() as Match) : null;
}

export async function getUserMatches(uid: string, status?: string): Promise<Match[]> {
  try {
    let q: Query;
    if (status) {
      q = query(getCollection('matches'), where('userIds', 'array-contains', uid), where('status', '==', status), orderBy('createdAt', 'desc'));
    } else {
      q = query(getCollection('matches'), where('userIds', 'array-contains', uid), orderBy('createdAt', 'desc'));
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Match);
  } catch (err) {
    // Fallback: index might not be ready yet, try without orderBy
    console.warn('[getUserMatches] Index not ready, fetching without orderBy:', err);
    try {
      let q: Query;
      if (status) {
        q = query(getCollection('matches'), where('userIds', 'array-contains', uid), where('status', '==', status));
      } else {
        q = query(getCollection('matches'), where('userIds', 'array-contains', uid));
      }
      const snap = await getDocs(q);
      const matches = snap.docs.map(d => d.data() as Match);
      // Sort client-side
      matches.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.()?.getTime?.() || 0;
        const dateB = b.createdAt?.toDate?.()?.getTime?.() || 0;
        return dateB - dateA;
      });
      return matches;
    } catch (err2) {
      console.error('[getUserMatches] Fallback also failed:', err2);
      return [];
    }
  }
}

export async function updateMatch(matchId: string, data: Partial<Match>): Promise<void> {
  await updateDoc(getDocRef('matches', matchId), data);
}

export async function unlockChat(matchId: string): Promise<void> {
  if (!db) throw new Error('Firestore non initialisé');
  // Step 1: Unlock the match (update chatUnlocked to true)
  await updateDoc(getDocRef('matches', matchId), { chatUnlocked: true });
  // Step 2: Add system message (now that chatUnlocked is true, the rule allows it)
  try {
    const msgRef = doc(collection(db, 'chats', matchId, 'messages'));
    await setDoc(msgRef, {
      messageId: msgRef.id,
      senderId: 'system',
      text: 'Le chat est débloqué ! Planifiez votre Sport Date 🎾',
      type: 'system',
      readBy: [],
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-critical: webhook may also create this message
    console.warn('[unlockChat] System message creation failed (webhook may handle it):', err);
  }
}

// ===================== ACTIVITIES =====================

export async function createActivity(data: Omit<Activity, 'activityId' | 'createdAt' | 'updatedAt' | 'currentParticipants' | 'rating' | 'reviewCount'>): Promise<string> {
  const ref = doc(getCollection('activities'));
  await setDoc(ref, {
    ...data,
    activityId: ref.id,
    currentParticipants: 0,
    rating: 0,
    reviewCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getActivity(activityId: string): Promise<Activity | null> {
  const snap = await getDoc(getDocRef('activities', activityId));
  return snap.exists() ? (snap.data() as Activity) : null;
}

export async function getActivities(filters?: { city?: string; sport?: string; partnerId?: string }): Promise<Activity[]> {
  let q = query(getCollection('activities'), where('isActive', '==', true), orderBy('createdAt', 'desc'));

  if (filters?.city) {
    q = query(getCollection('activities'), where('isActive', '==', true), where('city', '==', filters.city), orderBy('createdAt', 'desc'));
  }
  if (filters?.sport) {
    q = query(getCollection('activities'), where('isActive', '==', true), where('sport', '==', filters.sport), orderBy('createdAt', 'desc'));
  }
  if (filters?.partnerId) {
    q = query(getCollection('activities'), where('partnerId', '==', filters.partnerId), orderBy('createdAt', 'desc'));
  }

  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Activity);
}

export async function updateActivity(activityId: string, data: Partial<Activity>): Promise<void> {
  await updateDoc(getDocRef('activities', activityId), { ...data, updatedAt: serverTimestamp() });
}

// ===================== BOOKINGS =====================

export async function createBooking(data: Omit<Booking, 'bookingId' | 'createdAt' | 'updatedAt'>): Promise<string> {
  if (!db) throw new Error('Firestore non initialisé');
  const batch = writeBatch(db);

  const ref = doc(getCollection('bookings'));
  batch.set(ref, {
    ...data,
    bookingId: ref.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Si un match est lié, débloquer le chat
  if (data.matchId && data.status === 'confirmed') {
    batch.update(getDocRef('matches', data.matchId), { chatUnlocked: true });
  }

  // Mettre à jour les participants de l'activité
  if (data.activityId) {
    batch.update(getDocRef('activities', data.activityId), {
      currentParticipants: increment(data.ticketType === 'duo' ? 2 : 1),
    });
  }

  await batch.commit();

  // Notification
  await createNotification(data.userId, 'booking', 'Réservation confirmée !', `Ton ${data.sport} est réservé`, { bookingId: ref.id });

  // Analytics
  await updateAnalyticsOnBooking(data);

  return ref.id;
}

export async function getUserBookings(userId: string): Promise<Booking[]> {
  const q = query(getCollection('bookings'), where('userId', '==', userId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Booking);
}

export async function updateBooking(bookingId: string, data: Partial<Booking>): Promise<void> {
  await updateDoc(getDocRef('bookings', bookingId), { ...data, updatedAt: serverTimestamp() });
}

// ===================== TRANSACTIONS =====================

export async function createTransaction(data: Omit<Transaction, 'transactionId' | 'createdAt'>): Promise<string> {
  const ref = doc(getCollection('transactions'));
  await setDoc(ref, {
    ...data,
    transactionId: ref.id,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getTransactionByStripeSession(sessionId: string): Promise<Transaction | null> {
  const q = query(getCollection('transactions'), where('stripeSessionId', '==', sessionId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data() as Transaction;
}

export async function updateTransaction(transactionId: string, data: Partial<Transaction>): Promise<void> {
  await updateDoc(getDocRef('transactions', transactionId), data);
}

// ===================== CREATORS & AFFILIATION =====================

export async function createCreator(uid: string, displayName: string): Promise<Creator> {
  const user = await getUser(uid);
  const referralCode = user?.referralCode || generateReferralCode();

  const creator: Partial<Creator> = {
    creatorId: uid,
    displayName,
    referralCode,
    referralLink: `https://spordateur.com/?ref=${referralCode}`,
    commissionRate: 0.10, // 10% par défaut
    totalEarnings: 0,
    pendingPayout: 0,
    totalReferrals: 0,
    totalPurchases: 0,
    isActive: true,
    payoutMethod: 'twint',
    payoutDetails: {},
    createdAt: serverTimestamp() as unknown as Timestamp,
  };

  await setDoc(getDocRef('creators', uid), creator);
  await updateUser(uid, { isCreator: true, role: 'creator' });

  return creator as Creator;
}

export async function getCreator(creatorId: string): Promise<Creator | null> {
  const snap = await getDoc(getDocRef('creators', creatorId));
  return snap.exists() ? (snap.data() as Creator) : null;
}

async function processReferralSignup(newUserId: string, referralCode: string): Promise<void> {
  // Trouver le créateur par son code
  const q = query(getCollection('creators'), where('referralCode', '==', referralCode), limit(1));
  const snap = await getDocs(q);

  if (snap.empty) {
    // Peut-être un user normal qui a parrainé
    const userSnap = await getUsersByReferralCode(referralCode);
    if (!userSnap) return;
    // Créer automatiquement un profil créateur
    await createCreator(userSnap.uid, userSnap.displayName);
  }

  const creatorDoc = snap.empty ? null : snap.docs[0];
  const creatorId = creatorDoc?.id || (await getUsersByReferralCode(referralCode))?.uid;
  if (!creatorId) return;

  // Anti self-referral
  if (creatorId === newUserId) return;

  // Créer le document referral
  const ref = doc(getCollection('referrals'));
  await setDoc(ref, {
    referralId: ref.id,
    referrerId: creatorId,
    referredUserId: newUserId,
    referralCode,
    status: 'registered',
    totalPurchases: 0,
    totalCommission: 0,
    createdAt: serverTimestamp(),
  });

  // Incrémenter le compteur du créateur
  await updateDoc(getDocRef('creators', creatorId), {
    totalReferrals: increment(1),
  });
}

export async function processReferralPurchase(userId: string, amount: number): Promise<void> {
  // Trouver le referral de cet utilisateur
  const q = query(getCollection('referrals'), where('referredUserId', '==', userId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return;

  const referral = snap.docs[0].data() as Referral;
  const creator = await getCreator(referral.referrerId);
  if (!creator || !creator.isActive) return;

  const commission = Math.round(amount * creator.commissionRate); // En centimes

  if (!db) return;
  const batch = writeBatch(db);

  // MAJ referral
  batch.update(snap.docs[0].ref, {
    totalPurchases: increment(1),
    totalCommission: increment(commission),
    status: referral.status === 'registered' ? 'first_purchase' : 'active',
  });

  // MAJ créateur
  batch.update(getDocRef('creators', referral.referrerId), {
    totalEarnings: increment(commission),
    pendingPayout: increment(commission),
    totalPurchases: increment(1),
  });

  await batch.commit();
}

export async function getCreatorReferrals(creatorId: string): Promise<Referral[]> {
  const q = query(getCollection('referrals'), where('referrerId', '==', creatorId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Referral);
}

// ===================== PARTNERS =====================

export async function createPartner(data: Omit<Partner, 'partnerId' | 'createdAt' | 'updatedAt' | 'totalBookings' | 'totalRevenue' | 'rating' | 'reviewCount'>): Promise<string> {
  const ref = doc(getCollection('partners'));
  await setDoc(ref, {
    ...data,
    partnerId: ref.id,
    totalBookings: 0,
    totalRevenue: 0,
    rating: 0,
    reviewCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getPartner(partnerId: string): Promise<Partner | null> {
  const snap = await getDoc(getDocRef('partners', partnerId));
  return snap.exists() ? (snap.data() as Partner) : null;
}

export async function getPartners(onlyActive = true): Promise<Partner[]> {
  let q;
  if (onlyActive) {
    q = query(getCollection('partners'), where('isActive', '==', true), where('isApproved', '==', true));
  } else {
    q = query(getCollection('partners'), orderBy('createdAt', 'desc'));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Partner);
}

export async function updatePartner(partnerId: string, data: Partial<Partner>): Promise<void> {
  await updateDoc(getDocRef('partners', partnerId), { ...data, updatedAt: serverTimestamp() });
}

// ===================== PAYOUTS =====================

export async function requestPayout(creatorId: string, amount: number, method: 'twint' | 'bank_transfer', details: Record<string, string>): Promise<string> {
  const creator = await getCreator(creatorId);
  if (!creator) throw new Error('Créateur non trouvé');
  if (creator.pendingPayout < amount) throw new Error('Solde insuffisant');

  const ref = doc(getCollection('payouts'));
  await setDoc(ref, {
    payoutId: ref.id,
    creatorId,
    amount,
    method,
    details,
    status: 'requested',
    processedBy: '',
    processedAt: null,
    createdAt: serverTimestamp(),
  });

  return ref.id;
}

export async function processPayoutAdmin(payoutId: string, adminId: string, approve: boolean): Promise<void> {
  if (!db) throw new Error('Firestore non initialisé');
  const payoutSnap = await getDoc(getDocRef('payouts', payoutId));
  if (!payoutSnap.exists()) throw new Error('Payout non trouvé');
  const payout = payoutSnap.data() as Payout;

  const batch = writeBatch(db);

  if (approve) {
    batch.update(getDocRef('payouts', payoutId), {
      status: 'completed',
      processedBy: adminId,
      processedAt: serverTimestamp(),
    });
    // Déduire du pendingPayout du créateur
    batch.update(getDocRef('creators', payout.creatorId), {
      pendingPayout: increment(-payout.amount),
    });
  } else {
    batch.update(getDocRef('payouts', payoutId), {
      status: 'rejected',
      processedBy: adminId,
      processedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

// ===================== CHAT =====================

export async function sendMessage(chatId: string, senderId: string, text: string): Promise<string> {
  if (!db) throw new Error('Firestore non initialisé');

  // Vérifier que le chat est débloqué
  const match = await getMatch(chatId);
  if (!match?.chatUnlocked) throw new Error('Chat verrouillé — réserve une activité pour débloquer');

  const msgRef = doc(collection(db, 'chats', chatId, 'messages'));
  await setDoc(msgRef, {
    messageId: msgRef.id,
    senderId,
    text,
    type: 'text',
    readBy: [senderId],
    createdAt: serverTimestamp(),
  });

  // MAJ le chat principal
  const otherUser = match.userIds.find(id => id !== senderId) || '';
  await updateDoc(getDocRef('chats', chatId), {
    lastMessage: text,
    lastMessageAt: serverTimestamp(),
    [`unreadCount.${otherUser}`]: increment(1),
  });

  // Notification à l'autre utilisateur
  await createNotification(otherUser, 'message', 'Nouveau message', text.substring(0, 50), { chatId });

  return msgRef.id;
}

export function subscribeToMessages(chatId: string, callback: (messages: ChatMessage[]) => void): Unsubscribe {
  if (!db) throw new Error('Firestore non initialisé');
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => d.data() as ChatMessage));
  });
}

export async function markMessagesRead(chatId: string, userId: string): Promise<void> {
  await updateDoc(getDocRef('chats', chatId), {
    [`unreadCount.${userId}`]: 0,
  });
}

// ===================== NOTIFICATIONS =====================

export async function createNotification(userId: string, type: string, title: string, body: string, data: Record<string, string> = {}): Promise<void> {
  const ref = doc(getCollection('notifications'));
  await setDoc(ref, {
    notificationId: ref.id,
    userId,
    type,
    title,
    body,
    data,
    isRead: false,
    createdAt: serverTimestamp(),
  });
}

export async function getUserNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
  let q;
  if (unreadOnly) {
    q = query(getCollection('notifications'), where('userId', '==', userId), where('isRead', '==', false), orderBy('createdAt', 'desc'), limit(50));
  } else {
    q = query(getCollection('notifications'), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Notification);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await updateDoc(getDocRef('notifications', notificationId), { isRead: true });
}

// ===================== ERROR LOGS (Auto-correction) =====================

export async function logError(data: Omit<ErrorLog, 'logId' | 'resolved' | 'resolvedAt' | 'createdAt'>): Promise<string> {
  const ref = doc(getCollection('errorLogs'));
  await setDoc(ref, {
    ...data,
    logId: ref.id,
    resolved: false,
    resolvedAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getUnresolvedErrors(): Promise<ErrorLog[]> {
  const q = query(getCollection('errorLogs'), where('resolved', '==', false), orderBy('createdAt', 'desc'), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as ErrorLog);
}

export async function resolveError(logId: string): Promise<void> {
  await updateDoc(getDocRef('errorLogs', logId), {
    resolved: true,
    resolvedAt: serverTimestamp(),
  });
}

// ===================== ANALYTICS =====================

async function updateAnalyticsOnNewUser(): Promise<void> {
  try {
    const globalRef = getDocRef('analytics', 'global');
    const snap = await getDoc(globalRef);
    if (snap.exists()) {
      await updateDoc(globalRef, { totalUsers: increment(1), lastUpdated: serverTimestamp() });
    } else {
      await setDoc(globalRef, {
        totalRevenue: 0,
        totalUsers: 1,
        totalBookings: 0,
        totalMatches: 0,
        totalPartners: 0,
        totalCreators: 0,
        lastUpdated: serverTimestamp(),
      });
    }

    // Analytics du jour
    const dailyRef = getDocRef('analytics', `daily_${todayString()}`);
    const dailySnap = await getDoc(dailyRef);
    if (dailySnap.exists()) {
      await updateDoc(dailyRef, { newUsers: increment(1) });
    } else {
      await setDoc(dailyRef, {
        date: todayString(),
        revenue: 0, newUsers: 1, bookings: 0, matches: 0,
        creditsPurchased: 0, creditsUsed: 0,
        byCity: {}, bySport: {}, byPartner: {}, byCreator: {}, byPaymentMethod: {},
      });
    }
  } catch (e) {
    console.error('[Analytics] Erreur MAJ user:', e);
  }
}

async function updateAnalyticsOnBooking(data: Omit<Booking, 'bookingId' | 'createdAt' | 'updatedAt'>): Promise<void> {
  try {
    // Global
    await updateDoc(getDocRef('analytics', 'global'), {
      totalBookings: increment(1),
      lastUpdated: serverTimestamp(),
    });

    // Daily
    const dailyRef = getDocRef('analytics', `daily_${todayString()}`);
    const dailySnap = await getDoc(dailyRef);
    if (dailySnap.exists()) {
      await updateDoc(dailyRef, { bookings: increment(1) });
    }
  } catch (e) {
    console.error('[Analytics] Erreur MAJ booking:', e);
  }
}

export async function updateAnalyticsOnPayment(amount: number, paymentMethod: string, city?: string, sport?: string, partnerId?: string, creatorId?: string): Promise<void> {
  try {
    const amountCHF = amount / 100; // Centimes → CHF

    // Global
    const globalRef = getDocRef('analytics', 'global');
    await updateDoc(globalRef, {
      totalRevenue: increment(amountCHF),
      lastUpdated: serverTimestamp(),
    });

    // Daily
    const dailyRef = getDocRef('analytics', `daily_${todayString()}`);
    const dailySnap = await getDoc(dailyRef);

    const updates: Record<string, FieldValue> = {
      revenue: increment(amountCHF),
      creditsPurchased: increment(1),
      [`byPaymentMethod.${paymentMethod}`]: increment(amountCHF),
    };

    if (city) updates[`byCity.${city}.revenue`] = increment(amountCHF);
    if (sport) updates[`bySport.${sport}.revenue`] = increment(amountCHF);
    if (partnerId) updates[`byPartner.${partnerId}.revenue`] = increment(amountCHF);
    if (creatorId) updates[`byCreator.${creatorId}.revenue`] = increment(amountCHF);

    if (dailySnap.exists()) {
      await updateDoc(dailyRef, updates);
    } else {
      await setDoc(dailyRef, {
        date: todayString(),
        revenue: amountCHF, newUsers: 0, bookings: 0, matches: 0,
        creditsPurchased: 1, creditsUsed: 0,
        byCity: city ? { [city]: { revenue: amountCHF, bookings: 0 } } : {},
        bySport: sport ? { [sport]: { revenue: amountCHF, bookings: 0 } } : {},
        byPartner: partnerId ? { [partnerId]: { revenue: amountCHF, bookings: 0 } } : {},
        byCreator: creatorId ? { [creatorId]: { revenue: amountCHF, referrals: 0 } } : {},
        byPaymentMethod: { [paymentMethod]: amountCHF },
      });
    }
  } catch (e) {
    console.error('[Analytics] Erreur MAJ paiement:', e);
  }
}

export async function getAnalyticsGlobal(): Promise<AnalyticsGlobal | null> {
  const snap = await getDoc(getDocRef('analytics', 'global'));
  return snap.exists() ? (snap.data() as AnalyticsGlobal) : null;
}

export async function getAnalyticsDaily(date: string): Promise<AnalyticsDaily | null> {
  const snap = await getDoc(getDocRef('analytics', `daily_${date}`));
  return snap.exists() ? (snap.data() as AnalyticsDaily) : null;
}

/** Écouter les analytics global en temps réel */
export function subscribeToAnalytics(callback: (data: AnalyticsGlobal) => void): Unsubscribe {
  return onSnapshot(getDocRef('analytics', 'global'), (snap) => {
    if (snap.exists()) callback(snap.data() as AnalyticsGlobal);
  });
}

// ===================== ADMIN =====================

export async function getAllUsers(limitCount = 50): Promise<UserProfile[]> {
  const q = query(getCollection('users'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile));
}

export async function getAllTransactions(limitCount = 50): Promise<Transaction[]> {
  const q = query(getCollection('transactions'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Transaction);
}

export async function getAllBookings(limitCount = 50): Promise<Booking[]> {
  const q = query(getCollection('bookings'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Booking);
}

export async function getAllPayouts(status?: string): Promise<Payout[]> {
  let q;
  if (status) {
    q = query(getCollection('payouts'), where('status', '==', status), orderBy('createdAt', 'desc'));
  } else {
    q = query(getCollection('payouts'), orderBy('createdAt', 'desc'));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Payout);
}

export async function banUser(uid: string): Promise<void> {
  await updateUser(uid, { role: 'user' as const } as Partial<UserProfile>);
  // On pourrait ajouter un champ "banned: true" si nécessaire
}

export async function sendGlobalNotification(title: string, body: string): Promise<void> {
  const users = await getAllUsers(500);
  const batch = writeBatch(db!);

  for (const user of users) {
    const ref = doc(getCollection('notifications'));
    batch.set(ref, {
      notificationId: ref.id,
      userId: user.uid,
      type: 'system',
      title,
      body,
      data: {},
      isRead: false,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

// ===================== SESSIONS =====================
// Phase 2 du système "Dates par Activités" — fonctions PURES uniquement (étape 4.A).
// Les CRUD et bookSession seront ajoutés en étape 4.B.
//
// Convention : les fonctions de cette section sont SANS effet de bord côté Firestore (pures).
// Elles peuvent être appelées côté client (UI countdown live, page détail) ET côté serveur
// (webhook Stripe en Phase 3) sans dépendance à Firebase Admin SDK.

// ----- Inputs interfaces -----

/** Input pour créer une session (4.B). Définie ici pour cohérence du typage. */
export interface CreateSessionInput {
  activityId: string;
  startAt: Date;
  endAt: Date;
  maxParticipants: number;
  /** Si omis : copie depuis activity.defaultPricingTiers. */
  pricingTiers?: PricingTier[];
  /** Si omis : activity.chatOpenOffsetMinutes ?? 120. */
  chatOpenOffsetMinutes?: number;
}

/** Filtres pour getUpcomingSessions / getCompletedSessions (4.B). */
export interface SessionFilters {
  city?: string;
  sport?: string;
  partnerId?: string;
  creatorId?: string;
  /** Défaut 20. */
  limit?: number;
}

/** Input pour bookSession (4.B). paymentIntentId sert de clé d'idempotency. */
export interface BookSessionInput {
  sessionId: string;
  userId: string;
  /** En CHF centimes (cohérent avec Transaction.amount, Stripe unit_amount). */
  amount: number;
  /** Palier actif au moment du paiement (pour traçabilité). */
  tier: PricingTierKind;
  /** Référence Stripe — si un booking existe déjà pour ce paymentIntentId, l'opération est idempotente. */
  paymentIntentId: string;
  /** Optionnel — si la réservation est liée à un match (Phase 6). */
  matchId?: string;
}

// ----- Helpers internes (non exportés) -----

/** Calcule un taux de remplissage (0..) en évitant la division par zéro. */
function computeFillRate(currentParticipants: number, maxParticipants: number): number {
  if (maxParticipants <= 0) return 0;
  return currentParticipants / maxParticipants;
}

// ----- Fonctions pures exportées -----

/**
 * Calcule la fenêtre temporelle du chat à partir d'inputs primitifs.
 * - chatOpenAt = startAt - chatOpenOffsetMinutes
 * - chatCloseAt = endAt
 *
 * Fonction pure, pas d'accès Firestore. Utilisable côté client et serveur.
 */
export function computeChatWindow(
  startAt: Date,
  endAt: Date,
  chatOpenOffsetMinutes: number,
): { chatOpenAt: Timestamp; chatCloseAt: Timestamp } {
  const openAtMs = startAt.getTime() - chatOpenOffsetMinutes * 60_000;
  return {
    chatOpenAt: Timestamp.fromMillis(openAtMs),
    chatCloseAt: Timestamp.fromDate(endAt),
  };
}

/**
 * Détermine la phase actuelle de la fenêtre chat pour une session :
 * - 'before'    : now < chatOpenAt (chat pas encore ouvert)
 * - 'chat-open' : chatOpenAt <= now < startAt (chat ouvert, événement pas commencé)
 * - 'started'   : startAt <= now < chatCloseAt (événement en cours)
 * - 'ended'     : now >= chatCloseAt (chat archivé en lecture seule)
 *
 * Fonction pure.
 */
export function getChatPhase(
  session: Pick<Session, 'chatOpenAt' | 'chatCloseAt' | 'startAt' | 'endAt'>,
  now: Date,
): 'before' | 'chat-open' | 'started' | 'ended' {
  const nowMs = now.getTime();
  const openAtMs = session.chatOpenAt.toMillis();
  const startAtMs = session.startAt.toMillis();
  const closeAtMs = session.chatCloseAt.toMillis();

  if (nowMs < openAtMs) return 'before';
  if (nowMs < startAtMs) return 'chat-open';
  if (nowMs < closeAtMs) return 'started';
  return 'ended';
}

/**
 * Renvoie true si la session est encore réservable :
 * - status est 'scheduled' ou 'open'
 * - currentParticipants < maxParticipants
 * - startAt > now (événement futur)
 *
 * Fonction pure.
 */
export function isSessionBookable(session: Session, now: Date): boolean {
  const isOpenStatus = session.status === 'scheduled' || session.status === 'open';
  const hasRoom = session.currentParticipants < session.maxParticipants;
  const isFuture = session.startAt.toMillis() > now.getTime();
  return isOpenStatus && hasRoom && isFuture;
}

/**
 * Calcule le palier de prix ACTIF pour une session à un instant T.
 *
 * Logique :
 * - Le palier actif est le PLUS HAUT (rang : early < standard < last_minute) dont AU MOINS
 *   UNE des deux conditions est satisfaite (temps OU remplissage). Si aucune n'est satisfaite,
 *   le palier 'early' s'applique par défaut.
 * - Condition temporelle : minutesUntilStart <= activateMinutesBeforeStart (inclusif).
 * - Condition remplissage : fillRate >= activateAtFillRate (inclusif).
 * - Si activateMinutesBeforeStart est null, la condition temporelle ne se déclenche jamais.
 * - Si activateAtFillRate est null, la condition remplissage ne se déclenche jamais.
 *
 * Edge cases :
 * - pricingTiers vide → tier='early', price=0
 * - pricingTiers sans 'early' → fallback price=0 (pas de prix early trouvé)
 * - maxParticipants=0 → fillRate=0 (pas de division par zéro)
 * - now > startAt → minutesUntilStart négatif → tous les paliers temporels déclenchent
 * - currentParticipants > maxParticipants → fillRate > 1.0 → palier 'last_minute' déclenché
 *
 * Fonction pure, idempotente, sans accès Firestore.
 *
 * @param session La session à analyser.
 * @param now Date courante (injectée pour faciliter les tests).
 * @param currentParticipantsOverride Optionnel — surcharge le compteur de la session
 *   (utile pour calculer le tier APRÈS un nouvel ajout, sans avoir à muter la session).
 *
 * @returns
 *   - tier : kind du palier actif ('early' | 'standard' | 'last_minute')
 *   - price : prix en CHF centimes du palier actif
 *   - passedTiers : kinds des paliers de rang inférieur (utiles pour UI : prix barrés)
 */
export function computePricingTier(
  session: Session,
  now: Date,
  currentParticipantsOverride?: number,
): { tier: PricingTierKind; price: number; passedTiers: PricingTierKind[] } {
  const tiers = session.pricingTiers || [];
  const rank: Record<PricingTierKind, number> = { early: 0, standard: 1, last_minute: 2 };

  // Default fallback : 'early' avec price = prix du tier 'early' s'il existe, sinon 0.
  const earlyTier = tiers.find((t) => t.kind === 'early');
  let activeTier: PricingTierKind = 'early';
  let activePrice: number = earlyTier?.price ?? 0;

  // Calculs de contexte (temps et remplissage).
  const minutesUntilStart = (session.startAt.toMillis() - now.getTime()) / 60_000;
  const participants = currentParticipantsOverride ?? session.currentParticipants;
  const fillRate = computeFillRate(participants, session.maxParticipants);

  // Parcours des paliers par rang croissant ; le DERNIER triggered devient l'actif (= le plus haut).
  const sortedTiers = [...tiers].sort((a, b) => rank[a.kind] - rank[b.kind]);
  for (const tier of sortedTiers) {
    const timeTriggers =
      tier.activateMinutesBeforeStart !== null &&
      minutesUntilStart <= tier.activateMinutesBeforeStart;
    const fillTriggers =
      tier.activateAtFillRate !== null && fillRate >= tier.activateAtFillRate;

    if (timeTriggers || fillTriggers) {
      activeTier = tier.kind;
      activePrice = tier.price;
    }
  }

  // passedTiers = tous les kinds de rang inférieur au tier actif (pour UI : prix barrés).
  const activeRank = rank[activeTier];
  const allKinds: PricingTierKind[] = ['early', 'standard', 'last_minute'];
  const passedTiers = allKinds.filter((k) => rank[k] < activeRank);

  return { tier: activeTier, price: activePrice, passedTiers };
}

// ----- Test seam (étape 4.B) -----
// Pour permettre aux tests d'intégration emulator d'injecter un Firestore alternatif.
// En prod, ce override reste null et les fonctions utilisent la `db` globale de @/lib/firebase.

let _sessionsDbOverride: Firestore | null = null;

/**
 * @internal — utilisé UNIQUEMENT par les tests pour injecter un Firestore
 * connecté à l'emulator (cf. tests/sessions-integration.test.ts).
 * Ne JAMAIS appeler depuis le code de production.
 */
export function __setSessionsDbForTesting(testDb: Firestore | null): void {
  _sessionsDbOverride = testDb;
}

/** Récupère le Firestore actif pour les fonctions Sessions (test override OU prod global). */
function getSessionsDb(): Firestore {
  const fbDb = _sessionsDbOverride ?? db;
  if (!fbDb) throw new Error('Firestore non initialisé');
  return fbDb;
}

// ----- CRUD Sessions -----

/**
 * Crée une nouvelle session datée à partir d'une activity template.
 *
 * Comportement :
 * 1. Lit l'activity (doit exister) pour récupérer partnerId, createdBy, sport, title, city,
 *    defaultPricingTiers, chatOpenOffsetMinutes.
 * 2. Si input.pricingTiers est fourni, l'utilise tel quel ; sinon copie depuis activity.defaultPricingTiers.
 * 3. Si aucun pricingTiers n'est disponible (ni input ni default sur l'activity) → throw.
 * 4. Calcule chatOpenAt et chatCloseAt depuis input.startAt/endAt et l'offset.
 * 5. Initialise currentTier='early', currentPrice = (tier early)?.price ?? 0.
 * 6. status='scheduled' à la création (l'admin / partner publiera ensuite à 'open').
 *
 * Permission Firestore : l'appelant doit être le partnerId de l'activity, ou admin.
 *
 * @returns sessionId de la session créée.
 * @throws si activity introuvable, si pas de pricingTiers disponibles, si rules denied.
 */
export async function createSession(input: CreateSessionInput): Promise<string> {
  const fbDb = getSessionsDb();

  // 1. Lire l'activity
  const activitySnap = await getDoc(doc(fbDb, 'activities', input.activityId));
  if (!activitySnap.exists()) throw new Error('Activity introuvable');
  const activity = activitySnap.data() as Activity;

  // 2. Résoudre les pricingTiers
  const pricingTiers = input.pricingTiers ?? activity.defaultPricingTiers;
  if (!pricingTiers || pricingTiers.length === 0) {
    throw new Error('Pas de pricingTiers disponibles (ni input.pricingTiers ni activity.defaultPricingTiers)');
  }

  // 3. Calculer la fenêtre chat
  const chatOpenOffsetMinutes = input.chatOpenOffsetMinutes ?? activity.chatOpenOffsetMinutes ?? 120;
  const { chatOpenAt, chatCloseAt } = computeChatWindow(input.startAt, input.endAt, chatOpenOffsetMinutes);

  // 4. Initialiser le palier actif
  const earlyTier = pricingTiers.find((t) => t.kind === 'early');
  const initialPrice = earlyTier?.price ?? 0;

  // 5. Créer le doc
  const ref = doc(collection(fbDb, 'sessions'));
  const sessionData: Session = {
    sessionId: ref.id,
    activityId: input.activityId,
    partnerId: activity.partnerId,
    creatorId: activity.createdBy, // l'auteur de l'activity = creator (peut être affiné Phase 5+)
    sport: activity.sport,
    title: activity.title,
    city: activity.city,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: Timestamp.fromDate(input.endAt),
    chatOpenAt,
    chatCloseAt,
    maxParticipants: input.maxParticipants,
    currentParticipants: 0,
    pricingTiers,
    currentTier: 'early',
    currentPrice: initialPrice,
    status: 'scheduled',
    createdBy: activity.partnerId,
    createdAt: serverTimestamp() as unknown as Timestamp,
    updatedAt: serverTimestamp() as unknown as Timestamp,
  };

  await setDoc(ref, sessionData);
  return ref.id;
}

/** Lecture one-shot d'une session par ID. Retourne null si absente. */
export async function getSession(sessionId: string): Promise<Session | null> {
  const fbDb = getSessionsDb();
  const snap = await getDoc(doc(fbDb, 'sessions', sessionId));
  return snap.exists() ? (snap.data() as Session) : null;
}

/**
 * Subscribe en temps réel à une session (pour la page détail avec countdown live).
 * Retourne la fonction unsubscribe. Le callback reçoit null si le doc est supprimé.
 */
export function subscribeToSession(
  sessionId: string,
  callback: (session: Session | null) => void,
): Unsubscribe {
  const fbDb = getSessionsDb();
  return onSnapshot(doc(fbDb, 'sessions', sessionId), (snap) => {
    callback(snap.exists() ? (snap.data() as Session) : null);
  });
}

/**
 * Liste paginée des sessions à venir (status in ['scheduled', 'open']) triées par startAt ASC.
 * Filtres optionnels : ville, sport, partnerId, creatorId.
 *
 * Pattern fallback : si l'index composite n'est pas encore déployé en prod, on retombe sur
 * une requête sans orderBy + tri client-side (cf. getUserMatches).
 */
export async function getUpcomingSessions(filters?: SessionFilters): Promise<Session[]> {
  const fbDb = getSessionsDb();
  const lim = filters?.limit ?? 20;

  const buildBaseQuery = (withOrderBy: boolean) => {
    const conditions: ReturnType<typeof where>[] = [where('status', 'in', ['scheduled', 'open'])];
    if (filters?.sport) conditions.push(where('sport', '==', filters.sport));
    if (filters?.city) conditions.push(where('city', '==', filters.city));
    if (filters?.partnerId) conditions.push(where('partnerId', '==', filters.partnerId));
    if (filters?.creatorId) conditions.push(where('creatorId', '==', filters.creatorId));

    if (withOrderBy) {
      return query(collection(fbDb, 'sessions'), ...conditions, orderBy('startAt', 'asc'), limit(lim));
    }
    return query(collection(fbDb, 'sessions'), ...conditions, limit(lim * 3));
  };

  try {
    const snap = await getDocs(buildBaseQuery(true));
    return snap.docs.map((d) => d.data() as Session);
  } catch (err) {
    console.warn('[getUpcomingSessions] Index pas prêt, fallback sans orderBy:', err);
    try {
      const snap = await getDocs(buildBaseQuery(false));
      const sessions = snap.docs.map((d) => d.data() as Session);
      sessions.sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
      return sessions.slice(0, lim);
    } catch (err2) {
      console.error('[getUpcomingSessions] Fallback échoué:', err2);
      return [];
    }
  }
}

/**
 * Liste des sessions terminées (status='completed'), triées par endAt DESC.
 * Pour la section "Ils l'ont vécu" (social proof).
 *
 * Note : Phase 1 n'a pas d'index `(status, endAt DESC)` ; on fait une requête sur status seule
 * + tri client-side. Acceptable tant qu'on n'a pas trop de sessions completed.
 */
export async function getCompletedSessions(filters?: {
  limit?: number;
  sport?: string;
  city?: string;
}): Promise<Session[]> {
  const fbDb = getSessionsDb();
  const lim = filters?.limit ?? 20;

  try {
    const conditions: ReturnType<typeof where>[] = [where('status', '==', 'completed')];
    if (filters?.sport) conditions.push(where('sport', '==', filters.sport));
    if (filters?.city) conditions.push(where('city', '==', filters.city));

    const q = query(collection(fbDb, 'sessions'), ...conditions, limit(lim * 3));
    const snap = await getDocs(q);
    const sessions = snap.docs.map((d) => d.data() as Session);
    sessions.sort((a, b) => b.endAt.toMillis() - a.endAt.toMillis());
    return sessions.slice(0, lim);
  } catch (err) {
    console.error('[getCompletedSessions] Erreur:', err);
    return [];
  }
}

/** Sessions d'une activity spécifique, triées par startAt ASC. */
export async function getSessionsByActivity(activityId: string): Promise<Session[]> {
  const fbDb = getSessionsDb();

  try {
    const q = query(
      collection(fbDb, 'sessions'),
      where('activityId', '==', activityId),
      orderBy('startAt', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Session);
  } catch (err) {
    console.warn('[getSessionsByActivity] Index pas prêt, fallback:', err);
    try {
      const q = query(collection(fbDb, 'sessions'), where('activityId', '==', activityId));
      const snap = await getDocs(q);
      const sessions = snap.docs.map((d) => d.data() as Session);
      sessions.sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
      return sessions;
    } catch (err2) {
      console.error('[getSessionsByActivity] Fallback échoué:', err2);
      return [];
    }
  }
}

// ----- Update partiel (Phase 6 anti-cheat V7) -----

/**
 * Update partiel d'une session avec validation anti-cheat.
 *
 * À utiliser obligatoirement Phase 7+ par tout code serveur qui mute une session
 * (admin UI, partner dashboard, etc.). NE remplace PAS bookSession (qui a sa propre tx
 * pour gérer currentParticipants).
 *
 * Validations actuelles (Phase 6 chantier B) :
 * - V7 : maxParticipants (si présent dans updates) ≥ session.currentParticipants actuel.
 *
 * Validations FUTURES (chantier C / Phase 8) :
 * - C : pricingTiers freeze après 1er booking (currentParticipants > 0)
 * - 8 : status downgrade prevention (e.g. 'completed' → 'open' interdit)
 * - 8 : startAt ne peut pas devenir < now sur session active
 *
 * Champs explicitement exclus du Pick<> (réservés webhook Stripe Phase 3 + cron Phase 6) :
 * - currentParticipants, currentTier, currentPrice
 *
 * Defense en 2 couches : si appelé côté client, les rules Phase 6
 * (validMaxParticipantsUpdate) bloqueront aussi un downgrade illégitime.
 *
 * @param sessionId  ID de la session à updater
 * @param updates    Champs à modifier (Partial). Server-managed fields excluded by type.
 * @throws Error('session-not-found') si la session n'existe pas
 * @throws Error('maxParticipants-cannot-be-below-currentParticipants') avec err.cause
 *         { attempted, current, sessionId } pour debug admin Phase 7+
 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Pick<
    Session,
    | 'maxParticipants'
    | 'status'
    | 'pricingTiers'
    | 'startAt'
    | 'endAt'
    | 'chatOpenAt'
    | 'chatCloseAt'
    | 'title'
    | 'sport'
    | 'city'
  >>,
): Promise<void> {
  const fbDb = getSessionsDb();
  const ref = doc(fbDb, 'sessions', sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('session-not-found');
  }
  const session = snap.data() as Session;

  // V7 guard : downgrade strict bloqué (égalité OK = ferme aux nouvelles bookings)
  if (
    updates.maxParticipants !== undefined &&
    updates.maxParticipants < session.currentParticipants
  ) {
    throw new Error('maxParticipants-cannot-be-below-currentParticipants', {
      cause: {
        attempted: updates.maxParticipants,
        current: session.currentParticipants,
        sessionId,
      },
    });
  }

  // Defensive runtime filter — TypeScript Pick<> exclut déjà les server-managed fields,
  // mais des callers JS (ou `as any`) pourraient bypasser. Filter no-op si TS respecté.
  // Spread inline cohérent avec pattern updateUser/updateActivity du fichier (pas de cast `any`).
  const SERVER_MANAGED = ['currentParticipants', 'currentTier', 'currentPrice'] as const;
  const filteredUpdates = Object.fromEntries(
    Object.entries(updates).filter(([k]) => !SERVER_MANAGED.includes(k as never)),
  );

  await updateDoc(ref, { ...filteredUpdates, updatedAt: serverTimestamp() });
}

// ----- Réservation transactionnelle -----

/**
 * Crée un booking + incrémente atomiquement currentParticipants + recompute tier/price/status.
 *
 * Comportement :
 * 1. IDEMPOTENCY (hors transaction) — si un booking existe déjà pour le même paymentIntentId,
 *    retourne son ID sans rien créer. C'est la clé pour gérer les retries de webhook Stripe.
 * 2. TRANSACTION atomique :
 *    a. Lit la session (re-vérifie disponibilité)
 *    b. Vérifie isSessionBookable → throw si non
 *    c. Re-calcule le tier serveur pour cohérence (warning seulement, pas blocking)
 *    d. Crée le booking avec sessionId, paymentIntentId, tier, amount
 *    e. Incrémente session.currentParticipants
 *    f. Recompute currentTier/currentPrice avec le nouveau count
 *    g. Si max atteint → status='full', sinon 'open'
 *    h. Si matchId fourni → débloque match.chatUnlocked + lie match.sessionId
 * 3. POST-COMMIT (best effort, hors transaction) — notification au booker.
 *
 * IMPORTANT (cf. risque H.3 du plan Phase 2) :
 * Cette fonction est destinée à être appelée CÔTÉ SERVEUR (webhook Stripe Phase 3 via Admin SDK qui
 * bypass les rules). Côté client en prod, les rules de Phase 1 protègent currentParticipants/currentTier/
 * currentPrice contre les writes non-server → la transaction échouera avec "permission-denied".
 * Utilisée tel quel en client uniquement pour les tests emulator (où on désactive les rules).
 *
 * @returns bookingId créé (ou bookingId existant si idempotency hit).
 * @throws "Session introuvable" | "Session non réservable (status=..., x/y)" | erreur transaction Firestore.
 */
export async function bookSession(input: BookSessionInput): Promise<string> {
  const fbDb = getSessionsDb();

  // 1. Idempotency check (hors transaction)
  const existing = await getDocs(
    query(
      collection(fbDb, 'bookings'),
      where('paymentIntentId', '==', input.paymentIntentId),
      limit(1),
    ),
  );
  if (!existing.empty) return existing.docs[0].id;

  // 2. Transaction atomique
  const bookingId = await runTransaction(fbDb, async (tx) => {
    const sessionRef = doc(fbDb, 'sessions', input.sessionId);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error('Session introuvable');

    const session = sessionSnap.data() as Session;
    const now = new Date();

    // Vérifier que la session est encore réservable
    if (!isSessionBookable(session, now)) {
      throw new Error(
        `Session non réservable (status=${session.status}, ${session.currentParticipants}/${session.maxParticipants})`,
      );
    }

    // Re-vérification de cohérence tier (warning seulement — on respecte input)
    const computed = computePricingTier(session, now);
    if (computed.tier !== input.tier || computed.price !== input.amount) {
      console.warn(
        `[bookSession] Tier mismatch: input=(${input.tier}, ${input.amount}) computed=(${computed.tier}, ${computed.price}). Using input.`,
      );
    }

    // Créer le booking
    const bookingRef = doc(collection(fbDb, 'bookings'));
    const bookingData: Booking = {
      bookingId: bookingRef.id,
      userId: input.userId,
      userName: '',
      matchId: input.matchId || '',
      activityId: session.activityId,
      partnerId: session.partnerId,
      sport: session.sport,
      ticketType: 'solo',
      sessionDate: session.startAt,
      status: 'confirmed',
      transactionId: '',
      amount: input.amount,
      currency: 'CHF',
      creditsUsed: 0,
      sessionId: input.sessionId,
      paymentIntentId: input.paymentIntentId,
      tier: input.tier,
      createdAt: serverTimestamp() as unknown as Timestamp,
      updatedAt: serverTimestamp() as unknown as Timestamp,
    };
    tx.set(bookingRef, bookingData);

    // Incrémenter currentParticipants + recompute tier/price/status
    const newParticipants = session.currentParticipants + 1;
    const { tier: newTier, price: newPrice } = computePricingTier(session, now, newParticipants);
    const newStatus: SessionStatus = newParticipants >= session.maxParticipants ? 'full' : 'open';

    tx.update(sessionRef, {
      currentParticipants: newParticipants,
      currentTier: newTier,
      currentPrice: newPrice,
      status: newStatus,
      updatedAt: serverTimestamp(),
    });

    // Match chat unlock (si lié)
    if (input.matchId) {
      tx.update(doc(fbDb, 'matches', input.matchId), {
        chatUnlocked: true,
        sessionId: input.sessionId,
      });
    }

    return bookingRef.id;
  });

  // 3. Post-commit (best effort) — utilise la fonction globale createNotification
  //    qui passe par la `db` standard et non le test seam ; en tests on accepte que ça échoue silencieusement.
  try {
    await createNotification(
      input.userId,
      'booking',
      'Réservation confirmée',
      'Votre Sport Date est confirmé.',
      { bookingId, sessionId: input.sessionId },
    );
  } catch {
    /* silent — best effort */
  }

  return bookingId;
}
