/**
 * BUG #74 polish — Lecteur audio custom dans le chat, style Hinge/WhatsApp.
 *
 * Layout :
 *  - Bulle accent (rose Spordateur #D91CD2) ou neutre selon isMe
 *  - Bouton play/pause rond blanc
 *  - Waveform en barres : ~30 traits verticaux de hauteurs pseudo-aléatoires
 *    (seed déterministe basé sur l'URL → même waveform à chaque rendu)
 *  - Barres "jouées" en blanc plein, barres "restantes" en blanc translucide
 *  - Time mm:ss à droite + bouton vitesse 1x / 1.5x / 2x
 *
 * Pourquoi waveform statique et pas vraie analyse audio :
 *  - L'analyse Web Audio API nécessite un fetch + decodeAudioData côté client,
 *    coûteux pour des messages courts. Hinge/WhatsApp affichent une waveform
 *    décorative (forme stable, pas la "vraie" enveloppe). Pour MVP suffisant.
 *  - Le seed via simple hash de l'URL garantit un visuel stable par message.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';

export interface ChatAudioMessageProps {
  audioUrl: string;
  durationSec?: number;
  /** true si le message vient de l'utilisateur courant (bulle accent vs neutre). */
  isMe: boolean;
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

/** Hash simple d'une string en entier 32-bit pour seeder le PRNG. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** Calcule les hauteurs des BAR_COUNT barres (range 0.25..1) selon l'URL. */
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

export function ChatAudioMessage({ audioUrl, durationSec, isMe }: ChatAudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [rateIdx, setRateIdx] = useState(0);

  const bars = generateBarHeights(audioUrl);
  const rate = PLAYBACK_RATES[rateIdx];

  // Sync HTML5 audio element events → React state
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      el.currentTime = 0;
    };
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => {
      // Préfère la durée mesurée par le browser si dispo (fiable). Fallback
      // sur durationSec passé en prop (pour les blobs WebM Safari iOS où
      // .duration peut renvoyer Infinity).
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
    };
  }, []);

  // Apply playback rate when rateIdx changes
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        // autoplay blocked, user gesture required — déjà déclenché par click
        // donc on ne s'attend pas à voir ce cas, juste safe.
      }
    } else {
      el.pause();
    }
  };

  const cycleRate = () => {
    setRateIdx((idx) => (idx + 1) % PLAYBACK_RATES.length);
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const remaining = Math.max(0, duration - currentTime);

  // Styles bulles : isMe = bulle accent ; sinon = bulle zinc-800 avec player accent
  const bubbleClass = isMe
    ? 'bg-accent text-white rounded-br-md'
    : 'bg-zinc-800 text-white rounded-bl-md';
  const playBtnClass = isMe
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-accent hover:bg-accent/90 text-white';
  const barOnClass = isMe ? 'bg-white' : 'bg-accent';
  const barOffClass = isMe ? 'bg-white/30' : 'bg-white/25';
  const timeClass = isMe ? 'text-white/90' : 'text-white/70';
  const rateBtnClass = isMe
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-white/10 hover:bg-white/20 text-white';

  return (
    <div className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${bubbleClass}`}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Play / Pause */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Lecture'}
        className={`flex items-center justify-center h-9 w-9 rounded-full shrink-0 transition-colors ${playBtnClass}`}
      >
        {isPlaying ? (
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
              className={`w-0.5 rounded-full ${played ? barOnClass : barOffClass}`}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          );
        })}
      </div>

      {/* Time (affiche le temps restant pendant la lecture, durée totale sinon) */}
      <span className={`text-xs font-mono tabular-nums ${timeClass} shrink-0`}>
        {formatTime(isPlaying ? remaining : duration)}
      </span>

      {/* Speed toggle */}
      <button
        type="button"
        onClick={cycleRate}
        aria-label={`Vitesse ${rate}x (clique pour changer)`}
        className={`shrink-0 text-[11px] font-medium px-2 py-1 rounded-md transition-colors ${rateBtnClass}`}
      >
        {rate}x
      </button>
    </div>
  );
}
