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
  RefreshCcw,
  Trash2,
  Video,
  Upload,
  UploadCloud,
  Camera,
} from 'lucide-react';
import { VideoThumbnailPicker } from './VideoThumbnailPicker';
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
import { useLanguage } from '@/context/LanguageContext';
import {
  uploadActivityMedia,
  StorageUploadError,
  STORAGE_UPLOAD_MAX_BYTES,
} from '@/lib/storage/uploadActivityMedia';
import { parseVideoUrl, isImageUrl, getVideoThumbnailChain } from '@/lib/activities/mediaParser';
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
  /** BUG #102 — Callback "Remplacer" : ouvre file picker + re-upload + remplace
   *  l'URL dans le slot existant (préserve l'ordre + le rôle "Principale"). */
  onReplace: () => void;
  /** Fix #122 — Callback "Choisir miniature" : ouvre VideoThumbnailPicker modal.
   *  Seulement visible si item.type === 'video' && source === 'upload'. */
  onPickThumbnail: () => void;
}

/**
 * Phase 9.5 c14 BUG3 — preview thumbnail vidéo avec fallback chain.
 *
 * YouTube : tente hqdefault → mqdefault → default (certaines vidéos n'ont pas
 * de hqdefault → 404 → onError walk la chaîne avant fallback Video icon).
 * Vimeo/Drive : chain vide → directement Video icon (pas de thumbnail public).
 */
/**
 * BUG #61 — Barre de progression upload réutilisée dans MediaManager.
 *
 * - Track : bg-white/10 (sur fond zinc accord avec charte stricte)
 * - Fill : bg-accent (#D91CD2) avec transition douce
 * - Label : pourcentage à droite, monospace pour stabilité visuelle
 * - Pour 0% on n'affiche pas encore 0% explicite (le spinner Loader2 suffit)
 *
 * Pas de dépendance shadcn Progress car ce composant n'est pas encore importé
 * dans le bundle MediaManager — un simple div bar suffit (charte stricte
 * black / #D91CD2 / white).
 */
function UploadProgressBar({ value }: { value: number }) {
  const { t } = useLanguage();
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-150 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t('media_manager_upload_progress')}
        />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-white/70 w-9 text-right">
        {pct}%
      </span>
    </div>
  );
}

function SortableVideoThumb({ item }: { item: MediaItem }) {
  // Hooks first (rules of hooks). useState DOIT être appelé avant tout early-return.
  const chain = getVideoThumbnailChain(item);
  const [idx, setIdx] = useState(0);

  // Fix #122 — Si une miniature custom existe (frame capturée par le partner),
  // on la prend en priorité. getVideoThumbnailChain renvoie déjà [thumbnailUrl]
  // en premier mais cet override court-circuite aussi le code "uploaded video"
  // qui affiche la 1ère frame du <video> via preload="metadata".
  if (item.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.thumbnailUrl}
        alt=""
        className="h-full w-full object-cover"
      />
    );
  }

  // BUG #62 — Régression "icône caméra sans aperçu" sur la row UPLOAD du modal
  // partner. Cause : `getVideoThumbnailChain` ne renvoie de thumbnails que pour
  // YouTube/Drive (provider-specific). Pour une vidéo uploadée vers Firebase
  // Storage, la chain est vide → exhausted=true immédiatement → fallback icône
  // Video. Fix : si `source === 'upload'` (ou URL Storage), on rend un
  // <video preload="metadata"> à mute/playsInline, qui affiche la première
  // frame comme thumbnail sans charger toute la vidéo. Pattern aligné
  // CardMediaSlide / MediaCarousel (BUG #60).
  const isUploadedVideo =
    item.source === 'upload' || /firebasestorage\.(googleapis\.com|app)/i.test(item.url || '');
  if (isUploadedVideo && item.url) {
    // BUG #102 — Régression aperçu vidéo après fix #62. Cause racine : Firebase
    // Storage signe les URLs avec un token + headers spécifiques. `preload="metadata"`
    // récupérait moins d'octets que nécessaire pour décoder la 1ère frame sur
    // certains navigateurs (Safari iOS notamment). Fix : ajouter `#t=0.1` (Media
    // Fragments W3C) qui force le seek à 0.1s à l'init → la 1ère frame
    // s'affiche garantie. `preload="auto"` complète au cas où.
    const srcWithFragment = item.url.includes('#') ? item.url : `${item.url}#t=0.1`;
    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={srcWithFragment}
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-cover pointer-events-none"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
          <Video className="h-4 w-4 text-white" />
        </span>
      </>
    );
  }

  const exhausted = idx >= chain.length;

  if (exhausted) {
    return <Video className="h-5 w-5 text-accent" />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={chain[idx]}
        alt=""
        className="h-full w-full object-cover"
        loading="eager"
        onError={() => setIdx((i) => i + 1)}
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
        <Video className="h-4 w-4 text-white" />
      </span>
    </>
  );
}

function SortableItem({ id, item, index, onRemove, onReplace, onPickThumbnail }: SortableItemProps) {
  const { t } = useLanguage();
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
        aria-label={t('media_manager_reorder_item', { num: index + 1 })}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Preview — c10.A + c14 BUG3 : chaîne hq → mq → default fallback (certaines
          vidéos retournent 404 sur hqdefault.jpg, on tente mq puis default avant
          de fallback sur l'icône Video). */}
      <div className="h-12 w-12 shrink-0 rounded overflow-hidden bg-zinc-800 flex items-center justify-center relative">
        {isVideo ? (
          <SortableVideoThumb item={item} />
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
            <Badge className="bg-accent/15 border-accent/40 text-accent text-[9px] uppercase tracking-wider">
              {t('media_manager_primary')}
            </Badge>
          )}
          {isVideo && item.provider && (
            <Badge className="bg-zinc-800 border-zinc-700 text-zinc-400 text-[9px] uppercase tracking-wider">
              {item.provider}
            </Badge>
          )}
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            {item.source === 'upload' ? t('media_manager_source_upload') : t('media_manager_source_url')}
          </span>
        </div>
        <span className="text-xs text-white/60 truncate font-mono" title={item.url}>
          {item.url}
        </span>
      </div>

      {/* Fix #122 — Bouton "Choisir miniature" (vidéos uploadées uniquement).
          Ouvre VideoThumbnailPicker — scrub la vidéo et capture une frame
          comme thumbnailUrl. Indicateur visuel (point accent) si une miniature
          custom est déjà définie. */}
      {item.source === 'upload' && item.type === 'video' && (
        <button
          type="button"
          onClick={onPickThumbnail}
          className="relative p-1.5 text-white/40 hover:text-accent transition-colors"
          aria-label={t('media_manager_pick_thumbnail_aria')}
          title={t('media_manager_pick_thumbnail_title')}
        >
          <Camera className="h-4 w-4" />
          {item.thumbnailUrl && (
            <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent" />
          )}
        </button>
      )}

      {/* BUG #102 — Bouton Remplacer (uploads uniquement). Pour les médias
          ajoutés via URL (YouTube, Drive, etc.), pas de bouton — l'utilisateur
          supprime puis re-colle l'URL. Pour les uploads Firebase Storage, le
          bouton ouvre un file picker et remplace l'item à index in-place
          (préserve l'ordre + le badge Principale si index === 0). */}
      {item.source === 'upload' && (
        <button
          type="button"
          onClick={onReplace}
          className="p-1.5 text-white/40 hover:text-accent transition-colors"
          aria-label={t('media_manager_replace_file')}
          title={t('media_manager_replace_file')}
        >
          <RefreshCcw className="h-4 w-4" />
        </button>
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
        aria-label={t('media_manager_delete')}
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
  const { t } = useLanguage();
  const [uploading, setUploading] = useState(false);
  // BUG #61 — Progress upload exposé par uploadBytesResumable (0..1). Affiché
  // dans la zone d'upload (empty state) OU au-dessus des boutons (liste non vide).
  const [uploadProgress, setUploadProgress] = useState(0);
  // BUG #61 — Nom du fichier en cours d'upload, affiché à côté de la barre
  // pour donner du contexte (ex. "ma-video.mp4 — 42%").
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [urlDialog, setUrlDialog] = useState<
    | { open: false }
    | { open: true; type: 'image' | 'video'; value: string }
  >({ open: false });
  // Fix #122 — Index de l'item vidéo en cours de sélection thumbnail (-1 si fermé)
  const [thumbnailPickerIndex, setThumbnailPickerIndex] = useState<number>(-1);

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

  /**
   * BUG #102 — Remplacer le fichier d'un item uploadé existant.
   *
   * Pipeline : ouvre un <input type="file"> programmatique → user pick →
   * upload via uploadActivityMedia → remplace l'URL + type + source dans le
   * slot `index` sans toucher l'ordre. Le badge Principale (index === 0)
   * reste donc en place. Si l'upload échoue, on conserve l'ancien item
   * (no-op) + toast d'erreur.
   *
   * Pourquoi pas un Dialog ? Le file picker natif est plus rapide + ne
   * nécessite pas de nouveau composant. Le UX reste cohérent avec
   * "Uploader image ou vidéo" du bas de la liste.
   */
  const handleReplace = (index: number) => {
    if (disabled || uploading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploading(true);
      setUploadProgress(0);
      setUploadingName(file.name);
      try {
        const result = await uploadActivityMedia(file, partnerId, {
          onProgress: (ratio) => setUploadProgress(ratio),
        });
        // Remplace in-place sans muter l'array d'origine
        onChange(
          value.map((it, i) =>
            i === index
              ? { url: result.url, type: result.kind, source: 'upload' as const }
              : it,
          ),
        );
        toast({
          title: t('media_manager_replaced_title'),
          description: result.kind === 'video' ? t('media_manager_video_updated') : t('media_manager_image_updated'),
          className: 'bg-zinc-900 border-accent/40 text-white',
        });
      } catch (err) {
        // BUG #106 — Log enrichi avec le code Firebase + message contextuel
        // pour l'utilisateur (vs ancien "Erreur upload" générique). Code
        // 'invalid-content-type' : la rule storage ne permet pas ce contentType
        // (ex: vidéo sur un path images-only). 'file-too-large' : > maxBytes.
        // 'upload-failed' : autre raison (rules deny, réseau, etc.).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const code = (err as any)?.code || 'unknown';
        console.error('[MediaManager] replace failed', { code, err });
        let description = t('media_manager_upload_retry_err');
        if (err instanceof StorageUploadError) {
          if (err.code === 'file-too-large') {
            const max = (err.details as { max?: number; mb?: string })?.max;
            const mb = max ? Math.round(max / 1024 / 1024) : 50;
            description = t('media_manager_err_file_too_large', { mb });
          } else if (err.code === 'invalid-content-type') {
            description = t('media_manager_err_invalid_format');
          } else if (err.code === 'upload-failed') {
            description = t('media_manager_err_upload_failed');
          }
        } else if (err instanceof Error) {
          description = err.message;
        }
        toast({
          variant: 'destructive',
          title: t('media_manager_replace_impossible'),
          description,
        });
      } finally {
        setUploading(false);
        setUploadProgress(0);
        setUploadingName(null);
      }
    };
    input.click();
  };

  const canAddMore = value.length < maxItems;

  // BUG #54 — refactor : handler core qui prend un File direct, réutilisé
  // par <input type=file> ET le drag-drop natif sur la zone empty state.
  const processFile = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadingName(file.name);
    try {
      const result = await uploadActivityMedia(file, partnerId, {
        // BUG #61 — ratio 0..1 surfacé par uploadBytesResumable. setState
        // chaque fois → barre de progression UI temps réel pendant l'upload.
        onProgress: (ratio) => setUploadProgress(ratio),
      });
      // BUG #51 — kind ('image' ou 'video') auto-détecté par uploadActivityMedia
      // depuis file.type. type MediaItem suit, donc card carousel choisit
      // automatiquement <img> ou <video> selon le rendu.
      onChange([
        ...value,
        { url: result.url, type: result.kind, source: 'upload' },
      ]);
      toast({
        title: result.kind === 'video' ? t('media_manager_video_uploaded') : t('media_manager_image_uploaded'),
        description: result.kind === 'video'
          ? t('media_manager_video_added_desc')
          : t('media_manager_image_added_desc'),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      const code =
        err instanceof StorageUploadError
          ? err.code
          : err instanceof Error
            ? err.message
            : 'unknown';
      const details = err instanceof StorageUploadError ? err.details : null;
      const maxMb = details && typeof details.max === 'number'
        ? Math.round((details.max as number) / 1024 / 1024)
        : MAX_SIZE_MB;
      const description =
        code === 'file-too-large'
          ? t('media_manager_err_file_too_big', { mb: maxMb })
          : code === 'invalid-content-type'
            ? t('media_manager_err_format_unsupported')
            : t('media_manager_err_upload_code', { code });
      toast({
        title: t('media_manager_upload_error'),
        description,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadingName(null);
    }
  };

  // Wrapper pour le <input type="file"> — extrait File puis appelle processFile.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    // Reset input pour permettre re-upload du même fichier
    e.target.value = '';
  };

  // BUG #54 — handler drag&drop natif sur la zone empty state.
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!canAddMore || disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
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
      toast({ title: t('media_manager_url_empty_title'), description: t('media_manager_url_empty_desc'), variant: 'destructive' });
      return;
    }
    if (urlDialog.type === 'image') {
      // Heuristique extension-based
      if (!isImageUrl(trimmed) && !confirm(t('media_manager_url_image_confirm'))) {
        return;
      }
      onChange([...value, { url: trimmed, type: 'image', source: 'url' }]);
      setUrlDialog({ open: false });
    } else {
      const parsed = parseVideoUrl(trimmed);
      if (!parsed) {
        toast({
          title: t('media_manager_url_video_invalid_title'),
          description: t('media_manager_url_video_invalid_desc'),
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
    // BUG #7 — min-w-0 : sans ça, le contenu de MediaManager (cards médias) peut
    // imposer un min-content > largeur de cellule → débordement à droite par
    // rapport aux inputs du modal /partner/offers. min-w-0 laisse le bloc se
    // contracter à la largeur de sa cellule grille (truncate/wrap interne prend le relais).
    <div className="flex flex-col gap-3 min-w-0">
      <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center justify-between gap-2">
        <span className="min-w-0">{t('media_manager_photos_videos_label', { current: value.length, max: maxItems })}</span>
        {value.length > 0 && (
          <span className="text-[10px] text-white/40 normal-case tracking-normal text-right min-w-0">
            {t('media_manager_drag_to_reorder')}
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
                  onReplace={() => handleReplace(i)}
                  onPickThumbnail={() => setThumbnailPickerIndex(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        // BUG #54 — Zone Drag & Drop avec icône cloud + texte explicite.
        // Clic sur la zone → ouvre file picker (label autour input hidden).
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (canAddMore && !disabled && !uploading) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-3 p-8 text-center cursor-pointer transition-all ${
            isDragOver
              ? 'border-accent bg-accent/10'
              : canAddMore && !disabled && !uploading
                ? 'border-white/20 bg-zinc-900/30 hover:border-accent/40 hover:bg-accent/5'
                : 'border-white/10 bg-zinc-900/20 cursor-not-allowed'
          }`}
        >
          {uploading ? (
            <Loader2 className="h-10 w-10 text-accent animate-spin" />
          ) : (
            <UploadCloud className="h-10 w-10 text-accent/70" />
          )}
          <div className="flex flex-col gap-1 w-full max-w-[260px]">
            {uploading ? (
              // BUG #61 — État upload : remplace le placeholder par la barre
              // de progression + nom fichier + % en cours.
              <>
                <p
                  className="text-sm font-medium text-white truncate"
                  title={uploadingName ?? undefined}
                >
                  {uploadingName ?? t('media_manager_upload_in_progress')}
                </p>
                <UploadProgressBar value={uploadProgress} />
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-white">
                  {t('media_manager_drop_or_browse')}
                </p>
                <p className="text-[11px] text-white/40">
                  {t('media_manager_size_limits')}
                </p>
              </>
            )}
          </div>
          <input
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            onChange={handleFileUpload}
            disabled={!canAddMore || disabled || uploading}
            className="hidden"
          />
        </label>
      )}

      {/* BUG #61 — Quand la liste a déjà des items, l'empty state n'est plus
          rendu → on affiche la progress bar ici, au-dessus des boutons d'action. */}
      {uploading && value.length > 0 && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-3 flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-accent animate-spin shrink-0" />
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <p
              className="text-xs font-medium text-white truncate"
              title={uploadingName ?? undefined}
            >
              {uploadingName ?? t('media_manager_upload_in_progress')}
            </p>
            <UploadProgressBar value={uploadProgress} />
          </div>
        </div>
      )}

      {/* Action buttons — BUG #54 : un seul bouton principal "Uploader" qui accepte
          image OU vidéo (handleFileUpload détecte le type via file.type). Un petit
          lien discret en dessous pour ajouter via URL externe. */}
      <div className="flex flex-wrap gap-2">
        {/* Bouton principal unique : upload image OU vidéo (handleFileUpload détecte). */}
        <label
          className={`inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm cursor-pointer transition-colors flex-1 justify-center min-w-[140px] ${
            canAddMore && !disabled && !uploading
              ? 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/20'
              : 'border-white/10 text-white/30 cursor-not-allowed'
          }`}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
          {t('media_manager_upload_button')}
          <input
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            onChange={handleFileUpload}
            disabled={!canAddMore || disabled || uploading}
            className="hidden"
          />
        </label>
      </div>
      {/* Liens URL discrets en dessous (image / vidéo via URL externe) */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-white/40 pt-1">
        <button
          type="button"
          onClick={handleAddImageUrl}
          disabled={!canAddMore || disabled || uploading}
          className="hover:text-accent transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <LinkIcon className="h-3 w-3" />
          {t('media_manager_add_image_url')}
        </button>
        <span className="text-white/20">·</span>
        <button
          type="button"
          onClick={handleAddVideoUrl}
          disabled={!canAddMore || disabled || uploading}
          className="hover:text-accent transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Video className="h-3 w-3" />
          {t('media_manager_add_video_url')}
        </button>
      </div>

      {!canAddMore && (
        <p className="text-[11px] text-amber-300/70">
          {t('media_manager_limit_reached', { max: maxItems })}
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
                  <ImagePlus className="h-5 w-5 text-accent" />
                  {t('media_manager_add_image_dialog_title')}
                </>
              ) : (
                <>
                  <Video className="h-5 w-5 text-accent" />
                  {t('media_manager_add_video_dialog_title')}
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-white/60 text-sm">
              {urlDialog.open && urlDialog.type === 'video'
                ? t('media_manager_add_video_dialog_desc')
                : t('media_manager_add_image_dialog_desc')}
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
              {t('common_cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleConfirmUrl}
              className="bg-accent hover:bg-accent/90 text-white"
            >
              {t('media_manager_add_button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix #122 — Modal de sélection miniature vidéo (frame picker). */}
      {thumbnailPickerIndex >= 0 && value[thumbnailPickerIndex] && (
        <VideoThumbnailPicker
          open={thumbnailPickerIndex >= 0}
          onOpenChange={(open) => {
            if (!open) setThumbnailPickerIndex(-1);
          }}
          videoUrl={value[thumbnailPickerIndex].url}
          partnerId={partnerId}
          onThumbnailSaved={(thumbnailUrl) => {
            // Met à jour l'item à l'index courant avec la nouvelle thumbnailUrl
            const next = [...value];
            next[thumbnailPickerIndex] = {
              ...next[thumbnailPickerIndex],
              thumbnailUrl,
            };
            onChange(next);
          }}
        />
      )}
    </div>
  );
}
