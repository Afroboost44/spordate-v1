"use client";

import React, { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, MapPin, Calendar, Dumbbell, Loader2, MessageCircle, BadgeCheck
} from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { getUser } from "@/services/firestore";
import { getReviewsByUser, getReviewerProfiles, type ReviewerProfile } from "@/lib/reviews";
import { isBlocked } from "@/lib/blocks";
import { BlockButton } from "@/components/blocks/BlockButton";
import { ReportButton } from "@/components/reports/ReportButton";
import { ReviewsList } from "@/components/reviews/ReviewsList";
import { ProfilePromptsDisplay } from "@/components/profile/ProfilePromptsDisplay";
import { ProfileStatsRow } from "@/components/profile/ProfileStatsRow";
import { VoicePromptPlayer } from "@/components/profile/VoicePromptPlayer";
import { ProfileInfoList } from "@/components/profile/ProfileInfoList";
import type { Review, UserProfile } from "@/types/firestore";
import { Timestamp } from 'firebase/firestore';

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function calculateAge(birthDate: Timestamp | null | undefined): number | null {
  if (!birthDate) return null;
  const birth = birthDate instanceof Timestamp ? birthDate.toDate() : new Date(birthDate as any);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

function PublicProfileContent() {
  const router = useRouter();
  const params = useParams();
  const uid = params.uid as string;
  const { user } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Map<string, ReviewerProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  // Phase 7 sub-chantier 2 commit 4/4 : check mutuel blocks (doctrine §9.sexies E)
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        // Block check en parallèle des autres fetch (non-bloquant)
        const blockedPromise = user?.uid
          ? isBlocked(user.uid, uid).catch((err) => {
              console.warn('[PublicProfile] isBlocked check failed (defaulting to false)', err);
              return false;
            })
          : Promise.resolve(false);

        const [p, r, isBlockedRes] = await Promise.all([
          getUser(uid),
          getReviewsByUser(uid).catch((err) => {
            console.error('[PublicProfile] Reviews fetch failed (non-blocking)', err);
            return [] as Review[];
          }),
          blockedPromise,
        ]);
        setBlocked(isBlockedRes);
        setProfile(p);
        setReviews(r);
        // Phase 7 commit 4/6 : résoudre les profils reviewers nominatifs (3-5★)
        if (r.length > 0) {
          const profilesMap = await getReviewerProfiles(r).catch((err) => {
            console.error('[PublicProfile] reviewerProfiles fetch failed (non-blocking)', err);
            return new Map<string, ReviewerProfile>();
          });
          setReviewerProfiles(profilesMap);
        }
      } catch (err) {
        console.error('[PublicProfile] Error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, user?.uid]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-gray-500 animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
        <p className="text-gray-400 font-light text-lg mb-4">Profil introuvable</p>
        <Button variant="ghost" onClick={() => router.back()} className="text-gray-400">
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  // Phase 7 sub-chantier 2 commit 4/4 : invisibilité mutuelle (doctrine §9.sexies E).
  // Si bloqué dans un sens ou l'autre, affichage neutre (pas de fuite d'info au bloqué).
  if (blocked === true) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
        <p className="text-gray-400 font-light text-lg mb-4">Profil non disponible</p>
        <Button variant="ghost" onClick={() => router.back()} className="text-gray-400">
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  const age = calculateAge(profile.birthDate);

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-white"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-white font-light text-lg flex-1">Profil</h1>
        {/* Phase 7 sub-chantier 2-3 : entry points T&S (block + report variant 'profile') */}
        {user?.uid && (
          <div className="flex items-center gap-2">
            <ReportButton
              variant="profile"
              targetUid={uid}
              targetName={profile.displayName || 'cet utilisateur'}
              currentUserId={user.uid}
            />
            <BlockButton
              variant="profile"
              targetUid={uid}
              targetName={profile.displayName || 'cet utilisateur'}
              currentUserId={user.uid}
            />
          </div>
        )}
      </div>

      {/* Profile Card */}
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Photo + Name */}
        <div className="flex flex-col items-center mb-8">
          <Avatar className="h-28 w-28 mb-4 ring-2 ring-zinc-800">
            <AvatarImage src={profile.photoURL} className="object-cover" />
            <AvatarFallback className="bg-zinc-800 text-gray-400 text-2xl">
              {getInitials(profile.displayName)}
            </AvatarFallback>
          </Avatar>
          <h2 className="text-2xl text-white font-light flex items-center gap-2">
            <span>{profile.displayName}{age ? `, ${age}` : ''}</span>
            {/* BUG #82 — Badge ✓ Vérifié à côté du nom si le profil a passé la
                vérification du selfie (selfieVerificationStatus === 'verified').
                Renforce la confiance entre utilisateurs. */}
            {profile.selfieVerificationStatus === 'verified' && (
              <BadgeCheck
                className="h-5 w-5 text-accent"
                aria-label="Profil vérifié"
              />
            )}
          </h2>
          {(profile.city || profile.canton) && (
            <div className="flex items-center gap-1.5 mt-2 text-gray-400">
              <MapPin className="h-4 w-4" />
              <span className="text-sm font-light">
                {[profile.city, profile.canton].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* BUG #107 — Accroche vocale en 2e position après la photo principale.
            Affichée si voicePromptUrl présent. Lecteur custom avec icône AudioLines. */}
        {profile.voicePromptUrl && (
          <div className="mb-6">
            <VoicePromptPlayer
              url={profile.voicePromptUrl}
              question={profile.voicePromptQuestion}
              duration={profile.voicePromptDuration}
            />
          </div>
        )}

        {/* BUG #71 — Stats horizontales scrollables (âge/genre/taille/ville/lifestyle).
            Tout est null-safe : le composant renvoie null si rien à afficher. */}
        <div className="mb-6">
          <ProfileStatsRow profile={profile} />
        </div>

        {/* Bio */}
        {profile.bio && (
          <div className="mb-8">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-light">À propos</h3>
            <p className="text-sm text-gray-300 font-light leading-relaxed">
              {profile.bio}
            </p>
          </div>
        )}

        {/* BUG #71 — Photos additionnelles INTERCALÉES entre les prompts (pattern
            Hinge feed). Layout : P1 + Q1 + P2 + Q2 + P3 + Q3 + photos restantes.
            Si moins de photos que de prompts, on affiche ce qu'on a et le reste
            des prompts s'enchaîne. */}
        {(() => {
          const photos = (profile.photos && profile.photos.length > 1)
            ? profile.photos.slice(1)
            : [];
          const prompts = profile.profilePrompts ?? [];
          // Construit l'ordre alterné : photo / prompt / photo / prompt / ...
          // Si plus de prompts que de photos, les prompts restants suivent.
          // Si plus de photos que de prompts, les photos restantes suivent.
          const sequence: Array<{ kind: 'photo'; url: string; idx: number } | { kind: 'prompt'; data: typeof prompts[number]; idx: number }> = [];
          const maxLen = Math.max(photos.length, prompts.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < photos.length) sequence.push({ kind: 'photo', url: photos[i], idx: i });
            if (i < prompts.length) sequence.push({ kind: 'prompt', data: prompts[i], idx: i });
          }
          if (sequence.length === 0) return null;
          return (
            <div className="mb-8 flex flex-col gap-4">
              {sequence.map((item) => {
                if (item.kind === 'photo') {
                  return (
                    <div
                      key={`photo-${item.idx}-${item.url}`}
                      className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden border border-white/10 bg-zinc-900"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={`${profile.displayName} — photo ${item.idx + 2}`}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading={item.idx === 0 ? 'eager' : 'lazy'}
                      />
                    </div>
                  );
                }
                return (
                  <ProfilePromptsDisplay
                    key={`prompt-${item.idx}-${item.data.questionId}`}
                    prompts={[item.data]}
                  />
                );
              })}
            </div>
          );
        })()}

        {/* BUG #71 — Infos perso verticales (profession, religion, origine, etc.) */}
        <div className="mb-8">
          <ProfileInfoList profile={profile} />
        </div>

        {/* Sports */}
        {profile.sports && profile.sports.length > 0 && (
          <div className="mb-8">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-light flex items-center gap-1.5">
              <Dumbbell className="h-3.5 w-3.5" /> Sports
            </h3>
            <div className="flex flex-wrap gap-2">
              {profile.sports.map((sport, i) => (
                <div
                  key={i}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2"
                >
                  <span className="text-sm text-white font-light">{sport.name}</span>
                  <span className="text-xs text-gray-500 font-light ml-1.5">
                    {LEVEL_LABELS[sport.level] || sport.level}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Member since */}
        {profile.createdAt && (
          <div className="mb-8">
            <div className="flex items-center gap-1.5 text-gray-600">
              <Calendar className="h-3.5 w-3.5" />
              <span className="text-xs font-light">
                Membre depuis {(profile.createdAt instanceof Timestamp ? profile.createdAt.toDate() : new Date(profile.createdAt as any)).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>
        )}

        {/* Reviews reçues (Phase 7 sub-chantier 1) */}
        <div className="mb-8">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-light">
            Avis reçus
          </h3>
          <ReviewsList reviews={reviews} variant="profile" reviewerProfiles={reviewerProfiles} />
        </div>

        {/* Back to chat */}
        <Button
          onClick={() => router.back()}
          className="w-full bg-accent text-white font-light hover:opacity-90 rounded-xl h-11"
        >
          <MessageCircle className="mr-2 h-4 w-4" />
          Retour au chat
        </Button>
      </div>
    </div>
  );
}

export default function PublicProfilePage() {
  return (
    <AuthGuard>
      <PublicProfileContent />
    </AuthGuard>
  );
}
