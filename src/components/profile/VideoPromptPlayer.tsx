/**
 * Accroche vidéo — lecteur 9:16 style Instagram Reels.
 *
 * - Muet par défaut + bouton son (Volume2/VolumeX).
 * - Tap sur la vidéo = play/pause, overlay Play au centre quand en pause.
 * - Indicateur de durée + barre de progression accent #D91CD2.
 *
 * Anti-régression : url null/undefined → composant masqué (return null).
 * Strictement complémentaire de VoicePromptPlayer (audio), ne le remplace pas.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatVideoTime } from '@/lib/profile/videoPrompt';

interface VideoPromptPlayerProps {
  /** URL Firebase Storage. Null/undefined → composant masqué. */
  url?: string | null;
  /** Quand true, le player s'étire sur toute la largeur du conteneur (désactive
   *  le max-width centré). Utilisé dans ProfileMediaStack pour aligner la
   *  largeur de la vidéo sur celle des photos. Default false (autres usages
   *  inchangés). */
  fullWidth?: boolean;
}

export function VideoPromptPlayer({ url, fullWidth = false }: VideoPromptPlayerProps) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
    };
  }, []);

  if (!url) return null;

  const togglePlay = async () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        /* autoplay/gesture rejection — ignore */
      }
    } else {
      el.pause();
    }
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const remaining = Math.max(0, duration - currentTime);
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className={`relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/10 ${
        fullWidth ? '' : 'max-w-[240px] mx-auto'
      }`}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={url}
        muted={muted}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        className="absolute inset-0 w-full h-full object-cover cursor-pointer"
      />

      {/* Overlay Play (en pause) */}
      {!isPlaying && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={t('video_prompt_play')}
          className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors"
        >
          <span className="flex items-center justify-center h-14 w-14 rounded-full bg-accent text-white shadow-lg shadow-accent/30">
            <Play className="h-6 w-6 ml-0.5" fill="currentColor" />
          </span>
        </button>
      )}

      {/* Spinner buffering */}
      {loading && isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-6 w-6 text-white animate-spin" />
        </div>
      )}

      {/* Pause overlay control (en lecture, coin) */}
      {isPlaying && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={t('video_prompt_pause')}
          className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
        >
          <Pause className="h-4 w-4" fill="currentColor" />
        </button>
      )}

      {/* Bouton son */}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? t('video_prompt_sound_on') : t('video_prompt_sound_off')}
        className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      {/* Durée */}
      <span className="absolute bottom-2 left-2 text-[11px] font-mono tabular-nums text-white bg-black/60 px-1.5 py-0.5 rounded">
        {formatVideoTime(isPlaying ? remaining : duration)}
      </span>

      {/* Barre de progression */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
        <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}
