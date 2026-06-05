/**
 * Pile média ordonnée (lecture publique) — applique profileBlocksOrder.
 *
 * Rend les blocs médias (photos + accroche audio + accroche vidéo) dans l'ordre
 * choisi par l'utilisateur (drag-and-drop), EN EXCLUANT la 1ère photo (rendue
 * ailleurs comme avatar/principale). Utilisé par ProfilePreviewModal (Aperçu)
 * et /profile/[uid] (profil public) pour un rendu cohérent.
 *
 * Fallback : si profileBlocksOrder est absent → ordre historique
 * [photos…, audio, video] (cf. buildProfileBlocks). Zéro régression.
 *
 * Aucune string hardcodée (alt = displayName dynamique).
 */

'use client';

import { VoicePromptPlayer } from './VoicePromptPlayer';
import { VideoPromptPlayer } from './VideoPromptPlayer';
import { buildProfileBlocks } from '@/lib/profile/profileBlocks';

interface ProfileMediaStackProps {
  photos: string[];
  voicePromptUrl?: string | null;
  voicePromptQuestion?: string | null;
  voicePromptDuration?: number | null;
  videoPromptUrl?: string | null;
  order?: Array<{ type: 'photo' | 'audio' | 'video'; id: string }>;
  displayName?: string;
}

export function ProfileMediaStack({
  photos,
  voicePromptUrl,
  voicePromptQuestion,
  voicePromptDuration,
  videoPromptUrl,
  order,
  displayName,
}: ProfileMediaStackProps) {
  const blocks = buildProfileBlocks({
    photos,
    hasAudio: !!voicePromptUrl,
    hasVideo: !!videoPromptUrl,
    order,
  });

  // Exclut la 1ère photo (= avatar/principale rendue par le parent).
  let avatarSkipped = false;
  const stack = blocks.filter((b) => {
    if (!avatarSkipped && b.type === 'photo') {
      avatarSkipped = true;
      return false;
    }
    return true;
  });

  if (stack.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {stack.map((b, i) => {
        if (b.type === 'photo') {
          return (
            <div
              key={`photo-${i}-${b.id}`}
              className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden border border-white/10 bg-zinc-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={b.id}
                alt={displayName || ''}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          );
        }
        if (b.type === 'audio') {
          return (
            <VoicePromptPlayer
              key={`audio-${i}`}
              url={voicePromptUrl}
              question={voicePromptQuestion}
              duration={voicePromptDuration}
            />
          );
        }
        return <VideoPromptPlayer key={`video-${i}`} url={videoPromptUrl} />;
      })}
    </div>
  );
}
