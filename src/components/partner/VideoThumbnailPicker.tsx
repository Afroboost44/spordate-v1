/**
 * Fix #122 — VideoThumbnailPicker (refonte UX "façon Instagram").
 *
 * Modal qui permet au partenaire de choisir la miniature d'une vidéo uploadée
 * (= image affichée sur les cards listing/recherche/aperçu). 3 sources, un
 * SEUL chemin d'upload (uploadThumbnailBlob) :
 *
 *   1. Rangée de 5 frames pré-extraites (0/25/50/75/~98 % de la durée).
 *      Clic sur une frame → seek le grand player à ce timestamp + highlight.
 *   2. Grand player central (scrub / play / pause) = aperçu de la frame pointée.
 *   3. Scrubber horizontal sous le player pour cibler une frame précise.
 *   4. "Capturer cette frame" → canvas.drawImage → blob → Firebase Storage.
 *   5. "Sélectionner depuis l'ordinateur" → file picker image (jpg/png) →
 *      upload direct comme miniature.
 *
 * La source active est HIGHLIGHTÉE (bordure accent #D91CD2 + check).
 *
 * Anti-régression : "Capturer cette frame" + l'upload Firebase Storage gardent
 * EXACTEMENT le comportement d'avant (même path, même pipeline canvas). Le clic
 * sur une des 5 frames ne fait que seek + highlight ; la sauvegarde repasse par
 * le même pipeline canvas → mêmes garanties.
 *
 * Extraction des 5 frames = 100 % CÔTÉ CLIENT (canvas, <video> offscreen sur le
 * proxy /api/proxy-video pour CORS). Aucun endpoint serveur.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Camera, Play, Pause, Check, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/context/LanguageContext';
import { uploadThumbnailBlob } from '@/lib/storage/uploadThumbnail';

interface VideoThumbnailPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** URL de la vidéo (Firebase Storage download URL). Doit être un upload mp4/webm. */
  videoUrl: string;
  /** Path Firebase Storage pour stocker la thumbnail (ex: partners/{id}/activities/thumbnails/). */
  partnerId: string;
  /** Callback appelé avec l'URL publique de la thumbnail uploadée. */
  onThumbnailSaved: (thumbnailUrl: string) => void;
}

/** Frame pré-extraite : timestamp + aperçu base64 (qualité légère, preview only). */
interface ExtractedFrame {
  time: number;
  dataUrl: string;
}

/** Fractions de la durée auxquelles on extrait les 5 frames suggérées. */
const FRAME_FRACTIONS = [0, 0.25, 0.5, 0.75, 0.98];
/** Tolérance (s) pour considérer une frame suggérée comme "celle pointée". */
const FRAME_MATCH_TOLERANCE = 0.35;

export function VideoThumbnailPicker({
  open,
  onOpenChange,
  videoUrl,
  partnerId,
  onThumbnailSaved,
}: VideoThumbnailPickerProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Fix UX — préchargement vidéo. `isVideoReady` passe à true sur onLoadedData
  // (premier frame décodé, prêt à drawImage). Avant ça, on affiche un loader
  // par-dessus la <video> et on désactive le bouton Capturer + le slider.
  const [isVideoReady, setIsVideoReady] = useState(false);

  // Refonte Instagram — frames suggérées + source active.
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  // Source active de la miniature : 'video' (frame du player, mini ou scrub) ou
  // 'upload' (image choisie depuis l'ordinateur). Détermine le bouton d'action.
  const [activeKind, setActiveKind] = useState<'video' | 'upload'>('video');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const computerInputRef = useRef<HTMLInputElement>(null);

  // Reset state quand modal s'ouvre/ferme
  useEffect(() => {
    if (!open) {
      setIsPlaying(false);
      setCurrentTime(0);
      setSaving(false);
      setLoadError(null);
      setIsVideoReady(false);
      setFrames([]);
      setFramesLoading(false);
      setActiveKind('video');
      setUploadFile(null);
      setUploadPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fix vidéo qui ne joue pas (CORS Firebase Storage) :
  // Utilise directement /api/proxy-video comme src de la vidéo. Avantages :
  //   - Streaming progressif (pas d'attente du download entier)
  //   - <video> joue immédiatement (same-origin)
  //   - canvas.drawImage marche car src est sur le même domaine
  useEffect(() => {
    if (!open || !videoUrl) {
      setBlobUrl(null);
      return;
    }
    setLoadError(null);
    setIsVideoReady(false);
    // Utilise l'URL proxy directement — pas de fetch+blob.
    const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`;
    setBlobUrl(proxyUrl);
  }, [open, videoUrl]);

  // ── Extraction des 5 frames suggérées (100 % client, <video> offscreen) ──
  // Déclenchée une fois la durée connue + premier frame prêt. Un élément
  // <video> dédié (offscreen) seek séquentiellement aux 5 timestamps et
  // capture chaque frame dans un canvas → dataUrl (qualité légère pour preview).
  // On NE touche PAS au player visible (pas de flicker de scrub).
  useEffect(() => {
    if (!open || !blobUrl || !isVideoReady || duration <= 0) return;
    if (!Number.isFinite(duration)) return;
    if (frames.length > 0 || framesLoading) return;

    let cancelled = false;
    setFramesLoading(true);

    const video = document.createElement('video');
    video.src = blobUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const canvas = document.createElement('canvas');
    const collected: ExtractedFrame[] = [];

    // Cibles de seek dédupliquées. Sur une vidéo très courte, plusieurs
    // fractions retombent sur le même temps (après clamp à [0.05, duration-0.05]).
    // Or seek vers le temps courant ne déclenche PAS `seeked` → l'extraction se
    // bloquerait. On déduplique donc (epsilon 0.02s) → pas de stall.
    const maxT = Math.max(0.05, duration - 0.05);
    const targets: number[] = [];
    for (const f of FRAME_FRACTIONS) {
      const tgt = Math.min(Math.max(0.05, duration * f), maxT);
      if (!targets.some((prev) => Math.abs(prev - tgt) < 0.02)) targets.push(tgt);
    }

    // Watchdog : si une frame ne se décode jamais (codec exotique, seek bloqué),
    // on finalise au bout de 12s avec ce qui a été collecté → pas de shimmer
    // infini. Le scrub + la capture restent disponibles indépendamment.
    let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      finish();
    }, 12000);

    const clearWatchdog = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const finish = () => {
      if (cancelled) return;
      clearWatchdog();
      setFrames(collected);
      setFramesLoading(false);
      cleanup();
    };

    const cleanup = () => {
      clearWatchdog();
      video.onseeked = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* noop */
      }
    };

    type FrameMeta = { mediaTime: number };

    // Seek vers un temps précis + attend l'event `seeked`. Garde-fou 1.5s.
    const seekTo = (time: number): Promise<void> =>
      new Promise((resolve) => {
        let done = false;
        const settle = () => {
          if (done) return;
          done = true;
          video.removeEventListener('seeked', settle);
          resolve();
        };
        video.addEventListener('seeked', settle);
        video.currentTime = time;
        setTimeout(settle, 1500);
      });

    // FIX #207 — l'event `seeked` se déclenche AVANT que la frame cible soit
    // décodée et peinte → drawImage capturait la frame précédente (toutes
    // identiques à la 1ère). On attend la présentation EFFECTIVE de la frame :
    //   1. video.requestVideoFrameCallback (Chrome/Edge/Safari récents) = signal
    //      exact + metadata.mediaTime = temps RÉEL de la frame présentée
    //   2. fallback double requestAnimationFrame (layout puis paint)
    //   3. garde-fou 1.5s pour ne jamais bloquer l'extraction
    // Retourne le mediaTime présenté (ou null si rvfc indispo / timeout).
    const waitForPaintedFrame = (): Promise<number | null> =>
      new Promise((resolve) => {
        let done = false;
        const settle = (mediaTime: number | null) => {
          if (done) return;
          done = true;
          resolve(mediaTime);
        };
        const rvfc = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback?: (
              cb: (now: number, metadata: FrameMeta) => void,
            ) => number;
          }
        ).requestVideoFrameCallback;
        if (typeof rvfc === 'function') {
          rvfc.call(video, (_now, metadata) =>
            settle(metadata?.mediaTime ?? null),
          );
        } else {
          requestAnimationFrame(() => requestAnimationFrame(() => settle(null)));
        }
        setTimeout(() => settle(null), 1500);
      });

    const captureFrame = (idx: number) => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        // ACTION 1 — diagnostic enrichi. actualTime stuck à 0 + buffered
        // 'none'/0-x sans avancer = proxy ne supporte pas les Range requests
        // (pas de 206) → seek impossible en prod.
        // eslint-disable-next-line no-console
        console.log('frame extracted', {
          idx,
          target: targets[idx],
          actualTime: video.currentTime,
          readyState: video.readyState,
          duration: video.duration,
          networkState: video.networkState,
          buffered:
            video.buffered.length > 0
              ? `${video.buffered.start(0)}-${video.buffered.end(0)}`
              : 'none',
        });
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        collected.push({
          time: video.currentTime,
          dataUrl: canvas.toDataURL('image/jpeg', 0.6),
        });
      } catch {
        /* frame skip (tainted/decode) — on continue */
      }
    };

    // Boucle séquentielle promise-based (remplace la récursion onseeked qui
    // souffrait de ré-entrance sur le retry).
    const run = async () => {
      for (let idx = 0; idx < targets.length; idx++) {
        if (cancelled) {
          cleanup();
          return;
        }
        const target = targets[idx];
        await seekTo(target);
        let painted = await waitForPaintedFrame();

        // ACTION C — si la frame présentée ne correspond pas au target (le
        // décodeur a renvoyé une keyframe cachée / frame précédente), on
        // pousse le seek de +0.01s pour forcer un re-decode, puis on réessaie
        // UNE fois. mediaTime n'est dispo que via requestVideoFrameCallback.
        if (painted !== null && Math.abs(painted - target) > 0.4) {
          await seekTo(Math.min(target + 0.01, maxT));
          painted = await waitForPaintedFrame();
        }

        if (cancelled) {
          cleanup();
          return;
        }
        captureFrame(idx);
      }
      finish();
    };

    video.onloadeddata = () => {
      void run();
    };
    video.onerror = () => {
      // Échec extraction → pas de frames suggérées, mais scrub + capture OK.
      if (cancelled) return;
      setFramesLoading(false);
      cleanup();
    };

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, blobUrl, isVideoReady, duration]);

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
  };

  // onLoadedData = premier frame décodé et drawable (HAVE_CURRENT_DATA).
  const handleLoadedData = () => {
    setIsVideoReady(true);
  };

  const handleVideoError = () => {
    setIsVideoReady(false);
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const time = parseFloat(e.target.value);
    v.currentTime = time;
    setCurrentTime(time);
    // Scrubber = source vidéo → revient en mode 'video' (annule un éventuel
    // aperçu d'image uploadée).
    setActiveKind('video');
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    setActiveKind('video');
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  // Clic sur une des 5 frames suggérées → seek le player + mode vidéo + highlight.
  const handleSelectFrame = (frame: ExtractedFrame) => {
    const v = videoRef.current;
    setActiveKind('video');
    if (v) {
      v.pause();
      v.currentTime = frame.time;
    }
    setIsPlaying(false);
    setCurrentTime(frame.time);
  };

  // "Sélectionner depuis l'ordinateur" → file picker image (jpg/png).
  const handleComputerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-sélectionner le même fichier
    if (!file) return;
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
      toast({
        variant: 'destructive',
        title: t('vtp_toast_error_title'),
        description: t('vtp_err_invalid_image'),
      });
      return;
    }
    const v = videoRef.current;
    if (v) {
      v.pause();
    }
    setIsPlaying(false);
    setUploadFile(file);
    setUploadPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setActiveKind('upload');
  };

  // Upload commun (capture frame OU image ordi) via le helper partagé.
  const saveBlob = useCallback(
    async (blob: Blob, savedDescription: string) => {
      setSaving(true);
      try {
        const url = await uploadThumbnailBlob(blob, partnerId);
        toast({
          title: t('vtp_toast_saved_title'),
          description: savedDescription,
        });
        onThumbnailSaved(url);
        onOpenChange(false);
      } catch (err) {
        console.error('[VideoThumbnailPicker] save failed', err);
        toast({
          variant: 'destructive',
          title: t('vtp_toast_error_title'),
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setSaving(false);
      }
    },
    [partnerId, onThumbnailSaved, onOpenChange, toast, t],
  );

  // "Capturer cette frame" — comportement INCHANGÉ : draw frame courante du
  // player dans le canvas → blob JPEG 0.85 → upload Firebase → onThumbnailSaved.
  const handleCaptureFrame = async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    v.pause();
    setIsPlaying(false);

    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) {
      toast({
        variant: 'destructive',
        title: t('vtp_toast_error_title'),
        description: t('vtp_err_not_ready'),
      });
      return;
    }
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) {
      toast({
        variant: 'destructive',
        title: t('vtp_toast_error_title'),
        description: t('vtp_err_canvas'),
      });
      return;
    }
    ctx.drawImage(v, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) => {
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        0.85,
      );
    });

    await saveBlob(blob, t('vtp_toast_saved_frame_desc', { time: currentTime.toFixed(1) }));
  };

  // "Enregistrer la photo" — upload de l'image choisie depuis l'ordinateur.
  const handleSaveUpload = async () => {
    if (!uploadFile) return;
    await saveBlob(uploadFile, t('vtp_toast_saved_photo_desc'));
  };

  const handlePrimaryAction = () => {
    if (activeKind === 'upload') {
      void handleSaveUpload();
    } else {
      void handleCaptureFrame();
    }
  };

  const primaryDisabled =
    saving ||
    (activeKind === 'upload'
      ? !uploadFile
      : !duration || !isVideoReady);

  // Une frame suggérée est "sélectionnée" si on est en mode vidéo et que le
  // temps courant correspond (tolérance) à son timestamp.
  const isFrameSelected = (frame: ExtractedFrame) =>
    activeKind === 'video' &&
    Math.abs(currentTime - frame.time) <= FRAME_MATCH_TOLERANCE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-white/10 max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-white font-light">{t('vtp_title')}</DialogTitle>
          <DialogDescription className="text-white/50 text-sm">
            {t('vtp_desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
          {/* ── Rangée de 5 frames suggérées (façon Instagram) ── */}
          {(framesLoading || frames.length > 0) && (
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-white/40">
                {framesLoading ? t('vtp_extracting_frames') : t('vtp_suggested_frames')}
              </span>
              <div className="grid grid-cols-5 gap-2">
                {framesLoading && frames.length === 0
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="aspect-video rounded-md bg-zinc-800/80 animate-pulse"
                      />
                    ))
                  : frames.map((frame, index) => {
                      const selected = isFrameSelected(frame);
                      return (
                        <button
                          key={`frame-${index}`}
                          type="button"
                          onClick={() => handleSelectFrame(frame)}
                          className={`group relative aspect-video rounded-md overflow-hidden border-2 transition-all ${
                            selected
                              ? 'border-accent ring-2 ring-accent/40'
                              : 'border-transparent hover:border-white/30'
                          }`}
                          aria-label={`${t('vtp_suggested_frames')} ${frame.time.toFixed(1)}s`}
                          aria-pressed={selected}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={frame.dataUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                          {/* ACTION B — badge timestamp : l'user voit qu'il
                              choisit un INSTANT (0s, 5s, 10s…), même si la
                              vidéo est statique et les images se ressemblent. */}
                          <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                            {frame.time < 1
                              ? `${Math.round(frame.time * 1000)}ms`
                              : `${Math.round(frame.time)}s`}
                          </span>
                          {selected && (
                            <span className="absolute top-1 right-1 flex items-center justify-center h-4 w-4 rounded-full bg-accent">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </span>
                          )}
                        </button>
                      );
                    })}
              </div>
            </div>
          )}

          {/* "Sélectionner depuis l'ordinateur" */}
          <div>
            <input
              ref={computerInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleComputerSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => computerInputRef.current?.click()}
              disabled={saving}
              className={`w-full flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                activeKind === 'upload'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-white/15 text-white/70 hover:border-accent/50 hover:text-accent'
              }`}
            >
              {activeKind === 'upload' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t('vtp_from_computer')}
            </button>
          </div>

          {/* ── Grand player central : frame pointée OU aperçu image uploadée ── */}
          <div className="relative bg-black rounded-md overflow-hidden min-h-[200px]">
            {!blobUrl && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> {t('video_loading')}
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-sm px-4 text-center">
                {t('vtp_play_unavailable')} {loadError}
                <span className="text-white/40 mt-1">{t('vtp_check_expired')}</span>
              </div>
            )}
            {blobUrl && (
              <video
                ref={videoRef}
                src={blobUrl}
                playsInline
                // preload=metadata : durée + dimensions + 1er frame seulement.
                preload="metadata"
                onLoadedMetadata={handleLoadedMetadata}
                onLoadedData={handleLoadedData}
                onError={handleVideoError}
                onTimeUpdate={handleTimeUpdate}
                onClick={isVideoReady && activeKind === 'video' ? togglePlay : undefined}
                onEnded={() => setIsPlaying(false)}
                className={`w-full max-h-[400px] object-contain ${
                  activeKind === 'video' ? 'cursor-pointer' : 'opacity-0'
                }`}
              />
            )}
            {/* Aperçu image uploadée (par-dessus le player) */}
            {activeKind === 'upload' && uploadPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadPreview}
                alt=""
                className="absolute inset-0 h-full w-full object-contain bg-black"
              />
            )}
            {/* Loader chargement vidéo — visible tant que premier frame pas prêt */}
            {blobUrl && !isVideoReady && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white/80 text-sm z-10">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> {t('video_loading')}
              </div>
            )}
            {/* Overlay play/pause — uniquement en mode vidéo, vidéo prête */}
            {isVideoReady && activeKind === 'video' && (
              <button
                type="button"
                onClick={togglePlay}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 rounded-full p-4 transition-colors"
                aria-label={isPlaying ? t('vtp_pause') : t('vtp_play')}
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6 text-white" />
                ) : (
                  <Play className="h-6 w-6 text-white" />
                )}
              </button>
            )}
          </div>

          {/* ── Scrubber (timeline) ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-white/50 font-mono">
              <span>{currentTime.toFixed(1)}s</span>
              <span>{duration > 0 ? `${duration.toFixed(1)}s` : '--'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={activeKind === 'video' ? currentTime : 0}
              onChange={handleSeek}
              className="w-full accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!duration || !isVideoReady}
              title={!isVideoReady ? t('vtp_video_loading_title') : undefined}
            />
            <p className="text-[11px] text-white/30">{t('vtp_scrub_hint')}</p>
          </div>

          {/* Canvas hidden — drawImage + toBlob uniquement */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-white/10 text-white/70"
          >
            {t('vtp_cancel')}
          </Button>
          <Button
            type="button"
            onClick={handlePrimaryAction}
            disabled={primaryDisabled}
            title={
              activeKind === 'video' && !isVideoReady
                ? t('vtp_video_loading_title')
                : undefined
            }
            className="bg-accent hover:bg-accent/90 text-white"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />{' '}
                {activeKind === 'upload' ? t('vtp_saving') : t('vtp_capturing')}
              </>
            ) : activeKind === 'upload' ? (
              <>
                <Check className="h-4 w-4 mr-2" /> {t('vtp_save_photo')}
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" /> {t('vtp_capture_frame')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
