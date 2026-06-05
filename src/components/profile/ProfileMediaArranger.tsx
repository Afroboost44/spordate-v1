/**
 * Réorganisation des médias profil (drag-and-drop).
 *
 * Englobe les slots photos + l'accroche audio + l'accroche vidéo dans une
 * grille réordonnable (dnd-kit). Au drop : met à jour l'ordre côté parent ET
 * persiste `photos[]`/`photoURL`/`profileBlocksOrder` dans Firestore (merge).
 *
 * - 1ère photo de l'ordre = PRINCIPALE (badge automatique).
 * - Mobile : long-press 300ms (TouchSensor delay) pour éviter les drags
 *   accidentels au scroll. Desktop : drag immédiat (MouseSensor distance 4).
 * - Ghost semi-opaque #D91CD2 (DragOverlay) + placeholder pointillé accent.
 *
 * Anti-régression : l'enregistrement/upload audio & vidéo restent gérés par
 * VoicePromptRecorder / VideoPromptRecorder (ouverts via onEditVoice/onEditVideo).
 * Ce composant ne touche PAS à ces flux, il ne fait que (ré)ordonner + afficher.
 */

'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, X, Camera, Loader2, AudioLines, Video, Pencil, Play, Pause } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/context/LanguageContext';
import { VoicePromptPlayer } from './VoicePromptPlayer';
import {
  buildProfileBlocks,
  type ProfileBlock,
} from '@/lib/profile/profileBlocks';
import { formatVideoTime } from '@/lib/profile/videoPrompt';

interface ProfileMediaArrangerProps {
  uid: string;
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  voice: { url?: string; question?: string; duration?: number };
  videoUrl?: string;
  order?: Array<{ type: 'photo' | 'audio' | 'video'; id: string }>;
  onOrderChange: (order: Array<{ type: 'photo' | 'audio' | 'video'; id: string }>) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (url: string) => void;
  onEditVoice: () => void;
  onEditVideo: () => void;
  uploadingPhoto?: boolean;
  maxPhotos?: number;
}

/** id dnd-kit stable pour un bloc. */
function blockKey(b: ProfileBlock): string {
  return `${b.type}:${b.id}`;
}

/** Carte audio (compacte) — play réel via VoicePromptPlayer compact + édition. */
function AudioTile({
  voice,
  isPrimary,
  onEdit,
  t,
}: {
  voice: { url?: string; question?: string; duration?: number };
  isPrimary: boolean;
  onEdit: () => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-accent/10 text-accent p-2">
      <AudioLines className="h-7 w-7" />
      <span className="text-[10px] uppercase tracking-wider text-white/70 text-center">
        {t('arranger_audio_label')}
      </span>
      {typeof voice.duration === 'number' && voice.duration > 0 && (
        <span className="text-[10px] font-mono text-white/50">{formatVideoTime(voice.duration)}</span>
      )}
      <div onPointerDown={(e) => e.stopPropagation()}>
        <VoicePromptPlayer url={voice.url} variant="compact" question={voice.question} />
      </div>
      {isPrimary && <PrimaryBadge label={t('arranger_primary_badge')} />}
      <EditButton onEdit={onEdit} aria={t('arranger_edit')} />
    </div>
  );
}

/** Carte vidéo (compacte) — thumbnail muet tap-to-play + édition. */
function VideoTile({
  url,
  isPrimary,
  onEdit,
  t,
}: {
  url: string;
  isPrimary: boolean;
  onEdit: () => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const [playing, setPlaying] = useState(false);
  const ref = (el: HTMLVideoElement | null) => {
    videoElRef.current = el;
  };
  const videoElRef = useState<{ current: HTMLVideoElement | null }>({ current: null })[0];
  const toggle = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = videoElRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      el.pause();
      setPlaying(false);
    }
  };
  return (
    <div className="absolute inset-0 bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={url}
        muted
        playsInline
        preload="metadata"
        onEnded={() => setPlaying(false)}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <button
        type="button"
        onPointerDown={toggle}
        aria-label={playing ? t('video_prompt_pause') : t('video_prompt_play')}
        className="absolute inset-0 flex items-center justify-center bg-black/30"
      >
        <span className="flex items-center justify-center h-10 w-10 rounded-full bg-accent text-white">
          {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 ml-0.5" fill="currentColor" />}
        </span>
      </button>
      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-black/60 text-[9px] uppercase tracking-wider text-white/80 flex items-center gap-1">
        <Video className="h-3 w-3" /> {t('arranger_video_label')}
      </span>
      {isPrimary && <PrimaryBadge label={t('arranger_primary_badge')} />}
      <EditButton onEdit={onEdit} aria={t('arranger_edit')} />
    </div>
  );
}

function PrimaryBadge({ label }: { label: string }) {
  return (
    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-accent text-white text-[9px] uppercase tracking-wider font-medium">
      {label}
    </div>
  );
}

function EditButton({ onEdit, aria }: { onEdit: () => void; aria: string }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onEdit}
      aria-label={aria}
      className="absolute bottom-1 right-1 bg-black/70 backdrop-blur p-1 rounded-full text-white/80 hover:text-accent transition-colors"
    >
      <Pencil className="h-3 w-3" />
    </button>
  );
}

function SortableBlock({
  block,
  isPrimary,
  voice,
  videoUrl,
  onRemovePhoto,
  onEditVoice,
  onEditVideo,
  t,
}: {
  block: ProfileBlock;
  isPrimary: boolean;
  voice: { url?: string; question?: string; duration?: number };
  videoUrl?: string;
  onRemovePhoto: (url: string) => void;
  onEditVoice: () => void;
  onEditVideo: () => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: blockKey(block),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative aspect-square rounded-lg overflow-hidden border touch-none cursor-grab active:cursor-grabbing ${
        isDragging ? 'border-dashed border-accent' : isPrimary ? 'border-accent ring-2 ring-accent/30' : 'border-gray-700'
      }`}
      aria-label={t('arranger_reorder_aria')}
    >
      {block.type === 'photo' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.id} alt="" className="w-full h-full object-cover pointer-events-none select-none" draggable={false} />
          {isPrimary && <PrimaryBadge label={t('arranger_primary_badge')} />}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onRemovePhoto(block.id)}
            aria-label={t('arranger_remove')}
            className="absolute top-1 right-1 bg-red-600 p-1 rounded-full text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      )}
      {block.type === 'audio' && (
        <AudioTile voice={voice} isPrimary={isPrimary} onEdit={onEditVoice} t={t} />
      )}
      {block.type === 'video' && videoUrl && (
        <VideoTile url={videoUrl} isPrimary={isPrimary} onEdit={onEditVideo} t={t} />
      )}
    </div>
  );
}

export function ProfileMediaArranger({
  uid,
  photos,
  onPhotosChange,
  voice,
  videoUrl,
  order,
  onOrderChange,
  onAddPhoto,
  onRemovePhoto,
  onEditVoice,
  onEditVideo,
  uploadingPhoto,
  maxPhotos = 5,
}: ProfileMediaArrangerProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [activeId, setActiveId] = useState<string | null>(null);

  const blocks = useMemo(
    () =>
      buildProfileBlocks({
        photos,
        hasAudio: !!voice.url,
        hasVideo: !!videoUrl,
        order,
      }),
    [photos, voice.url, videoUrl, order],
  );

  const blockIds = blocks.map(blockKey);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Mobile : long-press 300ms avant de démarrer le drag (anti-drag au scroll).
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = async (
    nextPhotos: string[],
    nextOrder: Array<{ type: 'photo' | 'audio' | 'video'; id: string }>,
  ) => {
    try {
      const { default: app, db } = await import('@/lib/firebase');
      if (!app || !db) return;
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(
        doc(db, 'users', uid),
        {
          photos: nextPhotos,
          photoURL: nextPhotos[0] ?? '',
          profileBlocksOrder: nextOrder,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.error('[ProfileMediaArranger] persist order failed', err);
      toast({ variant: 'destructive', title: t('arranger_save_failed') });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blockIds.indexOf(String(active.id));
    const newIndex = blockIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(blocks, oldIndex, newIndex);
    const nextOrder = reordered.map((b) => ({ type: b.type, id: b.id }));
    const nextPhotos = reordered.filter((b) => b.type === 'photo').map((b) => b.id);
    onPhotosChange(nextPhotos);
    onOrderChange(nextOrder);
    void persist(nextPhotos, nextOrder);
  };

  const activeBlock = activeId ? blocks.find((b) => blockKey(b) === activeId) : null;
  const canAddPhoto = photos.length < maxPhotos;
  // Slots vides pour conserver une grille pleine (5 colonnes desktop).
  const filled = blocks.length + (canAddPhoto ? 1 : 0) + (!voice.url ? 1 : 0) + (!videoUrl ? 1 : 0);
  const emptyCount = Math.max(0, maxPhotos + 2 - filled);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={blockIds} strategy={rectSortingStrategy}>
          {blocks.map((block, i) => (
            <SortableBlock
              key={blockKey(block)}
              block={block}
              isPrimary={i === 0}
              voice={voice}
              videoUrl={videoUrl}
              onRemovePhoto={onRemovePhoto}
              onEditVoice={onEditVoice}
              onEditVideo={onEditVideo}
              t={t}
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeBlock ? (
            <div className="relative aspect-square rounded-lg overflow-hidden border-2 border-accent shadow-2xl shadow-accent/40 opacity-90">
              {activeBlock.type === 'photo' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeBlock.id} alt="" className="w-full h-full object-cover" />
              ) : activeBlock.type === 'audio' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-accent/20 text-accent">
                  <AudioLines className="h-7 w-7" />
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-accent/20 text-accent">
                  <Video className="h-7 w-7" />
                </div>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Ajouter une photo */}
      {canAddPhoto && (
        <button
          type="button"
          onClick={onAddPhoto}
          disabled={uploadingPhoto}
          className="aspect-square rounded-lg border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-accent hover:text-accent transition-colors bg-black/20 disabled:opacity-50 disabled:cursor-wait gap-2"
        >
          {uploadingPhoto ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-xs font-bold">{t('arranger_uploading')}</span>
            </>
          ) : (
            <>
              <Plus className="h-6 w-6" />
              <span className="text-[11px] font-bold text-center">{t('arranger_add_photo')}</span>
            </>
          )}
        </button>
      )}

      {/* Ajouter accroche vocale */}
      {!voice.url && (
        <button
          type="button"
          onClick={onEditVoice}
          className="aspect-square rounded-lg border-2 border-dashed border-accent/30 bg-accent/5 flex flex-col items-center justify-center text-accent hover:bg-accent/10 hover:border-accent/50 transition-colors gap-2"
        >
          <AudioLines className="h-6 w-6" />
          <span className="text-[11px] font-bold text-center px-1">{t('arranger_add_audio')}</span>
        </button>
      )}

      {/* Ajouter accroche vidéo */}
      {!videoUrl && (
        <button
          type="button"
          onClick={onEditVideo}
          className="aspect-square rounded-lg border-2 border-dashed border-accent/30 bg-accent/5 flex flex-col items-center justify-center text-accent hover:bg-accent/10 hover:border-accent/50 transition-colors gap-2"
        >
          <Video className="h-6 w-6" />
          <span className="text-[11px] font-bold text-center px-1">{t('arranger_add_video')}</span>
        </button>
      )}

      {/* Slots vides décoratifs */}
      {Array.from({ length: emptyCount }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="aspect-square rounded-lg bg-gray-900/50 border border-gray-800 flex items-center justify-center"
        >
          <Camera className="h-6 w-6 text-gray-700" />
        </div>
      ))}
    </div>
  );
}
