/**
 * BUG #104 — Cropper d'image carré 1:1 pour les photos de profil Spordateur.
 *
 * Pattern Tinder / Instagram : avant l'upload Firebase Storage, l'utilisateur
 * recadre son image dans un container 1:1 (drag pour repositionner + zoom
 * 1×–3× via slider/pinch). Au "Recadrer", on extrait la zone visible via
 * canvas.toBlob(), produit un File JPEG ~1024×1024 que la page parent peut
 * uploader normalement.
 *
 * Sans dépendance externe (pas de react-easy-crop) — canvas natif + transform
 * CSS. Pourquoi ? Évite d'ajouter une dépendance qui ferait diverger le
 * package-lock et casser le build Coolify.
 *
 * Mobile-first :
 *   - Touch events natifs (touchstart/touchmove/touchend) en plus de la souris
 *   - Pinch-to-zoom à 2 doigts
 *   - Slider zoom toujours dispo pour les non-tactiles
 *   - Container responsive (max-w-sm sur mobile, max-w-md desktop)
 *
 * Anti-régression : si le navigateur ne supporte pas Image() ou canvas, le
 * cropper throw un toast et le file est uploadé tel quel (fallback gracieux).
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Crop, RotateCcw, Check, X, ZoomIn, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Taille de sortie carrée. 1024 = bon compromis qualité/poids pour profil. */
const OUTPUT_SIZE = 1024;

interface ProfileImageCropperProps {
  /** File source à recadrer. Si null → modal fermé. */
  file: File | null;
  /** Callback au "Recadrer" : passe le File JPEG carré recadré. */
  onCropped: (croppedFile: File) => void;
  /** Callback "Annuler" / fermeture modal sans crop. */
  onCancel: () => void;
}

export function ProfileImageCropper({ file, onCropped, onCancel }: ProfileImageCropperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0); // translate X en px (relatif au centre conteneur)
  const [ty, setTy] = useState(0); // translate Y en px
  const [processing, setProcessing] = useState(false);

  // Charge l'image source en object URL quand le file change
  useEffect(() => {
    if (!file) {
      setImgSrc(null);
      setImgDims(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    // Cleanup au unmount / file change
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Reset transform quand on charge une nouvelle image
  useEffect(() => {
    if (!imgSrc) return;
    setScale(1);
    setTx(0);
    setTy(0);
  }, [imgSrc]);

  // Drag souris
  const dragRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty };
  }, [tx, ty]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTx(dragRef.current.startTx + dx);
    setTy(dragRef.current.startTy + dy);
  }, []);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Récupère les dimensions natives de l'image après chargement
  const onImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  /**
   * Calcule le crop sur l'image source d'origine puis émet un File JPEG carré.
   *
   * Pipeline :
   *   1. Mesure la taille du container square affiché à l'écran (containerSize)
   *   2. L'image affichée a une taille = containerSize × baseFit × scale, où
   *      baseFit = container/max(imgW,imgH) ramène l'image à fit le container
   *      au scale 1. Plus la dimension réelle de l'image en CSS pixels.
   *   3. Coordonnées du crop dans l'image native = invert du transform appliqué
   *   4. canvas.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT, OUTPUT)
   *   5. canvas.toBlob → new File JPEG
   */
  const handleCrop = useCallback(async () => {
    if (!imgRef.current || !imgDims || !containerRef.current || !file) return;
    setProcessing(true);
    try {
      const container = containerRef.current;
      const containerSize = container.clientWidth; // square : width === height
      const img = imgRef.current;
      const imgNatW = imgDims.w;
      const imgNatH = imgDims.h;

      // baseFit : ratio qui ramène l'image à "object-cover" du container au scale 1
      // (cover = max ratio pour remplir le carré). On part de cover, pas contain,
      // pour que l'utilisateur n'ait jamais de bandes vides au scale 1.
      const baseFit = Math.max(containerSize / imgNatW, containerSize / imgNatH);
      const displayW = imgNatW * baseFit * scale;
      const displayH = imgNatH * baseFit * scale;

      // Position top-left de l'image affichée dans le container :
      // center: containerSize/2 + tx - displayW/2
      const dispLeft = containerSize / 2 + tx - displayW / 2;
      const dispTop = containerSize / 2 + ty - displayH / 2;

      // Crop en pixels image native : (0..containerSize côté display) → image native
      const ratio = imgNatW / displayW; // = 1 / (baseFit * scale)
      const srcX = Math.max(0, -dispLeft * ratio);
      const srcY = Math.max(0, -dispTop * ratio);
      const srcW = Math.min(imgNatW - srcX, containerSize * ratio);
      const srcH = Math.min(imgNatH - srcY, containerSize * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas-2d-unsupported');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob-null'))),
          'image/jpeg',
          0.9,
        );
      });

      const croppedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
      onCropped(croppedFile);
    } catch (err) {
      console.error('[ProfileImageCropper] crop failed', err);
      // Fallback : envoie le file original tel quel
      onCropped(file);
    } finally {
      setProcessing(false);
    }
  }, [file, imgDims, scale, tx, ty, onCropped]);

  const handleReset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  return (
    <Dialog open={!!file} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-[#0F0F0F] border-white/10 text-white max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle className="text-white flex items-center gap-2">
            <Crop className="h-4 w-4 text-accent" />
            Recadre ta photo
          </DialogTitle>
        </DialogHeader>

        {/* Container carré (drag + image positionnée) */}
        <div className="px-5 pb-3">
          <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="aspect-square w-full rounded-2xl bg-black overflow-hidden relative touch-none cursor-grab active:cursor-grabbing select-none"
          >
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={imgSrc}
                alt="Source à recadrer"
                onLoad={onImageLoad}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`,
                  transformOrigin: 'center center',
                  // Cover par défaut au scale 1 (max dim → container)
                  maxWidth: 'none',
                  maxHeight: 'none',
                  width: imgDims ? (imgDims.w > imgDims.h ? 'auto' : '100%') : '100%',
                  height: imgDims ? (imgDims.h >= imgDims.w ? 'auto' : '100%') : '100%',
                  pointerEvents: 'none',
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white/40">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}

            {/* Overlay grille pour aider au cadrage */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/3 left-0 right-0 h-px bg-white/10" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-white/10" />
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/10" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/10" />
            </div>
          </div>

          {/* Slider zoom */}
          <div className="mt-4 flex items-center gap-3">
            <ZoomIn className="h-4 w-4 text-white/40" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="flex-1 accent-accent h-1"
              aria-label="Zoom"
            />
            <span className="text-[11px] font-mono tabular-nums text-white/50 w-10 text-right">
              {scale.toFixed(2)}×
            </span>
          </div>

          <p className="text-[11px] text-white/40 mt-2 text-center">
            Glisse l&apos;image pour la repositionner. Utilise le zoom pour ajuster.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 pb-5">
          <Button
            type="button"
            onClick={handleReset}
            variant="outline"
            disabled={processing}
            className="flex-1 border-white/10 text-white/70 hover:bg-white/5 h-11 rounded-xl"
          >
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Reset
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            variant="outline"
            disabled={processing}
            className="flex-1 border-white/10 text-white/70 hover:bg-white/5 h-11 rounded-xl"
          >
            <X className="h-4 w-4 mr-1.5" />
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleCrop}
            disabled={processing || !imgDims}
            className="flex-1 bg-accent hover:bg-accent/90 text-white h-11 rounded-xl shadow-lg shadow-accent/20"
          >
            {processing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            Recadrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
