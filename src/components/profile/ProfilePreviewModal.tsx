/**
 * BUG #78 — Aperçu du profil public depuis /profile édition.
 *
 * Affiche le profil de l'utilisateur tel qu'un autre user le voit (rendu
 * identique à /profile/[uid]) dans une Dialog plein écran. Live preview :
 *  - Construit un UserProfile mock à partir des states courants du form
 *  - Réutilise les composants publics (ProfilePromptsDisplay, ProfileStatsRow,
 *    ProfileInfoList) pour cohérence visuelle 100%
 *  - Pas besoin de sauvegarder en Firestore pour voir l'aperçu
 *
 * Pattern Dialog plein écran sur mobile, centré desktop max-w-lg.
 */

'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { MapPin, X, Dumbbell, Eye, BadgeCheck } from 'lucide-react';
import type { UserProfile, SportEntry } from '@/types/firestore';
import { ProfilePromptsDisplay } from './ProfilePromptsDisplay';
import { ProfileStatsRow } from './ProfileStatsRow';
import { ProfileInfoList } from './ProfileInfoList';
import { VoicePromptPlayer } from './VoicePromptPlayer';

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

export interface ProfilePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Profile mock construit depuis les states du form (live preview). */
  profile: Partial<UserProfile>;
  /** Photos en cours d'édition (ne sont pas encore dans profile.photos). */
  photos: string[];
  /** Sports + danses fusionnés en SportEntry[] (cohérent avec ce qu'affiche /profile/[uid]). */
  sports: SportEntry[];
}

export function ProfilePreviewModal({
  open,
  onOpenChange,
  profile,
  photos,
  sports,
}: ProfilePreviewModalProps) {
  const displayName = profile.displayName || 'Toi';
  const city = profile.city || '';
  const bio = profile.bio || '';
  const avatarUrl = photos[0] || profile.photoURL || '';
  // Photos supplémentaires pour intercaler avec les prompts (1ère = avatar, on skip)
  const extraPhotos = photos.slice(1);
  const prompts = profile.profilePrompts ?? [];

  // Construit la sequence alternée photo / prompt / photo / prompt …
  const sequence: Array<
    | { kind: 'photo'; url: string; idx: number }
    | { kind: 'prompt'; data: { questionId: string; question: string; answer: string }; idx: number }
  > = [];
  const maxLen = Math.max(extraPhotos.length, prompts.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < extraPhotos.length) sequence.push({ kind: 'photo', url: extraPhotos[i], idx: i });
    if (i < prompts.length) sequence.push({ kind: 'prompt', data: prompts[i], idx: i });
  }

  // Pseudo-UserProfile pour passer aux composants ProfileStatsRow / InfoList
  // (ils acceptent un Pick<UserProfile, ...> donc seuls les champs nécessaires sont requis).
  const previewProfile: Pick<UserProfile, 'birthDate' | 'gender' | 'city' | 'profileExtras'> = {
    birthDate: profile.birthDate as UserProfile['birthDate'],
    gender: profile.gender || 'other',
    city: profile.city || '',
    profileExtras: profile.profileExtras,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* BUG #79 — Structure flex-col avec header fixe + body scrollable.
          Mobile : prend 100dvh (dynamic viewport, gère barre URL mobile).
          Desktop sm+ : max-h-[90vh] centré, rounded.
          overflow-hidden sur le parent : empêche le scroll fantôme global,
          le scroll se fait UNIQUEMENT dans le body interne (flex-1 + overflow-y-auto). */}
      <DialogContent
        className="bg-black border-zinc-800 text-white p-0 w-[100vw] h-[100dvh] max-w-none sm:w-auto sm:h-auto sm:max-w-lg sm:max-h-[90vh] sm:rounded-2xl overflow-hidden flex flex-col"
      >
        {/* Header fixe (pas sticky) — separé du body scrollable via flex-col */}
        <div className="shrink-0 border-b border-zinc-800 px-4 py-3 flex items-center justify-between bg-black">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
            <DialogTitle className="text-sm font-light tracking-wider uppercase text-white/70">
              Aperçu de ton profil
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fermer l'aperçu"
            className="text-white/60 hover:text-white transition-colors p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body scrollable — flex-1 prend tout l'espace restant, overflow-y-auto
            permet le scroll intra-modal sans casser le layout global. */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
          {/* Avatar + Nom + Ville */}
          <div className="flex flex-col items-center text-center">
            <Avatar className="h-28 w-28 mb-4 ring-2 ring-zinc-800">
              <AvatarImage src={avatarUrl} className="object-cover" />
              <AvatarFallback className="bg-zinc-800 text-gray-400 text-2xl">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-2xl text-white font-light flex items-center gap-2">
              <span>{displayName}</span>
              {/* BUG #82 — Badge ✓ visible si le profil est vérifié */}
              {profile.selfieVerificationStatus === 'verified' && (
                <BadgeCheck className="h-5 w-5 text-accent" aria-label="Profil vérifié" />
              )}
            </h2>
            {city && (
              <div className="flex items-center gap-1.5 mt-2 text-gray-400">
                <MapPin className="h-4 w-4" />
                <span className="text-sm font-light">{city}</span>
              </div>
            )}
          </div>

          {/* BUG #107 — Accroche vocale en 2e position après photo principale,
              avant les stats. Cohérent avec /profile/[uid] (rendu public). */}
          {profile.voicePromptUrl && (
            <VoicePromptPlayer
              url={profile.voicePromptUrl}
              question={profile.voicePromptQuestion}
              duration={profile.voicePromptDuration}
            />
          )}

          {/* Stats horizontales (âge/genre/taille/ville/lifestyle) */}
          <ProfileStatsRow profile={previewProfile} />

          {/* Bio */}
          {bio && (
            <div>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-light">
                À propos
              </h3>
              <p className="text-sm text-gray-300 font-light leading-relaxed">{bio}</p>
            </div>
          )}

          {/* Photos intercalées avec prompts (pattern Hinge) */}
          {sequence.length > 0 && (
            <div className="flex flex-col gap-4">
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
                        alt={`${displayName} — photo ${item.idx + 2}`}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
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
          )}

          {/* Infos perso (profession / religion / origine / etc.) */}
          <ProfileInfoList profile={{ profileExtras: profile.profileExtras }} />

          {/* Sports */}
          {sports.length > 0 && (
            <div>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-light flex items-center gap-1.5">
                <Dumbbell className="h-3.5 w-3.5" /> Sports
              </h3>
              <div className="flex flex-wrap gap-2">
                {sports.map((sport, i) => (
                  <div
                    key={`${sport.name}-${i}`}
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

            {/* Note de pied de page : c'est un aperçu, pas le rendu final */}
            <div className="mt-4 px-4 py-3 rounded-xl border border-accent/20 bg-accent/[0.04]">
              <p className="text-[11px] text-white/50 leading-relaxed text-center">
                👁️ Voici ce que les autres voient. N&apos;oublie pas de sauvegarder tes modifs.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
