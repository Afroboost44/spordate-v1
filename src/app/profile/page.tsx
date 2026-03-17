"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Camera, MapPin, Save, Loader2, Plus, X, CheckCircle, Gift, Copy, CreditCard
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { updateUser, getUser } from "@/services/firestore";
import type { UserProfile, SportEntry } from "@/types/firestore";
import { DANCE_ACTIVITIES, DANCE_LEVELS } from "@/types/firestore";
import type { DanceCategory, DanceLevel } from "@/types/firestore";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedDances, setSelectedDances] = useState<DanceCategory[]>([]);
  const [danceLevel, setDanceLevel] = useState<DanceLevel | ''>('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('other');

  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

          setPhotos(userProfile.photoURL ? [userProfile.photoURL] : []);
          setProfileComplete(userProfile.onboardingComplete || false);
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

  // Image upload
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Fichier trop lourd", description: "Max 2MB par image.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (photos.length >= 5) {
        toast({ title: "Limite atteinte", description: "Max 5 photos.", variant: "destructive" });
        return;
      }
      setPhotos(prev => [...prev, base64]);
      toast({ title: "Photo ajoutée", className: "bg-green-600 text-white" });
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
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
      await updateUser(user.uid, {
        displayName: displayName.trim(),
        bio: bio.trim(),
        city,
        gender,
        sports: sportsEntries,
        photoURL: photos[0] || '',
        onboardingComplete: true,
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

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <Loader2 className="animate-spin mr-2" /> Chargement du profil...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 pb-24">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* HEADER */}
        <div className="pt-4">
          <h1 className="text-3xl font-light tracking-wide">Mon Profil</h1>
          <p className="text-white/40 text-sm font-light mt-1">
            {profileComplete
              ? "Gérez vos informations et vos photos."
              : "Complétez votre profil pour commencer à matcher !"}
          </p>
          {!profileComplete && (
            <div className="mt-3 px-4 py-2 bg-[#D91CD2]/10 border border-[#D91CD2]/30 rounded-lg">
              <p className="text-sm text-[#D91CD2]">
                Complétez votre profil pour apparaître dans les résultats de matching.
              </p>
            </div>
          )}
        </div>

        {/* SECTION PHOTOS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
          <CardHeader>
            <CardTitle>Photos</CardTitle>
            <p className="text-xs text-gray-500">Max 5 photos. Montrez-vous en action !</p>
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
                <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-gray-700 group">
                  <img src={photo} alt="User" className="w-full h-full object-cover" />
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
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-[#D91CD2] hover:text-[#D91CD2] transition-colors bg-black/20"
                >
                  <Plus className="h-6 w-6 mb-2" />
                  <span className="text-xs font-bold">Ajouter</span>
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
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
          <CardHeader><CardTitle>À propos de moi</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Prénom *</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-black/50 border-gray-700"
                placeholder="Votre prénom"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Bio</label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="bg-black/50 border-gray-700 min-h-[100px]"
                placeholder="Parlez de vos sports favoris..."
                maxLength={300}
              />
              <p className="text-xs text-gray-600 text-right">{bio.length}/300</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Ville *</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-black/50 border border-gray-700 rounded-md text-white appearance-none"
                >
                  <option value="">Sélectionnez votre ville</option>
                  {SWISS_CITIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Genre</label>
              <div className="flex gap-2">
                {[
                  { id: 'female' as const, label: 'Femme' },
                  { id: 'male' as const, label: 'Homme' },
                  { id: 'other' as const, label: 'Autre' },
                ].map(g => (
                  <Badge
                    key={g.id}
                    onClick={() => setGender(g.id)}
                    className={`cursor-pointer px-4 py-2 text-sm border ${
                      gender === g.id
                        ? 'bg-[#D91CD2]/10 border-[#D91CD2] text-[#D91CD2]'
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
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
          <CardHeader>
            <CardTitle>Mes Sports *</CardTitle>
            <p className="text-xs text-gray-500">Sélectionnez vos sports favoris</p>
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
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-light tracking-wide">Mes Danses</CardTitle>
            <p className="text-xs text-gray-500">Sélectionnez vos styles de danse</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {DANCE_STYLES.map(dance => (
                <Badge
                  key={dance.id}
                  onClick={() => toggleDance(dance.id)}
                  className={`cursor-pointer px-4 py-2 text-sm border transition-all ${
                    selectedDances.includes(dance.id)
                      ? 'bg-[#D91CD2]/10 border-[#D91CD2] text-[#D91CD2] scale-105'
                      : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                  }`}
                >
                  <span className="mr-1">{dance.emoji}</span>
                  {dance.label}
                </Badge>
              ))}
            </div>

            {/* Niveau de danse (visible si au moins une danse sélectionnée) */}
            {selectedDances.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-gray-400">Niveau de danse</p>
                <div className="flex gap-2">
                  {DANCE_LEVEL_OPTIONS.map(lvl => (
                    <Badge
                      key={lvl.id}
                      onClick={() => setDanceLevel(danceLevel === lvl.id ? '' : lvl.id)}
                      className={`cursor-pointer px-4 py-2 text-sm border transition-all ${
                        danceLevel === lvl.id
                          ? 'bg-[#D91CD2]/10 border-[#D91CD2] text-[#D91CD2]'
                          : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <span className="mr-1">{lvl.emoji}</span>
                      {lvl.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SECTION PARRAINAGE & CRÉDITS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-[#D91CD2]" />
              Parrainage & Crédits
            </CardTitle>
            <p className="text-xs text-gray-500">Invite tes amis et gagne des crédits gratuits</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Crédits */}
            <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-[#D91CD2]" />
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
                  className="h-12 w-12 border-[#D91CD2]/30 text-[#D91CD2] hover:bg-[#D91CD2]/10"
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
                  className="h-12 w-12 border-[#D91CD2]/30 text-[#D91CD2] hover:bg-[#D91CD2]/10"
                  onClick={() => {
                    if (userProfile?.referralCode) {
                      navigator.clipboard.writeText(`https://spordateur.com/signup?ref=${userProfile.referralCode}`);
                      toast({ title: 'Lien copié !', description: 'Partage-le avec tes amis' });
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Explication */}
            <div className="p-4 bg-[#D91CD2]/5 border border-[#D91CD2]/10 rounded-xl">
              <p className="text-xs text-white/50 leading-relaxed">
                Quand un ami s'inscrit avec ton lien et achète des crédits, tu reçois automatiquement <span className="text-[#D91CD2] font-medium">+1 crédit gratuit</span> par achat.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ACTIONS */}
        <div className="fixed bottom-20 md:bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur border-t border-gray-800 md:relative md:bg-transparent md:border-0 md:p-0 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full md:w-auto bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold h-12 px-8"
          >
            {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />}
            Sauvegarder mon profil
          </Button>
        </div>

      </div>
    </div>
  );
}
