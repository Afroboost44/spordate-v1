"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Heart, MapPin, Undo2, Zap, Lock, CheckCircle, RefreshCcw, Handshake, Share2, CreditCard, Check, Ticket, Loader2, Building2, Navigation, Clock, Users, Calendar, MessageCircle, Send, ChevronRight, Download, Gift } from 'lucide-react';
// Using regular img tags instead of next/image for external URLs reliability
import { Badge } from "@/components/ui/badge";
import { PlaceHolderImages } from '@/lib/placeholder-images';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useRouter, useSearchParams } from 'next/navigation';
import { 
   Carousel, 
   CarouselContent, 
   CarouselItem, 
   CarouselPrevious, 
   CarouselNext 
} from '@/components/ui/carousel';
import { Separator } from '@/components/ui/separator';
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { registerBooking, getConfirmedTickets, getPartners, DEFAULT_PARTNERS, type Partner } from "@/lib/db";

import { sendPartnerNotification } from "@/lib/notifications";
import { isFirebaseConfigured, getMissingConfig, db } from "@/lib/firebase";
import { ConfigErrorScreen } from "@/components/ConfigErrorScreen";
import { useAuth } from "@/context/AuthContext";
import { collection, query, where, getDocs, limit as firestoreLimit, orderBy, Timestamp } from 'firebase/firestore';
import type { UserProfile, SportEntry } from '@/types/firestore';
import { DANCE_ACTIVITIES } from '@/types/firestore';
import { createMatch } from '@/services/firestore';
import { useCredits } from '@/hooks/useCredits';
import BackButton from '@/components/BackButton';
import ProfileActions from '@/components/ProfileActions';

// Revenue storage key for admin sync (kept for backward compatibility)
const TICKETS_STORAGE_KEY = 'spordate_tickets';
const LAST_BOOKING_KEY = 'spordate_last_booking';

// Mock participants for social proof
const mockParticipants = [
  { id: 1, name: 'Julie', avatar: 'J', sport: 'Afroboost' },
  { id: 2, name: 'Marc', avatar: 'M', sport: 'Danse' },
  { id: 3, name: 'Sophie', avatar: 'S', sport: 'Fitness' },
];

// Mock upcoming sessions
const mockSessions = [
  { id: 1, title: 'Afroboost Débutant', day: 'Lundi', time: '19:00', spots: 3 },
  { id: 2, title: 'Danse Africaine', day: 'Mercredi', time: '18:30', spots: 5 },
  { id: 3, title: 'Cardio Dance', day: 'Vendredi', time: '20:00', spots: 2 },
];

// Fallback profiles (used when Firestore has no users yet)
// No more fallback profiles — only real Firestore users are shown
const fallbackProfiles: any[] = [];

// boostedActivities mock removed — now loaded from Firestore 'boosts' collection

/** Convert a Firestore UserProfile to the local profile format used by the card UI */
function firestoreProfileToCard(user: UserProfile, index: number) {
  // Map sport entries to display labels
  const sportLabels = (user.sports || []).map((s: SportEntry) => {
    const danceInfo = DANCE_ACTIVITIES[s.name as keyof typeof DANCE_ACTIVITIES];
    return danceInfo ? danceInfo.label : s.name;
  });

  return {
    id: index + 1000, // Offset to avoid collision with fallback IDs
    firestoreUid: user.uid,
    name: user.displayName || 'Utilisateur',
    location: user.city || 'Suisse',
    sports: sportLabels.length > 0 ? sportLabels : ['Sport'],
    bio: user.bio || 'Passionné de sport, à la recherche de partenaires !',
    imageId: 'discovery-' + ((index % 3) + 1), // Cycle through placeholder images
    photoURL: user.photoURL || '',
    price: 25, // Default session price
    matchScore: 0, // Will be computed
  };
}

/** Compute a match score between the current user and a candidate profile */
function computeMatchScore(myProfile: UserProfile | null, candidate: UserProfile): number {
  if (!myProfile || !myProfile.sports || myProfile.sports.length === 0) return 50; // Neutral score

  const mySports = new Set(myProfile.sports.map((s: SportEntry) => s.name));
  const theirSports = candidate.sports || [];

  let score = 0;
  let sportsInCommon = 0;

  for (const sport of theirSports) {
    if (mySports.has(sport.name)) {
      sportsInCommon++;
      // Bonus for same sport
      score += 30;

      // Additional bonus for matching level
      const mySport = myProfile.sports.find((s: SportEntry) => s.name === sport.name);
      if (mySport && mySport.level === sport.level) {
        score += 20; // Same level = perfect match
      } else if (mySport) {
        score += 10; // Different level but same sport
      }
    }
  }

  // Same city bonus
  if (myProfile.city && candidate.city && myProfile.city === candidate.city) {
    score += 15;
  }

  // Normalize: cap at 100
  return Math.min(score, 100);
}


export default function DiscoveryPage() {
  const [profiles, setProfiles] = useState(fallbackProfiles);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMatch, setIsMatch] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmedTickets, setConfirmedTickets] = useState<number[]>([]);
  const [partners, setPartners] = useState<Partner[]>(DEFAULT_PARTNERS);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [boostedPartnerIds, setBoostedPartnerIds] = useState<Set<string>>(new Set());
  const [boostedActivities_db, setBoostedActivities_db] = useState<any[]>([]);
  const [realActivities, setRealActivities] = useState<any[]>([]);

  // New states for social features
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [showLocationsSheet, setShowLocationsSheet] = useState(false);
  const [selectedMeetingPlace, setSelectedMeetingPlace] = useState<string>('');
  const [showTicketSuccess, setShowTicketSuccess] = useState(false);
  const [lastBooking, setLastBooking] = useState<{profile: string, partner: string, partnerAddress?: string, isDuo: boolean, amount: number} | null>(null);

  // Duo option state
  const [isDuoTicket, setIsDuoTicket] = useState(false);
  // Current match ID (created on like)
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const { credits: creditCount, hasCredits, useCredit, canLike, canSuperMatch, canSkip, requireCreditsForChat } = useCredits();

  // Load REAL profiles from Firestore with matching
  useEffect(() => {
    const loadFirestoreProfiles = async () => {
      if (!db || !isFirebaseConfigured || !user) {
        setLoadingProfiles(false);
        return;
      }

      try {
        const usersRef = collection(db, 'users');
        // Query: only users who completed onboarding, exclude self, limit to 50
        const q = query(
          usersRef,
          where('onboardingComplete', '==', true),
          firestoreLimit(50)
        );

        const snapshot = await getDocs(q);
        const firestoreUsers: UserProfile[] = [];

        snapshot.forEach(doc => {
          const data = doc.data() as UserProfile;
          // Exclude self
          if (data.uid !== user.uid) {
            firestoreUsers.push({ ...data, uid: doc.id });
          }
        });

        if (firestoreUsers.length > 0) {
          // Convert to card format and compute match scores
          let cardProfiles = firestoreUsers.map((u, i) => {
            const card = firestoreProfileToCard(u, i);
            card.matchScore = computeMatchScore(userProfile, u);
            return card;
          });

          // Sort by match score (highest first)
          cardProfiles.sort((a, b) => b.matchScore - a.matchScore);

          setProfiles(cardProfiles);
          setCurrentIndex(0);
          console.log(`[Discovery] ${cardProfiles.length} profils chargés depuis Firestore`);
        } else {
          // No real users yet → keep fallback profiles
          console.log('[Discovery] Aucun profil Firestore, utilisation des profils démo');
          setProfiles([]);
        }
      } catch (err) {
        console.warn('[Discovery] Erreur chargement Firestore, fallback aux profils démo:', err);
        setProfiles([]);
      } finally {
        setLoadingProfiles(false);
      }
    };

    loadFirestoreProfiles();
  }, [user, userProfile]);

  // Load partners function (extracted for reuse)
  const loadPartnersData = async () => {
    try {
      const loadedPartners = await getPartners();
      const activePartners = loadedPartners.filter(p => p.active);
      // Keep defaults if no active partners found (avoids empty sidebar flash)
      setPartners(activePartners.length > 0 ? activePartners : DEFAULT_PARTNERS);
    } catch (e) {
      setPartners(DEFAULT_PARTNERS);
    }
  };

  // Load active boosts from Firestore
  useEffect(() => {
    if (!db || !isFirebaseConfigured) return;

    const loadActiveBoosts = async () => {
      try {
        const now = Timestamp.now();
        const boostsRef = collection(db, 'boosts');
        const q = query(
          boostsRef,
          where('active', '==', true),
          where('expiresAt', '>', now)
        );
        const snapshot = await getDocs(q);
        const ids = new Set<string>();
        const boostDocs: any[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.partnerId) {
            ids.add(data.partnerId);
          }
          boostDocs.push({ id: doc.id, ...data });
        });
        setBoostedPartnerIds(ids);
        setBoostedActivities_db(boostDocs);
        console.log(`[Discovery] ${ids.size} partenaires boostés chargés`);
      } catch (err) {
        console.warn('[Discovery] Erreur chargement boosts:', err);
      }
    };

    // Load real activities from Firestore
    const loadRealActivities = async () => {
      try {
        let snap;
        try {
          const q = query(collection(db, 'activities'), where('isActive', '==', true), orderBy('createdAt', 'desc'));
          snap = await getDocs(q);
        } catch {
          const q = query(collection(db, 'activities'), where('isActive', '==', true));
          snap = await getDocs(q);
        }
        const acts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRealActivities(acts);
      } catch (err) {
        console.warn('[Discovery] Erreur chargement activités:', err);
      }
    };

    loadActiveBoosts();
    loadRealActivities();
  }, []);

  // Load confirmed tickets and partners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Load tickets
    const tickets = getConfirmedTickets();
    setConfirmedTickets(tickets);

    // Load partners
    loadPartnersData();

    // Check for referral in URL
    const ref = searchParams.get('ref');
    const profileId = searchParams.get('profile');
    if (ref && profileId) {
      toast({
        title: "Invitation reçue !",
        description: `Vous avez été invité via le code ${ref}`,
      });
    }
  }, [searchParams, toast]);

  // Real-time sync: refresh partners when tab becomes visible
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadPartnersData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadPartnersData();
      }
    }, 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, []);

  const discoveryImages = PlaceHolderImages.filter(p => p.id.startsWith('discovery-'));
  const activityImages = PlaceHolderImages.filter(p => p.id.startsWith('activity-'));

  const handleNextProfile = () => {
    setCurrentIndex(prev => prev + 1);
  };

  const handleLike = async () => {
    // Use credit via hook (real-time check + toast + redirect)
    const creditUsed = await useCredit();
    if (!creditUsed) return;

    // Create a real match in Firestore
    if (user && currentProfile && (currentProfile as any).firestoreUid) {
      try {
        const otherUid = (currentProfile as any).firestoreUid;
        const matchId = await createMatch({
          userIds: [user.uid, otherUid],
          user1: {
            uid: user.uid,
            displayName: userProfile?.displayName || user.displayName || 'Utilisateur',
            photoURL: userProfile?.photoURL || user.photoURL || '',
          },
          user2: {
            uid: otherUid,
            displayName: currentProfile.name.split(',')[0],
            photoURL: (currentProfile as any).photoURL || '',
          },
          status: 'accepted',
          activityId: '',
          sport: currentProfile.sports?.[0] || 'Sport',
          chatUnlocked: false,
          initiatedBy: user.uid,
          expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        });
        setCurrentMatchId(matchId);
          // Credit already deducted at start of handleLike
        console.log('[Discovery] Match créé:', matchId);
      } catch (err) {
        console.error('[Discovery] Erreur création match:', err);
      }
    }
    setIsMatch(true);
  };
  
  const resetProfiles = () => {
    setCurrentIndex(0);
    setProfiles(initialProfiles);
  }

  const closeMatchModal = () => {
    setIsMatch(false);
    setCurrentMatchId(null);
    handleNextProfile();
  }

  const bookActivity = () => {
    router.push('/activities');
  }

  // Share profile with referral code
  const handleShareProfile = async () => {
    if (typeof window === 'undefined') return;
    
    const userCode = localStorage.getItem('spordate_user_code') || 'SPORT-USER';
    const shareUrl = `${window.location.origin}/discovery?ref=${userCode}&profile=${currentProfile?.id}`;
    const shareText = `Regarde ce profil sur Spordateur, on va faire une séance ensemble ? 💪🔥`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${currentProfile?.name} sur Spordateur`,
          text: shareText,
          url: shareUrl,
        });
      } catch (error) {
        console.log('Share cancelled');
      }
    } else {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      toast({
        title: "Lien copié ! 📋",
        description: "Partage ce profil avec tes amis WhatsApp !",
      });
    }
  };

  // Open payment modal
  const handleBookSession = () => {
      // Don't reset selectedMeetingPlace if already set from partner selection
    setIsDuoTicket(false);
    setShowPaymentModal(true);
  };

  // Calculate current price based on solo/duo
  const getCurrentPrice = () => {
    if (!currentProfile) return 25;
    return isDuoTicket ? 50 : currentProfile.price;
  };

  // Poll payment status from Stripe
  const pollPaymentStatus = async (sessionId: string, attempts = 0): Promise<boolean> => {
    const maxAttempts = 10;
    const pollInterval = 2000;

    if (attempts >= maxAttempts) {
      toast({
        variant: "destructive",
        title: "Timeout",
        description: "Vérification du paiement expirée. Vérifiez votre email.",
      });
      return false;
    }

    try {
      const response = await fetch(`/api/checkout/status/${sessionId}`);
      if (!response.ok) throw new Error('Failed to check status');

      const data = await response.json();

      if (data.paymentStatus === 'paid') {
        return true;
      } else if (data.status === 'expired') {
        toast({
          variant: "destructive",
          title: "Session expirée",
          description: "La session de paiement a expiré. Veuillez réessayer.",
        });
        return false;
      }

      // Continue polling
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      return pollPaymentStatus(sessionId, attempts + 1);
    } catch (error) {
      console.error('Error polling status:', error);
      return false;
    }
  };

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const paymentStatus = searchParams.get('payment');
    const sessionId = searchParams.get('session_id');
    const isFreeBooking = searchParams.get('free') === 'true';

    // Handle FREE booking success (no Stripe, no session_id)
    if (paymentStatus === 'success' && isFreeBooking) {
      console.log('[Discovery] Free booking success detected');
      
      const pendingBooking = localStorage.getItem('pending_booking');
      if (pendingBooking) {
        const booking = JSON.parse(pendingBooking);
        
        // Create booking record
        const newBooking = {
          id: `free_${Date.now()}`,
          profile: booking.profileName,
          partner: booking.partnerName || 'Non défini',
          partnerAddress: booking.partnerAddress || '',
          isDuo: booking.isDuo,
          amount: 0,
          date: new Date().toISOString(),
        };
        
        // Save to bookings history
        const existingBookings = JSON.parse(localStorage.getItem('bookings') || '[]');
        existingBookings.push(newBooking);
        localStorage.setItem('bookings', JSON.stringify(existingBookings));
        
        // Update confirmed tickets
        const newTickets = [...confirmedTickets, booking.profileId];
        setConfirmedTickets(newTickets);
        localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(newTickets));
        
        // Set last booking for success modal
        setLastBooking(newBooking);
        localStorage.setItem(LAST_BOOKING_KEY, JSON.stringify(newBooking));
        
        // Clean up
        localStorage.removeItem('pending_booking');
        
        // Show success modal (SuccessTicket)
        setShowTicketSuccess(true);
        
        toast({
          title: "Réservation confirmée ! 🎉",
          description: `Séance d'essai ${booking.isDuo ? 'Duo' : 'Solo'} réservée avec succès`,
        });
      }
      
      // Clean URL
      router.replace('/discovery');
      return;
    }

    // Handle PAID booking success (Stripe with session_id)
    if (paymentStatus === 'success' && sessionId) {
      // Poll for payment confirmation
      setIsProcessing(true);
      
      pollPaymentStatus(sessionId).then(async (success) => {
        if (success) {
          // Payment confirmed - finalize booking
          const pendingBooking = localStorage.getItem('pending_booking');
          if (pendingBooking) {
            const booking = JSON.parse(pendingBooking);
            
            // Register booking
            const userId = localStorage.getItem('spordate_user_id') || `user-${Date.now()}`;
            await registerBooking(userId, booking.profileId, booking.profileName, booking.amount);
            
            // Update local state
            const newTickets = [...confirmedTickets, booking.profileId];
            setConfirmedTickets(newTickets);
            localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(newTickets));
            
            // Set last booking for success modal
            setLastBooking({
              profile: booking.profileName,
              partner: booking.partnerName || 'Non défini',
              partnerAddress: booking.partnerAddress,
              isDuo: booking.isDuo,
              amount: booking.amount,
            });
            localStorage.setItem(LAST_BOOKING_KEY, JSON.stringify({
              profile: booking.profileName,
              partner: booking.partnerName || 'Non défini',
              partnerAddress: booking.partnerAddress,
              isDuo: booking.isDuo,
              amount: booking.amount,
            }));

            // Send notification to partner
            if (booking.partnerId) {
              await sendPartnerNotification({
                partnerName: booking.partnerName || 'Partenaire',
                customerName: booking.profileName,
                ticketType: booking.isDuo ? 'Duo' : 'Solo',
                amount: booking.amount,
                bookingId: sessionId,
              });
            }

            // Clean up
            localStorage.removeItem('pending_booking');
            
            // Show success modal
            setShowTicketSuccess(true);
            
            toast({
              title: "Paiement confirmé ! ✅",
              description: `Séance ${booking.isDuo ? 'Duo' : 'Solo'} réservée avec succès`,
            });
          }
        }
        setIsProcessing(false);
        
        // Clean URL
        router.replace('/discovery');
      });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Paiement annulé",
        description: "Le paiement a été annulé. Vous pouvez réessayer.",
      });
      router.replace('/discovery');
    }
  }, [searchParams]);

  // Process payment with Stripe
  const handlePayment = async () => {
    if (typeof window === 'undefined' || !currentProfile) return;
    
    setIsProcessing(true);
    
    const finalPrice = getCurrentPrice();
    const meetingPartner = partners.find(p => p.id === selectedMeetingPlace);
    
    try {
      // Save pending booking info (including matchId for post-payment redirect)
      const pendingBooking = {
        profileId: currentProfile.id,
        profileName: currentProfile.name.split(',')[0],
        partnerId: selectedMeetingPlace || null,
        partnerName: meetingPartner?.name || null,
        partnerAddress: meetingPartner ? `${meetingPartner.address}, ${meetingPartner.city}` : null,
        isDuo: isDuoTicket,
        amount: finalPrice,
        matchId: currentMatchId || '',
      };
      localStorage.setItem('pending_booking', JSON.stringify(pendingBooking));

      // If price is 0, skip Stripe and confirm booking directly
      if (finalPrice === 0) {
        // Free booking - unlock chat and redirect to chat
        if (currentMatchId) {
          try {
            const { unlockChat } = await import('@/services/firestore');
            await unlockChat(currentMatchId);
          } catch (err) {
            console.warn('[Discovery] Erreur unlockChat:', err);
          }
        }

        setShowPaymentModal(false);
        setIsProcessing(false);
        localStorage.removeItem('pending_booking');

        toast({
          title: "Réservation confirmée ! 🎉",
          description: "Le chat est débloqué, commencez à discuter !",
        });

        // Redirect to chat
        if (currentMatchId) {
          router.push(`/chat?payment=success&match=${currentMatchId}`);
        }
        return;
      }

      // Use real Firebase userId
      const userId = user?.uid || localStorage.getItem('spordate_user_code') || `user_${Date.now()}`;

      // Call Stripe checkout API with correct packageId format
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: '1_date',
          userId: userId,
          matchId: currentMatchId || '',
          referralCode: '',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de la création du paiement');
      }

      const data = await response.json();
      
      // If free booking, handle success locally
      if (data.isFree) {
        const booking = {
          id: data.sessionId,
          profile: currentProfile.name.split(',')[0],
          partner: meetingPartner?.name || 'Non spécifié',
          partnerAddress: meetingPartner ? `${meetingPartner.address}, ${meetingPartner.city}` : '',
          date: new Date().toISOString(),
          isDuo: isDuoTicket,
          amount: 0,
        };
        
        const existingBookings = JSON.parse(localStorage.getItem('bookings') || '[]');
        existingBookings.push(booking);
        localStorage.setItem('bookings', JSON.stringify(existingBookings));
        
        setLastBooking(booking);
        setShowPaymentModal(false);
        setShowTicketSuccess(true);
        setIsProcessing(false);
        localStorage.removeItem('pending_booking');
        
        toast({
          title: "Réservation confirmée ! 🎉",
          description: "Votre séance d'essai a été réservée avec succès.",
        });
        return;
      }
      
      // Redirect to Stripe Checkout for paid sessions
      window.location.href = data.url;
      
    } catch (error) {
      console.error('Payment error:', error);
      setIsProcessing(false);
      localStorage.removeItem('pending_booking');
      toast({
        variant: "destructive",
        title: "Erreur de paiement",
        description: error instanceof Error ? error.message : "Une erreur est survenue lors du paiement.",
      });
    }
  };

  // Share ticket on WhatsApp - dynamic message for Solo/Duo
  const shareTicketOnWhatsApp = () => {
    if (!lastBooking) return;
    
    const baseUrl = window.location.origin;
    let message: string;
    if (lastBooking.isDuo) {
      // Duo ticket message - inviting partner
      message = encodeURIComponent(
        `🎁 Je t'offre une séance Afroboost avec ${lastBooking.profile} !\n\n📍 RDV à ${lastBooking.partner}\n💪 C'est gratuit pour toi, je t'ai déjà payé ta place !\n\nDétails sur Spordateur\n${baseUrl}/discovery`
      );
    } else {
      // Solo ticket message
      message = encodeURIComponent(
        `Je vais m'entraîner à ${lastBooking.partner}, rejoins-moi ! 💪🔥\n\nRDV avec ${lastBooking.profile} sur Spordateur\n${baseUrl}/discovery`
      );
    }
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  // Add to Google Calendar
  const addToGoogleCalendar = () => {
    if (!lastBooking) return;
    
    const ticketType = lastBooking.isDuo ? 'Duo' : 'Solo';
    const title = encodeURIComponent(`Séance Afroboost ${ticketType} avec ${lastBooking.profile}`);
    const location = lastBooking.partnerAddress 
      ? encodeURIComponent(lastBooking.partnerAddress)
      : encodeURIComponent('Spordateur');
    const priceLabel = lastBooking.amount === 0 ? 'OFFERT' : `${lastBooking.amount} CHF`;
    const details = encodeURIComponent(`🎟️ Ticket ${ticketType} - ${priceLabel}\nPartenaire: ${lastBooking.profile}\nLieu: ${lastBooking.partner}\n\nRéservé via Spordateur`);
    
    // Create event for tomorrow at 19:00
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(19, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(20, 0, 0, 0);
    
    const formatDate = (d: Date) => d.toISOString().replace(/-|:|\.\d+/g, '').slice(0, -1);
    
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatDate(startDate)}/${formatDate(endDate)}&location=${location}&details=${details}`;
    
    window.open(calendarUrl, '_blank');
    toast({ title: "Google Calendar ouvert 📅", description: "Ajoutez l'événement à votre agenda !" });
  };

  // Download .ics calendar file
  const downloadIcsFile = () => {
    if (!lastBooking) return;
    
    const ticketType = lastBooking.isDuo ? 'Duo' : 'Solo';
    
    // Create event for tomorrow at 19:00
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(19, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(20, 0, 0, 0);
    
    const formatIcsDate = (d: Date) => {
      return d.toISOString().replace(/-|:|\.\d+/g, '').slice(0, -1) + 'Z';
    };
    
    const location = lastBooking.partnerAddress || 'Spordateur';
    
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Spordateur//FR
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
DTSTART:${formatIcsDate(startDate)}
DTEND:${formatIcsDate(endDate)}
SUMMARY:Séance Afroboost ${ticketType} avec ${lastBooking.profile}
DESCRIPTION:🎟️ Ticket ${ticketType} - ${lastBooking.amount === 0 ? 'OFFERT' : lastBooking.amount + ' CHF'}\\nPartenaire: ${lastBooking.profile}\\nLieu: ${lastBooking.partner}\\n\\nRéservé via Spordateur
LOCATION:${location}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spordateur-seance-${ticketType.toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: "Fichier téléchargé 📅", description: "Ouvrez-le pour l'ajouter à votre calendrier !" });
  };

  // Select partner from "Où pratiquer?" list - pre-select for booking
  const handlePartnerSelect = (partner: Partner) => {
    if (selectedMeetingPlace === partner.id) {
      // If already selected, open detail modal
      setSelectedPartner(partner);
      setShowPartnerModal(true);
    } else {
      // Select this partner as meeting place
      setSelectedMeetingPlace(partner.id!);
      toast({
        title: `${partner.name} sélectionné ✓`,
        description: "Ce lieu sera pré-sélectionné pour votre réservation",
      });
    }
  };

  // Open partner detail modal (from other places)
  const handlePartnerClick = (partner: Partner) => {
    setSelectedPartner(partner);
    setShowPartnerModal(true);
  };

  const currentProfile = profiles[currentIndex];
  const profileImage = discoveryImages.find(img => img.id === currentProfile?.imageId);
  const hasTicket = currentProfile && confirmedTickets.includes(currentProfile.id);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-black">
      {currentProfile ? (
        <div className="relative w-full max-w-6xl mx-auto md:flex md:flex-row-reverse md:gap-6 md:px-6 md:py-6">
          {/* Profile Card — clean photo + info below */}
          <div className="md:flex-1 order-2 md:order-1 flex flex-col">

            {/* === PHOTO ZONE === Only name + location on image */}
            <div className="relative aspect-[3/4] md:aspect-[4/5] w-full max-h-[60vh] md:max-h-[70vh] overflow-hidden md:rounded-3xl">
              {(currentProfile as any).photoURL ? (
                <img
                  src={(currentProfile as any).photoURL}
                  alt={currentProfile.name}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : profileImage ? (
                <img
                  src={profileImage.imageUrl}
                  alt={currentProfile.name}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#D91CD2] to-[#E91E63] flex items-center justify-center">
                  <span className="text-8xl font-light text-white/20">{currentProfile.name.charAt(0)}</span>
                </div>
              )}

              {/* Subtle gradient — just enough for name readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

              {/* Top badges */}
              <div className="absolute top-5 left-5 right-5 z-20 flex justify-between items-start">
                {(currentProfile as any).matchScore > 0 && (
                  <Badge className={`px-3 py-1.5 flex items-center gap-1.5 backdrop-blur-md text-sm ${
                    (currentProfile as any).matchScore >= 70 ? 'bg-green-500/80 text-white' :
                    (currentProfile as any).matchScore >= 40 ? 'bg-yellow-500/80 text-black' :
                    'bg-white/20 text-white'
                  }`}>
                    <Zap className="h-3.5 w-3.5" />
                    {(currentProfile as any).matchScore}% match
                  </Badge>
                )}
                {hasTicket && (
                  <Badge className="bg-green-500/80 backdrop-blur-md text-white px-3 py-1.5 flex items-center gap-1.5">
                    <Ticket className="h-3.5 w-3.5" />
                    Réservé
                  </Badge>
                )}
              </div>

              {/* Name + Location — only these on the photo */}
              <div className="absolute bottom-0 left-0 right-0 p-6 pb-7 z-10">
                <h2 className="text-4xl font-light tracking-tight text-white drop-shadow-2xl">{currentProfile.name}</h2>
                <p className="flex items-center gap-1.5 text-white/60 text-sm mt-1 tracking-wide">
                  <MapPin size={14} className="text-[#D91CD2]" />
                  {currentProfile.location}
                </p>
              </div>

              {/* Like / Dislike floating on photo */}
              <div className="absolute bottom-6 right-6 z-20 flex items-center gap-3">
                <button
                  onClick={handleNextProfile}
                  className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/60 hover:text-red-400 hover:border-red-400/40 transition-all active:scale-90"
                >
                  <X size={22} />
                </button>
                <button
                  onClick={handleLike}
                  className="w-12 h-12 rounded-full bg-[#D91CD2]/30 backdrop-blur-md border border-[#D91CD2]/40 flex items-center justify-center text-white hover:scale-110 transition-all active:scale-90"
                >
                  <Heart size={20} fill="currentColor" />
                </button>
              </div>
            </div>

            {/* === INFO ZONE === Below photo, on pure black */}
            <div className="px-6 md:px-8 pt-6 pb-4 space-y-5">

              {/* Sports Tags */}
              <div className="flex flex-wrap gap-2">
                {currentProfile.sports.map(sport => (
                  <span key={sport} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-light tracking-wider uppercase text-white/80 border border-white/10">
                    {sport === 'Afroboost' && <Zap className="h-3 w-3 text-[#D91CD2]" />}
                    {sport}
                  </span>
                ))}
              </div>

              {/* Bio — clean, on black, font-light */}
              <p className="text-white text-sm font-light leading-relaxed tracking-wide">
                {currentProfile.bio}
              </p>

              {/* CTA Row — Réserver (80%) + Lieux (20%) */}
              <div className="pt-2 flex items-center gap-3 px-0">
                {!hasTicket ? (
                  <button
                    onClick={handleBookSession}
                    className="flex-[4] h-14 rounded-full bg-white/5 backdrop-blur-xl border border-[#D91CD2] text-white font-light text-sm tracking-wider uppercase flex items-center justify-center gap-2.5 hover:bg-[#D91CD2]/10 transition-all active:scale-[0.98]"
                  >
                    <Zap className="h-4 w-4 text-[#D91CD2]" />
                    {currentProfile.price === 0 ? 'Essai gratuit' : `Réserver · ${currentProfile.price} CHF`}
                  </button>
                ) : (
                  <button
                    disabled
                    className="flex-[4] h-14 rounded-full bg-green-500/10 backdrop-blur-xl border border-green-500/30 text-green-400 font-light text-sm tracking-wider uppercase flex items-center justify-center gap-2.5 cursor-default"
                  >
                    <Check className="h-4 w-4" />
                    Réservé
                  </button>
                )}
                {/* Bouton Lieux — ouvre le bottom sheet */}
                <button
                  onClick={() => setShowLocationsSheet(true)}
                  className="flex-[1] h-14 rounded-full bg-white/5 backdrop-blur-xl border border-white/15 flex items-center justify-center text-white/50 hover:text-white/80 hover:border-[#D91CD2]/40 transition-all active:scale-95"
                >
                  <MapPin className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Desktop sidebar — Où pratiquer (hidden on mobile, visible on desktop) */}
          <div className="hidden md:block md:w-80 md:flex-shrink-0 order-1 md:order-2">
            <div className="md:sticky md:top-20">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-5 w-5 text-[#D91CD2]" />
                <h3 className="text-lg font-semibold text-white">Où pratiquer ?</h3>
              </div>
              <div className="space-y-2">
                {[...partners]
                  .sort((a, b) => {
                    const aBoost = a.id ? boostedPartnerIds.has(a.id) : false;
                    const bBoost = b.id ? boostedPartnerIds.has(b.id) : false;
                    if (aBoost && !bBoost) return -1;
                    if (!aBoost && bBoost) return 1;
                    return 0;
                  })
                  .slice(0, 5).map((partner) => {
                  const isBoosted = partner.id ? boostedPartnerIds.has(partner.id) : false;
                  return (
                  <div
                    key={partner.id}
                    onClick={() => handlePartnerSelect(partner)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 relative
                      ${selectedMeetingPlace === partner.id
                        ? 'bg-[#D91CD2]/15 border border-[#D91CD2]/40'
                        : isBoosted
                          ? 'bg-[#D91CD2]/5 border border-[#D91CD2]/20 hover:bg-[#D91CD2]/10'
                          : 'bg-white/5 border border-transparent hover:bg-white/8 hover:border-white/10'}
                    `}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                      isBoosted
                        ? 'bg-gradient-to-br from-[#D91CD2] to-[#E91E63] ring-2 ring-[#D91CD2]/40'
                        : 'bg-gradient-to-br from-[#D91CD2] to-[#E91E63]'
                    }`}>
                      {partner.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-sm text-white truncate">{partner.name}</h4>
                        {isBoosted && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#D91CD2]/20 text-[#D91CD2] whitespace-nowrap flex items-center gap-0.5">
                            <Zap className="h-2.5 w-2.5" />Recommandé
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{partner.city}
                      </p>
                    </div>
                    {selectedMeetingPlace === partner.id ? (
                      <span className="text-xs text-[#D91CD2] font-medium">Sélectionné</span>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-white/20" />
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
            <Heart className="h-10 w-10 text-white/20" />
          </div>
          <h2 className="text-2xl font-semibold text-white mb-2">Plus de profils pour le moment</h2>
          <p className="text-white/40 mb-6">Revenez plus tard ou recommencez</p>
          <Button onClick={resetProfiles} variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <Undo2 className="mr-2 h-4 w-4" />
            Recommencer
          </Button>
        </div>
      )}

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-md w-full bg-zinc-900 border-white/10 text-white p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
          <DialogHeader className="p-6 pb-0 bg-gradient-to-b from-[#D91CD2]/20 to-transparent">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-6 w-6 text-yellow-400" />
              Réserver une séance Afroboost
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Séance avec {currentProfile?.name.split(',')[0]} à {currentProfile?.location}
            </DialogDescription>
          </DialogHeader>
          
          <div className="p-6 space-y-6">
            {/* Duo Option Toggle */}
            <div data-testid="duo-option-toggle" className="bg-gradient-to-r from-[#D91CD2]/30 to-[#E91E63]/30 rounded-xl p-4 border border-[#D91CD2]/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D91CD2] to-[#E91E63] flex items-center justify-center">
                    <Gift className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">J'invite mon partenaire</p>
                    <p className="text-xs text-gray-400">Offrir la séance (2 places)</p>
                  </div>
                </div>
                <Switch
                  checked={isDuoTicket}
                  onCheckedChange={setIsDuoTicket}
                  className="data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#D91CD2] data-[state=checked]:to-[#E91E63]"
                />
              </div>
              {isDuoTicket && (
                <div className="mt-3 pt-3 border-t border-white/10 text-xs text-violet-300">
                  ✨ Vous recevrez un lien WhatsApp à partager avec votre invité(e)
                </div>
              )}
            </div>

            {/* Price Summary */}
            <div data-testid="price-summary" className="bg-zinc-900/50 rounded-xl p-4 border border-white/10">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400">
                  {isDuoTicket ? 'Séance Duo Afroboost (2x 1h)' : 'Séance Afroboost (1h)'}
                </span>
                <span className="font-semibold">{getCurrentPrice() === 0 ? 'SÉANCE D\'ESSAI' : `${getCurrentPrice()} CHF`}</span>
              </div>
              {isDuoTicket && (
                <div className="flex justify-between items-center text-sm text-violet-300 mb-2">
                  <span className="flex items-center gap-1">
                    <Gift className="h-3 w-3" /> Place offerte incluse
                  </span>
                  <span className="line-through text-gray-500">{(currentProfile?.price || 25) * 2} CHF</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Frais de service</span>
                <span className="text-gray-500">0 CHF</span>
              </div>
              <Separator className="my-3 bg-white/10" />
              <div className="flex justify-between items-center text-lg font-bold">
                <span>Total</span>
                <span className="text-green-400">{getCurrentPrice() === 0 ? 'OFFERT' : `${getCurrentPrice()} CHF`}</span>
              </div>
            </div>

            {/* Meeting Place Selection */}
            <div className="space-y-3">
              <Label className="text-sm text-gray-400 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Lieu de rendez-vous (optionnel)
              </Label>
              <Select value={selectedMeetingPlace} onValueChange={setSelectedMeetingPlace}>
                <SelectTrigger className="bg-black border-gray-700">
                  <SelectValue placeholder="Choisir un lieu partenaire..." />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((partner) => (
                    <SelectItem key={partner.id} value={partner.id!}>
                      <div className="flex items-center gap-2">
                        <span>{partner.name}</span>
                        <span className="text-xs text-muted-foreground">• {partner.city}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Pay Button - FIRST */}
            <Button
              data-testid="pay-button"
              onClick={handlePayment}
              disabled={isProcessing}
              className="w-full h-14 bg-gradient-to-br from-[#D91CD2] to-[#E91E63] text-white font-semibold text-lg disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              {isProcessing ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>{getCurrentPrice() === 0 ? 'Confirmation...' : 'Redirection vers Stripe...'}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  <span>{getCurrentPrice() === 0 ? 'Confirmer ma séance d\'essai' : `Payer ${getCurrentPrice()} CHF`}</span>
                  {isDuoTicket && <Badge className="bg-white/20 text-white text-xs ml-1">Duo</Badge>}
                </div>
              )}
            </Button>

            {/* Stripe Checkout Notice - after pay button */}
            <div className="bg-gradient-to-r from-[#D91CD2]/10 to-[#E91E63]/10 rounded-xl p-3 border border-white/5">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-[#D91CD2]" />
                <div>
                  <p className="text-xs font-medium text-white/60">Paiement sécurisé Stripe</p>
                  <p className="text-[11px] text-white/30">TWINT • Carte bancaire • Apple Pay</p>
                </div>
                <Lock className="h-3.5 w-3.5 text-white/20 ml-auto" />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Match Modal — Improved UX/UI for conversion */}
      <Dialog open={isMatch} onOpenChange={setIsMatch}>
        <DialogContent className="max-w-md w-full bg-black border-[#D91CD2]/20 text-white p-0 overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-300">
          <div className="overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">

          {/* Match Header — Emotional & Personal */}
          <div className="relative px-6 pt-8 pb-5 text-center bg-gradient-to-b from-[#D91CD2]/20 via-[#D91CD2]/5 to-transparent">
            {/* Animated glow */}
            <div className="absolute inset-0 bg-[#D91CD2]/5 animate-pulse" />
            
            <div className="relative z-10">
              {/* Dual avatars */}
              <div className="flex justify-center items-center gap-3 mb-5">
                <div className="relative">
                  <Avatar className="h-16 w-16 ring-2 ring-[#D91CD2]/50">
                    <AvatarImage src={userProfile?.photoURL || ''} className="object-cover" />
                    <AvatarFallback className="bg-zinc-800 text-white text-lg">
                      {(userProfile?.displayName || 'T').charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="relative">
                  <div className="absolute inset-0 bg-[#D91CD2]/40 rounded-full blur-xl animate-pulse" />
                  <Heart className="h-8 w-8 text-[#D91CD2] relative z-10" fill="currentColor" />
                </div>
                <div className="relative">
                  <Avatar className="h-16 w-16 ring-2 ring-[#D91CD2]/50">
                    <AvatarImage src={(currentProfile as any)?.photoURL || ''} className="object-cover" />
                    <AvatarFallback className="bg-zinc-800 text-white text-lg">
                      {(currentProfile?.name || '?').charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>

              <DialogHeader className="items-center">
                <DialogTitle className="text-2xl font-bold tracking-tight text-white leading-tight">
                  Tu veux rencontrer {currentProfile?.name.split(',')[0]} ?
                </DialogTitle>
                <DialogDescription className="text-sm text-white/50 mt-2 max-w-[280px] mx-auto leading-relaxed">
                  Passe du virtuel au réel. Réserve ton activité et rencontre{' '}
                  <span className="text-[#D91CD2] font-medium">{currentProfile?.name.split(',')[0]}</span>{' '}
                  dans la vraie vie.
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>

          {/* Activity Cards — Premium Design */}
          <div className="px-5 pb-2 pt-1">
            <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3 font-semibold">Choisis une activité</p>
            <div className="space-y-2.5">
              {realActivities.length > 0 ? (
                <>
                  {[...realActivities]
                    .sort((a, b) => {
                      const aBoosted = boostedPartnerIds.has(a.partnerId);
                      const bBoosted = boostedPartnerIds.has(b.partnerId);
                      if (aBoosted && !bBoosted) return -1;
                      if (!aBoosted && bBoosted) return 1;
                      return 0;
                    })
                    .map((act, idx) => {
                      const isBoosted = boostedPartnerIds.has(act.partnerId);
                      const imgUrl = act.images?.[0] || act.imageUrl || '';
                      const isFirst = idx === 0;
                      return (
                        <button
                          key={act.id}
                          onClick={() => {
                            setIsMatch(false);
                            handleBookSession();
                          }}
                          className={`w-full rounded-2xl transition-all duration-200 active:scale-[0.97] hover:scale-[1.01] ${
                            isFirst
                              ? 'bg-gradient-to-r from-[#D91CD2]/15 to-[#7B1FA2]/15 border-2 border-[#D91CD2]/40 p-0.5'
                              : 'bg-white/5 border border-white/10 hover:bg-white/8'
                          }`}
                        >
                          <div className={`flex items-center gap-3.5 p-3.5 ${isFirst ? 'bg-black/60 rounded-[14px]' : ''}`}>
                            {imgUrl ? (
                              <img src={imgUrl} alt={act.name} className={`${isFirst ? 'w-16 h-16' : 'w-12 h-12'} rounded-xl object-cover flex-shrink-0`} />
                            ) : (
                              <div className={`${isFirst ? 'w-16 h-16' : 'w-12 h-12'} rounded-xl bg-gradient-to-br from-[#D91CD2] to-[#E91E63] flex items-center justify-center text-white font-bold flex-shrink-0`}>
                                {act.sport?.charAt(0) || '?'}
                              </div>
                            )}
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className={`${isFirst ? 'text-base' : 'text-sm'} font-semibold text-white truncate`}>{act.name}</p>
                              </div>
                              {isFirst && (
                                <p className="text-[11px] text-[#D91CD2]/70 font-medium mb-1">Fun • Énergie • Connexion immédiate</p>
                              )}
                              <p className="text-[11px] text-white/40 flex items-center gap-1.5">
                                <span>{act.sport}</span>
                                <span className="text-white/20">·</span>
                                <span className="font-medium text-white/60">{act.price} CHF</span>
                                <span className="text-white/20">·</span>
                                <MapPin className="h-2.5 w-2.5 inline" />
                                <span>{act.city}</span>
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              {(isBoosted || isFirst) && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#D91CD2]/20 text-[#D91CD2] flex items-center gap-0.5 whitespace-nowrap">
                                  <Zap className="h-2.5 w-2.5" />{isBoosted ? 'Boost' : 'Recommandé'}
                                </span>
                              )}
                              <ChevronRight className="h-4 w-4 text-white/20" />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-white/30 mb-1">Aucune activité disponible</p>
                  <p className="text-xs text-white/20">De nouvelles activités arrivent bientôt</p>
                </div>
              )}
            </div>
          </div>

          {/* Reassurance badges */}
          <div className="px-5 py-4">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center gap-2.5 bg-white/[0.03] rounded-xl px-3.5 py-2.5">
                <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                <span className="text-xs text-white/50">Chat débloqué après réservation</span>
              </div>
              <div className="flex items-center gap-2.5 bg-white/[0.03] rounded-xl px-3.5 py-2.5">
                <RefreshCcw size={14} className="text-blue-400 flex-shrink-0" />
                <span className="text-xs text-white/50">Annulation gratuite</span>
              </div>
              <div className="flex items-center gap-2.5 bg-white/[0.03] rounded-xl px-3.5 py-2.5">
                <Users size={14} className="text-[#D91CD2] flex-shrink-0" />
                <span className="text-xs text-white/50">Rencontre garantie (groupe si besoin)</span>
              </div>
            </div>
          </div>

          {/* Primary CTA */}
          <div className="px-5 pb-2">
            <button
              onClick={() => {
                setIsMatch(false);
                handleBookSession();
              }}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white font-semibold text-base tracking-wide flex items-center justify-center gap-2.5 hover:opacity-90 hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 shadow-lg shadow-[#D91CD2]/20"
            >
              <Zap className="h-5 w-5" />
              Réserver mon date maintenant
            </button>
          </div>

          {/* Secondary CTA — subtle */}
          <div className="px-5 pb-6 pt-1">
            <button onClick={closeMatchModal} className="w-full text-center text-xs text-white/20 hover:text-white/40 transition-colors py-2 font-light">
              Je réfléchirai plus tard
            </button>
          </div>
          </div>{/* end scroll wrapper */}
        </DialogContent>
      </Dialog>

      {/* Partner Detail Modal */}
      <Dialog open={showPartnerModal} onOpenChange={setShowPartnerModal}>
        <DialogContent className="max-w-md w-full bg-[#0a0a0a] border-violet-500/30 text-white p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0 bg-gradient-to-b from-violet-900/20 to-transparent">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#7B1FA2] to-[#E91E63] flex items-center justify-center text-white font-bold text-2xl">
                {selectedPartner?.name.charAt(0)}
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">{selectedPartner?.name}</DialogTitle>
                <DialogDescription className="text-gray-400 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {selectedPartner?.city}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          
          <div className="p-6 space-y-6">
            {/* Address */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-start gap-3">
                <Navigation className="h-5 w-5 text-violet-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Adresse complète</p>
                  <p className="text-xs text-gray-400">{selectedPartner?.address}</p>
                  <p className="text-xs text-gray-400">{selectedPartner?.city}</p>
                </div>
              </div>
            </div>

            {/* Upcoming Sessions */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-violet-400" />
                Prochaines sessions
              </h4>
              <div className="space-y-2">
                {mockSessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                    <div>
                      <p className="text-sm font-medium">{session.title}</p>
                      <p className="text-xs text-gray-400">{session.day} • {session.time}</p>
                    </div>
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      {session.spots} places
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Who's Participating */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-violet-400" />
                Qui participe ?
              </h4>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-3">
                  {mockParticipants.map((p) => (
                    <Avatar key={p.id} className="border-2 border-[#0a0a0a] w-10 h-10">
                      <AvatarFallback className="bg-gradient-to-br from-[#7B1FA2] to-[#E91E63] text-white text-sm">
                        {p.avatar}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <div className="text-sm">
                  <p className="text-white">{mockParticipants.map(p => p.name).join(', ')}</p>
                  <p className="text-xs text-gray-400">ont réservé récemment</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button 
                onClick={() => setShowPartnerModal(false)}
                className="flex-1 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63]"
              >
                <Ticket className="mr-2 h-4 w-4" />
                Réserver ici
              </Button>
              <Button 
                variant="outline"
                className="border-gray-700"
                onClick={() => {
                  const msg = encodeURIComponent(`Découvre ${selectedPartner?.name} sur Spordateur ! 💪\n${window.location.origin}/discovery`);
                  window.open(`https://wa.me/?text=${msg}`, '_blank');
                }}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket Success Modal */}
      <Dialog open={showTicketSuccess} onOpenChange={setShowTicketSuccess}>
        <DialogContent className="max-w-sm w-full bg-[#0a0a0a] border-green-500/30 text-white text-center">
          <div className="py-6 space-y-6">
            {/* Success Icon */}
            <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-400" />
            </div>

            <div>
              <h3 className="text-2xl font-bold mb-2">Réservation confirmée ! 🎉</h3>
              <p className="text-gray-400 text-sm">
                Votre séance {lastBooking?.isDuo ? 'Duo' : 'Solo'} avec {lastBooking?.profile} est réservée
                {lastBooking?.partner !== 'Non défini' && ` à ${lastBooking?.partner}`}
              </p>
            </div>

            {/* Ticket Summary */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-left">
              <div className="flex items-center gap-3 mb-3">
                <Ticket className="h-5 w-5 text-violet-400" />
                <span className="font-semibold">Votre ticket {lastBooking?.isDuo ? 'Duo' : 'Solo'}</span>
                {lastBooking?.isDuo && (
                  <Badge className="bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] text-white text-xs">
                    <Gift className="h-3 w-3 mr-1" />
                    2 places
                  </Badge>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Partenaire</span>
                  <span>{lastBooking?.profile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Lieu</span>
                  <span>{lastBooking?.partner}</span>
                </div>
                {lastBooking?.partnerAddress && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Adresse</span>
                    <span className="text-right text-xs max-w-[150px]">{lastBooking.partnerAddress}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">Montant</span>
                  <span className="text-green-400 font-semibold">
                    {lastBooking?.amount === 0 ? 'OFFERT' : `${lastBooking?.amount} CHF`}
                  </span>
                </div>
              </div>
            </div>

            {/* Calendar Buttons */}
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-2">Ajouter à mon calendrier</p>
              <div className="flex gap-2">
                <Button 
                  onClick={addToGoogleCalendar}
                  variant="outline"
                  className="flex-1 border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  Google Calendar
                </Button>
                <Button 
                  onClick={downloadIcsFile}
                  variant="outline"
                  className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-700/30"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Fichier .ics
                </Button>
              </div>
            </div>

            {/* Partage viral — redirige vers /share */}
            <Button
              onClick={() => {
                setShowTicketSuccess(false);
                router.push(`/share?sport=${encodeURIComponent(lastBooking?.profile || 'Sport Date')}&partner=${encodeURIComponent(lastBooking?.partner || '')}`);
              }}
              className="w-full bg-gradient-to-r from-[#D91CD2] to-[#E91E63] hover:from-[#E91E63] hover:to-[#D91CD2] text-white"
            >
              <Share2 className="mr-2 h-4 w-4" />
              Partager mon Sport Date
            </Button>

            <Button
              variant="ghost"
              onClick={() => setShowTicketSuccess(false)}
              className="w-full text-gray-400"
            >
              Plus tard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* ===== BOTTOM SHEET — Lieux / Partenaires (mobile only) ===== */}
      {showLocationsSheet && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowLocationsSheet(false)}
          />
          {/* Sheet */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0A0A0A] border-t border-white/10 rounded-t-3xl max-h-[70vh] overflow-y-auto animate-in slide-in-from-bottom duration-300 pb-24">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            <div className="px-5 pb-6 pt-2">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-[#D91CD2]" />
                  <h3 className="text-lg font-semibold text-white">Où pratiquer ?</h3>
                </div>
                <button
                  onClick={() => setShowLocationsSheet(false)}
                  className="text-xs text-white/30 hover:text-white/60 transition"
                >
                  Fermer
                </button>
              </div>

              <div className="space-y-2">
                {[...partners]
                  .sort((a, b) => {
                    const aBoost = a.id ? boostedPartnerIds.has(a.id) : false;
                    const bBoost = b.id ? boostedPartnerIds.has(b.id) : false;
                    if (aBoost && !bBoost) return -1;
                    if (!aBoost && bBoost) return 1;
                    return 0;
                  })
                  .map((partner) => {
                  const isBoosted = partner.id ? boostedPartnerIds.has(partner.id) : false;
                  return (
                  <div
                    key={partner.id}
                    onClick={() => {
                      handlePartnerSelect(partner);
                      setShowLocationsSheet(false);
                    }}
                    className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-200 min-h-[56px]
                      ${selectedMeetingPlace === partner.id
                        ? 'bg-[#D91CD2]/15 border border-[#D91CD2]/40'
                        : isBoosted
                          ? 'bg-[#D91CD2]/5 border border-[#D91CD2]/20 active:bg-[#D91CD2]/10'
                          : 'bg-white/5 border border-transparent active:bg-white/10'}
                    `}
                  >
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                      isBoosted
                        ? 'bg-gradient-to-br from-[#D91CD2] to-[#E91E63] ring-2 ring-[#D91CD2]/40'
                        : 'bg-gradient-to-br from-[#D91CD2] to-[#E91E63]'
                    }`}>
                      {partner.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-sm text-white truncate">{partner.name}</h4>
                        {isBoosted && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#D91CD2]/20 text-[#D91CD2] whitespace-nowrap flex items-center gap-0.5">
                            <Zap className="h-2.5 w-2.5" />Recommandé
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{partner.city}
                        {partner.address && <span className="ml-1 text-white/20">— {partner.address}</span>}
                      </p>
                    </div>
                    {selectedMeetingPlace === partner.id ? (
                      <CheckCircle className="h-5 w-5 text-[#D91CD2] flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-white/20 flex-shrink-0" />
                    )}
                  </div>
                  );
                })}
              </div>

              {selectedMeetingPlace && (
                <div className="mt-4 p-3 bg-[#D91CD2]/5 border border-[#D91CD2]/15 rounded-xl">
                  <p className="text-xs text-[#D91CD2]">
                    Lieu sélectionné pour votre prochaine réservation
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
