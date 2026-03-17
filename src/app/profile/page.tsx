"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  Camera, MapPin, Activity, Save, Loader2, Plus, X, UploadCloud, User
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

// --- RÈGLE ANTI-CASSE : DONNÉES PAR DÉFAUT ---
// Si le profil est vide ou corrompu, on charge ceci pour éviter l'écran blanc.
const DEFAULT_PROFILE = {
    name: "Utilisateur Spordate",
    bio: "Passionné de sport, je cherche des partenaires pour progresser.",
    city: "Neuchâtel",
    sports: ["Tennis", "Running"],
    photos: [] // Tableau vide par défaut
};

export default function ProfilePage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // États sécurisés
  const [profile, setProfile] = useState<any>(DEFAULT_PROFILE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // --- CHARGEMENT SÉCURISÉ ---
  useEffect(() => {
    const loadProfile = () => {
        try {
            const storedProfile = localStorage.getItem('spordate_user_profile');
            if (storedProfile) {
                const parsed = JSON.parse(storedProfile);
                // Fusion pour s'assurer qu'il ne manque pas de champs (ex: photos)
                setProfile({ ...DEFAULT_PROFILE, ...parsed });
            } else {
                setProfile(DEFAULT_PROFILE);
            }
        } catch (error) {
            console.error("Erreur chargement profil", error);
            setProfile(DEFAULT_PROFILE);
        } finally {
            setIsLoaded(true);
        }
    };
    loadProfile();
  }, []);

  const saveToDb = (newProfile: any) => {
      try {
          localStorage.setItem('spordate_user_profile', JSON.stringify(newProfile));
          setProfile(newProfile);
      } catch (e) {
          console.error("Erreur sauvegarde", e);
          toast({ title: "Erreur stockage", description: "Mémoire pleine ?", variant: "destructive" });
      }
  };

  // --- LOGIQUE UPLOAD IMAGE (Base64) ---
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Limite de sécurité (2MB) pour ne pas faire laguer le navigateur
      if (file.size > 2 * 1024 * 1024) {
          toast({ title: "Fichier trop lourd", description: "Max 2MB par image.", variant: "destructive" });
          return;
      }

      const reader = new FileReader();
      
      reader.onloadend = () => {
          try {
            const base64String = reader.result as string;
            // Ajout de la nouvelle photo au tableau existant
            const currentPhotos = profile.photos || [];
            if (currentPhotos.length >= 5) {
                toast({ title: "Limite atteinte", description: "Max 5 photos.", variant: "destructive" });
                return;
            }
            
            const updatedProfile = { ...profile, photos: [...currentPhotos, base64String] };
            saveToDb(updatedProfile);
            toast({ title: "Photo ajoutée 📸", className: "bg-green-600 text-white" });
          } catch (err) {
            toast({ title: "Erreur lecture image", variant: "destructive" });
          }
      };

      reader.readAsDataURL(file);
  };

  const removePhoto = (indexToRemove: number) => {
      const updatedPhotos = profile.photos.filter((_: any, index: number) => index !== indexToRemove);
      const updatedProfile = { ...profile, photos: updatedPhotos };
      saveToDb(updatedProfile);
  };

  const handleSave = () => {
      setIsSaving(true);
      setTimeout(() => {
          saveToDb(profile);
          setIsSaving(false);
          toast({ title: "Profil mis à jour ✅", description: "Vos modifications sont visibles." });
      }, 800);
  };

  // Toggle Sport simple pour la démo
  const toggleSport = (sport: string) => {
      const currentSports = profile.sports || [];
      let newSports;
      if (currentSports.includes(sport)) {
          newSports = currentSports.filter((s: string) => s !== sport);
      } else {
          newSports = [...currentSports, sport];
      }
      setProfile({ ...profile, sports: newSports });
  };

  if (!isLoaded) return <div className="min-h-screen bg-black flex items-center justify-center text-white"><Loader2 className="animate-spin mr-2"/> Chargement du profil...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 pb-24">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* HEADER */}
        <div className="pt-4">
            <h1 className="text-3xl font-light tracking-wide">Mon Profil</h1>
            <p className="text-white/40 text-sm font-light mt-1">Gerez vos informations et vos photos.</p>
        </div>

        {/* SECTION PHOTOS (FONCTIONNELLE) */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
            <CardHeader><CardTitle>Photos</CardTitle><p className="text-xs text-gray-500">Max 5 photos. Montrez-vous en action !</p></CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {/* INPUT CACHÉ POUR L'UPLOAD */}
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="image/*" 
                        onChange={handleImageUpload}
                    />

                    {/* AFFICHAGE DES PHOTOS EXISTANTES */}
                    {(profile.photos || []).map((photo: string, index: number) => (
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

                    {/* BOUTON AJOUTER (Si moins de 5 photos) */}
                    {(profile.photos || []).length < 5 && (
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-square rounded-lg border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-cyan-500 hover:text-cyan-500 transition-colors bg-black/20"
                        >
                            <Plus className="h-6 w-6 mb-2" />
                            <span className="text-xs font-bold">Ajouter</span>
                        </button>
                    )}

                    {/* PLACEHOLDERS VIDES (Pour combler la grille) */}
                    {Array.from({ length: Math.max(0, 5 - ((profile.photos || []).length + 1)) }).map((_, i) => (
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
                    <label className="text-sm text-gray-400">Bio</label>
                    <Textarea 
                        value={profile.bio} 
                        onChange={(e) => setProfile({...profile, bio: e.target.value})}
                        className="bg-black/50 border-gray-700 min-h-[100px]" 
                        placeholder="Parlez de vos sports favoris..."
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm text-gray-400">Ville</label>
                    <div className="relative">
                        <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                        <Input 
                            value={profile.city} 
                            onChange={(e) => setProfile({...profile, city: e.target.value})}
                            className="pl-10 bg-black/50 border-gray-700" 
                        />
                    </div>
                </div>
            </CardContent>
        </Card>

        {/* SECTION SPORTS */}
        <Card className="bg-[#1A1A1A] border-white/5 hover:border-[#D91CD2]/20 transition-colors">
            <CardHeader><CardTitle>Mes Sports</CardTitle><p className="text-xs text-gray-500">Sélectionnez vos sports favoris</p></CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-2">
                    {["Tennis", "Fitness", "Running", "Yoga", "Crossfit", "Football", "Natation", "Vélo", "Escalade"].map((sport) => (
                        <Badge
                            key={sport}
                            onClick={() => toggleSport(sport)}
                            className={`cursor-pointer px-4 py-2 text-sm border ${
                                (profile.sports || []).includes(sport)
                                ? 'bg-cyan-900/30 border-cyan-500 text-cyan-400'
                                : 'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'
                            }`}
                        >
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
                    {["Afroboost", "Zumba", "Afro Dance", "Dance Fitness", "Salsa", "Bachata", "Hip-Hop", "Dance Workout"].map((dance) => (
                        <Badge
                            key={dance}
                            onClick={() => toggleSport(dance)}
                            className={`cursor-pointer px-4 py-2 text-sm border ${
                                (profile.sports || []).includes(dance)
                                ? 'bg-[#D91CD2]/10 border-[#D91CD2] text-[#D91CD2]'
                                : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                            }`}
                        >
                            {dance}
                        </Badge>
                    ))}
                </div>

                {/* Niveau de danse */}
                {(profile.sports || []).some((s: string) => ["Afroboost", "Zumba", "Afro Dance", "Dance Fitness", "Salsa", "Bachata", "Hip-Hop", "Dance Workout"].includes(s)) && (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm text-gray-400">Niveau de danse</p>
                    <div className="flex gap-2">
                      {[
                        { level: "debutant", label: "Debutant" },
                        { level: "intermediaire", label: "Intermediaire" },
                        { level: "avance", label: "Avance" },
                      ].map((lvl) => (
                        <Badge
                          key={lvl.level}
                          onClick={() => setProfile({ ...profile, danceLevel: lvl.level })}
                          className={`cursor-pointer px-4 py-2 text-sm border ${
                            profile.danceLevel === lvl.level
                              ? 'bg-[#D91CD2]/10 border-[#D91CD2] text-[#D91CD2]'
                              : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                          }`}
                        >
                          {lvl.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Toggle "Aime la danse" */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => setProfile({ ...profile, likesDancing: !profile.likesDancing })}
                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                      profile.likesDancing
                        ? 'bg-[#D91CD2]/10 border-[#D91CD2] text-[#D91CD2]'
                        : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    {profile.likesDancing ? 'J\'aime la danse' : 'J\'aime la danse ?'}
                  </button>
                </div>
            </CardContent>
        </Card>

        {/* ACTIONS */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur border-t border-gray-800 md:relative md:bg-transparent md:border-0 md:p-0 flex justify-end">
            <Button 
                onClick={handleSave} 
                disabled={isSaving}
                className="w-full md:w-auto bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold h-12 px-8"
            >
                {isSaving ? <Loader2 className="animate-spin mr-2"/> : <Save className="mr-2 h-4 w-4"/>}
                Sauvegarder mon profil
            </Button>
        </div>

      </div>
    </div>
  );
}

    