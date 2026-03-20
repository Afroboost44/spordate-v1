/**
 * Spordateur V2 — Service Firestore central
 * Remplace l'ancien db.ts avec support complet de toutes les collections
 */

import { db, isFirebaseConfigured } from '@/lib/firebase';
import {
  doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, collection, where, orderBy, limit, onSnapshot,
  increment, serverTimestamp, Timestamp, writeBatch,
  type DocumentReference, type Query, type Unsubscribe,
  startAfter, type DocumentSnapshot,
} from 'firebase/firestore';

import type {
  UserProfile, UserPreferences, Match, Activity, Booking,
  CreditEntry, Transaction, Creator, Partner, Referral,
  Payout, Chat, ChatMessage, Notification, ErrorLog,
  AnalyticsGlobal, AnalyticsDaily, CreditPackage, CreditType,
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

    const updates: Record<string, unknown> = {
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
