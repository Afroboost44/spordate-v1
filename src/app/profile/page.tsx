"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Camera, MapPin, Save, Loader2, Plus, X, CheckCircle, Gift, Copy, CreditCard, TrendingUp, ArrowRight, LogOut, Shield, MessageSquareQuote, Sparkles, UserCircle, Crown, Settings, SlidersHorizontal, BadgeCheck, AudioLines
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { updateUser, updateUserAiOptIn, getUser } from "@/services/firestore";
import { PushOptInSwitch } from "@/components/profile/PushOptInSwitch";
import { ProfileExtrasEditor } from "@/components/profile/ProfileExtrasEditor";
import { ProfilePreviewModal } from "@/components/profile/ProfilePreviewModal";
import { ProfileSafetySection } from "@/components/profile/ProfileSafetySection";
import { ProfilePremiumCard } from "@/components/profile/ProfilePremiumCard";
import { UnverifiedBanner } from "@/components/profile/UnverifiedBanner";
import { ProfileImageCropper } from "@/components/profile/ProfileImageCropper";
import { VoicePromptRecorder } from "@/components/profile/VoicePromptRecorder";
import { VoicePromptPlayer } from "@/components/profile/VoicePromptPlayer";
import { VOICE_PROMPT_MAX_SECONDS } from "@/lib/profile/voicePrompt";

// Alias label : "20 secondes" pour le sous-titre profile, avec fallback
const VOICE_PROMPT_MAX_SECONDS_LABEL = String(VOICE_PROMPT_MAX_SECONDS);
import { QRCodeButton } from "@/components/share/QRCodeButton";
import { uploadProfilePhoto, StorageUploadError, PROFILE_PHOTO_MAX_BYTES } from "@/lib/storage/uploadProfilePhoto";
import { readProfilePhotos, normalizePhotosForSave } from "@/lib/profile/photos";
import type { UserProfile, SportEntry } from "@/types/firestore";
import { Switch } from "@/components/ui/switch";
import { DANCE_ACTIVITIES, DANCE_LEVELS } from "@/types/firestore";
import type { DanceCategory, DanceLevel } from "@/types/firestore";
import BackButton from '@/components/BackButton';
import { useLanguage } from '@/context/LanguageContext';

// Sports disponibles
const AVAILABLE_SPORTS = [
  "Tennis", "Fitness", "Running", "Yoga", "Crossfit",
  "Football", "Natation", "Padel", "Escalade"
];

// Styles de danse (from DANCE_ACTIVITIES)
const DANCE_STYLES: { id: DanceCategory; label: string; emoji: string }[] = [
  { id: 'afroboost', label: 'Afroboost', emoji: '🔥' },
  { id: 'zumba', label: 'Zumba', emoji: '💃' },
  { id: 'afro_dance', label: 'Afro Dance', emoji: '🥁' },
  { id: 'dance_fitness', label: 'Dance Fitness', emoji: '⚡' },
  { id: 'salsa', label: 'Salsa', emoji: '🌶️' },
  { id: 'bachata', label: 'Bachata', emoji: '🎶' },
  { id: 'hiphop', label: 'Hip-Hop', emoji: '🎤' },
  { id: 'dance_workout', label: 'Dance Workout', emoji: '💪' },
];

const SWISS_CITIES = [
  "Zurich", "Genève", "Bâle", "Lausanne", "Berne",
  "Lucerne", "St-Gall", "Lugano", "Bienne", "Thoune",
  "Fribourg", "Neuchâtel", "Sion", "Yverdon", "Montreux",
];

const DANCE_LEVEL_OPTIONS: { id: DanceLevel; label: string; emoji: string }[] = [
  { id: 'debutant', label: 'Débutant', emoji: '🌱' },
  { id: 'intermediaire', label: 'Intermédiaire', emoji: '⭐' },
  { id: 'avance', label: 'Avancé', emoji: '🏆' },
];

export default function ProfilePage() {
  const { toast } = useToast();
  const { user, userProfile, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedDances, setSelectedDances] = useState<DanceCategory[]>([]);
  const [danceLevel, setDanceLevel] = useState<DanceLevel | ''>('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('other');
  // BUG #71 — Champs étendus profil (lifestyle + infos perso style Hinge).
  // Stocké dans users/{uid}.profileExtras. Tous optionnels.
  const [profileExtras, setProfileExtras] = useState<NonNullable<UserProfile['profileExtras']>>({});
  // BUG #78 — Modal aperçu profil public (live preview depuis les states courants).
  const [previewOpen, setPreviewOpen] = useState(false);
  // BUG #86 — Autosave : indique l'état de sauvegarde auto en bas de page.
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Phase 8 sub-chantier 0 — toggle suggestions IA chat (default-on doctrine §D.Q1).
  // undefined === true (opt-in implicite). false === opt-out explicite.
  const [aiSuggestionsOptIn, setAiSuggestionsOptIn] = useState<boolean>(true);
  const [isAiOptInSaving, setIsAiOptInSaving] = useState(false);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // BUG #86 (révisé) — Snapshot de l'état déjà sauvegardé (JSON.stringify).
  // Compare à chaque trigger du useEffect : si égal → skip (évite la boucle
  // infinie qui se produisait car handleSave appelait refreshProfile qui
  // re-hydratait les states → re-trigger autosave → save → re-hydrate ...).
  const lastSavedSnapshotRef = useRef<string>('');
  const [profileComplete, setProfileComplete] = useState(false);

  // Load profile from Firestore
  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      try {
        // Try Firestore first
        if (userProfile) {
          setDisplayName(userProfile.displayName || user.displayName || '');
          setBio(userProfile.bio || '');
          setCity(userProfile.city || '');
          setGender(userProfile.gender || 'other');
          // BUG #71 — load profileExtras (lifestyle + infos perso)
          setProfileExtras(userProfile.profileExtras ?? {});

          // Parse sports: separate regular sports from dance categories
          const sports: string[] = [];
          const dances: DanceCategory[] = [];
          (userProfile.sports || []).forEach((s: SportEntry) => {
            const danceIds = DANCE_STYLES.map(d => d.id as string);
            if (danceIds.includes(s.name)) {
              dances.push(s.name as DanceCategory);
            } else {
              sports.push(s.name);
            }
          });
          setSelectedSports(sports);
          setSelectedDances(dances);

          // Dance level from first dance entry
          const firstDance = (userProfile.sports || []).find((s: SportEntry) =>
            DANCE_STYLES.some(d => d.id === s.name)
          );
          if (firstDance) {
            // Map firestore levels to dance levels
            const levelMap: Record<string, DanceLevel> = {
              'beginner': 'debutant',
              'intermediate': 'intermediaire',
              'advanced': 'avance',
            };
            setDanceLevel(levelMap[firstDance.level] || '');
          }

          // BUG #35 — read priorité photos[] > photoURL legacy
          setPhotos(readProfilePhotos(userProfile));
          setProfileComplete(userProfile.onboardingComplete || false);

          // Phase 8 — undefined === true (opt-in implicite doctrine §D.Q1).
          setAiSuggestionsOptIn(userProfile.aiSuggestionsOptIn !== false);
        } else {
          // Fallback to localStorage
          const stored = localStorage.getItem('spordate_user_profile');
          if (stored) {
            const parsed = JSON.parse(stored);
            setDisplayName(parsed.name || user.displayName || '');
            setBio(parsed.bio || '');
            setCity(parsed.city || '');
            setSelectedSports(parsed.sports?.filter((s: string) =>
              AVAILABLE_SPORTS.includes(s)
            ) || []);
            setSelectedDances(parsed.sports?.filter((s: string) =>
              DANCE_STYLES.some(d => d.label === s)
            ).map((s: string) => {
              const found = DANCE_STYLES.find(d => d.label === s);
              return found?.id || '';
            }).filter(Boolean) || []);
            setPhotos(parsed.photos || []);
          } else {
            setDisplayName(user.displayName || '');
          }
        }
      } catch (err) {
        console.error('Erreur chargement profil:', err);
        setDisplayName(user.displayName || '');
      } finally {
        setIsLoaded(true);
      }
    };

    loadProfile();
  }, [user, userProfile]);

  // Toggle sport selection
  const toggleSport = (sport: string) => {
    setSelectedSports(prev =>
      prev.includes(sport) ? prev.filter(s => s !== sport) : [...prev, sport]
    );
  };

  // Toggle dance selection
  const toggleDance = (danceId: DanceCategory) => {
    setSelectedDances(prev =>
      prev.includes(danceId) ? prev.filter(d => d !== danceId) : [...prev, danceId]
    );
  };

  // BUG #13 — Image upload via Firebase Storage.
  // BUG #104 — Ajout d'un step "Cropper" AVANT l'upload : quand l'utilisateur
  // choisit une photo, on stocke le File dans `croppingFile` et on affiche un
  // modal `ProfileImageCropper` qui produit un File JPEG 1024×1024 recadré.
  // Au "Recadrer" du modal → handleCroppedUpload reçoit le File final et
  // lance l'upload Firebase Storage. Au "Annuler" → on remet croppingFile à null.
  const [croppingFile, setCroppingFile] = useState<File | null>(null);
  // BUG #107 — Accroche vocale : modal open + valeurs (synchronisées via callbacks
  // VoicePromptRecorder qui écrit déjà dans Firestore).
  const [voicePromptModalOpen, setVoicePromptModalOpen] = useState(false);
  const [voicePromptData, setVoicePromptData] = useState<{ url?: string; question?: string; duration?: number }>({
    url: userProfile?.voicePromptUrl,
    question: userProfile?.voicePromptQuestion,
    duration: userProfile?.voicePromptDuration,
  });
  // Sync depuis userProfile quand il se charge (premier render)
  useEffect(() => {
    if (userProfile) {
      setVoicePromptData({
        url: userProfile.voicePromptUrl,
        question: userProfile.voicePromptQuestion,
        duration: userProfile.voicePromptDuration,
      });
    }
  }, [userProfile?.voicePromptUrl, userProfile?.voicePromptQuestion, userProfile?.voicePromptDuration]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset input pour permettre de re-uploader le même file après remove
    if (event.target) event.target.value = '';
    if (!file) return;
    if (!user) {
      toast({ title: "Non connecté", description: "Connecte-toi pour uploader une photo.", variant: "destructive" });
      return;
    }
    if (photos.length >= 5) {
      toast({ title: "Limite atteinte", description: "Max 5 photos.", variant: "destructive" });
      return;
    }
    // Ouvre le modal cropper. L'upload se fera dans handleCroppedUpload.
    setCroppingFile(file);
  };

  const handleCroppedUpload = async (croppedFile: File) => {
    setCroppingFile(null);
    if (!user) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadProfilePhoto(croppedFile, user.uid);
      setPhotos(prev => [...prev, url]);
      toast({ title: "Photo ajoutée", className: "bg-green-600 text-white" });
    } catch (err) {
      console.warn('[Profile] uploadProfilePhoto failed', err);
      let description = "Upload impossible. Réessaie.";
      if (err instanceof StorageUploadError) {
        if (err.code === 'file-too-large') {
          description = `Fichier trop lourd. Max ${PROFILE_PHOTO_MAX_BYTES / 1024 / 1024}MB par image.`;
        } else if (err.code === 'invalid-content-type') {
          description = "Format non supporté. Utilise une image (JPG, PNG, WEBP).";
        }
      }
      toast({ title: "Erreur", description, variant: "destructive" });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  // Phase 8 sub-chantier 0 — toggle handler avec optimistic update + rollback on error.
  // Self-only enforcé par firestore.rules /users/{uid} (commit 1/3 disclosed CGU+Privacy).
  const handleAiOptInToggle = async (checked: boolean) => {
    if (!user) return;
    const previous = aiSuggestionsOptIn;
    setAiSuggestionsOptIn(checked); // optimistic
    setIsAiOptInSaving(true);
    try {
      await updateUserAiOptIn(user.uid, checked);
      await refreshProfile();
      toast({
        title: checked ? 'Suggestions IA activées' : 'Suggestions IA désactivées',
        description: checked
          ? 'Vous recevrez occasionnellement des suggestions d’activités dans le chat.'
          : 'Aucune suggestion ne sera générée pour vos chats.',
        className: 'bg-green-600 text-white',
      });
    } catch (err) {
      console.error('Erreur toggle aiSuggestionsOptIn:', err);
      setAiSuggestionsOptIn(previous); // rollback
      toast({
        title: 'Échec de la sauvegarde',
        description: 'Réessayez dans un instant.',
        variant: 'destructive',
      });
    } finally {
      setIsAiOptInSaving(false);
    }
  };

  // Save profile to Firestore
  const handleSave = async () => {
    if (!user) return;

    // Validation
    if (!displayName.trim()) {
      toast({ title: "Prénom requis", description: "Veuillez entrer votre prénom.", variant: "destructive" });
      return;
    }
    if (!city) {
      toast({ title: "Ville requise", description: "Veuillez sélectionner votre ville.", variant: "destructive" });
      return;
    }
    if (selectedSports.length === 0 && selectedDances.length === 0) {
      toast({ title: "Sport requis", description: "Sélectionnez au moins un sport ou une danse.", variant: "destructive" });
      return;
    }

    setIsSaving(true);

    // Build sports array for Firestore
    const danceLevelMap: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
      'debutant': 'beginner',
      'intermediaire': 'intermediate',
      'avance': 'advanced',
    };

    const sportsEntries: SportEntry[] = [
      ...selectedSports.map(name => ({ name, level: 'intermediate' as const })),
      ...selectedDances.map(danceId => ({
        name: danceId,
        level: danceLevel ? danceLevelMap[danceLevel] || 'beginner' : 'beginner' as const,
      })),
    ];

    try {
      // BUG #35 — sauve l'array photos[] complet (dedup + truncate via helper)
      // + sync photoURL legacy pour consumers (discovery firestoreProfileToCard
      // line 101 utilise toujours user.photoURL singulier).
      const normalized = normalizePhotosForSave(photos);
      // BUG #71 — clean profileExtras : ne persiste que les champs non-vides
      // (storage lean : pas de clés undefined dans Firestore).
      const cleanedExtras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(profileExtras)) {
        if (v === undefined || v === null || v === '') continue;
        cleanedExtras[k] = v;
      }
      await updateUser(user.uid, {
        displayName: displayName.trim(),
        bio: bio.trim(),
        city,
        gender,
        sports: sportsEntries,
        photoURL: normalized.photoURL,
        photos: normalized.photos,
        onboardingComplete: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        profileExtras: cleanedExtras as any,
      });

      // Also save to localStorage for backward compatibility
      localStorage.setItem('spordate_user_profile', JSON.stringify({
        name: displayName.trim(),
        bio: bio.trim(),
        city,
        sports: [...selectedSports, ...selectedDances.map(id => {
          const found = DANCE_STYLES.find(d => d.id === id);
          return found?.label || id;
        })],
        danceLevel,
        photos,
        gender,
      }));

      // Refresh the profile in context
      await refreshProfile();

      setProfileComplete(true);
      toast({ title: "Profil sauvegardé", description: "Vos informations sont à jour.", className: "bg-green-600 text-white" });
    } catch (err) {
      console.error('Erreur sauvegarde profil:', err);
      // Fallback: save to localStorage
      localStorage.setItem('spordate_user_profile', JSON.stringify({
        name: displayName.trim(),
        bio: bio.trim(),
        city,
        sports: [...selectedSports, ...selectedDances.map(id => {
          const found = DANCE_STYLES.find(d => d.id === id);
          return found?.label || id;
        })],
        danceLevel,
        photos,
        gender,
      }));
      toast({ title: "Sauvegardé localement", description: "Le profil sera synchronisé quand la connexion sera rétablie." });
    } finally {
      setIsSaving(false);
    }
  };

  // BUG #87 — Autosave RETIRÉ : malgré le snapshot ref + save silencieuse,
  // l'autosave continuait à déclencher la notification "Profil sauvegardé"
  // en boucle (probablement à cause d'un onSnapshot quelque part qui ré-
  // hydrate userProfile et re-trigger l'effet). Retour au bouton manuel
  // uniquement, qui est fiable et explicite pour l'utilisateur.
  //
  // Le snapshot ref est conservé pour usage futur si on relance l'autosave
  // avec une architecture plus robuste (ex: ref des states + flush on blur).
  void lastSavedSnapshotRef;
  void autoSaveState;
  void setAutoSaveState;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <BackButton fallbackUrl="/activities" />
        <Loader2 className="animate-spin mr-2" /> Chargement du profil...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 pb-24">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* BUG #80 — Icônes top-right (préférences matching + paramètres) façon
            Hinge top-right (sliders + settings cog).
            BUG #81 — Si user est admin, ajout d'une 3ème icône Shield qui
            pointe vers /admin/manage. Visible mobile + desktop (avant l'admin
            ne pouvait accéder au dashboard que via le menu hamburger du Header
            global, peu pratique depuis /profile). */}
        <div className="flex items-center justify-end gap-2 pt-4 -mb-2">
          {userProfile?.role === 'admin' && (
            <Link
              href="/admin/manage"
              aria-label="Tableau de bord admin"
              title="Tableau de bord admin"
              className="p-2 rounded-full border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              <Shield className="h-4 w-4" />
            </Link>
          )}
          <Link
            href="/preferences"
            aria-label="Préférences de matching"
            className="p-2 rounded-full border border-white/10 text-white/60 hover:text-accent hover:border-accent/30 transition-colors"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Link>
          <Link
            href="/settings"
            aria-label="Paramètres"
            className="p-2 rounded-full border border-white/10 text-white/60 hover:text-accent hover:border-accent/30 transition-colors"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>

        {/* BUG #77 — HEADER ÉPURÉ STYLE HINGE : avatar grand centré + nom + tabs.
            Avant : H1 "Mon Profil" + 9 sections empilées (chargé). Maintenant :
            header centré minimaliste + 3 tabs thématiques pour aérer le contenu. */}
        <div className="flex flex-col items-center gap-3 pt-6 pb-2">
          {/* BUG #105 — Wrapper avatar pour pouvoir superposer le badge "Vérifié"
              en bas à droite. Avant : badge invisible sur /profile (alors qu'il
              s'affichait bien sur /profile/[uid] et /discovery). */}
          <div className="relative">
            <Avatar className="h-24 w-24 sm:h-28 sm:w-28 ring-2 ring-white/10">
              <AvatarImage src={photos[0] || ''} className="object-cover" />
              <AvatarFallback className="bg-zinc-900 text-white/40 text-2xl font-light">
                {displayName.charAt(0).toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            {userProfile?.selfieVerificationStatus === 'verified' && (
              <div
                className="absolute -bottom-1 -right-1 bg-black rounded-full p-0.5 ring-2 ring-black"
                title="Profil vérifié"
                aria-label="Profil vérifié"
              >
                <BadgeCheck className="h-7 w-7 text-accent" />
              </div>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-light tracking-wide text-white flex items-center gap-2">
            {displayName || 'Mon Profil'}
            {userProfile?.selfieVerificationStatus === 'verified' && (
              <BadgeCheck
                className="h-5 w-5 text-accent flex-shrink-0"
                aria-label="Profil vérifié"
              />
            )}
          </h1>
          {!profileComplete && (
            <div className="px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-full">
              <p className="text-[11px] text-accent font-light">
                Complète ton profil pour apparaître dans les matchs
              </p>
            </div>
          )}

          {/* BUG #78 — Bouton "Aperçu de mon profil" : icône Crown premium-look,
              ouvre la Dialog ProfilePreviewModal qui montre le rendu public live
              (depuis les states courants, pas besoin de sauvegarder avant). */}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/40 bg-gradient-to-r from-accent/10 via-accent/5 to-accent/10 text-accent hover:bg-accent/20 transition-colors text-sm font-medium"
          >
            <Crown className="h-4 w-4" aria-hidden="true" />
            Aperçu de mon profil
          </button>
        </div>

        {/* BUG #77 — Tabs Hinge-style : "Mon profil" / "Parrainage" / "Confidentialité".
            Mobile : tabs prennent toute la largeur. Desktop : tabs centrées. */}
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-zinc-900/60 border border-white/5 mb-8">
            <TabsTrigger value="profile" className="text-xs sm:text-sm data-[state=active]:bg-accent/10 data-[state=active]:text-accent">
              Mon profil
            </TabsTrigger>
            <TabsTrigger value="referral" className="text-xs sm:text-sm data-[state=active]:bg-accent/10 data-[state=active]:text-accent">
              Parrainage
            </TabsTrigger>
            <TabsTrigger value="privacy" className="text-xs sm:text-sm data-[state=active]:bg-accent/10 data-[state=active]:text-accent">
              Confidentialité
            </TabsTrigger>
          </TabsList>

          {/* ===== TAB 1 : MON PROFIL (photos + infos + sports + danses + extras + prompts) ===== */}
          <TabsContent value="profile" className="space-y-6 mt-0">

        {/* BUG #85 — Bannière "Vérifie ton profil" pour nouveaux utilisateurs
            (status not_started). Auto-hide si déjà verified/pending/rejected
            ou dismissé 24h. */}
        <UnverifiedBanner />

        {/* BUG #80 — Card Premium + quick actions Boost / Découvrir en haut */}
        <ProfilePremiumCard isPremium={!!userProfile?.isPremium} />

        {/* BUG #107 — Section "Accroche vocale" (Hinge Voice Prompt).
            Placée en 2e position après les photos (cf. mockup Bassi 2026-05-22).
            Si pas d'enregistrement : bouton CTA. Sinon : lecteur + bouton Modifier. */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AudioLines className="h-5 w-5 text-accent" />
              Accroche vocale
            </CardTitle>
            <p className="text-xs text-gray-500">
              Une voix dit plus qu&apos;un texte. Affiche-toi sous ton meilleur jour en {VOICE_PROMPT_MAX_SECONDS_LABEL} secondes.
            </p>
          </CardHeader>
          <CardContent>
            {voicePromptData.url ? (
              <div className="space-y-3">
                <VoicePromptPlayer
                  url={voicePromptData.url}
                  question={voicePromptData.question}
                  duration={voicePromptData.duration}
                />
                <button
                  onClick={() => setVoicePromptModalOpen(true)}
                  className="w-full h-11 rounded-xl border border-white/10 text-white/70 hover:text-accent hover:border-accent/30 transition-colors text-sm"
                >
                  Modifier / Remplacer
                </button>
              </div>
            ) : (
              <button
                onClick={() => setVoicePromptModalOpen(true)}
                className="w-full h-14 rounded-2xl border-2 border-dashed border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 hover:border-accent/50 transition-colors flex items-center justify-center gap-2 text-sm font-light"
              >
                <AudioLines className="h-5 w-5" />
                Ajouter mon accroche vocale
              </button>
            )}
          </CardContent>
        </Card>

        {/* SECTION PHOTOS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader>
            <CardTitle>Photos</CardTitle>
            <p className="text-xs text-gray-500">{t('profile_photos_subtitle')}</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleImageUpload}
              />
              {photos.map((photo, index) => (
                <div key={index} className={`relative aspect-square rounded-lg overflow-hidden border group ${index === 0 ? 'border-accent ring-2 ring-accent/30' : 'border-gray-700'}`}>
                  <img src={photo} alt="User" className="w-full h-full object-cover" />
                  {/* BUG #107 — Badge "Principale" sur photo[0] + bouton "Mettre en principale"
                      sur les autres photos. Au click → swap avec photos[0]. */}
                  {index === 0 && (
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-accent text-white text-[9px] uppercase tracking-wider font-medium">
                      Principale
                    </div>
                  )}
                  {index !== 0 && (
                    <button
                      onClick={() => {
                        // Swap photos[index] avec photos[0] pour mettre en avant
                        setPhotos(prev => {
                          const next = [...prev];
                          [next[0], next[index]] = [next[index], next[0]];
                          return next;
                        });
                      }}
                      title="Mettre cette photo en principale"
                      className="absolute bottom-1 left-1 bg-black/70 backdrop-blur px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-[9px] uppercase tracking-wider text-white/80 hover:text-accent"
                    >
                      ★ Principale
                    </button>
                  )}
                  <button
                    onClick={() => removePhoto(index)}
                    className="absolute top-1 right-1 bg-red-600 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-accent hover:text-accent transition-colors bg-black/20 disabled:opacity-50 disabled:cursor-wait"
                >
                  {uploadingPhoto ? (
                    <>
                      <Loader2 className="h-6 w-6 mb-2 animate-spin text-accent" />
                      <span className="text-xs font-bold">Upload…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-6 w-6 mb-2" />
                      <span className="text-xs font-bold">{t('profile_add_photo_button')}</span>
                    </>
                  )}
                </button>
              )}
              {Array.from({ length: Math.max(0, 5 - (photos.length + 1)) }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square rounded-lg bg-gray-900/50 border border-gray-800 flex items-center justify-center">
                  <Camera className="h-6 w-6 text-gray-700" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* SECTION INFOS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader><CardTitle>{t('profile_about_section_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">{t('profile_first_name_label')}</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-black/50 border-gray-700"
                placeholder={t('profile_first_name_placeholder')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">{t('profile_bio_label')}</label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="bg-black/50 border-gray-700 min-h-[100px]"
                placeholder={t('profile_bio_placeholder')}
                maxLength={300}
              />
              <p className="text-xs text-gray-600 text-right">{bio.length}/300</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">{t('profile_city_label')}</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-black/50 border border-gray-700 rounded-md text-white appearance-none"
                >
                  <option value="">{t('profile_city_placeholder')}</option>
                  {SWISS_CITIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">{t('profile_gender_label')}</label>
              <div className="flex gap-2">
                {[
                  { id: 'female' as const, label: t('profile_gender_female') },
                  { id: 'male' as const, label: t('profile_gender_male') },
                  { id: 'other' as const, label: t('profile_gender_other') },
                ].map(g => (
                  <Badge
                    key={g.id}
                    onClick={() => setGender(g.id)}
                    className={`cursor-pointer px-4 py-2 text-sm border ${
                      gender === g.id
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    {g.label}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SECTION SPORTS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader>
            <CardTitle>{t('profile_sports_section_title')}</CardTitle>
            <p className="text-xs text-gray-500">{t('profile_sports_subtitle')}</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_SPORTS.map(sport => (
                <Badge
                  key={sport}
                  onClick={() => toggleSport(sport)}
                  className={`cursor-pointer px-4 py-2 text-sm border transition-all ${
                    selectedSports.includes(sport)
                      ? 'bg-cyan-900/30 border-cyan-500 text-cyan-400 scale-105'
                      : 'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {selectedSports.includes(sport) && <CheckCircle className="h-3 w-3 mr-1" />}
                  {sport}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* SECTION DANSE */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-light tracking-wide">{t('profile_dances_section_title')}</CardTitle>
            <p className="text-xs text-gray-500">{t('profile_dances_subtitle')}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {DANCE_STYLES.map(dance => (
                <Badge
                  key={dance.id}
                  onClick={() => toggleDance(dance.id)}
                  className={`cursor-pointer px-4 py-2 text-sm border transition-all ${
                    selectedDances.includes(dance.id)
                      ? 'bg-accent/10 border-accent text-accent scale-105'
                      : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                  }`}
                >
                  <span className="mr-1">{dance.emoji}</span>
                  {dance.label}
                </Badge>
              ))}
            </div>

            {/* Niveau de danse (visible si au moins une danse sélectionnée)
                BUG #22 — flex gap-2 → grid grid-cols-3 pour distribution équitable
                sur mobile (chips text-sm + emoji débordaient 375px viewport). */}
            {selectedDances.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-gray-400">Niveau de danse</p>
                <div className="grid grid-cols-3 gap-2">
                  {DANCE_LEVEL_OPTIONS.map(lvl => (
                    <Badge
                      key={lvl.id}
                      onClick={() => setDanceLevel(danceLevel === lvl.id ? '' : lvl.id)}
                      className={`cursor-pointer px-2 py-2 text-xs border transition-all flex items-center justify-center gap-1 min-w-0 ${
                        danceLevel === lvl.id
                          ? 'bg-accent/10 border-accent text-accent'
                          : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <span className="flex-shrink-0">{lvl.emoji}</span>
                      <span className="truncate">{lvl.label}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BUG #71 — SECTION INFOS PERSO + LIFESTYLE (taille, profession, religion,
            type de relation, alcool/tabac/etc.). Tout optionnel.
            BUG #82 — Wrappé dans Accordion : replié par défaut pour réduire la
            charge visuelle. L'utilisateur clique pour déplier et remplir. */}
        <Accordion type="single" collapsible className="bg-[#1A1A1A] border border-white/5 rounded-xl">
          <AccordionItem value="plus-sur-toi" className="border-0">
            <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-white/5 rounded-xl">
              <div className="flex items-center gap-2 flex-1 text-left">
                <UserCircle className="h-5 w-5 text-accent" />
                <div>
                  <p className="text-sm font-medium text-white">Plus sur toi</p>
                  <p className="text-xs text-white/40 font-light mt-0.5">
                    Tout est optionnel. Plus tu remplis, plus ton profil est riche.
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <ProfileExtrasEditor
                value={profileExtras}
                onChange={setProfileExtras}
                disabled={isSaving}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* BUG #70 — SECTION 3 RÉPONSES PROFIL (style Hinge prompts).
            Affiche les 3 prompts répondus (lecture seule ici) + CTA vers
            /onboard/prompts qui réutilise le picker complet pour modifier. */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareQuote className="h-5 w-5 text-accent" />
              Tes 3 réponses profil
            </CardTitle>
            <p className="text-xs text-white/40 font-light mt-1">
              Les questions qui rendent ton profil unique. Inspiré style Hinge.
            </p>
          </CardHeader>
          <CardContent>
            {userProfile?.profilePrompts && userProfile.profilePrompts.length > 0 ? (
              <div className="flex flex-col gap-3">
                {userProfile.profilePrompts.map((p, i) => (
                  <div
                    key={`${p.questionId}-${i}`}
                    className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"
                  >
                    <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">
                      {p.question}
                    </p>
                    <p className="text-sm text-white font-medium leading-snug">
                      {p.answer}
                    </p>
                  </div>
                ))}
                <Link
                  href="/onboard/prompts"
                  className="self-start inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-full border border-accent/40 text-accent hover:bg-accent/10 text-sm font-light transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  Modifier mes réponses
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-accent" />
                </div>
                <p className="text-sm text-white/70 font-light">
                  Tu n&apos;as pas encore choisi tes 3 questions profil.
                </p>
                <Link
                  href="/onboard/prompts"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent/90 text-sm font-medium transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  Compléter mon profil
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

          </TabsContent>

          {/* ===== TAB 2 : PARRAINAGE (referral + créateur) ===== */}
          <TabsContent value="referral" className="space-y-6 mt-0">

        {/* SECTION PARRAINAGE & CRÉDITS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-accent/20 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-accent" />
              Parrainage & Crédits
            </CardTitle>
            <p className="text-xs text-gray-500">Invite tes amis et gagne des crédits gratuits</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Crédits */}
            <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-accent" />
                <span className="text-sm text-white/70">Mes crédits</span>
              </div>
              <span className="text-2xl font-light text-white">{userProfile?.credits ?? 0}</span>
            </div>

            {/* Code de parrainage */}
            <div className="space-y-2">
              <p className="text-sm text-white/50">Ton code de parrainage</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-12 bg-black/40 border border-white/10 rounded-xl flex items-center px-4">
                  <span className="text-white font-mono tracking-widest text-sm">
                    {userProfile?.referralCode || '—'}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 border-accent/30 text-accent hover:bg-accent/10"
                  onClick={() => {
                    if (userProfile?.referralCode) {
                      navigator.clipboard.writeText(userProfile.referralCode);
                      toast({ title: 'Code copié !' });
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Lien de parrainage */}
            <div className="space-y-2">
              <p className="text-sm text-white/50">Ton lien d'invitation</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-12 bg-black/40 border border-white/10 rounded-xl flex items-center px-4 overflow-hidden">
                  <span className="text-white/60 text-xs truncate">
                    {userProfile?.referralCode
                      ? `spordateur.com/signup?ref=${userProfile.referralCode}`
                      : '—'}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 border-accent/30 text-accent hover:bg-accent/10"
                  onClick={() => {
                    if (userProfile?.referralCode) {
                      navigator.clipboard.writeText(`https://spordateur.com/signup?ref=${userProfile.referralCode}`);
                      toast({ title: 'Lien copié !', description: 'Partage-le avec tes amis' });
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {userProfile?.referralCode && (
                  <QRCodeButton
                    url={`https://spordateur.com/signup?ref=${userProfile.referralCode}`}
                    label="Lien d'invitation"
                    code={userProfile.referralCode}
                    className="h-12 w-12 inline-flex items-center justify-center rounded-md border border-accent/30 text-accent hover:bg-accent/10 transition active:scale-95"
                  />
                )}
              </div>
            </div>

            {/* Explication */}
            <div className="p-4 bg-accent/5 border border-accent/10 rounded-xl">
              <p className="text-xs text-white/50 leading-relaxed">
                Quand un ami s'inscrit avec ton lien et achète des crédits, tu reçois automatiquement <span className="text-accent font-medium">+1 crédit gratuit</span> par achat.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* SECTION DEVENIR CRÉATEUR */}
        <Card className="bg-gradient-to-br from-accent/5 to-[#E91E63]/5 border-accent/20 hover:border-accent/40 transition-colors">
          <CardContent className="p-6 flex flex-col md:flex-row items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-5 w-5 text-accent" />
                <h3 className="text-base font-medium text-white">Devenir Créateur</h3>
              </div>
              <p className="text-xs text-white/40 leading-relaxed">
                Partage ton lien sur TikTok, Instagram ou avec tes amis. Gagne <span className="text-accent">10% de commission</span> sur chaque achat généré.
              </p>
            </div>
            <Link
              href="/creator/dashboard"
              className="w-full md:w-auto h-12 px-6 bg-white/5 backdrop-blur-xl border border-accent rounded-full text-white font-light text-sm tracking-wider uppercase flex items-center justify-center gap-2 hover:bg-accent/10 transition-all"
            >
              Mon dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

          </TabsContent>

          {/* ===== TAB 3 : CONFIDENTIALITÉ (IA opt-in, push notif, supprimer compte) ===== */}
          <TabsContent value="privacy" className="space-y-6 mt-0">

        {/* BUG #80 — Section Sécurité enrichie (selfie + liste rouge + filtre) */}
        <ProfileSafetySection profile={userProfile} />

        {/* SECTION CONFIDENTIALITÉ — Phase 8 sub-chantier 0 (commit 2/3) */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-base font-medium text-white flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" />
              Confidentialité
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="flex-1 min-w-0">
                <label htmlFor="ai-opt-in-toggle" className="text-sm font-medium text-white cursor-pointer">
                  Suggestions IA dans le chat
                </label>
                <p className="text-xs text-white/40 mt-1 leading-relaxed">
                  Activées par défaut. Recevoir au maximum 1 suggestion d&apos;activité toutes les 72 h
                  dans les chats post-session, générée par Google Gemini Flash. Désactivable à tout moment.{' '}
                  <Link href="/privacy" className="text-accent hover:underline">
                    En savoir plus
                  </Link>
                  .
                </p>
              </div>
              <Switch
                id="ai-opt-in-toggle"
                checked={aiSuggestionsOptIn}
                onCheckedChange={handleAiOptInToggle}
                disabled={isAiOptInSaving}
                className="mt-1 data-[state=checked]:bg-accent flex-shrink-0"
              />
            </div>

            {/* Phase 9 SC3 c3/5 — Push notifications opt-in (default-on) */}
            {user?.uid && (
              <div className="pt-2 border-t border-white/5">
                <PushOptInSwitch
                  uid={user.uid}
                  initialEnabled={userProfile?.pushNotificationsEnabled !== false}
                />
              </div>
            )}

            <div className="pt-2 border-t border-white/5">
              <p className="text-[11px] text-white/30 leading-relaxed">
                La modération automatisée des messages (filtres + IA) constitue une mesure de sécurité
                essentielle et n&apos;est pas désactivable individuellement.{' '}
                <Link href="/terms" className="text-white/50 hover:text-white/70 underline">
                  Voir CGU section 7.quater
                </Link>
                .
              </p>
            </div>

            {/* Phase 9 SC6 c3/4 — RGPD/nLPD Art. 17 droit à l'effacement */}
            <div className="pt-2 border-t border-white/5">
              <Link
                href="/profile/delete"
                className="inline-flex items-center gap-2 text-sm text-red-400 hover:text-red-300 underline"
              >
                Supprimer mon compte
              </Link>
              <p className="text-[11px] text-white/30 mt-1 leading-relaxed">
                Conformité RGPD Art. 17 / nLPD Art. 19 — délai de grâce 30 jours avant
                anonymisation définitive.
              </p>
            </div>
          </CardContent>
        </Card>

          </TabsContent>
        </Tabs>

        {/* ACTIONS */}
        <div className="flex justify-center md:justify-end mt-4">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-auto bg-accent hover:bg-accent/90 text-white font-medium h-11 px-8 rounded-full text-sm"
          >
            {isSaving ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
            Sauvegarder mon profil
          </Button>
        </div>

        {/* BUG #78 — Modal Aperçu du profil public. Construit un userProfile mock
            depuis les states courants du form (live preview), réutilise les composants
            publics (ProfilePromptsDisplay / ProfileStatsRow / ProfileInfoList). */}
        <ProfilePreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          profile={{
            displayName,
            bio,
            city,
            gender,
            photoURL: photos[0] || '',
            photos,
            birthDate: userProfile?.birthDate,
            profileExtras,
            profilePrompts: userProfile?.profilePrompts,
            // BUG #109 — Aperçu live : passer aussi les champs voicePrompt depuis
            // le state local voicePromptData (mis à jour temps réel après save
            // via VoicePromptRecorder callbacks). Avant : ces 3 champs étaient
            // omis → l'aperçu n'affichait pas l'accroche même quand enregistrée.
            voicePromptUrl: voicePromptData.url,
            voicePromptQuestion: voicePromptData.question,
            voicePromptDuration: voicePromptData.duration,
            // Badge ✓ Vérifié dans l'aperçu (cohérent /profile/[uid])
            selfieVerificationStatus: userProfile?.selfieVerificationStatus,
          }}
          photos={photos}
          sports={[
            ...selectedSports.map((name) => ({ name, level: 'intermediate' as const })),
            ...selectedDances.map((danceId) => {
              const danceLevelMap: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
                debutant: 'beginner',
                intermediaire: 'intermediate',
                avance: 'advanced',
              };
              return {
                name: danceId,
                level: (danceLevel ? danceLevelMap[danceLevel] : 'beginner') as 'beginner' | 'intermediate' | 'advanced',
              };
            }),
          ]}
        />

        {/* DÉCONNEXION */}
        <button
          onClick={async () => {
            const { getAuth, signOut } = await import('firebase/auth');
            const auth = getAuth();
            await signOut(auth);
            window.location.href = '/';
          }}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-white/10 text-white/40 hover:text-red-400 hover:border-red-400/30 transition-all text-sm font-light tracking-wide"
        >
          <LogOut className="h-4 w-4" />
          Se déconnecter
        </button>

      </div>

      {/* BUG #104 — Modal cropper : ouvert quand croppingFile != null. */}
      <ProfileImageCropper
        file={croppingFile}
        onCropped={(croppedFile) => { void handleCroppedUpload(croppedFile); }}
        onCancel={() => setCroppingFile(null)}
      />

      {/* BUG #107 — Modal recorder accroche vocale. Écrit lui-même dans Firestore
          via les callbacks ; on synchronise juste le state local pour réactivité. */}
      {user && (
        <VoicePromptRecorder
          open={voicePromptModalOpen}
          onOpenChange={setVoicePromptModalOpen}
          uid={user.uid}
          current={voicePromptData}
          onSaved={(data) => setVoicePromptData(data)}
          onDeleted={() => setVoicePromptData({})}
        />
      )}
    </div>
  );
}
