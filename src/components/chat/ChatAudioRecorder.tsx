/**
 * BUG #74 — Bouton + recorder de messages audio dans le chat.
 *
 * Icon : AudioLines (waveform style — choix Bassi 2026-05-21, cohérent
 * Hinge/WhatsApp). Bouton rond clair à droite du textfield.
 *
 * Flux UX :
 *  1. État idle → bouton AudioLines → click → demande permission micro
 *  2. État recording → timer "0:12 / 1:00" + bouton stop (carré rouge)
 *     + cancel ✕. Limite hard 60s (CHAT_AUDIO_MAX_SECONDS).
 *  3. État preview → mini player <audio controls> + bouton Send (envoie au
 *     parent via onRecorded) + bouton Trash (re-enregistrer)
 *
 * Compatibilité :
 *  - MediaRecorder API : tous les browsers récents (Chrome/Safari/Firefox)
 *  - Codec préféré : audio/webm;codecs=opus (Chrome/Firefox)
 *    fallback audio/mp4 sur Safari iOS
 *  - getUserMedia : requiert HTTPS en prod (OK : spordateur.com)
 *
 * Coût utilisateur : 2 crédits par envoi (cf. CHAT_AUDIO_COST côté server).
 * Affichage du coût sur le bouton send pour transparence.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Square, X, Send, Trash2, Loader2, Coins } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CHAT_AUDIO_MAX_SECONDS } from '@/lib/pricing/chatPricing';

export interface ChatAudioRecorderProps {
  /** Coût affiché au-dessus du bouton send (lu depuis pricing côté parent). */
  costCredits: number;
  /** Solde courant de l'utilisateur (pour bloquer si insuffisant). */
  availableCredits: number;
  /** Callback appelé quand l'utilisateur valide le send (parent upload + envoie). */
  onRecorded: (blob: Blob, durationSec: number) => Promise<void> | void;
  /** Désactive complètement le bouton (chat verrouillé, ou send en cours). */
  disabled?: boolean;
}

type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'sending';

/** Choisit le mimeType supporté par le browser pour l'enregistrement. */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return ''; // laisser le default browser
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ChatAudioRecorder({
  costCredits,
  availableCredits,
  onRecorded,
  disabled = false,
}: ChatAudioRecorderProps) {
  const { toast } = useToast();
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [finalDuration, setFinalDuration] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0);
  // Workaround Safari iOS : la durée d'un Blob audio/webm n'est pas toujours
  // récupérable via <audio>.duration. On stocke la durée mesurée pendant
  // l'enregistrement comme source de vérité.
  const measuredDurationRef = useRef<number>(0);

  // Cleanup : arrêter le stream + ticker quand le composant unmount
  useEffect(() => {
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insufficientCredits = availableCredits < costCredits;

  const startRecording = async () => {
    if (disabled || state !== 'idle') return;
    if (insufficientCredits) {
      toast({
        title: 'Solde insuffisant',
        description: `Il te faut ${costCredits} crédits pour envoyer un audio.`,
        variant: 'destructive',
      });
      return;
    }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener('dataavailable', (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      });
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setFinalDuration(Math.round(measuredDurationRef.current));
        setState('preview');
        // Arrête les tracks pour libérer le micro (l'icône d'enregistrement
        // dans le browser disparaît, important pour la confiance utilisateur).
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      });

      startedAtRef.current = Date.now();
      measuredDurationRef.current = 0;
      setElapsed(0);
      recorder.start(250); // chunk timeslice : 250ms → flush régulier
      setState('recording');

      tickerRef.current = setInterval(() => {
        const secs = (Date.now() - startedAtRef.current) / 1000;
        measuredDurationRef.current = secs;
        setElapsed(secs);
        if (secs >= CHAT_AUDIO_MAX_SECONDS) {
          // Auto-stop à la limite max
          stopRecording();
        }
      }, 200);
    } catch (err) {
      console.error('[ChatAudioRecorder] getUserMedia failed', err);
      toast({
        title: 'Micro indisponible',
        description: 'Autorise l\'accès au micro dans ton navigateur pour enregistrer un audio.',
        variant: 'destructive',
      });
      setState('idle');
    }
  };

  const stopRecording = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      // mute le 'stop' event pour ne pas tomber en preview
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setState('idle');
  };

  const discardPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedBlob(null);
    setFinalDuration(0);
    setElapsed(0);
    setState('idle');
  };

  const sendPreview = async () => {
    if (!recordedBlob || finalDuration < 1) {
      toast({
        title: 'Audio trop court',
        description: 'Enregistre au moins 1 seconde avant d\'envoyer.',
        variant: 'destructive',
      });
      return;
    }
    setState('sending');
    try {
      await onRecorded(recordedBlob, finalDuration);
      // Reset après envoi réussi
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setRecordedBlob(null);
      setFinalDuration(0);
      setElapsed(0);
      setState('idle');
    } catch (err) {
      console.error('[ChatAudioRecorder] send failed', err);
      // Le parent affiche déjà un toast d'erreur via onRecorded.
      setState('preview');
    }
  };

  // =====================================================================
  // Rendus par état
  // =====================================================================

  if (state === 'preview' && previewUrl) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-accent/30 bg-zinc-900 px-2 py-1.5">
        <button
          type="button"
          onClick={discardPreview}
          aria-label="Supprimer l'enregistrement"
          className="p-1.5 text-white/50 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          src={previewUrl}
          controls
          className="h-8 max-w-[180px] sm:max-w-[240px]"
        />
        <button
          type="button"
          onClick={sendPreview}
          disabled={state !== 'preview' || insufficientCredits}
          aria-label={`Envoyer (coûte ${costCredits} crédits)`}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            insufficientCredits
              ? 'bg-white/5 text-white/30 cursor-not-allowed'
              : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          <Send className="h-3.5 w-3.5" />
          <Coins className="h-3 w-3" />
          {costCredits}
        </button>
      </div>
    );
  }

  if (state === 'sending') {
    return (
      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-accent/10">
        <Loader2 className="h-4 w-4 text-accent animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/[0.08] px-3 py-1.5">
        <button
          type="button"
          onClick={cancelRecording}
          aria-label="Annuler l'enregistrement"
          className="p-1 text-white/60 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="text-xs font-mono tabular-nums text-white whitespace-nowrap">
          {formatTime(elapsed)} / {formatTime(CHAT_AUDIO_MAX_SECONDS)}
        </span>
        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
        <button
          type="button"
          onClick={stopRecording}
          aria-label="Arrêter l'enregistrement"
          className="flex items-center justify-center h-7 w-7 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
        >
          <Square className="h-3 w-3" fill="white" />
        </button>
      </div>
    );
  }

  // state === 'idle' ou 'requesting'
  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled || state === 'requesting'}
      aria-label="Enregistrer un message audio"
      title={
        insufficientCredits
          ? `Solde insuffisant — il faut ${costCredits} crédits`
          : `Enregistrer un message audio (coûte ${costCredits} crédits)`
      }
      className={`flex items-center justify-center h-10 w-10 rounded-full transition-colors shrink-0 ${
        disabled
          ? 'bg-white/5 text-white/20 cursor-not-allowed'
          : insufficientCredits
            ? 'bg-white/5 text-white/30 hover:bg-white/10'
            : 'bg-white/10 text-white hover:bg-accent/20 hover:text-accent'
      }`}
    >
      {state === 'requesting' ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <AudioLines className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}
