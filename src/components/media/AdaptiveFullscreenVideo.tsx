/**
 * AdaptiveFullscreenVideo — composant partagé pour lecture vidéo plein écran
 * ratio-aware (9:16 portrait remplit l'écran, 16:9 landscape avec orientation
 * lock + fallback hint Safari iOS).
 *
 * Extrait de `src/app/activities/page.tsx` (composant `FullscreenVideo`,
 * BUG #220 + UX mobile Reels/TikTok) afin de partager le comportement entre
 * la page Activités (listing) et la page Activité détail ("À propos").
 *
 * Desktop (>768px) :
 *  - Comportement historique : object-contain + bandes noires + controls
 *    HTML5 natifs. Aucune régression sur le ratio dynamique.
 *
 * Mobile (≤768px) :
 *  - Vidéo 9:16 (portrait) : object-cover + w-screen/h-screen pour remplir
 *    100% de l'écran (UX Reels/TikTok). PAS de requestFullscreen() natif
 *    (sinon Android force la rotation auto en landscape et la vidéo
 *    verticale se retrouve tournée).
 *  - Vidéo 16:9 (landscape) : tente screen.orientation.lock('landscape').
 *    Si l'API n'existe pas / throw (Safari iOS) → overlay 5s avec hint
 *    "Tourne ton téléphone pour le plein écran" (i18n FR/EN/DE).
 *  - Controls overlay custom (✕ close + 🔊 mute) avec aria-label + title,
 *    toujours visibles (bg-black/50 backdrop-blur) au lieu des controls
 *    HTML5 natifs.
 *
 * Mute initial :
 *  - Mobile : muted=true (les navigateurs bloquent l'autoplay sonore).
 *  - Desktop : muted=false (controls natifs + user attention présente).
 *  - handleToggleMute force play() après unmute (le clic est un user-gesture
 *    qui débloque l'autoplay sonore Chrome/Safari).
 *
 * Cleanup au unmount :
 *  - Sortie fullscreen natif si activé.
 *  - Déverrouille screen.orientation si lockée.
 *  - Remove resize listener (matchMedia).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Volume2, VolumeX, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export interface AdaptiveFullscreenVideoProps {
  src: string;
  autoPlay: boolean;
  onClose?: () => void;
}

export default function AdaptiveFullscreenVideo({
  src,
  autoPlay,
  onClose,
}: AdaptiveFullscreenVideoProps) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<'landscape' | 'portrait' | 'square'>('landscape');
  const [isMobile, setIsMobile] = useState<boolean>(false);
  // Démarrage muted=true sur mobile pour permettre l'autoplay (Chrome/Safari
  // bloquent l'autoplay sonore par défaut). Sur desktop, controls natifs +
  // user attention présente, donc autoplay sonore tolérable. Le state est
  // calculé au mount en SSR-safe (window guard) pour éviter le toggle visible
  // entre le premier paint et la première sync isMobile.
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  const [showRotateHint, setShowRotateHint] = useState<boolean>(false);
  // Refs pour cleanup : on doit savoir si on a verrouillé l'orientation
  // ou demandé un fullscreen natif côté <video>, pour défaire au unmount
  // sans casser d'autres écrans déjà fullscreen.
  const didLockOrientation = useRef(false);
  const didRequestFullscreen = useRef(false);
  const rotateHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Détection mobile via matchMedia, mise à jour live si rotation/resize.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Détecte Safari iOS où Screen Orientation Lock API est bloquée.
  const isSafariIOS = (): boolean => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = (window as any).MSStream;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !ms;
  };

  // Applique le comportement orientation/fullscreen quand on connaît le ratio
  // ET qu'on est en mobile. Idempotent : si déjà fait, ne refait pas.
  useEffect(() => {
    if (!isMobile) return;
    if (typeof window === 'undefined') return;

    // Vidéo 9:16 (portrait) sur mobile → on NE FAIT RIEN d'autre que
    // l'overlay fixed inset-0 + w-screen h-screen object-cover (déjà appliqué
    // via la className dynamique). PAS de requestFullscreen() : sur Android,
    // entrer en fullscreen natif côté <video> déclenche une rotation auto en
    // landscape, ce qui retournerait la vidéo verticale (UX inverse de ce que
    // veut Bassi : 9:16 doit RESTER portrait). UX cible = Reels/TikTok :
    // vidéo verticale qui remplit l'écran portrait sans rotation.
    if (ratio === 'portrait') {
      // No-op : object-cover w-screen h-screen suffit pour "remplir l'écran".
    }

    // Vidéo 16:9 (landscape) → orientation lock landscape, fallback hint.
    if (ratio === 'landscape') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orient = (screen as any).orientation;
      const canLock = orient && typeof orient.lock === 'function' && !isSafariIOS();
      if (canLock) {
        try {
          const p = orient.lock('landscape');
          if (p && typeof p.then === 'function') {
            p.then(() => { didLockOrientation.current = true; }).catch(() => {
              // Lock refusé runtime → afficher le hint.
              setShowRotateHint(true);
              rotateHintTimerRef.current = setTimeout(() => setShowRotateHint(false), 5000);
            });
          } else {
            didLockOrientation.current = true;
          }
        } catch {
          setShowRotateHint(true);
          rotateHintTimerRef.current = setTimeout(() => setShowRotateHint(false), 5000);
        }
      } else {
        // Safari iOS ou API absente → hint visuel 5s.
        setShowRotateHint(true);
        rotateHintTimerRef.current = setTimeout(() => setShowRotateHint(false), 5000);
      }
    }
  }, [isMobile, ratio]);

  // Cleanup global au unmount du composant.
  useEffect(() => {
    return () => {
      if (rotateHintTimerRef.current) clearTimeout(rotateHintTimerRef.current);
      if (didLockOrientation.current) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (screen as any).orientation?.unlock?.();
        } catch {
          /* silent */
        }
        didLockOrientation.current = false;
      }
      if (didRequestFullscreen.current && typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => undefined);
        didRequestFullscreen.current = false;
      }
    };
  }, []);

  const handleLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (!v.videoWidth || !v.videoHeight) return;
    const r = v.videoWidth / v.videoHeight;
    if (r > 1.1) setRatio('landscape');
    else if (r < 0.9) setRatio('portrait');
    else setRatio('square');
  };

  const handleClose = () => {
    if (didLockOrientation.current) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (screen as any).orientation?.unlock?.();
      } catch {
        /* silent */
      }
      didLockOrientation.current = false;
    }
    if (didRequestFullscreen.current && typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
      didRequestFullscreen.current = false;
    }
    onClose?.();
  };

  const handleToggleMute = () => {
    setMuted((m) => {
      const next = !m;
      const v = videoRef.current;
      if (v) {
        v.muted = next;
        // Si on dé-mute, on tente play() au cas où l'autoplay sonore initial
        // a été bloqué par le navigateur (Chrome/Safari refusent l'autoplay
        // non-muted en arrière-plan, mais le clic ici est un user-gesture
        // qui débloque la lecture sonore).
        if (!next) {
          v.play().catch(() => undefined);
        }
      }
      return next;
    });
  };

  // Classes ratio-aware.
  // Mobile + 9:16 → remplir tout l'écran (object-cover, w/h screen).
  // Mobile + 16:9 → on garde object-contain (l'orientation lock fera le job).
  // Desktop → comportement historique (aspect-ratio + object-contain).
  const useMobileFill = isMobile && ratio === 'portrait';
  const videoClass = useMobileFill
    ? 'w-screen h-screen object-cover bg-black'
    : (() => {
        // Bug fix Bassi 26/05 — Sur DESKTOP, vidéo 9:16 prenait `max-w-full`
        // ce qui rendait visuellement d'énormes bandes noires latérales
        // (boîte 9:16 étirée pleine largeur, fond noir partout sauf vidéo).
        // Fix : la boîte fait juste `h-[95vh] aspect-[9/16]`, sa largeur est
        // calculée automatiquement par le ratio (9/16 × 95vh ≈ 53vh de large).
        // La vidéo prend l'espace qu'elle doit, centrée. Le bg-black du
        // parent FullscreenLightbox sert de backdrop modal. 16:9 et square
        // NE SONT PAS modifiés (Bassi : "fonctionne bien, ne pas changer").
        const aspectClass =
          ratio === 'portrait'
            ? 'h-[95vh] aspect-[9/16] max-w-[95vw]'
            : ratio === 'square'
              ? 'aspect-square max-h-[100vh] max-w-full'
              : 'aspect-video max-w-[100vw] max-h-[100vh]';
        return `${aspectClass} object-contain bg-black`;
      })();

  // Sur mobile : on supprime les controls HTML5 natifs au profit d'un overlay
  // custom (✕ + mute) toujours visible. Sur desktop : controls natifs comme
  // avant + bouton ✕ du parent FullscreenLightbox.
  const showNativeControls = !isMobile;

  return (
    <div className={isMobile ? 'fixed inset-0 z-[105] flex items-center justify-center bg-black' : 'relative'}>
      <video
        ref={videoRef}
        src={src}
        controls={showNativeControls}
        autoPlay={autoPlay}
        playsInline
        muted={muted}
        onLoadedMetadata={handleLoaded}
        className={videoClass}
      />

      {isMobile && (
        <>
          {/* Bouton ✕ close en haut-droite */}
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('fullscreen_close')}
            title={t('fullscreen_close')}
            className="absolute top-4 right-4 z-30 p-3 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>

          {/* Bouton mute toggle en bas-droite */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? t('fullscreen_unmute') : t('fullscreen_mute')}
            title={muted ? t('fullscreen_unmute') : t('fullscreen_mute')}
            className="absolute bottom-6 right-4 z-30 p-3 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
          >
            {muted ? (
              <VolumeX className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Volume2 className="h-6 w-6" aria-hidden="true" />
            )}
          </button>

          {/* Overlay hint "tourne ton téléphone" pour Safari iOS sur 16:9 */}
          {showRotateHint && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center justify-center px-6 pointer-events-none">
              <div className="bg-black/70 backdrop-blur text-white text-sm md:text-base px-4 py-3 rounded-xl flex items-center gap-2 text-center">
                <Maximize2 className="h-5 w-5 rotate-90" aria-hidden="true" />
                <span>{t('fullscreen_rotate_phone_hint')}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
