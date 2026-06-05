/**
 * BUG #107 — Recorder d'accroche vocale Spordateur (modal Dialog).
 *
 * Pattern Hinge "Voice Prompt" adapté Spordateur :
 *  1. L'utilisateur choisit une question parmi 3 prédéfinies (VOICE_PROMPT_OPTIONS)
 *     ou saisit la sienne via "Autre".
 *  2. Tap-and-hold (ou click toggle) sur le gros bouton AudioLines pour
 *     enregistrer. Max 20 secondes (limite Hinge ~30s, on est plus strict).
 *  3. Preview <audio controls> + boutons "Refaire" / "Sauvegarder".
 *  4. Au save : upload Firebase Storage `users/{uid}/voice-prompt.webm` →
 *     mise à jour Firestore `users/{uid}.voicePromptUrl + question + duration`.
 *
 * Icône AudioLines : même choix que ChatAudioRecorder (cohérence visuelle).
 *
 * Anti-régression : si déjà un enregistrement, le modal pré-remplit la question
 * et affiche le clip existant. Refaire écrase le précédent fichier dans Storage
 * (même path).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Square, X, Save, Trash2, Loader2, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/context/LanguageContext';
import {
  VOICE_PROMPT_MAX_SECONDS,
  VOICE_PROMPT_OPTIONS,
  pickAudioMimeType,
  formatVoiceTime,
} from '@/lib/profile/voicePrompt';

type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'saving';

interface VoicePromptRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** UID utilisateur pour le path Storage + write Firestore. */
  uid: string;
  /** Question + URL actuels (pour pré-remplir si déjà enregistré). */
  current?: { question?: string; url?: string; duration?: number };
  /** Callback après succès : passe les nouvelles valeurs au parent qui les
   *  affichera + persiste si besoin (le composant écrit déjà dans Firestore). */
  onSaved: (data: { url: string; question: string; duration: number }) => void;
  /** Callback de suppression (le composant gère l'écriture Firestore). */
  onDeleted: () => void;
}

export function VoicePromptRecorder({
  open,
  onOpenChange,
  uid,
  current,
  onSaved,
  onDeleted,
}: VoicePromptRecorderProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [state, setState] = useState<RecorderState>('idle');
  const [selectedPrompt, setSelectedPrompt] = useState<string>(
    current?.question || VOICE_PROMPT_OPTIONS[0],
  );
  const [customMode, setCustomMode] = useState<boolean>(
    !!current?.question && !VOICE_PROMPT_OPTIONS.includes(current.question),
  );
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(current?.url || null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [finalDuration, setFinalDuration] = useState(current?.duration || 0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0);
  const measuredDurationRef = useRef<number>(0);

  // Cleanup au unmount + à la fermeture du modal
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickerRef.current) clearInterval(tickerRef.current);
      if (previewUrl && !previewUrl.startsWith('https://')) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset state quand le modal s'ouvre
  useEffect(() => {
    if (open) {
      setState('idle');
      setElapsed(0);
      setRecordedBlob(null);
      // Garde l'URL existante si on rouvre (pour preview)
      if (current?.url && !previewUrl) setPreviewUrl(current.url);
    } else {
      // Nettoie le stream si modal fermé en pleine session
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (tickerRef.current) clearInterval(tickerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startRecording = async () => {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      // Fix audio robotique — force un bitrate audio correct (128 kbps). Sans
      // `audioBitsPerSecond`, MediaRecorder utilise un défaut navigateur parfois
      // très bas (VBR agressif) → accroche vocale distordue/robotique. Le
      // mimeType (opus, fallback mp4 Safari) reste géré par pickAudioMimeType().
      const rec = new MediaRecorder(
        stream,
        mimeType
          ? { mimeType, audioBitsPerSecond: 128000 }
          : { audioBitsPerSecond: 128000 },
      );
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setPreviewUrl(url);
        setFinalDuration(measuredDurationRef.current);
        setState('preview');
        // Cleanup tracks
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      measuredDurationRef.current = 0;
      rec.start();
      setState('recording');
      // Ticker : update elapsed + auto-stop à VOICE_PROMPT_MAX_SECONDS
      tickerRef.current = setInterval(() => {
        const sec = (Date.now() - startedAtRef.current) / 1000;
        measuredDurationRef.current = sec;
        setElapsed(sec);
        if (sec >= VOICE_PROMPT_MAX_SECONDS) {
          stopRecording();
        }
      }, 100);
    } catch (err) {
      console.error('[VoicePrompt] mic permission denied', err);
      toast({
        variant: 'destructive',
        title: t('voice_prompt_mic_inaccessible_title'),
        description: t('voice_prompt_mic_inaccessible_desc'),
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
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setRecordedBlob(null);
    setState('idle');
    setElapsed(0);
  };

  const retake = () => {
    if (previewUrl && !previewUrl.startsWith('https://')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setRecordedBlob(null);
    setFinalDuration(0);
    setState('idle');
  };

  /**
   * Upload Storage + update Firestore + callback parent. Si l'utilisateur
   * change juste la question (sans re-enregistrer), on ne re-upload pas —
   * on update juste voicePromptQuestion dans Firestore.
   */
  const handleSave = async () => {
    const question = selectedPrompt.trim();
    if (!question) {
      toast({ variant: 'destructive', title: t('voice_prompt_pick_question') });
      return;
    }
    setState('saving');
    try {
      const { default: app, db } = await import('@/lib/firebase');
      if (!app || !db) throw new Error('firebase-not-initialized');

      // Cas 1 : nouveau enregistrement → upload Storage
      let finalUrl = current?.url || '';
      let finalDur = current?.duration || 0;
      if (recordedBlob) {
        const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } =
          await import('firebase/storage');
        const storage = getStorage(app);
        const path = `users/${uid}/voice-prompt.webm`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, recordedBlob, { contentType: recordedBlob.type });
        finalUrl = await getDownloadURL(fileRef);
        finalDur = finalDuration;
      }

      if (!finalUrl) {
        throw new Error('no-recording');
      }

      // Cas 2 : update Firestore
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(
        doc(db, 'users', uid),
        {
          voicePromptUrl: finalUrl,
          voicePromptQuestion: question,
          voicePromptDuration: finalDur,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      toast({
        title: t('voice_prompt_saved_toast'),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      onSaved({ url: finalUrl, question, duration: finalDur });
      onOpenChange(false);
    } catch (err) {
      // BUG #107 follow-up — Log enrichi pour traquer la cause exacte.
      // Cas typiques :
      //  - 'storage/unauthorized' : storage.rules pas déployées (audio/* manquant)
      //  - 'storage/canceled' : user a fermé la fenêtre pendant l'upload
      //  - 'storage/quota-exceeded' : quota plein
      //  - 'permission-denied' (Firestore) : firestore.rules bloquent users/{uid}
      //  - 'unauthenticated' : token expiré → reconnect
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      const code = e?.code || e?.name || 'unknown';
      const message = err instanceof Error ? err.message : String(err);
      console.error('[VoicePrompt] save failed', { code, message, err });
      let description = t('voice_prompt_err_retry');
      if (code === 'storage/unauthorized' || code === 'permission-denied') {
        description = t('voice_prompt_err_permissions');
      } else if (code === 'storage/canceled') {
        description = t('voice_prompt_err_canceled');
      } else if (code === 'storage/quota-exceeded') {
        description = t('voice_prompt_err_quota');
      } else if (code === 'storage/retry-limit-exceeded' || code === 'storage/server-file-wrong-size') {
        description = t('voice_prompt_err_network');
      } else if (message.includes('firebase-not-initialized')) {
        description = t('voice_prompt_err_firebase_init');
      } else if (message.includes('no-recording')) {
        description = t('voice_prompt_err_no_recording');
      } else if (message) {
        description = `${t('voice_prompt_err_generic')} ${message}`;
      }
      toast({
        variant: 'destructive',
        title: t('voice_prompt_save_failed_title'),
        description,
      });
      setState('preview');
    }
  };

  const handleDelete = async () => {
    setState('saving');
    try {
      const { default: app, db } = await import('@/lib/firebase');
      if (!app || !db) throw new Error('firebase-not-initialized');
      const { doc, setDoc, deleteField, serverTimestamp } = await import('firebase/firestore');
      await setDoc(
        doc(db, 'users', uid),
        {
          voicePromptUrl: deleteField(),
          voicePromptQuestion: deleteField(),
          voicePromptDuration: deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      // Le fichier Storage est laissé (pas critique, sera écrasé au prochain upload).
      toast({ title: t('voice_prompt_deleted_toast'), className: 'bg-zinc-900 border-accent/40 text-white' });
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      console.error('[VoicePrompt] delete failed', err);
      toast({ variant: 'destructive', title: t('voice_prompt_delete_failed_title'), description: t('voice_prompt_delete_failed_desc') });
      setState('preview');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0F0F0F] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <AudioLines className="h-4 w-4 text-accent" />
            {t('voice_prompt_title')}
          </DialogTitle>
          <DialogDescription className="text-white/40 text-xs">
            {t('voice_prompt_description', { max: VOICE_PROMPT_MAX_SECONDS })}
          </DialogDescription>
        </DialogHeader>

        {/* Sélecteur question */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-white/40">{t('voice_prompt_pick_question_label')}</p>
          {VOICE_PROMPT_OPTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => { setSelectedPrompt(q); setCustomMode(false); }}
              className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${
                !customMode && selectedPrompt === q
                  ? 'border-accent/50 bg-accent/10 text-white'
                  : 'border-white/10 bg-zinc-900/40 text-white/70 hover:border-white/20'
              }`}
            >
              🎤 {q}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setCustomMode(true); if (!customMode) setSelectedPrompt(''); }}
            className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${
              customMode
                ? 'border-accent/50 bg-accent/10 text-white'
                : 'border-white/10 bg-zinc-900/40 text-white/70 hover:border-white/20'
            }`}
          >
            ✏️ {t('voice_prompt_write_own')}
          </button>
          {customMode && (
            <Input
              value={selectedPrompt}
              onChange={(e) => setSelectedPrompt(e.target.value)}
              placeholder={t('voice_prompt_custom_placeholder')}
              maxLength={120}
              className="bg-black border-white/10 h-11 text-white text-sm rounded-xl"
            />
          )}
        </div>

        {/* Recorder zone */}
        <div className="mt-2 p-4 rounded-2xl bg-zinc-900/40 border border-white/5">
          {state === 'idle' && !previewUrl && (
            <div className="flex flex-col items-center gap-2 py-2">
              <Button
                type="button"
                onClick={startRecording}
                className="h-16 w-16 rounded-full bg-accent hover:bg-accent/90 text-white shadow-xl shadow-accent/30"
                aria-label={t('voice_prompt_record_aria')}
              >
                <AudioLines className="h-6 w-6" />
              </Button>
              <p className="text-[11px] text-white/50">{t('voice_prompt_tap_to_record')}</p>
            </div>
          )}

          {state === 'requesting' && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
              <p className="text-xs text-white/60">{t('voice_prompt_authorize_mic')}</p>
            </div>
          )}

          {state === 'recording' && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="flex items-center gap-2 text-accent">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono tabular-nums text-base">
                  {formatVoiceTime(elapsed)} / {formatVoiceTime(VOICE_PROMPT_MAX_SECONDS)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={cancelRecording}
                  variant="outline"
                  className="border-white/10 text-white/70 hover:bg-white/5 h-11 px-4 rounded-xl"
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  onClick={stopRecording}
                  className="bg-red-500 hover:bg-red-600 text-white h-12 w-12 rounded-full"
                  aria-label={t('voice_prompt_stop_aria')}
                >
                  <Square className="h-5 w-5" />
                </Button>
              </div>
            </div>
          )}

          {(state === 'preview' || (state === 'idle' && previewUrl)) && previewUrl && (
            <div className="flex flex-col gap-3">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={previewUrl} className="w-full" />
              {finalDuration > 0 && (
                <p className="text-[10px] text-white/40 text-center">
                  {t('voice_prompt_duration_label', { duration: formatVoiceTime(finalDuration) })}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={retake}
                  variant="outline"
                  className="flex-1 border-white/10 text-white/70 hover:bg-white/5 h-11 rounded-xl"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  {t('voice_prompt_retake')}
                </Button>
              </div>
            </div>
          )}

          {state === 'saving' && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
              <p className="text-xs text-white/60">{t('voice_prompt_saving')}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2">
          {current?.url && (
            <Button
              type="button"
              onClick={handleDelete}
              variant="outline"
              disabled={state === 'saving' || state === 'recording'}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-11 rounded-xl"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            variant="outline"
            disabled={state === 'saving' || state === 'recording'}
            className="flex-1 border-white/10 text-white/70 hover:bg-white/5 h-11 rounded-xl"
          >
            {t('voice_prompt_cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              state === 'saving' ||
              state === 'recording' ||
              (!recordedBlob && !current?.url) ||
              !selectedPrompt.trim()
            }
            className="flex-1 bg-accent hover:bg-accent/90 text-white h-11 rounded-xl shadow-lg shadow-accent/20"
          >
            {state === 'saving' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            {t('voice_prompt_save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
