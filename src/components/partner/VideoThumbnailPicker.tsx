/**
 * Fix #122 — VideoThumbnailPicker.
 *
 * Modal qui permet au partenaire de choisir la frame d'une vidéo uploadée
 * comme miniature (= image qui apparaît sur les cards d'aperçu, listing,
 * recherche). Pattern :
 *   1. <video> en haut, lecture/pause au clic
 *   2. Range slider sous la vidéo (currentTime in seconds)
 *   3. Bouton "Capturer cette frame" → canvas.drawImage → blob → upload
 *      Firebase Storage → setItem.thumbnailUrl
 *
 * Anti-régression : les vidéos déjà uploadées sans thumbnailUrl gardent leur
 * fallback actuel (chain YouTube/Vimeo/Drive, ou première frame). Ce picker
 * est OPTIONNEL — le partenaire peut choisir de ne pas en définir une.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Camera, Play, Pause } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/context/LanguageContext';

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

  // Reset state quand modal s'ouvre/ferme
  useEffect(() => {
    if (!open) {
      setIsPlaying(false);
      setCurrentTime(0);
      setSaving(false);
      setLoadError(null);
      setIsVideoReady(false);
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

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
  };

  // onLoadedData = premier frame décodé et drawable (HAVE_CURRENT_DATA).
  // C'est l'instant où canvas.drawImage(v) renvoie une image valide → on
  // active le slider + le bouton Capturer.
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
    const t = parseFloat(e.target.value);
    v.currentTime = t;
    setCurrentTime(t);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const handleCapture = async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    setSaving(true);
    try {
      // Pause la vidéo pour figer la frame courante
      v.pause();
      setIsPlaying(false);

      // Draw frame courante dans canvas
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) {
        throw new Error('Vidéo pas encore prête, attendez quelques secondes.');
      }
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas non disponible');
      ctx.drawImage(v, 0, 0, w, h);

      // Convert canvas → blob JPEG (qualité 0.85, balance taille/qualité)
      const blob: Blob = await new Promise((resolve, reject) => {
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          'image/jpeg',
          0.85,
        );
      });

      // Upload Firebase Storage
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import(
        'firebase/storage'
      );
      const firebaseModule = await import('@/lib/firebase');
      const app = firebaseModule.default;
      if (!app) throw new Error('Firebase non initialisé');
      const storage = getStorage(app);
      const ts = Date.now();
      const filename = `thumb-${ts}.jpg`;
      const storageRef = ref(
        storage,
        `partners/${partnerId}/activities/thumbnails/${filename}`,
      );
      await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(storageRef);

      toast({
        title: 'Miniature enregistrée',
        description: `Frame à ${currentTime.toFixed(1)}s capturée et sauvegardée.`,
      });
      onThumbnailSaved(url);
      onOpenChange(false);
    } catch (err) {
      console.error('[VideoThumbnailPicker] capture failed', err);
      toast({
        variant: 'destructive',
        title: 'Erreur capture',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-white/10 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white font-light">
            Choisir la miniature de la vidéo
          </DialogTitle>
          <DialogDescription className="text-white/50 text-sm">
            Lance la vidéo, mets pause sur l&apos;instant que tu veux afficher,
            puis clique sur &laquo;&nbsp;Capturer&nbsp;&raquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video preview — crossOrigin anonymous obligatoire pour que canvas
              accepte de lire les pixels (Firebase Storage envoie CORS headers). */}
          <div className="relative bg-black rounded-md overflow-hidden min-h-[200px]">
            {!blobUrl && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Chargement de la vidéo…
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-sm px-4 text-center">
                Lecture impossible — {loadError}
                <span className="text-white/40 mt-1">Vérifie que la vidéo n&apos;a pas expiré.</span>
              </div>
            )}
            {blobUrl && (
              <video
                ref={videoRef}
                src={blobUrl}
                playsInline
                // preload=metadata : ne télécharge que durée + dimensions + 1er
                // frame, pas la vidéo entière. Évite l'écran noir de 10s+ sur
                // les vidéos lourdes (mp4 partner uploads).
                preload="metadata"
                onLoadedMetadata={handleLoadedMetadata}
                onLoadedData={handleLoadedData}
                onError={handleVideoError}
                onTimeUpdate={handleTimeUpdate}
                onClick={isVideoReady ? togglePlay : undefined}
                onEnded={() => setIsPlaying(false)}
                className="w-full max-h-[400px] object-contain cursor-pointer"
              />
            )}
            {/* Loader chargement vidéo — visible tant que premier frame pas prêt */}
            {blobUrl && !isVideoReady && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white/80 text-sm z-10">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> {t('video_loading')}
              </div>
            )}
            {/* Overlay play/pause au centre — masqué tant que vidéo pas prête */}
            {isVideoReady && (
              <button
                type="button"
                onClick={togglePlay}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 rounded-full p-4 transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Lire'}
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6 text-white" />
                ) : (
                  <Play className="h-6 w-6 text-white" />
                )}
              </button>
            )}
          </div>

          {/* Timeline scrub */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50 font-mono">
              <span>{currentTime.toFixed(1)}s</span>
              <span>{duration > 0 ? `${duration.toFixed(1)}s` : '--'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="w-full accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!duration || !isVideoReady}
              title={!isVideoReady ? 'Vidéo en cours de chargement' : undefined}
            />
          </div>

          {/* Canvas hidden — pas utilisé pour affichage, juste pour drawImage + toBlob */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-white/10 text-white/70"
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleCapture}
            disabled={saving || !duration || !isVideoReady}
            title={!isVideoReady ? 'Vidéo en cours de chargement' : undefined}
            className="bg-accent hover:bg-accent/90 text-white"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Capture…
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" /> Capturer cette frame
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
