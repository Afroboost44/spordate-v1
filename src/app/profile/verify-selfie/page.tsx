/**
 * BUG #83 — Page /profile/verify-selfie — Capture selfie pour vérification de profil.
 *
 * Flow :
 *  1. Demande permission caméra (getUserMedia front-facing)
 *  2. Affiche le flux vidéo en preview
 *  3. Bouton "Capturer" → snapshot canvas → Blob JPEG
 *  4. Preview du snapshot avec bouton "Reprendre" ou "Valider"
 *  5. Valider → upload Firebase Storage `selfies/{uid}.jpg`
 *  6. Update users/{uid}.selfieVerificationStatus = 'pending'
 *  7. Toast confirmation → redirect /profile
 *
 * La review du selfie (passage en 'verified') est manuelle côté admin :
 * l'admin compare le selfie aux photos de profil et valide.
 *
 * Si statut déjà 'verified' : on affiche une carte success + bouton "Retour".
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera, Check, RotateCw, Loader2, BadgeCheck, ShieldCheck, AlertTriangle, Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import BackButton from '@/components/BackButton';

type State = 'idle' | 'streaming' | 'preview' | 'analyzing' | 'uploading';

/**
 * BUG #84 — Charge face-api.js dynamiquement (lazy) avec ses modèles depuis
 * un CDN public. Évite de gonfler le bundle initial (~5 MB de modèles TF.js
 * + 700 KB de lib).
 *
 * Distance euclidienne entre descriptors :
 *  - < 0.45 : très haute confiance (match évident)
 *  - 0.45 - 0.55 : confiance correcte (= seuil par défaut face-api)
 *  - > 0.55 : pas de match
 * On utilise 0.55 comme cutoff anti-faux-négatif.
 */
const FACE_MATCH_THRESHOLD = 0.55;
const FACE_API_MODELS_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

interface FaceApiModule {
  nets: {
    tinyFaceDetector: { loadFromUri: (url: string) => Promise<void> };
    faceLandmark68Net: { loadFromUri: (url: string) => Promise<void> };
    faceRecognitionNet: { loadFromUri: (url: string) => Promise<void> };
  };
  TinyFaceDetectorOptions: new (opts?: { inputSize?: number; scoreThreshold?: number }) => unknown;
  detectSingleFace: (
    input: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
    options?: unknown,
  ) => {
    withFaceLandmarks: () => {
      withFaceDescriptor: () => Promise<{ descriptor: Float32Array } | undefined>;
    };
  };
  euclideanDistance: (a: Float32Array | number[], b: Float32Array | number[]) => number;
}

export default function VerifySelfiePage() {
  const router = useRouter();
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<State>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // BUG #84 — État de la reconnaissance faciale automatique
  const [analyzeMessage, setAnalyzeMessage] = useState<string>('');
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const modelsLoadedRef = useRef(false);
  // BUG #86 — Preload progress des modèles (visible avant le click "Vérifier")
  const [modelsPreloading, setModelsPreloading] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);

  const status = userProfile?.selfieVerificationStatus ?? 'not_started';
  const alreadyVerified = status === 'verified';
  const isPending = status === 'pending';

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BUG #87 — Preload face-api DÉSACTIVÉ. La reconnaissance auto échouait
  // chez Bassi (probable problème de CDN models, CSP, ou ordre de chargement
  // TF.js). On revient au flow le plus simple et fiable : capture → upload
  // → status='pending' → review admin manuelle.
  void modelsLoadedRef;
  void modelsPreloading;
  void setModelsPreloading;
  void setModelsReady;
  void modelsReady;

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      // BUG #85 — setState d'abord, l'attache du stream se fait dans useEffect
      // ci-dessous quand le <video> apparaît dans le DOM. Avant : on tentait
      // de modifier videoRef.current AVANT le re-render → ref encore null →
      // écran noir.
      setState('streaming');
    } catch (err) {
      console.error('[selfie] getUserMedia failed', err);
      setError(t('verify_selfie_camera_error'));
      setState('idle');
    }
  };

  // BUG #85 — Une fois que React a rendu le <video> (state==='streaming'),
  // on attache le stream et on lance la lecture. Sinon videoRef.current
  // est null pendant le premier setState. Effet de cleanup : si le state
  // change, le useEffect précédent stop le play (pas nécessaire mais clean).
  useEffect(() => {
    if (state !== 'streaming') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch((err) => {
      // play() peut être bloqué sur iOS si non déclenché par tap utilisateur
      // mais startCamera() est lui-même appelé via onClick donc OK normalement.
      console.warn('[selfie] video.play() blocked', err);
    });
  }, [state]);

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setState('preview');
      },
      'image/jpeg',
      0.85,
    );
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setState('idle');
  };

  /**
   * BUG #87/#88/#89 — face-api.js désactivé (lib retirée de package.json).
   * Cette fonction reste comme stub pour ne pas casser les références.
   * Réactiver quand on aura intégré une reconnaissance faciale fiable.
   */
  const loadFaceApi = async (): Promise<FaceApiModule> => {
    throw new Error('face-api-disabled');
  };
  void FACE_API_MODELS_URL;

  /** Calcule le descriptor d'un Blob/HTMLImage via face-api.
   *  BUG #86 — inputSize 416→224 (4× moins de calculs) pour accélérer
   *  l'analyse. La détection reste fiable car le visage prend toute l'image. */
  const computeDescriptor = async (
    faceapi: FaceApiModule,
    src: HTMLImageElement | HTMLCanvasElement,
  ): Promise<Float32Array | null> => {
    const detection = await faceapi
      .detectSingleFace(src, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return detection?.descriptor ?? null;
  };

  /** Charge une URL d'image dans un HTMLImageElement (CORS-safe). */
  const loadImageElement = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });

  /**
   * BUG #87 — Flow simplifié : upload selfie → status='pending' → admin review.
   * Pas de reconnaissance auto (face-api était unreliable chez Bassi).
   * Sera ré-activé une fois la lib bien intégrée + testée en prod.
   */
  const submit = async () => {
    if (!user || !previewBlob || !db || !isFirebaseConfigured) return;
    setState('uploading');
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { default: app } = await import('@/lib/firebase');
      if (!app) throw new Error('firebase-not-initialized');
      const storage = getStorage(app);
      // BUG #103 — Path corrigé : avant `selfies/{uid}-{ts}.jpg` (plat) →
      // tombait dans le default deny des storage.rules → 403 "Envoi
      // impossible". Maintenant `selfies/{uid}/{ts}.jpg` (subfolder) avec
      // une règle dédiée qui autorise l'écriture si request.auth.uid === userId.
      const path = `selfies/${user.uid}/${Date.now()}.jpg`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, previewBlob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(fileRef);

      await setDoc(
        doc(db, 'users', user.uid),
        {
          selfieVerificationStatus: 'pending',
          selfieVerificationUrl: url,
          selfieVerificationSubmittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      toast({
        title: t('verify_selfie_sent_title'),
        description: t('verify_selfie_sent_desc'),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      router.push('/profile');
    } catch (err) {
      // BUG #103 — Log enrichi (code Firebase + path) pour debug rapide.
      // L'utilisateur voit un message contextuel selon le code d'erreur.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code || 'unknown';
      const message = err instanceof Error ? err.message : String(err);
      console.error('[selfie submit] failed', { code, message, uid: user.uid });
      const userMessage = code === 'storage/unauthorized'
        ? t('verify_selfie_err_unauthorized')
        : code === 'storage/quota-exceeded'
          ? t('verify_selfie_err_quota')
          : code === 'storage/canceled'
            ? t('verify_selfie_err_canceled')
            : t('verify_selfie_err_generic');
      toast({
        title: t('verify_selfie_err_title'),
        description: userMessage,
        variant: 'destructive',
      });
      setState('preview');
    }
  };
  // Garde des helpers face-api (non utilisés actuellement, prêts pour ré-activation)
  void loadImageElement;
  void computeDescriptor;
  void FACE_MATCH_THRESHOLD;
  void loadFaceApi;

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="animate-spin mr-2 h-5 w-5" /> {t('verify_selfie_loading')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-8">
          <BackButton fallbackUrl="/profile" />
          <h1 className="text-2xl sm:text-3xl font-light tracking-wide flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-accent" />
            {t('verify_selfie_page_title')}
          </h1>
        </div>

        {/* Statut déjà vérifié : on affiche un succès, pas de capture */}
        {alreadyVerified ? (
          <Card className="bg-[#1A1A1A] border-accent/30">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <BadgeCheck className="h-16 w-16 text-accent" />
              <div>
                <h2 className="text-xl text-white font-medium">{t('verify_selfie_verified_title')}</h2>
                <p className="text-sm text-white/60 mt-2 max-w-sm">
                  {t('verify_selfie_verified_desc')}
                </p>
              </div>
              <Button
                onClick={() => router.push('/profile')}
                className="bg-accent text-white hover:bg-accent/90"
              >
                {t('verify_selfie_back_to_profile')}
              </Button>
            </CardContent>
          </Card>
        ) : isPending ? (
          <Card className="bg-[#1A1A1A] border-white/10">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Loader2 className="h-12 w-12 text-accent animate-spin" />
              <div>
                <h2 className="text-xl text-white font-medium">{t('verify_selfie_pending_title')}</h2>
                <p className="text-sm text-white/60 mt-2 max-w-sm">
                  {t('verify_selfie_pending_desc')}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-base text-white font-medium">
                {t('verify_selfie_howto_title')}
              </CardTitle>
              <ul className="text-xs text-white/60 font-light leading-relaxed mt-2 list-disc pl-5 space-y-1">
                <li>{t('verify_selfie_howto_item_1')}</li>
                <li>{t('verify_selfie_howto_item_2')}</li>
                <li>{t('verify_selfie_howto_item_3')}</li>
                <li>{t('verify_selfie_howto_item_4')}</li>
              </ul>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* État idle : bouton ouvrir caméra */}
              {state === 'idle' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      {error}
                    </div>
                  )}
                  <Button
                    onClick={startCamera}
                    className="bg-accent text-white hover:bg-accent/90 h-12 px-8 rounded-full"
                  >
                    <Camera className="h-5 w-5 mr-2" />
                    {t('verify_selfie_open_camera')}
                  </Button>
                </div>
              )}

              {/* État streaming : preview vidéo + bouton capture */}
              {state === 'streaming' && (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden border border-accent/30 bg-black">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
                    />
                    {/* Cercle de cadrage suggestif */}
                    <div className="absolute inset-8 rounded-full border-2 border-accent/40 pointer-events-none" />
                  </div>
                  <Button
                    onClick={capture}
                    className="bg-accent text-white hover:bg-accent/90 h-14 w-14 rounded-full"
                    aria-label={t('verify_selfie_capture_aria')}
                  >
                    <Camera className="h-6 w-6" />
                  </Button>
                </div>
              )}

              {/* État preview : photo capturée + Valider/Reprendre */}
              {state === 'preview' && previewUrl && (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden border border-accent/30 bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt={t('verify_selfie_preview_alt')}
                      className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button
                      onClick={retake}
                      variant="outline"
                      className="border-white/10 text-white"
                    >
                      <RotateCw className="h-4 w-4 mr-2" />
                      {t('verify_selfie_retake')}
                    </Button>
                    <Button
                      onClick={submit}
                      className="bg-accent text-white hover:bg-accent/90"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      {t('verify_selfie_submit')}
                    </Button>
                  </div>
                </div>
              )}

              {/* BUG #84 — État analyzing : reconnaissance faciale en cours */}
              {state === 'analyzing' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="relative">
                    <Loader2 className="h-10 w-10 text-accent animate-spin" />
                    <Sparkles className="h-5 w-5 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <p className="text-sm text-white/80 font-medium">
                    {analyzeMessage || t('verify_selfie_analyzing')}
                  </p>
                  <p className="text-xs text-white/40 max-w-xs text-center">
                    {t('verify_selfie_analyzing_desc')}
                  </p>
                </div>
              )}

              {/* État uploading : spinner */}
              {state === 'uploading' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="h-8 w-8 text-accent animate-spin" />
                  <p className="text-sm text-white/70">{t('verify_selfie_saving')}</p>
                </div>
              )}

              {/* Canvas caché utilisé pour le snapshot */}
              <canvas ref={canvasRef} className="hidden" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
