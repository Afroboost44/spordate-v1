/**
 * BUG #107 — Lecteur d'accroche vocale style chat Spordateur (bulle accent
 * + waveform 32 barres + bouton play rond blanc + timer + vitesse).
 *
 * Pattern identique à `ChatAudioMessage` (mêmes patterns visuels) pour que
 * l'utilisateur reconnaisse immédiatement un "message vocal" sur le profil.
 *
 * Waveform :
 *   - 32 barres pseudo-aléatoires seedées par l'URL (Mulberry32 PRNG).
 *   - Même URL → même waveform à chaque rendu (déterministe).
 *   - Barres "jouées" en blanc plein, "restantes" en blanc translucide.
 *
 * Variants :
 *   - `full` (par défaut) : bulle accent rose, label question au-dessus.
 *   - `compact` : petit pill cliquable pour cards /discovery, /chat.
 *
 * Anti-régression : si url null/undefined → composant retourne null.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Loader2 } from 'lucide-react';

interface VoicePromptPlayerProps {
  /** URL Firebase Storage. Null/undefined → composant masqué. */
  url?: string | null;
  /** Question affichée au-dessus de la bulle. Optionnelle. */
  question?: string | null;
  /** Durée mesurée à l'enregistrement (secondes). */
  duration?: number | null;
  /** Variant compact pour cards. */
  variant?: 'full' | 'compact';
}

const BAR_COUNT = 32;
const PLAYBACK_RATES = [1, 1.5, 2] as const;

/** Mulberry32 PRNG — déterministe à partir d'un seed entier. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

function generateBarHeights(url: string): number[] {
  const rand = mulberry32(hashString(url));
  return Array.from({ length: BAR_COUNT }, () => 0.25 + rand() * 0.75);
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function VoicePromptPlayer({
  url,
  question,
  duration: durationProp,
  variant = 'full',
}: VoicePromptPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationProp ?? 0);
  const [loading, setLoading] = useState(false);
  const [rateIdx, setRateIdx] = useState(0);

  // Bars seed sur l'URL (stable par enregistrement)
  const bars = url ? generateBarHeights(url) : [];
  const rate = PLAYBACK_RATES[rateIdx];

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
    };
    const onLoadStart = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('loadstart', onLoadStart);
    el.addEventListener('canplay', onCanPlay);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('loadstart', onLoadStart);
      el.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = rate;
  }, [rate]);

  if (!url) return null;

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        // ignore
      }
    } else {
      el.pause();
    }
  };

  const cycleRate = () => {
    setRateIdx((i) => (i + 1) % PLAYBACK_RATES.length);
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const remaining = Math.max(0, duration - currentTime);

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={togglePlay}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent text-[11px] hover:bg-accent/25 transition-colors"
        title={question || 'Accroche vocale'}
        aria-label={question || 'Accroche vocale'}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> :
          isPlaying ? <Pause className="h-3 w-3" fill="currentColor" /> :
            <Play className="h-3 w-3 ml-0.5" fill="currentColor" />}
        <span>Voix</span>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} src={url} preload="none" />
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {question && (
        <p className="text-[11px] uppercase tracking-wider text-white/60 px-1">
          🎤 {question}
        </p>
      )}
      {/* Bulle accent rose — même style ChatAudioMessage isMe=true */}
      <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5 bg-accent text-white shadow-lg shadow-accent/20">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} src={url} preload="metadata" />

        {/* Play / Pause */}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Lecture'}
          className="flex items-center justify-center h-9 w-9 rounded-full shrink-0 bg-white/20 hover:bg-white/30 text-white transition-colors"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" fill="currentColor" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" fill="currentColor" />
          )}
        </button>

        {/* Waveform bars */}
        <div className="flex items-center gap-[2px] h-7 flex-1 min-w-[140px] sm:min-w-[180px]">
          {bars.map((h, i) => {
            const played = i / bars.length <= progress;
            return (
              <div
                key={i}
                className={`w-0.5 rounded-full ${played ? 'bg-white' : 'bg-white/30'}`}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            );
          })}
        </div>

        {/* Timer */}
        <span className="text-xs font-mono tabular-nums text-white/90 shrink-0">
          {formatTime(isPlaying ? remaining : duration)}
        </span>

        {/* Speed toggle */}
        <button
          type="button"
          onClick={cycleRate}
          aria-label={`Vitesse ${rate}x`}
          className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
        >
          {rate}x
        </button>
      </div>
    </div>
  );
}
