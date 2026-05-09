/**
 * Phase 9.5 c4 — <MediaManager> partner UI (drag&drop reorder + upload + URL embed).
 *
 * Features :
 *  - Liste verticale items + drag handle (GripVertical) — première = "Principale" badge
 *  - Per item : preview thumbnail (image) OR icone Video + URL truncate + supprimer ❌
 *  - 3 boutons action : Image upload / Image URL / Vidéo URL
 *  - Drag & drop reorder via @dnd-kit/core + @dnd-kit/sortable (Q1=A modern UX PC + mobile)
 *  - Q2=A maxItems=5 par défaut
 *  - Q3=A no autoplay (rendering iframe sans `&autoplay=1`)
 *
 * Charte stricte black/#D91CD2/white.
 */

'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  ImagePlus,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  Trash2,
  Video,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  uploadActivityMedia,
  StorageUploadError,
  STORAGE_UPLOAD_MAX_BYTES,
} from '@/lib/storage/uploadActivityMedia';
import { parseVideoUrl, isImageUrl, getVideoThumbnail } from '@/lib/activities/mediaParser';
import type { MediaItem } from '@/types/firestore';

// =====================================================================
// Constants
// =====================================================================

const DEFAULT_MAX_ITEMS = 5;
const MAX_SIZE_MB = STORAGE_UPLOAD_MAX_BYTES / 1024 / 1024;

// =====================================================================
// Sortable item row
// =====================================================================

interface SortableItemProps {
  id: string;
  item: MediaItem;
  index: number;
  onRemove: () => void;
}

function SortableItem({ id, item, index, onRemove }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isPrimary = index === 0;
  const isVideo = item.type === 'video';

  // Phase 9.5 c8 BUG 3 — state-based fallback (vs onError display:none qui laissait
  // le carré bg-zinc-800 vide sans repère visuel). Affiche ImageIcon si broken URL.
  const [imgBroken, setImgBroken] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border border-white/10 bg-zinc-900/60 p-3"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-white/40 hover:text-white/70 touch-none"
        aria-label={`Réorganiser l'item ${index + 1}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Preview — c10.A : YouTube videos affichent leur thumbnail (avant : Video icon générique) */}
      <div className="h-12 w-12 shrink-0 rounded overflow-hidden bg-zinc-800 flex items-center justify-center relative">
        {isVideo ? (
          (() => {
            const thumb = getVideoThumbnail(item);
            if (thumb && !imgBroken) {
              return (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => setImgBroken(true)}
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Video className="h-4 w-4 text-white" />
                  </span>
                </>
              );
            }
            return <Video className="h-5 w-5 text-[#D91CD2]" />;
          })()
        ) : imgBroken ? (
          <ImageIcon className="h-5 w-5 text-white/30" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImgBroken(true)}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-2">
          {isPrimary && (
            <Badge className="bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2] text-[9px] uppercase tracking-wider">
              Principale
            </Badge>
          )}
          {isVideo && item.provider && (
            <Badge className="bg-zinc-800 border-zinc-700 text-zinc-400 text-[9px] uppercase tracking-wider">
              {item.provider}
            </Badge>
          )}
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            {item.source === 'upload' ? 'Upload' : 'URL'}
          </span>
        </div>
        <span className="text-xs text-white/60 truncate font-mono" title={item.url}>
          {item.url}
        </span>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
        aria-label="Supprimer"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// =====================================================================
// MediaManager
// =====================================================================

export interface MediaManagerProps {
  value: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  partnerId: string;
  /** Q2=A default 5. */
  maxItems?: number;
  disabled?: boolean;
}

export function MediaManager({
  value,
  onChange,
  partnerId,
  maxItems = DEFAULT_MAX_ITEMS,
  disabled,
}: MediaManagerProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [urlDialog, setUrlDialog] = useState<
    | { open: false }
    | { open: true; type: 'image' | 'video'; value: string }
  >({ open: false });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Phase 9.5 c8 BUG 3 — stable id PAR ITEM (pas par position). Sans cela, ids
  // `media-${i}` étaient position-tied → arrayMove permute items mais ids
  // restaient 0/1/2 → @dnd-kit ne détectait pas le mouvement.
  // Strategy : id = `${source}__${url}` ; suffixe `#${count}` pour dédup si
  // duplicate URL (rare edge case user ajoute 2× même URL).
  const itemIds = useMemo(() => {
    const seen = new Map<string, number>();
    return value.map((item) => {
      const base = `${item.source}__${item.url}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return count === 1 ? base : `${base}#${count}`;
    });
  }, [value]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.findIndex((id) => id === active.id);
    const newIndex = itemIds.findIndex((id) => id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(value, oldIndex, newIndex));
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const canAddMore = value.length < maxItems;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadActivityMedia(file, partnerId);
      onChange([
        ...value,
        { url: result.url, type: 'image', source: 'upload' },
      ]);
      toast({
        title: 'Image uploadée',
        description: 'Image ajoutée à l\'activité.',
        className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      });
    } catch (err) {
      const code =
        err instanceof StorageUploadError
          ? err.code
          : err instanceof Error
            ? err.message
            : 'unknown';
      const description =
        code === 'file-too-large'
          ? `Fichier trop gros (max ${MAX_SIZE_MB} MB).`
          : code === 'invalid-content-type'
            ? 'Format non supporté (images uniquement).'
            : `Upload échoué — ${code}`;
      toast({
        title: 'Erreur upload',
        description,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      // Reset input pour permettre re-upload du même fichier
      e.target.value = '';
    }
  };

  const handleAddImageUrl = () => {
    setUrlDialog({ open: true, type: 'image', value: '' });
  };

  const handleAddVideoUrl = () => {
    setUrlDialog({ open: true, type: 'video', value: '' });
  };

  const handleConfirmUrl = () => {
    if (!urlDialog.open) return;
    const trimmed = urlDialog.value.trim();
    if (!trimmed) {
      toast({ title: 'URL vide', description: 'Colle une URL valide.', variant: 'destructive' });
      return;
    }
    if (urlDialog.type === 'image') {
      // Heuristique extension-based
      if (!isImageUrl(trimmed) && !confirm('Cette URL ne semble pas pointer vers une image (extension non-reconnue). Ajouter quand-même ?')) {
        return;
      }
      onChange([...value, { url: trimmed, type: 'image', source: 'url' }]);
      setUrlDialog({ open: false });
    } else {
      const parsed = parseVideoUrl(trimmed);
      if (!parsed) {
        toast({
          title: 'URL vidéo invalide',
          description: 'Supportés : YouTube, Vimeo, Google Drive.',
          variant: 'destructive',
        });
        return;
      }
      onChange([
        ...value,
        {
          url: trimmed,
          type: 'video',
          source: 'url',
          provider: parsed.provider,
          embedUrl: parsed.embedUrl,
        },
      ]);
      setUrlDialog({ open: false });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center justify-between">
        <span>Photos &amp; vidéos ({value.length}/{maxItems})</span>
        {value.length > 0 && (
          <span className="text-[10px] text-white/40 normal-case tracking-normal">
            Glisse pour réorganiser — la première est l&apos;image principale
          </span>
        )}
      </Label>

      {/* Sortable list */}
      {value.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {value.map((item, i) => (
                <SortableItem
                  key={itemIds[i]}
                  id={itemIds[i]}
                  item={item}
                  index={i}
                  onRemove={() => handleRemove(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="rounded-md border border-dashed border-white/10 bg-zinc-900/30 p-6 text-center text-sm text-white/40">
          Aucune photo/vidéo ajoutée. Ajoute-en au moins une pour rendre ton activité attractive.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <label
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
            canAddMore && !disabled && !uploading
              ? 'border-[#D91CD2]/40 text-[#D91CD2] hover:bg-[#D91CD2]/10'
              : 'border-white/10 text-white/30 cursor-not-allowed'
          }`}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Image (upload)
          <input
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            disabled={!canAddMore || disabled || uploading}
            className="hidden"
          />
        </label>

        <Button
          type="button"
          variant="outline"
          onClick={handleAddImageUrl}
          disabled={!canAddMore || disabled || uploading}
          className="border-white/10 text-white/70 hover:text-white hover:bg-white/5"
        >
          <LinkIcon className="h-4 w-4 mr-2" />
          Image (URL)
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleAddVideoUrl}
          disabled={!canAddMore || disabled || uploading}
          className="border-white/10 text-white/70 hover:text-white hover:bg-white/5"
        >
          <Video className="h-4 w-4 mr-2" />
          Vidéo (URL)
        </Button>
      </div>

      {!canAddMore && (
        <p className="text-[11px] text-amber-300/70">
          Limite atteinte ({maxItems}). Supprime un item pour en ajouter d&apos;autres.
        </p>
      )}

      {/* URL dialog */}
      <Dialog
        open={urlDialog.open}
        onOpenChange={(open) => !open && setUrlDialog({ open: false })}
      >
        <DialogContent className="bg-zinc-950 border border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {urlDialog.open && urlDialog.type === 'image' ? (
                <>
                  <ImagePlus className="h-5 w-5 text-[#D91CD2]" />
                  Ajouter une image par URL
                </>
              ) : (
                <>
                  <Video className="h-5 w-5 text-[#D91CD2]" />
                  Ajouter une vidéo par URL
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-white/60 text-sm">
              {urlDialog.open && urlDialog.type === 'video'
                ? 'YouTube, Vimeo ou Google Drive — la vidéo sera embed dans l\'activité.'
                : 'Colle l\'URL d\'une image hébergée externe.'}
            </DialogDescription>
          </DialogHeader>
          {urlDialog.open && (
            <div className="flex flex-col gap-2 py-2">
              <Input
                value={urlDialog.value}
                onChange={(e) =>
                  setUrlDialog({ ...urlDialog, value: e.target.value })
                }
                placeholder={
                  urlDialog.type === 'image'
                    ? 'https://example.com/photo.jpg'
                    : 'https://www.youtube.com/watch?v=...'
                }
                className="bg-zinc-900 border-white/10 text-white"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmUrl();
                  }
                }}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUrlDialog({ open: false })}
              className="border-white/10 text-white"
            >
              Annuler
            </Button>
            <Button
              type="button"
              onClick={handleConfirmUrl}
              className="bg-[#D91CD2] hover:bg-[#D91CD2]/90 text-white"
            >
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
