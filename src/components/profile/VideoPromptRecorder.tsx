/**
 * Accroche vidéo — recorder modal (additif à VoicePromptRecorder, audio intact).
 *
 * 2 chemins, comme l'audio :
 *  1. "Enregistrer maintenant" → getUserMedia(video+audio) + live preview 9:16,
 *     MediaRecorder vp9/opus (fallback mp4), auto-stop à 30s.
 *  2. "Uploader une vidéo" → file picker (.mp4/.mov/.webm), reject si > 30s
 *     OU > 100 Mo.
 *
 * Preview → "Recommencer" / "Valider". Au save : upload Firebase Storage
 * `users/{uid}/profile/video-prompt-{ts}.{ext}` + write Firestore
 * `users/{uid}.videoPromptUrl` (merge). "Supprimer" → deleteField.
 *
 * Encodage : videoBitsPerSecond 2.5 Mbps + audioBitsPerSecond 128k.
 * Charte stricte : accent #D91CD2 sur fond noir, aucun dégradé.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Video, Upload, Square, X, Check, Trash2, Loader2, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/context/LanguageContext';
import {
  VIDEO_PROMPT_MAX_SECONDS,
  VIDEO_PROMPT_MAX_UPLOAD_BYTES,
  pickVideoMimeType,
  videoExtFromMime,
  formatVideoTime,
} from '@/lib/profile/videoPrompt';

type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'saving';

interface VideoPromptRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** UID utilisateur pour le path Storage + write Firestore. */
  uid: string;
  /** URL actuelle (pour pré-remplir si déjà enregistré). */
  currentUrl?: string;
  /** Callback succès : URL publique de la vidéo. */
  onSaved: (url: string) => void;
  /** Callback suppression. */
  onDeleted: () => void;
}

/** Lit la durée d'un fichier vidéo via un <video> temporaire (metadata). */
function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const done = (d: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      resolve(d);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    setTimeout(() => done(Number.isFinite(el.duration) ? el.duration : 0), 3000);
    el.src = objectUrl;
  });
}

export function VideoPromptRecorder({
  open,
  onOpenChange,
  uid,
  currentUrl,
  onSaved,
  onDeleted,
}: VideoPromptRecorderProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl || null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0);
  const measuredDurationRef = useRef<number>(0);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cleanup au unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      if (tickerRef.current) clearInterval(tickerRef.current);
      if (previewUrl && !previewUrl.startsWith('https://')) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset à l'ouverture / nettoyage à la fermeture
  useEffect(() => {
    if (open) {
      setState('idle');
      setElapsed(0);
      setRecordedBlob(null);
      if (currentUrl && !previewUrl) setPreviewUrl(currentUrl);
    } else {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      if (tickerRef.current) clearInterval(tickerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Attache le flux caméra au live preview quand l'enregistrement démarre.
  useEffect(() => {
    if (state === 'recording' && liveVideoRef.current && streamRef.current) {
      liveVideoRef.current.srcObject = streamRef.current;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [state]);

  const startRecording = async () => {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 9 / 16 },
        },
        audio: true,
      });
      streamRef.current = stream;
      const mimeType = pickVideoMimeType();
      const rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
      });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setPreviewUrl(url);
        setState('preview');
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      measuredDurationRef.current = 0;
      rec.start();
      setState('recording');
      tickerRef.current = setInterval(() => {
        const sec = (Date.now() - startedAtRef.current) / 1000;
        measuredDurationRef.current = sec;
        setElapsed(sec);
        if (sec >= VIDEO_PROMPT_MAX_SECONDS) stopRecording();
      }, 100);
    } catch (err) {
      console.error('[VideoPrompt] camera permission denied', err);
      toast({
        variant: 'destructive',
        title: t('video_prompt_cam_inaccessible_title'),
        description: t('video_prompt_cam_inaccessible_desc'),
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
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setRecordedBlob(null);
    setState('idle');
    setElapsed(0);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const okType =
      /^video\/(mp4|quicktime|webm|x-m4v)$/i.test(file.type) ||
      /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    if (!okType) {
      toast({
        variant: 'destructive',
        title: t('video_prompt_save_failed_title'),
        description: t('video_prompt_invalid_format'),
      });
      return;
    }
    if (file.size > VIDEO_PROMPT_MAX_UPLOAD_BYTES) {
      toast({
        variant: 'destructive',
        title: t('video_prompt_save_failed_title'),
        description: t('video_prompt_too_large', {
          mb: Math.round(VIDEO_PROMPT_MAX_UPLOAD_BYTES / 1024 / 1024),
        }),
      });
      return;
    }
    const dur = await readVideoDuration(file);
    if (dur > VIDEO_PROMPT_MAX_SECONDS + 0.5) {
      toast({
        variant: 'destructive',
        title: t('video_prompt_save_failed_title'),
        description: t('video_prompt_max_duration_error', { max: VIDEO_PROMPT_MAX_SECONDS }),
      });
      return;
    }
    if (previewUrl && !previewUrl.startsWith('https://')) URL.revokeObjectURL(previewUrl);
    setRecordedBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    setState('preview');
  };

  const retake = () => {
    if (previewUrl && !previewUrl.startsWith('https://')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedBlob(null);
    setState('idle');
  };

  const handleSave = async () => {
    if (!recordedBlob) return;
    setState('saving');
    try {
      const { default: app, db } = await import('@/lib/firebase');
      if (!app || !db) throw new Error('firebase-not-initialized');
      const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = await import(
        'firebase/storage'
      );
      const storage = getStorage(app);
      const ext = videoExtFromMime(recordedBlob.type || 'video/mp4');
      const path = `users/${uid}/profile/video-prompt-${Date.now()}.${ext}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, recordedBlob, { contentType: recordedBlob.type || 'video/mp4' });
      const url = await getDownloadURL(fileRef);

      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(
        doc(db, 'users', uid),
        { videoPromptUrl: url, updatedAt: serverTimestamp() },
        { merge: true },
      );

      toast({
        title: t('video_prompt_saved_toast'),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      onSaved(url);
      onOpenChange(false);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      const code = e?.code || e?.name || 'unknown';
      console.error('[VideoPrompt] save failed', { code, err });
      toast({
        variant: 'destructive',
        title: t('video_prompt_save_failed_title'),
        description: t('video_prompt_save_failed_desc'),
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
        { videoPromptUrl: deleteField(), updatedAt: serverTimestamp() },
        { merge: true },
      );
      toast({
        title: t('video_prompt_deleted_toast'),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      console.error('[VideoPrompt] delete failed', err);
      toast({
        variant: 'destructive',
        title: t('video_prompt_delete_failed_title'),
        description: t('video_prompt_save_failed_desc'),
      });
      setState('preview');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0F0F0F] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Video className="h-4 w-4 text-accent" />
            {t('video_prompt_title')}
          </DialogTitle>
          <DialogDescription className="text-white/40 text-xs">
            {t('video_prompt_subtitle')}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={handleFileSelected}
          className="hidden"
        />

        {/* Zone recorder */}
        <div className="mt-2 p-4 rounded-2xl bg-zinc-900/40 border border-white/5">
          {state === 'idle' && !previewUrl && (
            <div className="flex flex-col gap-3 py-2">
              <Button
                type="button"
                onClick={startRecording}
                className="h-12 rounded-xl bg-accent hover:bg-accent/90 text-white shadow-lg shadow-accent/20"
              >
                <Video className="h-5 w-5 mr-2" />
                {t('video_prompt_record_now')}
              </Button>
              <Button
                type="button"
                onClick={handleUploadClick}
                variant="outline"
                className="h-12 rounded-xl border-white/10 text-white/70 hover:bg-white/5"
              >
                <Upload className="h-5 w-5 mr-2" />
                {t('video_prompt_upload')}
              </Button>
              <p className="text-[11px] text-white/40 text-center">
                {t('video_prompt_record_hint', { max: VIDEO_PROMPT_MAX_SECONDS })}
              </p>
            </div>
          )}

          {state === 'requesting' && (
            <div className="flex flex-col items-center gap-2 py-6">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
              <p className="text-xs text-white/60">{t('video_prompt_authorize_cam')}</p>
            </div>
          )}

          {state === 'recording' && (
            <div className="flex flex-col items-center gap-3 py-1">
              <div className="relative w-full max-w-[220px] aspect-[9/16] rounded-xl overflow-hidden bg-black">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={liveVideoRef}
                  muted
                  autoPlay
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 px-2 py-0.5 rounded-full">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-mono tabular-nums text-xs text-white">
                    {formatVideoTime(elapsed)} / {formatVideoTime(VIDEO_PROMPT_MAX_SECONDS)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={cancelRecording}
                  variant="outline"
                  className="border-white/10 text-white/70 hover:bg-white/5 h-11 px-4 rounded-xl"
                  aria-label={t('video_prompt_cancel')}
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  onClick={stopRecording}
                  className="bg-red-500 hover:bg-red-600 text-white h-12 w-12 rounded-full"
                  aria-label={t('video_prompt_stop')}
                >
                  <Square className="h-5 w-5" />
                </Button>
              </div>
            </div>
          )}

          {(state === 'preview' || (state === 'idle' && previewUrl)) && previewUrl && (
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-full max-w-[220px] aspect-[9/16] rounded-xl overflow-hidden bg-black">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
              <Button
                type="button"
                onClick={retake}
                variant="outline"
                className="border-white/10 text-white/70 hover:bg-white/5 h-11 rounded-xl"
              >
                <RotateCcw className="h-4 w-4 mr-1.5" />
                {t('video_prompt_retry')}
              </Button>
            </div>
          )}

          {state === 'saving' && (
            <div className="flex flex-col items-center gap-2 py-6">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
              <p className="text-xs text-white/60">{t('video_prompt_saving')}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2">
          {currentUrl && (
            <Button
              type="button"
              onClick={handleDelete}
              variant="outline"
              disabled={state === 'saving' || state === 'recording'}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-11 rounded-xl"
              aria-label={t('video_prompt_delete')}
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
            {t('video_prompt_cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={state === 'saving' || state === 'recording' || !recordedBlob}
            className="flex-1 bg-accent hover:bg-accent/90 text-white h-11 rounded-xl shadow-lg shadow-accent/20"
          >
            {state === 'saving' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            {t('video_prompt_validate')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
