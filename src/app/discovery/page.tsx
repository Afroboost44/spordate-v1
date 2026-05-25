"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Heart, MapPin, Undo2, Zap, Lock, CheckCircle, RefreshCcw, Handshake, Share2, CreditCard, Check, Ticket, Loader2, Building2, Navigation, Clock, Users, Calendar, MessageCircle, Send, ChevronRight, Download, Gift, BadgeCheck, Info } from 'lucide-react';
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
import { Sheet, SheetContent } from "@/components/ui/sheet"
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveThumbnail } from '@/lib/youtube/thumbnail';
import { registerBooking, getConfirmedTickets, getPartners, type Partner } from "@/lib/db";

import { sendPartnerNotification } from "@/lib/notifications";
import { isFirebaseConfigured, getMissingConfig, db } from "@/lib/firebase";
import { ConfigErrorScreen } from "@/components/ConfigErrorScreen";
import { useAuth } from "@/context/AuthContext";
import { resolveActiveReferralCode } from "@/lib/referral/refStorage";
import { collection, query, where, getDocs, getDoc, doc, setDoc, serverTimestamp, limit as firestoreLimit, orderBy, Timestamp } from 'firebase/firestore';
import { useLanguage } from '@/context/LanguageContext';
import type { UserProfile, SportEntry } from '@/types/firestore';
import { groupBoostedActivitiesByCity } from '@/lib/discovery/whereToPractice';
import { resolveDiscoveryCardImage, buildProfileHref } from '@/lib/discovery/cardImage';
import { extractSwipedUids } from '@/lib/discovery/swipedUids';
import { buildActivityListUrl } from '@/lib/activities/listUrl';
import { getActivityThumbnail } from '@/lib/activities/getActivityThumbnail';
import Link from 'next/link';
import { DANCE_ACTIVITIES } from '@/types/firestore';
import { createMatch, getUserMatches, getNextFutureSessionForActivity } from '@/services/firestore';
import { getBookingPriceCHF } from '@/lib/booking/price';
import type { Session as PricingSession } from '@/types/firestore';
import type { Match } from '@/types/firestore';
import { getMutualBlockSet } from '@/lib/blocks';
import { computeMatchScore } from '@/lib/matching/computeMatchScore';
import { useCredits } from '@/hooks/useCredits';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';
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

  // Phase 9.5 c26 BUG BB — `price` retiré de la card profil. Le prix réel
  // vient de l'Activity choisie dans la modal "Tu veux rencontrer X ?" et
  // est porté par selectedActivity (state component-level).
  return {
    id: index + 1000, // Offset to avoid collision with fallback IDs
    firestoreUid: user.uid,
    name: user.displayName || 'Utilisateur',
    location: user.city || 'Suisse',
    sports: sportLabels.length > 0 ? sportLabels : ['Sport'],
    bio: user.bio || 'Passionné de sport, à la recherche de partenaires !',
    imageId: 'discovery-' + ((index % 3) + 1), // Cycle through placeholder images
    photoURL: user.photoURL || '',
    // BUG #84 — Propage le statut de vérification selfie pour afficher le
    // badge ✓ Vérifié sur la card Discovery.
    isVerified: user.selfieVerificationStatus === 'verified',
    matchScore: 0, // Will be computed
  };
}

// Phase 9 SC5 c3/4 — computeMatchScore extracted to @/lib/matching/computeMatchScore.ts
// (low-rating multiplier × 0.7 si <3.5★ + ≥3 reviews — Q2=B + Q3=A + Q4=B doctrine)


export default function DiscoveryPage() {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState(fallbackProfiles);
  // Fix #176 — Compteur de refresh : incrémenter force le re-fetch Firestore
  // dans le useEffect loadFirestoreProfiles. Utilisé par resetProfiles().
  const [refreshTick, setRefreshTick] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  // Phase 9.5 c38b CH5 — isMatch state retiré (modal "Tu veux rencontrer X" supprimée)
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmedTickets, setConfirmedTickets] = useState<number[]>([]);
  // Phase 9.5 c23 BUG V — state initialisé vide (au lieu de DEFAULT_PARTNERS mock).
  // Real partners chargés via getPartners() Firestore au mount.
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [boostedPartnerIds, setBoostedPartnerIds] = useState<Set<string>>(new Set());
  // BUG #69 — Set des activityId boostés (nouveau modèle par-activité).
  // Un boost peut désormais cibler 1 activity précise au lieu de tout le compte.
  // boostedPartnerIds reste utilisé pour les boosts LEGACY (sans activityId).
  const [boostedActivityIds, setBoostedActivityIds] = useState<Set<string>>(new Set());
  const [boostedActivities_db, setBoostedActivities_db] = useState<any[]>([]);
  const [realActivities, setRealActivities] = useState<any[]>([]);
  // Phase 9.5 c26 BUG BB — activity choisie dans la modal "Tu veux rencontrer X ?".
  // Source de vérité du prix affiché dans la payment modal (à la place de
  // currentProfile.price retiré). Pre-sélectionnée auto par handleBookSession()
  // si l'utilisateur clique le CTA principal sans en choisir une.
  const [selectedActivity, setSelectedActivity] = useState<any | null>(null);
  // BUG pricing FIX A — preview de la session de référence (next future) pour
  // afficher le prix EFFECTIVEMENT chargé par /api/checkout (computePricingTier
  // sur session.pricingTiers) au lieu d'Activity.price (vitrine) qui peut diverger.
  const [previewedSession, setPreviewedSession] = useState<PricingSession | null>(null);
  // Fix B post-B2 — map activityId → Session (next future), pour que le Step 1
  // card list affiche le prix effectif de chaque activity (cohérent step 2/3).
  // Sans cette map, les cards montraient `act.price` (Activity.price legacy
  // vitrine) qui peut diverger des pricingTiers de la session (custom override
  // partner via B2, ou progression tiers triggés).
  const [sessionsByActivityId, setSessionsByActivityId] = useState<Record<string, PricingSession>>({});

  // New states for social features
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [showLocationsSheet, setShowLocationsSheet] = useState(false);
  // BUG #10 — modal "Où pratiquer ?" : activités boostées groupées par ville
  const [showWherePracticeModal, setShowWherePracticeModal] = useState(false);
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
  const { discoveryMode, loading: flagsLoading } = useFeatureFlags();

  // Phase 9.5 c8 + c21 — gate page derrière feature flag 3-state
  // 'disabled' → redirect /activities ; sinon page accessible
  useEffect(() => {
    if (flagsLoading) return;
    if (discoveryMode === 'disabled') {
      toast({
        title: 'Bientôt disponible',
        description: 'La section Rencontres sera activée prochainement.',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      router.replace('/activities');
    }
  }, [flagsLoading, discoveryMode, router, toast]);

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

        // Phase 7 sub-chantier 2 commit 4/4 : filter mutual blocks (doctrine §9.sexies E)
        const blockSet = await getMutualBlockSet(user.uid).catch((err) => {
          console.warn('[Discovery] getMutualBlockSet failed (non-blocking, defaulting empty)', err);
          return new Set<string>();
        });
        let visibleUsers = firestoreUsers.filter((u) => !blockSet.has(u.uid));

        // BUG #25 — Exclure les profils déjà likés OU passés (Tinder-like
        // dismiss permanent). Avant : les profils ré-apparaissaient en boucle
        // car aucune persistance des passes (handleNextProfile = state local
        // pur) ni filter sur les likes existants.
        try {
          const [likesSnap, passesSnap] = await Promise.all([
            getDocs(query(collection(db, 'likes'), where('fromUid', '==', user.uid))),
            getDocs(query(collection(db, 'passes'), where('fromUid', '==', user.uid))),
          ]);
          const swipedUids = extractSwipedUids(
            likesSnap.docs.map((d) => d.data() as { toUid?: string }),
            passesSnap.docs.map((d) => d.data() as { toUid?: string }),
          );
          if (swipedUids.size > 0) {
            visibleUsers = visibleUsers.filter((u) => !swipedUids.has(u.uid));
            console.log(`[Discovery] Excluded ${swipedUids.size} already-swiped profiles`);
          }
        } catch (err) {
          console.warn('[Discovery] swiped filter failed (non-blocking, all profiles shown):', err);
        }

        // Phase 9.5 c21 — filter par opt-in partners si discoveryMode='participants-only'.
        // Query batch bookings confirmés → activities → partners.includeInDiscovery → set userIds
        // éligibles. Pas appliqué si mode='open-to-all' (legacy comportement préservé).
        if (discoveryMode === 'participants-only') {
          try {
            const fbDb = db;
            const bookingsSnap = await getDocs(
              query(
                collection(fbDb, 'bookings'),
                where('status', '==', 'confirmed'),
                firestoreLimit(500),
              ),
            );
            // userId → set of activityIds (pour grouper par user)
            const userBookings = new Map<string, Set<string>>();
            const activityIds = new Set<string>();
            bookingsSnap.forEach((d) => {
              const data = d.data() as { userId?: string; activityId?: string };
              if (data.userId && data.activityId) {
                const set = userBookings.get(data.userId) ?? new Set<string>();
                set.add(data.activityId);
                userBookings.set(data.userId, set);
                activityIds.add(data.activityId);
              }
            });
            // Activity → partnerId
            const activityToPartner = new Map<string, string>();
            await Promise.all(
              [...activityIds].map(async (aid) => {
                const aq = await getDocs(
                  query(collection(fbDb, 'activities'), where('activityId', '==', aid), firestoreLimit(1)),
                );
                aq.forEach((d) => {
                  const data = d.data() as { partnerId?: string };
                  if (data.partnerId) activityToPartner.set(aid, data.partnerId);
                });
              }),
            );
            const partnerIds = new Set(activityToPartner.values());
            // partnerId → includeInDiscovery
            const partnerOptIn = new Map<string, boolean>();
            await Promise.all(
              [...partnerIds].map(async (pid) => {
                const pq = await getDocs(
                  query(collection(fbDb, 'partners'), where('partnerId', '==', pid), firestoreLimit(1)),
                );
                pq.forEach((d) => {
                  const data = d.data() as { includeInDiscovery?: boolean };
                  // Default true (opt-in par défaut quand champ absent)
                  partnerOptIn.set(pid, data.includeInDiscovery !== false);
                });
              }),
            );
            // Compute eligible userIds : has ≥ 1 booking on activity from opt-in partner
            const eligibleUserIds = new Set<string>();
            userBookings.forEach((acts, uid) => {
              for (const aid of acts) {
                const pid = activityToPartner.get(aid);
                if (pid && partnerOptIn.get(pid) === true) {
                  eligibleUserIds.add(uid);
                  break;
                }
              }
            });
            visibleUsers = visibleUsers.filter((u) => eligibleUserIds.has(u.uid));
            console.log(`[Discovery] participants-only filter : ${visibleUsers.length} eligible users`);
          } catch (err) {
            console.warn('[Discovery] participants-only filter failed (silent, all visible):', err);
            // Fallback gracieux : si query fail, laisse passer (UX dégradée mais pas blank screen)
          }
        }

        if (visibleUsers.length > 0) {
          // Convert to card format and compute match scores
          let cardProfiles = visibleUsers.map((u, i) => {
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
    // Fix #176 — Le compteur refreshTick permet à resetProfiles() de
    // re-déclencher le chargement Firestore (Recommencer = vrai reload des
    // profils, pas juste reset au tableau vide fallback).
  }, [user, userProfile, refreshTick]);

  // Load partners function (extracted for reuse)
  // Phase 9.5 c23 BUG V — pas de fallback DEFAULT_PARTNERS si Firestore vide.
  // setPartners([]) → la section "Où pratiquer ?" ET le dropdown booking sont
  // skip ou affichent un message empty-state.
  const loadPartnersData = async () => {
    try {
      const loadedPartners = await getPartners();
      const activePartners = loadedPartners.filter(p => p.active);
      setPartners(activePartners);
    } catch (e) {
      console.warn('[Discovery] loadPartnersData failed:', e);
      setPartners([]);
    }
  };

  // Load active boosts from Firestore
  useEffect(() => {
    if (!db || !isFirebaseConfigured) return;
    const fbDb = db; // capture for async closures (already proven non-null by guard above)

    const loadActiveBoosts = async () => {
      try {
        const now = Timestamp.now();
        const boostsRef = collection(fbDb, 'boosts');
        const q = query(
          boostsRef,
          where('active', '==', true),
          where('expiresAt', '>', now)
        );
        const snapshot = await getDocs(q);
        // BUG #69 — Sépare boosts per-activity (nouveau) vs legacy (sans activityId).
        //  - Boost AVEC activityId → push dans boostedActivityIds (filtre précis)
        //  - Boost SANS activityId → push dans boostedPartnerIds (fallback legacy
        //    qui boost toutes les activités du partner). Ces docs ont été créés
        //    AVANT le fix #69 et restent valides jusqu'à leur expiration naturelle.
        const partnerIds = new Set<string>();
        const activityIds = new Set<string>();
        const boostDocs: any[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.activityId) {
            activityIds.add(data.activityId);
          } else if (data.partnerId) {
            partnerIds.add(data.partnerId);
          }
          boostDocs.push({ id: doc.id, ...data });
        });
        setBoostedPartnerIds(partnerIds);
        setBoostedActivityIds(activityIds);
        setBoostedActivities_db(boostDocs);
        console.log(`[Discovery] boosts chargés : ${activityIds.size} per-activity + ${partnerIds.size} legacy (partenaire)`);
      } catch (err) {
        console.warn('[Discovery] Erreur chargement boosts:', err);
      }
    };

    // Load real activities from Firestore
    const loadRealActivities = async () => {
      try {
        let snap;
        try {
          const q = query(collection(fbDb, 'activities'), where('isActive', '==', true), orderBy('createdAt', 'desc'));
          snap = await getDocs(q);
        } catch {
          const q = query(collection(fbDb, 'activities'), where('isActive', '==', true));
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

  // Phase 9.5 c26 BUG CC — ne montrer dans la modal "Tu veux rencontrer X ?"
  // que les activités dont le partenaire est ACTUELLEMENT boosté (présent dans
  // la collection boosts/ avec active=true et expiresAt>now, cf. ligne 310).
  // Boostés en tête (sort stable : tous boostés donc ordre Firestore conservé).
  // BUG #69 — Une activity est boostée si :
  //   - son activityId est dans boostedActivityIds (boost par-activité, nouveau modèle), OU
  //   - son partnerId est dans boostedPartnerIds (legacy : boost tout le compte)
  const visibleActivities = realActivities.filter(
    (act) =>
      boostedActivityIds.has(act.id) ||
      boostedPartnerIds.has(act.partnerId),
  );

  // BUG #69 — Set "effectif" des partners considérés boostés au niveau partner :
  // legacy boost partner + partnerIds des activités boostées par-activité.
  // Utilisé pour les UIs qui affichent les partners (sheet locations, partner cards)
  // afin qu'un partner avec un boost per-activity apparaisse aussi en haut.
  const effectiveBoostedPartnerIds = (() => {
    const s = new Set(boostedPartnerIds);
    for (const act of realActivities) {
      if (act.id && boostedActivityIds.has(act.id) && act.partnerId) {
        s.add(act.partnerId);
      }
    }
    return s;
  })();


  const handleNextProfile = () => {
    setCurrentIndex(prev => prev + 1);
  };

  // BUG #25 — Pass (X click) : persist + advance. Avant : seulement
  // setCurrentIndex local → le profil ré-apparaissait au reload car aucun
  // doc Firestore ne marquait le pass. Création de passes/{fromUid_toUid}
  // (skip-if-exists, défensif). Le filter loadFirestoreProfiles exclut
  // ces toUid au prochain mount.
  const handlePass = async () => {
    if (user && db && currentProfile) {
      const targetUid = (currentProfile as any).firestoreUid as string | undefined;
      if (targetUid && typeof targetUid === 'string' && targetUid.length >= 5 && targetUid !== user.uid) {
        try {
          const passId = `${user.uid}_${targetUid}`;
          const passRef = doc(db, 'passes', passId);
          const snap = await getDoc(passRef);
          if (!snap.exists()) {
            await setDoc(passRef, {
              fromUid: user.uid,
              toUid: targetUid,
              createdAt: serverTimestamp(),
            });
          }
        } catch (err) {
          // Best-effort : si la persistance échoue, le user voit quand même
          // le profil suivant. Sera ré-persisté au prochain swipe sur ce profil.
          console.warn('[handlePass] persist failed (non-blocking):', err);
        }
      }
    }
    handleNextProfile();
  };

  // Phase 9.5 c38a CH2 — Refactor flow Tinder-like.
  // AVANT : like débitait crédit + créait match unilatéral chatUnlocked=false +
  //         ouvrait modal "Tu veux rencontrer X" pour choisir une activité.
  // APRÈS : like crée un doc likes/{fromUid_toUid}, AUCUN crédit débité, AUCUNE
  //         modal. Si like inverse existe → POST /api/match/create-mutual qui
  //         crée matches/{id} avec chatUnlocked=true (chat ouvert d'office sur
  //         match mutuel). Sinon toast soft "Like envoyé".
  // Le crédit est désormais débité UNIQUEMENT à l'envoi de message dans le chat.
  const handleLike = async () => {
    if (!user || !db || !currentProfile) {
      handleNextProfile();
      return;
    }
    const targetUid = (currentProfile as any).firestoreUid as string | undefined;
    if (!targetUid || typeof targetUid !== 'string' || targetUid.length < 5) {
      console.warn('[handleLike] targetUid invalid, skip:', targetUid);
      toast({
        title: 'Profil incomplet',
        description: "Ce profil n'a pas d'identifiant valide. Profil suivant.",
        variant: 'destructive',
      });
      handleNextProfile();
      return;
    }
    if (targetUid === user.uid) {
      // Self-like impossible
      handleNextProfile();
      return;
    }

    try {
      // 1. Phase 9.5 c38a-fix3 — skip-if-exists pour éviter UPDATE rejeté par rules.
      const likeId = `${user.uid}_${targetUid}`;
      const ownLikeRef = doc(db, 'likes', likeId);
      const ownLikeSnap = await getDoc(ownLikeRef);
      if (!ownLikeSnap.exists()) {
        await setDoc(ownLikeRef, {
          fromUid: user.uid,
          toUid: targetUid,
          createdAt: serverTimestamp(),
          seen: false,
        });
      }

      // 2. Phase 9.5 c38a-fix5 — Mutual check 100% server-side (admin SDK bypass
      //    rules). Avant : getDoc(likes/${targetUid}_${user.uid}) côté client
      //    rejetait avec permission-denied (un user ne peut pas read un like
      //    où il est toUid only — rule read exige in [fromUid, toUid]; mais
      //    via le rule path "auth.uid == resource.data.toUid" ça marche... sauf
      //    si race/cache rules). On contourne en déléguant 100% au serveur :
      //    /api/match/create-mutual fait les 2 getDoc + détection + création
      //    atomique, return { mutual: true/false, matchId? } toujours 200.
      const idToken = await user.getIdToken();
      const res = await fetch('/api/match/create-mutual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ targetUid }),
      });
      const data = await res.json();
      if (res.ok && data.mutual === true && data.matchId) {
        setCurrentMatchId(data.matchId);
        toast({
          title: "💖 C'est un match !",
          description: `Tu peux maintenant discuter avec ${currentProfile.name.split(',')[0]}.`,
          className: 'bg-zinc-900 border-accent/40 text-white',
        });
      } else {
        toast({
          title: 'Like envoyé 💌',
          description: "Si l'intérêt est mutuel, vous serez notifiés.",
        });
      }
    } catch (err) {
      console.error('[Discovery] handleLike error:', err);
      toast({
        title: 'Erreur',
        description: 'Le like n\'a pas pu être enregistré. Réessaie.',
        variant: 'destructive',
      });
    }

    // Avancer au profil suivant après le like (peu importe match ou pas).
    handleNextProfile();
  };
  
  // Phase 9.5 c38b CH1 — Chat direct payant (5 crédits, court-circuite mutual).
  // Distinct du ❤️ Like (gratuit, attend mutuel) : ici on paie pour parler.
  // Server-side via /api/chat/unlock-direct (Bearer + runTransaction atomic).
  const DIRECT_CHAT_COST = 5;
  const handleDirectChat = async () => {
    if (!user || !db || !currentProfile) return;
    const targetUid = (currentProfile as any).firestoreUid as string | undefined;
    if (!targetUid || typeof targetUid !== 'string' || targetUid === user.uid) return;

    // UX fast-feedback côté client (server re-check faisant autorité).
    if (creditCount < DIRECT_CHAT_COST) {
      toast({
        title: 'Solde insuffisant',
        description: t('discovery_direct_chat_insufficient', {
          have: creditCount,
          need: DIRECT_CHAT_COST,
        }),
        variant: 'destructive',
      });
      router.push('/payment');
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/chat/unlock-direct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ targetUid }),
      });
      const data = await res.json();
      if (res.ok && data.matchId) {
        toast({
          title: t('discovery_direct_chat_success'),
          description: `Tu peux maintenant discuter avec ${currentProfile.name.split(',')[0]}.`,
          className: 'bg-zinc-900 border-accent/40 text-white',
        });
        router.push(`/chat?match=${data.matchId}`);
      } else if (data.error === 'insufficient-credits') {
        toast({
          title: 'Solde insuffisant',
          description: t('discovery_direct_chat_insufficient', {
            have: data.have ?? 0,
            need: data.need ?? DIRECT_CHAT_COST,
          }),
          variant: 'destructive',
        });
        router.push('/payment');
      } else {
        toast({
          title: 'Erreur',
          description: data.detail || data.error || 'Impossible de débloquer le chat.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('[handleDirectChat]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    }
  };

  // Fix #176 — Recommencer = vrai reload depuis Firestore (avant : juste reset
  // au tableau vide fallback → user bloqué sur "Plus de profils"). Maintenant on :
  //  1. Reset l'index à 0
  //  2. Vide les profiles pour montrer le loader
  //  3. Set loadingProfiles=true (skeleton)
  //  4. Bump refreshTick → useEffect loadFirestoreProfiles re-fetch tout
  const resetProfiles = () => {
    setCurrentIndex(0);
    setProfiles([]);
    setLoadingProfiles(true);
    setRefreshTick((t) => t + 1);
  }

  // Phase 9.5 c38b CH5 — closeMatchModal retiré (modal supprimée)

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
  // Phase 9.5 c26 BUG BB+CC — accepte une activity optionnelle (depuis le clic
  // sur une card d'activité dans la modal). Si absente, pre-select la première
  // de la liste filtrée par boost (visibleActivities) pour ne pas pousser un
  // flow "free booking" par accident (basePrice 0 sinon).
  const handleBookSession = (activity?: any) => {
    // Phase 9.5 c38b CH3 — Pre-select dans partnerActivities (filtré au profil
    // courant) au lieu de visibleActivities. Empty state → toast au lieu d'ouvrir
    // une modal vide (avant c38b la modal s'ouvrait avec une activité d'un autre
    // partner par accident).
    if (!activity && partnerActivities.length === 0) {
      toast({
        title: 'Aucune activité disponible',
        description: t('discovery_no_boosted_activity_partner'),
      });
      return;
    }
    const pick = activity ?? partnerActivities[0] ?? null;
    selectActivityWithPreview(pick);
    // Don't reset selectedMeetingPlace if already set from partner selection
    setIsDuoTicket(false);
    setShowPaymentModal(true);
    // Fix B post-B2 — prefetch sessions des AUTRES activités du modal pour
    // que leurs cards Step 1 affichent aussi le prix effectif (cohérence).
    // Run in background, results merge dans sessionsByActivityId.
    if (partnerActivities.length > 0) {
      void prefetchSessionsForActivities(partnerActivities);
    }
  };

  // BUG pricing FIX A — Centralise la sélection d'activité + preview de la
  // session de référence (next future). Sans preview, getBookingPriceCHF
  // retombe sur Activity.price (vitrine) qui peut diverger du prix réellement
  // chargé par /api/checkout (computePricingTier sur session.pricingTiers).
  //
  // Fix B post-B2 : si la session est déjà dans le cache sessionsByActivityId
  // (prefetched au modal open), on l'utilise directement — pas de re-fetch.
  const selectActivityWithPreview = (act: any | null) => {
    setSelectedActivity(act);
    if (!act?.activityId) {
      setPreviewedSession(null);
      return;
    }
    const cached = sessionsByActivityId[act.activityId];
    if (cached) {
      setPreviewedSession(cached);
      return;
    }
    setPreviewedSession(null);
    getNextFutureSessionForActivity(act.activityId)
      .then((s) => {
        if (s) {
          setPreviewedSession(s);
          setSessionsByActivityId((prev) => ({ ...prev, [act.activityId]: s }));
        }
      })
      .catch(() => setPreviewedSession(null));
  };

  // Fix B post-B2 — prefetch parallèle des sessions next-future pour TOUTES
  // les activités d'une liste. Utilisé au modal open + pour cohérence des
  // prix affichés dans le picker Step 1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefetchSessionsForActivities = async (acts: any[]) => {
    const missing = acts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((a: any) => a?.activityId && !sessionsByActivityId[a.activityId]);
    if (missing.length === 0) return;
    const results = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      missing.map((a: any) =>
        getNextFutureSessionForActivity(a.activityId)
          .then((s) => ({ id: a.activityId as string, session: s }))
          .catch(() => ({ id: a.activityId as string, session: null })),
      ),
    );
    setSessionsByActivityId((prev) => {
      const next = { ...prev };
      results.forEach((r) => {
        if (r.session) next[r.id] = r.session;
      });
      return next;
    });
  };

  // BUG pricing FIX A — Prix résolu par helper pur depuis la session de
  // référence (si chargée) sinon fallback Activity.price. Aligné avec
  // /api/checkout server-side (computePricingTier). Duo = ×2.
  const getCurrentPrice = () => {
    return getBookingPriceCHF({
      session: previewedSession,
      activity: selectedActivity ?? null,
      now: new Date(),
      isDuo: isDuoTicket,
    });
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

  // Phase 9.5 c48 — Wizard 3 étapes : Activité → Invité → Paiement.
  // Reset à 1 quand la modal s'ouvre/ferme (via useEffect plus bas).
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  // BUG #15 — Méthode de paiement sélectionnée dans la modal. Bassi veut 3
  // onglets explicites (Crédits / Carte / TWINT) au lieu des 2 tabs précédents
  // (Crédits / Stripe-qui-choisit). 'card' et 'twint' déterminent
  // payment_method_types côté Stripe Checkout via paymentMethodPreference.
  // Fix UX : retiré 'credits' (Crédits Spordateur tab supprimée Step 3).
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'twint'>('card');
  // Phase 9.5 c47 BUG B — Sélection invitee Duo via match Tinder (méthode "link"
  // WhatsApp reportée c48). Quand toggle Duo ON, on charge les matches actifs du
  // user et il sélectionne qui inviter ; inviteeUid passé au checkout → webhook
  // ou /api/checkout/credits crée le 2e booking + notification.
  const [invitationMethod, setInvitationMethod] = useState<'match' | 'link'>('match');
  const [selectedInviteeUid, setSelectedInviteeUid] = useState<string | null>(null);
  const [userMatches, setUserMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchProfiles, setMatchProfiles] = useState<Record<string, { displayName: string; photoURL: string }>>({});
  // Phase 9.5 c45 BUG 5 — Taux conversion crédits ↔ CHF (cohérent c29b boost + API credits).
  // 1 crédit = 0.50 CHF → 2 crédits par CHF. Round-up sur le total (anti sous-facturation).
  const computeCreditsCost = (priceCHF: number): number => Math.ceil((priceCHF * 100) / 50);

  // Phase 9.5 c47 BUG B — Charge les matches actifs du user quand le toggle Duo passe
  // ON (lazy). Filtre status='accepted' OU chatUnlocked. Display name/photo récupérés
  // via getUser parallel (cache in matchProfiles state).
  useEffect(() => {
    if (!isDuoTicket || !user?.uid || !db) return;
    if (userMatches.length > 0) return; // déjà chargé, skip
    let cancelled = false;
    (async () => {
      setLoadingMatches(true);
      try {
        const matches = await getUserMatches(user.uid);
        if (cancelled) return;
        const relevant = matches.filter((m) => m.status === 'accepted' || m.chatUnlocked);
        setUserMatches(relevant);
        // Resolve other-user display info (parallel)
        const { getUser } = await import('@/services/firestore');
        const otherUids = relevant
          .map((m) => m.userIds.find((uid) => uid !== user.uid))
          .filter((uid): uid is string => !!uid);
        const uniqueUids = Array.from(new Set(otherUids));
        const profileEntries = await Promise.all(
          uniqueUids.map(async (uid) => {
            try {
              const p = await getUser(uid);
              return [uid, { displayName: p?.displayName || 'Utilisateur', photoURL: p?.photoURL || '' }] as const;
            } catch {
              return [uid, { displayName: 'Utilisateur', photoURL: '' }] as const;
            }
          }),
        );
        if (cancelled) return;
        setMatchProfiles(Object.fromEntries(profileEntries));
      } catch (err) {
        console.warn('[Discovery c47] load matches failed', err);
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDuoTicket, user?.uid]);

  // Reset invitee sélectionné quand toggle Duo OFF (anti-stale state)
  useEffect(() => {
    if (!isDuoTicket) setSelectedInviteeUid(null);
  }, [isDuoTicket]);

  // Phase 9.5 c48 — Reset wizard à l'étape 1 + paymentMethod default quand
  // la modal s'ouvre (fresh state) ou se ferme (anti-stale au prochain open).
  useEffect(() => {
    if (showPaymentModal) {
      setCurrentStep(1);
      setPaymentMethod('card');
    }
  }, [showPaymentModal]);

  // Phase 9.5 c48 — Calcule si on peut avancer à l'étape suivante.
  const canAdvanceStep = (): boolean => {
    if (currentStep === 1) return !!selectedActivity;
    if (currentStep === 2) {
      if (!isDuoTicket) return true;
      return invitationMethod === 'match' ? !!selectedInviteeUid : false;
    }
    return false; // step 3 = pay button, pas de "next"
  };

  // Phase 9.5 c45 BUG 1 — helper ensure Session pour l'Activity sélectionnée
  // (réutilise /api/sessions/ensure-from-activity créé en c42). Sans Session
  // matérialisée, le checkout mode='session' renvoie 404.
  const ensureSessionForActivity = async (activityId: string): Promise<string | null> => {
    if (!user) return null;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/sessions/ensure-from-activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ activityId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.sessionId) return data.sessionId as string;
      console.warn('[Discovery] ensureSessionForActivity failed', { status: res.status, data });
      return null;
    } catch (err) {
      console.warn('[Discovery] ensureSessionForActivity threw', err);
      return null;
    }
  };

  // Phase 9.5 c45 BUG 5 — Paiement 100% crédits via /api/checkout/credits.
  const handlePaymentCredits = async () => {
    if (!currentProfile || !user || !selectedActivity) return;
    const finalPrice = getCurrentPrice();
    if (finalPrice <= 0) {
      // Cohérence avec flow Stripe (le bouton "Réserver gratuitement" reste dans handlePayment).
      void handlePayment();
      return;
    }
    const cost = computeCreditsCost(finalPrice);
    if (creditCount < cost) {
      toast({
        title: t('discovery_credits_insufficient_title') || 'Solde insuffisant',
        description: t('discovery_credits_insufficient_desc', { have: creditCount, need: cost })
          || `Tu as ${creditCount} crédits, il en faut ${cost}.`,
        variant: 'destructive',
      });
      router.push('/payment');
      return;
    }
    setIsProcessing(true);
    try {
      const sessionId = await ensureSessionForActivity(selectedActivity.activityId);
      if (!sessionId) {
        toast({ title: 'Erreur', description: 'Impossible de résoudre la session.', variant: 'destructive' });
        return;
      }
      const idToken = await user.getIdToken();
      const res = await fetch('/api/checkout/credits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          sessionId,
          isDuoTicket,
          matchId: currentMatchId || '',
          // Phase 9.5 c47 BUG B — invitee Duo (match Tinder). Endpoint credits crée
          // alors le 2e booking + notification à l'invité atomiquement dans la même TX.
          inviteeUid: isDuoTicket && invitationMethod === 'match' ? selectedInviteeUid : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.bookingId) {
        setShowPaymentModal(false);
        toast({
          title: t('discovery_credits_success_title') || 'Réservation confirmée ! 🎉',
          description: t('discovery_credits_success_desc', { cost })
            || `${cost} crédits débités. Il te reste ${data.creditsRemaining} crédits.`,
          className: 'bg-zinc-900 border-accent/40 text-white',
        });
        router.push(`/sessions/${sessionId}?status=success`);
      } else if (data?.error === 'insufficient-credits') {
        toast({
          title: t('discovery_credits_insufficient_title') || 'Solde insuffisant',
          description: t('discovery_credits_insufficient_desc', { have: data.have ?? 0, need: data.need ?? cost }),
          variant: 'destructive',
        });
        router.push('/payment');
      } else {
        toast({
          title: 'Erreur',
          description: data?.detail || data?.error || 'Réservation impossible.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('[handlePaymentCredits]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

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

      // Phase 9.5 c45 BUG 1 — paiement Session via Stripe Checkout mode='session'.
      // Avant c45 : packageId='1_date' (bundle Starter 10 CHF) → Stripe facturait
      // 10 CHF au lieu des 80 CHF Duo affichés dans la modal. Maintenant on
      // résout d'abord la Session (ensure-from-activity c42), puis on route via
      // handleSessionMode avec isDuoTicket → server-side amount × 2 si Duo.
      if (!user || !selectedActivity) {
        throw new Error('Activity ou user manquant');
      }
      const sessionId = await ensureSessionForActivity(selectedActivity.activityId);
      if (!sessionId) {
        toast({ title: 'Erreur', description: 'Impossible de résoudre la session.', variant: 'destructive' });
        setIsProcessing(false);
        return;
      }
      const idToken = await user.getIdToken();
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          mode: 'session',
          sessionId,
          userId: user.uid,
          matchId: currentMatchId || '',
          // Phase A — était hardcodé '' ; propage maintenant user.referredBy (ou
          // localStorage capture pré-signup) → Stripe metadata → processCommission.
          referralCode: resolveActiveReferralCode(userProfile?.referredBy),
          isDuoTicket,
          // Phase 9.5 c47 BUG B — invitee Duo (match Tinder). Passé en metadata
          // Stripe → webhook handleSessionPayment crée le 2e booking + notif.
          inviteeUid: isDuoTicket && invitationMethod === 'match' ? selectedInviteeUid : undefined,
          // BUG #15 — préférence UI : Stripe Checkout n'affichera que cette
          // méthode (Carte OU TWINT) au lieu de proposer les 2 sur sa page.
          // Si l'utilisateur a sélectionné 'credits', handlePayment n'est pas
          // appelé (handlePaymentCredits prend le relais).
          paymentMethodPreference: paymentMethod === 'twint' ? 'twint' : 'card',
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

  // BUG #18 — Image resolver + lien profil (skip placeholder pour real users).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cp = currentProfile as any;
  const cardImage = currentProfile
    ? resolveDiscoveryCardImage({
        photoURL: cp?.photoURL,
        firestoreUid: cp?.firestoreUid,
        placeholderUrl: profileImage?.imageUrl,
      })
    : null;
  const profileHref = currentProfile ? buildProfileHref(cp?.firestoreUid) : null;

  // Phase 9.5 c38b CH3 — Activités boostées DU PARTNER ACTUELLEMENT REGARDÉ.
  // Sous-ensemble de visibleActivities, filtré sur Activity.partnerId ==
  // currentProfile.firestoreUid (= le user/partner dont la card est affichée).
  // Bug A (post Fix A) — Si le profil visualisé n'est pas partenaire d'une
  // activité boostée (cas user normal qu'on swipe), fallback intelligent :
  // proposer toutes les activités actives du système. Permet à l'utilisateur
  // de réserver une activité Spordateur même si le profil swipé n'est pas
  // partenaire — le profil sert alors juste à matcher l'invitee Duo / partage.
  const partnerActivities = currentProfile
    ? (() => {
        const owned = visibleActivities.filter(
          (act) => act.partnerId === (currentProfile as any).firestoreUid,
        );
        if (owned.length > 0) return owned;
        // Fallback : toutes les activités actives (isActive !== false).
        return realActivities.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (act: any) => act.isActive !== false,
        );
      })()
    : [];

  // Fix 1bis — prefetch sessions futures pour toutes les activités du modal
  // "Où pratiquer" dès qu'il s'ouvre, afin d'afficher le prix effectif via
  // getBookingPriceCHF (réuse cache sessionsByActivityId, partage avec le
  // booking modal). Sans ce hook, le modal afficherait Activity.price brut
  // tant que le user n'a pas ouvert le booking modal au préalable.
  useEffect(() => {
    if (!showWherePracticeModal) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acts: any[] = [];
    wherePracticeGroups.forEach((g) => g.activities.forEach((a) => acts.push(a)));
    if (acts.length > 0) {
      void prefetchSessionsForActivities(acts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWherePracticeModal]);

  // BUG #10 — Groupes "activités boostées par ville" pour le modal Où pratiquer.
  // Dérivé de realActivities + boostedPartnerIds déjà chargés par useEffect.
  //
  // Fix UX (régression observée) : si aucun boost actif (expiration, drift
  // partnerId post-migration c34/c36, ou setup partner sans boost) le modal
  // serait vide. Fallback : si zéro match boosté → grouper TOUTES les
  // activités actives par ville. UX utile, le user voit une liste plutôt
  // qu'un empty state inquiétant. Si boost actif → comportement standard.
  const wherePracticeGroups = useMemo(() => {
    // BUG #69 — passe les 2 sets (per-activity + legacy partner) au helper
    const boosted = groupBoostedActivitiesByCity(
      realActivities,
      boostedPartnerIds,
      { max: 50, boostedActivityIds },
    );
    if (boosted.length > 0) return boosted;
    // Fallback : groupe toutes les activités actives par ville (set partnerIds
    // dérivé des activités elles-mêmes → tout pass le filtre boost dans le helper).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allActive = realActivities.filter((a: any) => a.isActive !== false);
    const allPartnerIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allActive.map((a: any) => a.partnerId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    return groupBoostedActivitiesByCity(allActive, allPartnerIds, { max: 50 });
  }, [realActivities, boostedPartnerIds, boostedActivityIds]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-black">
      {/* BUG #10 — Bouton "Où pratiquer ?" top-left, ouvre modal activités boostées par ville */}
      <div className="px-4 md:px-6 pt-3 pb-1 flex justify-start">
        <button
          onClick={() => setShowWherePracticeModal(true)}
          aria-label={t('discovery_where_to_practice')}
          className="inline-flex items-center gap-2 px-4 h-10 rounded-full bg-white/5 border border-white/10 text-white/80 hover:text-white hover:border-accent/40 hover:bg-accent/10 transition text-sm font-light tracking-wide active:scale-[0.98]"
        >
          <Building2 className="h-4 w-4 text-accent" />
          <span>{t('discovery_where_to_practice')}</span>
          {wherePracticeGroups.length > 0 && (
            <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/20 text-accent">
              {wherePracticeGroups.reduce((s, g) => s + g.activities.length, 0)}
            </span>
          )}
        </button>
      </div>
      {currentProfile ? (
        <div className="relative w-full max-w-6xl mx-auto md:flex md:flex-row-reverse md:gap-6 md:px-6 md:py-6">
          {/* Profile Card — clean photo + info below */}
          <div className="md:flex-1 order-2 md:order-1 flex flex-col">

            {/* === PHOTO ZONE === Only name + location on image
                 BUG #18 — real user avec photoURL='' → initial avatar (jamais le
                 placeholder moon, géré par resolveDiscoveryCardImage). Image +
                 nom wrappés dans Link → /profile/[uid] si firestoreUid présent.
                 Les boutons absolute z-20 capturent leur propre clic (au-dessus
                 du Link absolute inset-0 du fond). */}
            <div className="relative aspect-[3/4] md:aspect-[4/5] w-full max-h-[60vh] md:max-h-[70vh] overflow-hidden md:rounded-3xl">
              {/* Image / placeholder / initial — wrapped in Link if profileHref */}
              {profileHref ? (
                <Link
                  href={profileHref}
                  aria-label={`Voir le profil de ${currentProfile.name}`}
                  className="absolute inset-0 block"
                >
                  {cardImage && (cardImage.kind === 'photo' || cardImage.kind === 'placeholder') ? (
                    <img
                      src={cardImage.src}
                      alt={currentProfile.name}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center">
                      <span className="text-8xl font-light text-white/20">{currentProfile.name.charAt(0)}</span>
                    </div>
                  )}
                </Link>
              ) : cardImage && (cardImage.kind === 'photo' || cardImage.kind === 'placeholder') ? (
                <img
                  src={cardImage.src}
                  alt={currentProfile.name}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center">
                  <span className="text-8xl font-light text-white/20">{currentProfile.name.charAt(0)}</span>
                </div>
              )}

              {/* Subtle gradient — just enough for name readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />

              {/* Top badges */}
              <div className="absolute top-5 left-5 right-5 z-20 flex justify-between items-start pointer-events-none">
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

              {/* Name + Location — name cliquable vers /profile/[uid] (BUG #18).
                  BUG #84 — Badge ✓ Vérifié à droite du nom si le user a passé
                  la reconnaissance faciale (selfieVerificationStatus='verified'). */}
              <div className="absolute bottom-0 left-0 right-0 p-6 pb-7 z-10">
                {profileHref ? (
                  <Link href={profileHref} className="inline-flex items-center gap-2 hover:opacity-90 transition">
                    <h2 className="text-4xl font-light tracking-tight text-white drop-shadow-2xl">{currentProfile.name}</h2>
                    {currentProfile.isVerified && (
                      <BadgeCheck
                        className="h-7 w-7 text-accent drop-shadow-2xl"
                        aria-label={t('profile_verified_aria')}
                      />
                    )}
                  </Link>
                ) : (
                  <div className="inline-flex items-center gap-2">
                    <h2 className="text-4xl font-light tracking-tight text-white drop-shadow-2xl">{currentProfile.name}</h2>
                    {currentProfile.isVerified && (
                      <BadgeCheck
                        className="h-7 w-7 text-accent drop-shadow-2xl"
                        aria-label={t('profile_verified_aria')}
                      />
                    )}
                  </div>
                )}
                <p className="flex items-center gap-1.5 text-white/60 text-sm mt-1 tracking-wide">
                  <MapPin size={14} className="text-accent" />
                  {currentProfile.location}
                </p>
              </div>

              {/* Like / Dislike / Chat Direct floating on photo */}
              <div className="absolute bottom-6 right-6 z-20 flex items-center gap-3">
                {/* BUG #25 — bouton X = handlePass (persist + advance) au lieu
                    de handleNextProfile (advance local seul, le profil revenait). */}
                <button
                  onClick={handlePass}
                  aria-label="Passer"
                  className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/60 hover:text-red-400 hover:border-red-400/40 transition-all active:scale-90"
                >
                  <X size={22} />
                </button>
                <button
                  onClick={handleLike}
                  aria-label="Like"
                  className="w-12 h-12 rounded-full bg-accent/30 backdrop-blur-md border border-accent/40 flex items-center justify-center text-white hover:scale-110 transition-all active:scale-90"
                >
                  <Heart size={20} fill="currentColor" />
                </button>
                {/* Phase 9.5 c38b CH1 — 3e bouton : Chat direct payant (5 crédits) */}
                <button
                  onClick={handleDirectChat}
                  aria-label={`${t('discovery_direct_chat_button')} — ${t('discovery_direct_chat_cost')}`}
                  title={`${t('discovery_direct_chat_button')} — ${t('discovery_direct_chat_cost')}`}
                  className="w-12 h-12 rounded-full bg-accent backdrop-blur-md border border-accent flex items-center justify-center text-white hover:scale-110 transition-all active:scale-90"
                >
                  <MessageCircle size={20} />
                </button>
              </div>
            </div>

            {/* === INFO ZONE === Below photo, on pure black */}
            <div className="px-6 md:px-8 pt-6 pb-4 space-y-5">

              {/* Sports Tags */}
              <div className="flex flex-wrap gap-2">
                {currentProfile.sports.map((sport: string) => (
                  <span key={sport} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-light tracking-wider uppercase text-white/80 border border-white/10">
                    {sport === 'Afroboost' && <Zap className="h-3 w-3 text-accent" />}
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
                    className="flex-[4] h-14 rounded-full bg-white/5 backdrop-blur-xl border border-accent/30 text-white font-light text-sm tracking-wider uppercase flex items-center justify-center gap-2.5 hover:bg-accent/10 hover:border-accent/50 transition-all active:scale-[0.98]"
                  >
                    <Zap className="h-4 w-4 text-accent" />
                    {t('discovery_reserve_button')}
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
                {/* Bouton MapPin — ouvre le même modal "Où pratiquer ?" que le bouton top-left
                    (BUG #16 — décision UX : cohérence entre les 2 points d'entrée).
                    L'ancienne sheet partenaires (setShowLocationsSheet) reste branchée
                    sur d'autres flows (pre-select meeting place avant booking). */}
                <button
                  onClick={() => setShowWherePracticeModal(true)}
                  aria-label={t('discovery_where_to_practice')}
                  className="flex-[1] h-14 rounded-full bg-white/5 backdrop-blur-xl flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 transition-all active:scale-95"
                >
                  <MapPin className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* BUG #19 — Sidebar desktop "Où pratiquer ?" supprimée (doublon visible
              avec le bouton top-left déjà câblé fix #10 + #16). handlePartnerSelect
              + selectedMeetingPlace + bottom-sheet mobile (Sheet shadcn fix #11)
              restent en place pour le flow booking (pre-select meeting place). */}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
            <Heart className="h-10 w-10 text-white/20" />
          </div>
          <h2 className="text-2xl font-semibold text-white mb-2">{t('discovery_no_profiles_title')}</h2>
          <p className="text-white/40 mb-6">{t('discovery_no_profiles_subtitle')}</p>
          <Button onClick={resetProfiles} variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <Undo2 className="mr-2 h-4 w-4" />
            {t('discovery_reset_button')}
          </Button>
        </div>
      )}

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={(o) => {
        if (!o) setPreviewedSession(null);
        setShowPaymentModal(o);
      }}>
        <DialogContent className="max-w-md w-full bg-zinc-900 border-white/10 text-white p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="p-6 pb-3 bg-gradient-to-b from-accent/20 to-transparent flex-shrink-0">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              {t('payment_modal_title', { title: 'Afroboost' })}
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-sm">
              {currentProfile && (
                <>Séance avec {currentProfile.name.split(',')[0]} à {currentProfile.location}</>
              )}
            </DialogDescription>
            {/* Phase 9.5 c48 — Steps indicator wizard 3 étapes */}
            <div data-testid="wizard-steps" className="flex items-center justify-between pt-3 px-2">
              {[
                { n: 1, label: t('wizard_step_activity') || 'Activité' },
                { n: 2, label: t('wizard_step_invitee') || 'Invité' },
                { n: 3, label: t('wizard_step_payment') || 'Paiement' },
              ].map((s, i) => {
                const isActive = currentStep === s.n;
                const isDone = currentStep > s.n;
                return (
                  <React.Fragment key={s.n}>
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all',
                          isActive && 'bg-accent text-white shadow-[0_0_15px_rgb(var(--accent-color-rgb) / 0.5)]',
                          isDone && 'bg-white/60 text-black',
                          !isActive && !isDone && 'bg-white/10 text-white/40 border border-white/20',
                        )}
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : s.n}
                      </div>
                      <span className={cn(
                        'text-[10px] mt-1 transition-colors',
                        isActive ? 'text-accent font-semibold' : 'text-white/40',
                      )}>
                        {s.label}
                      </span>
                    </div>
                    {i < 2 && (
                      <div className={cn(
                        'h-px flex-1 mx-1 transition-colors -mt-4',
                        currentStep > s.n ? 'bg-white/40' : 'bg-white/10',
                      )} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </DialogHeader>

          {/* Phase 9.5 c48 — Wizard step content (scrollable middle) */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-[280px]">
            {/* ─── ÉTAPE 1 : Choisis ton activité ───────────────────── */}
            {currentStep === 1 && (
              <div data-testid="wizard-step-1" className="space-y-2 animate-in fade-in duration-200">
                <Label className="text-sm text-gray-400 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-accent" />
                  {t('discovery_choose_activity')}
                </Label>
                {partnerActivities.length === 0 ? (
                  <div className="text-center py-6 text-white/50 text-sm">
                    {t('discovery_no_boosted_activity_partner')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {partnerActivities.map((act) => {
                      const isSelected = selectedActivity?.activityId === act.activityId;
                      // BUG #113/#114 — Régression miniature. Cause racine : un legacy
                      // `act.imageUrl` peut contenir une URL VIDÉO Firebase Storage
                      // (.mp4/.webm) → rendu en <img> → broken → alt text affiché.
                      // Fix robuste : on détecte si une URL est "image-rendrable" via
                      // extension + provider (YouTube/Drive). Sinon → on traite comme
                      // vidéo et on rend un <video> avec Media Fragments #t=0.1.
                      const isImageLike = (u?: string | null): boolean => {
                        if (!u) return false;
                        const s = u.toLowerCase();
                        // URLs YouTube / Drive → resolveThumbnail produira une image
                        if (s.includes('youtube.com') || s.includes('youtu.be') || s.includes('drive.google.com')) return true;
                        // Extensions image classiques
                        if (/\.(jpg|jpeg|png|webp|gif|svg|avif)(\?|#|$)/i.test(s)) return true;
                        // Firebase Storage URL → on regarde si le chemin contient une
                        // image ou si content-disposition implique image
                        if (s.includes('firebasestorage')) {
                          // Ces URLs n'ont pas toujours d'extension dans le path encodé.
                          // On accepte par défaut SAUF si le path encodé contient explicitement .mp4/.webm/.mov
                          return !/(%2[fF])?[^/]*\.(mp4|webm|mov|m4v)/i.test(s);
                        }
                        // Sinon → considéré image par défaut (sera de toute façon fallback alt)
                        return true;
                      };
                      const isVideoLike = (u?: string | null): boolean => {
                        if (!u) return false;
                        const s = u.toLowerCase();
                        return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(s)
                          || /(%2[fF])?[^/]*\.(mp4|webm|mov|m4v)/i.test(s);
                      };
                      const mediaItems = Array.isArray(act.mediaUrls) ? act.mediaUrls : [];
                      // 1. Cherche la 1ère IMAGE dans mediaUrls (type='image' OR URL-image-like)
                      let rawImg = '';
                      let videoUrl: string | null = null;
                      for (const m of mediaItems) {
                        if (!m) continue;
                        const url = typeof m === 'string' ? m : m.url;
                        const type = typeof m === 'object' ? m.type : undefined;
                        if (!url) continue;
                        if (type === 'image' || (!type && isImageLike(url))) {
                          rawImg = url;
                          break;
                        }
                        if ((type === 'video' || isVideoLike(url)) && !videoUrl) {
                          videoUrl = url;
                        }
                      }
                      // 2. Fallback legacy imageUrl SEULEMENT s'il a l'air image-like
                      if (!rawImg && act.imageUrl && isImageLike(act.imageUrl) && !isVideoLike(act.imageUrl)) {
                        rawImg = act.imageUrl;
                      } else if (!rawImg && !videoUrl && act.imageUrl && isVideoLike(act.imageUrl)) {
                        // imageUrl legacy contenait une vidéo → on l'utilise comme vidéo
                        videoUrl = act.imageUrl;
                      }
                      const thumbnail = rawImg ? resolveThumbnail(rawImg) : null;
                      // Si on a une image valide, on ignore la vidéo (image prioritaire)
                      if (thumbnail) videoUrl = null;
                      return (
                        <button
                          key={act.activityId || act.id}
                          type="button"
                          data-testid="activity-card"
                          onClick={() => selectActivityWithPreview(act)}
                          className={cn(
                            'w-full flex gap-3 p-3 rounded-xl border transition-all text-left',
                            isSelected
                              ? 'border-accent bg-accent/10'
                              : 'border-white/10 hover:border-white/30 bg-zinc-900/30'
                          )}
                        >
                          {thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumbnail}
                              alt={act.name || act.title}
                              className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-zinc-800"
                            />
                          ) : videoUrl ? (
                            /* BUG #113 — Aperçu vidéo miniature avec Media Fragments
                               #t=0.1 pour forcer le seek 1ère frame (idem fix #102 pour
                               les Firebase Storage URLs). */
                            <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-800 relative">
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <video
                                src={videoUrl.includes('#') ? videoUrl : `${videoUrl}#t=0.1`}
                                muted
                                playsInline
                                preload="auto"
                                className="w-full h-full object-cover pointer-events-none"
                              />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                                <Zap className="h-4 w-4 text-white" />
                              </span>
                            </div>
                          ) : (
                            <div className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                              <Zap className="h-5 w-5 text-white/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                              <h4 className="text-white text-sm font-medium truncate">
                                {act.name || act.title}
                              </h4>
                              {(() => {
                                // Fix B post-B2 — prix effectif via getBookingPriceCHF
                                // (session.pricingTiers prioritaire, fallback Activity.price).
                                // Respecte les overrides per-session du partner (B2).
                                const cardEffectivePriceCHF = getBookingPriceCHF({
                                  session: sessionsByActivityId[act.activityId] ?? null,
                                  activity: { price: act.price },
                                  now: new Date(),
                                  isDuo: false,
                                });
                                return (
                                  <span className="text-accent text-sm font-semibold whitespace-nowrap">
                                    {cardEffectivePriceCHF === 0 ? t('payment_free_label') : `${cardEffectivePriceCHF} CHF`}
                                  </span>
                                );
                              })()}
                            </div>
                            {(act.description || act.sport) && (
                              <p className="text-white/60 text-xs line-clamp-1 mt-0.5">
                                {act.description || act.sport}
                              </p>
                            )}
                            {act.city && (
                              <div className="flex items-center gap-1 mt-1 text-white/40 text-xs">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate">{act.city}</span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ─── ÉTAPE 2 : Solo ou Duo + invitee ──────────────────── */}
            {currentStep === 2 && (
              <div data-testid="wizard-step-2" className="space-y-4 animate-in fade-in duration-200">
                <div data-testid="duo-option-toggle" className="bg-gradient-to-r from-accent/30 to-[#E91E63]/30 rounded-xl p-4 border border-accent/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center">
                        <Gift className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-white">{t('payment_duo_option_title')}</p>
                        <p className="text-xs text-gray-400">{t('payment_duo_option_subtitle')}</p>
                      </div>
                    </div>
                    <Switch
                      checked={isDuoTicket}
                      onCheckedChange={setIsDuoTicket}
                      className="data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-[#E91E63]"
                    />
                  </div>
                  {isDuoTicket && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
                      <Tabs value={invitationMethod} onValueChange={(v) => setInvitationMethod(v as 'match' | 'link')}>
                        <TabsList className="grid grid-cols-2 w-full bg-zinc-900 border border-white/10 rounded-lg p-1 h-auto">
                          <TabsTrigger value="match" className="data-[state=active]:bg-accent data-[state=active]:text-white text-white/60 rounded-md text-xs py-2">
                            {t('invitation_method_match') || 'Inviter un match'}
                          </TabsTrigger>
                          <TabsTrigger value="link" disabled title={t('invitation_method_link_soon') || 'Bientôt disponible'} className="data-[state=active]:bg-accent data-[state=active]:text-white text-white/40 rounded-md text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed">
                            {t('invitation_method_link') || 'Lien WhatsApp'}
                            <span className="ml-1 text-[10px] opacity-60">({t('common_soon') || 'bientôt'})</span>
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="match" className="mt-2">
                          {loadingMatches ? (
                            <div className="flex items-center justify-center py-6 text-white/40 text-xs gap-2">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t('invitation_loading_matches')}
                            </div>
                          ) : userMatches.length === 0 ? (
                            <div className="text-center py-4 text-white/50 text-xs">
                              {t('invitation_no_matches')}
                            </div>
                          ) : (
                            <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                              {userMatches.map((m) => {
                                const otherUid = m.userIds.find((uid) => uid !== user?.uid) || '';
                                const profile = matchProfiles[otherUid] || { displayName: 'Utilisateur', photoURL: '' };
                                const isSelectedInvitee = selectedInviteeUid === otherUid;
                                const createdMs = m.createdAt?.toMillis?.() ?? 0;
                                const ageDays = createdMs ? Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000)) : 0;
                                return (
                                  <button
                                    key={m.matchId}
                                    type="button"
                                    data-testid="invitee-match-card"
                                    onClick={() => setSelectedInviteeUid(otherUid)}
                                    className={cn(
                                      'w-full flex items-center gap-2.5 p-2 rounded-lg border transition-all text-left',
                                      isSelectedInvitee
                                        ? 'border-accent bg-accent/15'
                                        : 'border-white/10 hover:border-white/30 bg-zinc-900/40'
                                    )}
                                  >
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage src={profile.photoURL} />
                                      <AvatarFallback className="bg-zinc-800 text-white/60 text-xs">
                                        {profile.displayName.charAt(0).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-white text-sm font-medium truncate">{profile.displayName}</p>
                                      <p className="text-white/40 text-[11px]">
                                        {ageDays === 0
                                          ? t('invitation_match_today')
                                          : ageDays === 1
                                          ? t('invitation_match_yesterday')
                                          : t('invitation_match_days_ago', { days: ageDays })}
                                      </p>
                                    </div>
                                    {isSelectedInvitee && <Check className="h-4 w-4 text-accent flex-shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                    </div>
                  )}
                </div>
                {/* Mini-récap prix à l'étape 2 (déjà visible) */}
                <div className="bg-zinc-900/50 rounded-xl p-3 border border-white/10 flex justify-between items-center">
                  <span className="text-sm text-gray-400">
                    {isDuoTicket
                      ? (t('wizard_total_duo') || 'Total (Duo, 2 places)')
                      : (t('wizard_total_solo') || 'Total (Solo)')}
                  </span>
                  <span className="text-lg font-bold text-green-400">
                    {getCurrentPrice() === 0 ? t('payment_free_label') : `${getCurrentPrice()} CHF`}
                  </span>
                </div>
              </div>
            )}

            {/* ─── ÉTAPE 3 : Paiement ──────────────────────────────── */}
            {currentStep === 3 && (
              <div data-testid="wizard-step-3" className="space-y-4 animate-in fade-in duration-200">
                {/* Récap complet read-only */}
                <div className="bg-zinc-900/50 rounded-xl p-4 border border-white/10 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/50">{t('wizard_recap_activity') || 'Activité'}</span>
                    <span className="text-white font-medium truncate ml-2">{selectedActivity?.name || selectedActivity?.title || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">{t('wizard_recap_type') || 'Type'}</span>
                    <span className="text-white">
                      {isDuoTicket ? (
                        <>
                          Duo
                          {selectedInviteeUid && (
                            <span className="text-accent ml-1">
                              · {matchProfiles[selectedInviteeUid]?.displayName || ''}
                            </span>
                          )}
                        </>
                      ) : (
                        'Solo'
                      )}
                    </span>
                  </div>
                  {(selectedActivity?.address || selectedActivity?.city) && (
                    <div className="flex justify-between">
                      <span className="text-white/50 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {t('wizard_recap_location') || 'Lieu'}
                      </span>
                      <span className="text-white truncate ml-2">
                        {selectedActivity?.address ? `${selectedActivity.address}, ` : ''}{selectedActivity?.city || ''}
                      </span>
                    </div>
                  )}
                  <Separator className="my-2 bg-white/10" />
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">{t('payment_total_label')}</span>
                    <span className="text-green-400 text-lg font-bold">
                      {getCurrentPrice() === 0 ? t('payment_free_label') : `${getCurrentPrice()} CHF`}
                    </span>
                  </div>
                </div>

                {/* Tabs méthode de paiement (Carte vs TWINT).
                    BUG #15 (historique) avait 3 onglets dont Crédits Spordateur.
                    Fix UX : retiré Crédits → 2 onglets uniquement (Carte / TWINT).
                    Default paymentMethod='card' set au mount (Step 1 reset). */}
                {getCurrentPrice() > 0 && (
                  <div data-testid="payment-method-tabs">
                    <Tabs value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as 'card' | 'twint')}>
                      <TabsList className="grid grid-cols-2 w-full bg-zinc-900 border border-white/10 rounded-xl p-1 h-auto">
                        <TabsTrigger value="card" className="data-[state=active]:bg-accent data-[state=active]:text-white text-white/60 rounded-lg flex items-center gap-1.5 py-2.5">
                          <CreditCard className="h-4 w-4" />
                          <span className="text-xs sm:text-sm">Carte</span>
                        </TabsTrigger>
                        <TabsTrigger value="twint" className="data-[state=active]:bg-accent data-[state=active]:text-white text-white/60 rounded-lg flex items-center gap-1.5 py-2.5">
                          <span className="text-[10px] font-bold tracking-wider">TWINT</span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                )}

                <div className="bg-gradient-to-r from-accent/10 to-[#E91E63]/10 rounded-xl p-3 border border-white/5">
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-4 w-4 text-accent" />
                    <div>
                      <p className="text-[11px] font-medium text-white/60">{t('payment_stripe_notice')}</p>
                      <p className="text-[10px] text-white/30">{t('payment_methods_accepted')}</p>
                    </div>
                    <Lock className="h-3 w-3 text-white/20 ml-auto" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Phase 9.5 c48 — Navigation footer (sticky bottom) */}
          <div className="flex-shrink-0 p-4 border-t border-white/10 bg-zinc-900 flex items-center gap-2">
            {currentStep > 1 && (
              <Button
                type="button"
                variant="ghost"
                data-testid="wizard-back"
                onClick={() => setCurrentStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3) : prev))}
                disabled={isProcessing}
                className="text-white/70 hover:text-white hover:bg-white/5"
              >
                {t('common_back') || 'Retour'}
              </Button>
            )}
            <div className="flex-1" />
            {currentStep < 3 ? (
              <Button
                type="button"
                data-testid="wizard-next"
                onClick={() => setCurrentStep((prev) => (prev < 3 ? ((prev + 1) as 1 | 2 | 3) : prev))}
                disabled={!canAdvanceStep()}
                className="bg-gradient-to-br from-accent to-[#E91E63] text-white font-semibold px-6 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common_next') || 'Suivant'} →
              </Button>
            ) : (
              <Button
                data-testid="pay-button"
                onClick={handlePayment}
                disabled={
                  isProcessing ||
                  (isDuoTicket && invitationMethod === 'match' && !selectedInviteeUid)
                }
                className="bg-gradient-to-br from-accent to-[#E91E63] text-white font-semibold px-5 h-11 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{getCurrentPrice() === 0 ? t('payment_button_loading_free') : t('payment_button_loading_paid')}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm">{getCurrentPrice() === 0 ? t('payment_confirm_free_button') : t('payment_pay_button', { price: getCurrentPrice() })}</span>
                    {isDuoTicket && <Badge className="bg-white/20 text-white text-[10px]">Duo</Badge>}
                  </div>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Phase 9.5 c38b CH5 — Modal "Tu veux rencontrer X" supprimée définitivement.
          Avant : ouvrait après handleLike() avec liste d'activités boostées + CTA
          Réserver. Remplacée par flow Tinder classique (c38a) : ❤️ Like soft +
          bouton "Réserver" direct sur la card photo (qui ouvre showPaymentModal
          avec dropdown activités dans la modal, cf CH3-CH4). */}

      {/* Partner Detail Modal */}
      <Dialog open={showPartnerModal} onOpenChange={setShowPartnerModal}>
        <DialogContent className="max-w-md w-full bg-[#0a0a0a] border-accent/30 text-white p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0 bg-gradient-to-b from-accent/15 to-transparent">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-xl bg-accent flex items-center justify-center text-white font-bold text-2xl">
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
                  <p className="text-sm font-medium">{t('discovery_modal_address_label')}</p>
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
                      <AvatarFallback className="bg-accent text-white text-sm">
                        {p.avatar}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <div className="text-sm">
                  <p className="text-white">{mockParticipants.map(p => p.name).join(', ')}</p>
                  <p className="text-xs text-gray-400">{t('discovery_modal_recent_bookings')}</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button 
                onClick={() => setShowPartnerModal(false)}
                className="flex-1 bg-accent"
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
              <h3 className="text-2xl font-bold mb-2">{t('discovery_booking_confirmed_emoji')}</h3>
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
                  <Badge className="bg-accent text-white text-xs">
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
              <p className="text-xs text-gray-500 mb-2">{t('discovery_add_to_calendar')}</p>
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
              className="w-full bg-gradient-to-r from-accent to-[#E91E63] hover:bg-accent/90 text-white"
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
      {/* ===== BOTTOM SHEET — Lieux / Partenaires (mobile only)
           BUG #11 — Refacto custom backdrop+fixed div → shadcn Sheet (Radix Portal).
           Le custom sheet (z-50) entrait en conflit avec BottomNav (z-50 rendu
           après dans le DOM) → couvert/inaccessible sur mobile. Sheet de
           shadcn portale dans document.body → échappe la hiérarchie DOM,
           plus de conflit possible. ===== */}
      <Sheet open={showLocationsSheet} onOpenChange={setShowLocationsSheet}>
        <SheetContent
          side="bottom"
          className="md:hidden bg-[#0A0A0A] border-t border-white/10 rounded-t-3xl max-h-[80vh] overflow-y-auto p-0 z-[60]"
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="px-5 pb-24 pt-2">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-accent" />
                <h3 className="text-lg font-semibold text-white">{t('discovery_where_to_practice')}</h3>
              </div>
              <button
                onClick={() => setShowLocationsSheet(false)}
                className="text-xs text-white/30 hover:text-white/60 transition"
              >
                {t('common_close')}
              </button>
            </div>

            <div className="space-y-2">
              {[...partners]
                .sort((a, b) => {
                  // BUG #69 — utilise effectiveBoostedPartnerIds (legacy + per-activity)
                  const aBoost = a.id ? effectiveBoostedPartnerIds.has(a.id) : false;
                  const bBoost = b.id ? effectiveBoostedPartnerIds.has(b.id) : false;
                  if (aBoost && !bBoost) return -1;
                  if (!aBoost && bBoost) return 1;
                  return 0;
                })
                .map((partner) => {
                const isBoosted = partner.id ? effectiveBoostedPartnerIds.has(partner.id) : false;
                return (
                <div
                  key={partner.id}
                  onClick={() => {
                    handlePartnerSelect(partner);
                    setShowLocationsSheet(false);
                  }}
                  className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-200 min-h-[56px]
                    ${selectedMeetingPlace === partner.id
                      ? 'bg-accent/15 border border-accent/40'
                      : isBoosted
                        ? 'bg-accent/5 border border-accent/20 active:bg-accent/10'
                        : 'bg-white/5 border border-transparent active:bg-white/10'}
                  `}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                    isBoosted
                      ? 'bg-gradient-to-br from-accent to-[#E91E63] ring-2 ring-accent/40'
                      : 'bg-gradient-to-br from-accent to-[#E91E63]'
                  }`}>
                    {partner.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-medium text-sm text-white truncate">{partner.name}</h4>
                      {isBoosted && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/20 text-accent whitespace-nowrap flex items-center gap-0.5">
                          <Zap className="h-2.5 w-2.5" />{t('discovery_location_recommended')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{partner.city}
                      {partner.address && <span className="ml-1 text-white/20">— {partner.address}</span>}
                    </p>
                  </div>
                  {selectedMeetingPlace === partner.id ? (
                    <CheckCircle className="h-5 w-5 text-accent flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-white/20 flex-shrink-0" />
                  )}
                </div>
                );
              })}
            </div>

            {selectedMeetingPlace && (
              <div className="mt-4 p-3 bg-accent/5 border border-accent/15 rounded-xl">
                <p className="text-xs text-accent">
                  Lieu sélectionné pour votre prochaine réservation
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ===== BUG #10 — Modal "Où pratiquer ?" : activités boostées par ville ===== */}
      <Dialog
        open={showWherePracticeModal}
        onOpenChange={(o) => { if (!o) setShowWherePracticeModal(false); }}
      >
        <DialogContent className="bg-[#0A0A0A] border-white/10 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white text-2xl font-light tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-accent" />
              {t('discovery_where_to_practice')}
            </DialogTitle>
            <DialogDescription className="text-white/40 text-xs">
              Activités boostées en ce moment, groupées par ville. Clique pour voir les détails.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-6">
            {wherePracticeGroups.length === 0 ? (
              <div className="text-center py-12 text-white/30">
                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{t('discovery_modal_empty_title')}</p>
                <p className="text-xs mt-1 text-white/20">{t('discovery_modal_empty_subtitle')}</p>
              </div>
            ) : (
              wherePracticeGroups.map((group) => (
                <div key={group.city}>
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-accent" />
                    <h3 className="text-base font-medium text-white tracking-wide">{group.city}</h3>
                    <span className="text-[10px] text-white/30">({group.activities.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.activities.map((act) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const a = act as any;
                      const navId = a.id || a.activityId;
                      // Fix #146 — utilise le helper unique getActivityThumbnail
                      // (chaîne unifiée : thumbnailUrl → mediaItems image → video
                      // thumb → imageUrl legacy). Plus jamais de carré rose Zap.
                      const thumb = getActivityThumbnail(a);
                      // Fix #172 — Wrap dans un div flex pour permettre le bouton
                      // Découvrir secondaire à droite (pattern cohérent avec
                      // ActivitySelectorModal). Main button = liste activités en
                      // contexte ; Découvrir = détail direct /activities/[id].
                      return (
                        <div key={navId} className="flex items-stretch gap-2 rounded-xl bg-white/5 border border-white/10 hover:border-accent/40 hover:bg-accent/5 transition">
                        <button
                          type="button"
                          onClick={() => {
                            // BUG #20 — direction modifiée : la modal renvoie vers la
                            // page liste activités (avec hash scroll vers la card
                            // choisie), au lieu de bypass direct vers /activities/[id].
                            // L'utilisateur découvre l'activité en contexte (sœurs,
                            // partenaire, miniature) puis clique la miniature pour le
                            // détail (BUG #21).
                            setShowWherePracticeModal(false);
                            router.push(buildActivityListUrl(navId));
                          }}
                          className="flex-1 text-left p-3 active:scale-[0.98] transition"
                        >
                          <div className="flex items-start gap-3">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumb}
                                alt={a.title || a.name || 'Activité'}
                                className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5"
                                loading="lazy"
                                onError={(e) => {
                                  // Si la miniature 404, on retombe sur le badge accent
                                  // pour ne pas afficher un cadre vide cassé.
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  const next = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement | null;
                                  if (next) next.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent to-[#E91E63] flex-shrink-0 items-center justify-center text-white text-xs font-semibold"
                              style={{ display: thumb ? 'none' : 'flex' }}
                            >
                              <Zap className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white font-medium truncate">{a.title || a.name || 'Activité'}</p>
                              <p className="text-[11px] text-white/40 truncate">
                                {a.sport ? `${a.sport} · ` : ''}{a.partnerName || ''}
                              </p>
                              {/* Fix 1bis — prix effectif via getBookingPriceCHF
                                  (réuse sessionsByActivityId déjà prefetched).
                                  Reflète les overrides per-session du partner (B2)
                                  + Activity.price en fallback si pas de session. */}
                              {(() => {
                                const effective = getBookingPriceCHF({
                                  session: sessionsByActivityId[navId] ?? null,
                                  activity: { price: a.price },
                                  now: new Date(),
                                  isDuo: false,
                                });
                                if (effective === 0) {
                                  return <p className="text-[11px] text-emerald-300 mt-0.5">Gratuit</p>;
                                }
                                return <p className="text-[11px] text-accent mt-0.5">{effective} CHF</p>;
                              })()}
                            </div>
                          </div>
                        </button>
                        {/* Fix #172 — Bouton "Découvrir" : ouvre la fiche détail
                            /activities/[id] (pattern cohérent ActivitySelectorModal).
                            Le ChevronRight est retiré du main button — c'est ce
                            bouton qui sert maintenant de hint visuel "voir plus". */}
                        <button
                          type="button"
                          onClick={() => {
                            setShowWherePracticeModal(false);
                            router.push(`/activities/${navId}`);
                          }}
                          className="flex-shrink-0 px-2.5 rounded-r-xl text-[11px] text-white/60 hover:text-white hover:bg-white/5 flex items-center gap-1 transition border-l border-white/10"
                          aria-label={t('activity_selector_aria_discover', { title: a.title || a.name || 'Activité' })}
                        >
                          <Info className="h-3.5 w-3.5" />
                          {t('activity_selector_discover')}
                        </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
