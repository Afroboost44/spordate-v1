/**
 * Fix #128 — Brand Logo Manager (section /admin/manage page Site).
 *
 * Upload UN logo source (PNG idéalement 1024×1024 transparent), auto-génère
 * tous les variants PWA/favicon/Apple/splash via Canvas, upload sur Firebase
 * Storage, persiste les URLs dans settings/site.brand.
 *
 * Flow :
 *   1. Admin sélectionne un fichier (drag-drop ou bouton)
 *   2. Aperçu local du logo source + grille des variants prévus
 *   3. Click "Générer & enregistrer" :
 *      a. Canvas génère tous les variants (Promise.all)
 *      b. Upload séquentiel sur Firebase Storage à brand/v{ts}/{slot}.png
 *      c. setDoc settings/site avec brand: { ...urls, version, generatedAt }
 *      d. Toast succès + render des URLs finales
 *   4. Section "Logos actuels" : affiche les variants stockés (si déjà générés)
 *
 * @module
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, RefreshCw, ImageIcon, CheckCircle2 } from 'lucide-react';
import {
  generateAllLogos,
  loadImageFromFile,
  type BrandLogos,
  type GeneratedLogoSet,
} from '@/lib/brand/generateLogos';

interface BrandLogoManagerProps {
  /** Brand object actuel (lu depuis settings/site.brand). Peut être vide au premier chargement. */
  brand: BrandLogos;
  /** Callback déclenché après upload + save Firestore réussi. Le parent doit mettre à jour son state. */
  onUpdated: (newBrand: BrandLogos) => void;
}

interface SlotMeta {
  key: keyof GeneratedLogoSet;
  storageSlot: string; // path file in storage
  label: string;
  contextHint: string;
  size: string;
}

const SLOTS: SlotMeta[] = [
  { key: 'icon16', storageSlot: 'icon16Url', label: 'Favicon 16', contextHint: 'Onglet navigateur (petit)', size: '16×16' },
  { key: 'icon32', storageSlot: 'icon32Url', label: 'Favicon 32', contextHint: 'Onglet navigateur (standard)', size: '32×32' },
  { key: 'icon192', storageSlot: 'icon192Url', label: 'Logo standard 192', contextHint: 'PWA "any"', size: '192×192' },
  { key: 'icon512', storageSlot: 'icon512Url', label: 'Logo standard 512', contextHint: 'PWA "any" haute résolution', size: '512×512' },
  { key: 'maskable192', storageSlot: 'maskable192Url', label: 'Maskable 192', contextHint: 'Adaptive icon Android (padding safe-zone)', size: '192×192' },
  { key: 'maskable512', storageSlot: 'maskable512Url', label: 'Maskable 512', contextHint: 'Adaptive icon Android (haute résolution)', size: '512×512' },
  { key: 'appleTouch180', storageSlot: 'appleTouch180Url', label: 'Apple Touch', contextHint: 'iOS — icône home screen', size: '180×180' },
  { key: 'monochrome512', storageSlot: 'monochrome512Url', label: 'Monochrome', contextHint: 'Android — silhouette blanche', size: '512×512' },
  { key: 'splash1024', storageSlot: 'splash1024Url', label: 'Splash screen', contextHint: 'Écran démarrage iOS / PWA', size: '1024×1024' },
];

export function BrandLogoManager({ brand, onUpdated }: BrandLogoManagerProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; current: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Cleanup blob URL on unmount/change pour éviter leak mémoire
  useEffect(() => {
    return () => {
      if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    };
  }, [sourcePreview]);

  const handleFilePick = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Fichier invalide',
        description: 'Sélectionne une image (PNG, JPG, SVG…).',
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Fichier trop lourd',
        description: 'Taille maximum 10 MB.',
      });
      return;
    }
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourceFile(file);
    setSourcePreview(URL.createObjectURL(file));
  };

  const handleGenerateAndSave = async () => {
    if (!sourceFile) return;
    setGenerating(true);
    setProgress({ stage: 'Chargement…', current: 0, total: SLOTS.length + 2 });
    try {
      // 1. Charger l'image + générer variants
      const img = await loadImageFromFile(sourceFile);
      setProgress({ stage: 'Génération des variants…', current: 1, total: SLOTS.length + 2 });
      const generated = await generateAllLogos(img);

      // 2. Imports Firebase Storage (lazy)
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const firebaseModule = await import('@/lib/firebase');
      const app = firebaseModule.default;
      if (!app) throw new Error('Firebase non initialisé');
      const storage = getStorage(app);

      // 3. Upload source d'abord
      const version = Date.now();
      const sourceExt = sourceFile.name.split('.').pop()?.toLowerCase() || 'png';
      const sourceRef = ref(storage, `brand/v${version}/source.${sourceExt}`);
      setProgress({ stage: 'Upload source…', current: 2, total: SLOTS.length + 2 });
      await uploadBytes(sourceRef, sourceFile, { contentType: sourceFile.type });
      const sourceUrl = await getDownloadURL(sourceRef);

      // 4. Upload tous les variants
      const newBrand: BrandLogos = {
        sourceUrl,
        version,
        generatedAt: new Date().toISOString(),
      };

      let i = 2;
      for (const slot of SLOTS) {
        i += 1;
        setProgress({ stage: `Upload ${slot.label}…`, current: i, total: SLOTS.length + 2 });
        const blob = generated[slot.key];
        const slotRef = ref(storage, `brand/v${version}/${slot.key}.png`);
        await uploadBytes(slotRef, blob, { contentType: 'image/png' });
        const url = await getDownloadURL(slotRef);
        (newBrand as Record<string, unknown>)[slot.storageSlot] = url;
      }

      // 5. Persist Firestore — Fix #145 : passe par le service centralisé
      // updateSiteConfig() qui garantit merge:true. Plus aucune section ne
      // peut écraser une autre (hero, étapes, témoignages préservés).
      const { updateSiteConfig } = await import('@/lib/site/updateSiteConfig');
      await updateSiteConfig({ brand: newBrand });

      // Fix #142 — Cleanup ancien brand sur Storage (extraire version du
      // sourceUrl précédent et delete les anciens variants). Best-effort,
      // ne bloque pas si fail.
      if (brand.version && brand.version !== version) {
        try {
          const { deleteObject, ref: refStorage } = await import('firebase/storage');
          const oldSlots = ['icon16', 'icon32', 'icon192', 'icon512', 'maskable192',
            'maskable512', 'appleTouch180', 'monochrome512', 'splash1024'];
          await Promise.allSettled(
            oldSlots.map((slot) =>
              deleteObject(refStorage(storage, `brand/v${brand.version}/${slot}.png`)),
            ),
          );
          // Aussi le source (extension variable, on tente png par défaut)
          await Promise.allSettled([
            deleteObject(refStorage(storage, `brand/v${brand.version}/source.png`)),
            deleteObject(refStorage(storage, `brand/v${brand.version}/source.jpg`)),
            deleteObject(refStorage(storage, `brand/v${brand.version}/source.jpeg`)),
            deleteObject(refStorage(storage, `brand/v${brand.version}/source.webp`)),
            deleteObject(refStorage(storage, `brand/v${brand.version}/source.svg`)),
          ]);
          console.log('[BrandLogoManager] Cleanup ancien brand v' + brand.version + ' OK');
        } catch (err) {
          console.warn('[BrandLogoManager] Cleanup ancien brand failed (non-bloquant)', err);
        }
      }

      toast({
        title: 'Logos générés ✓',
        description: `${SLOTS.length} variants créés et appliqués au site.`,
      });
      onUpdated(newBrand);
      setSourceFile(null);
      if (sourcePreview) {
        URL.revokeObjectURL(sourcePreview);
        setSourcePreview(null);
      }
    } catch (err) {
      console.error('[BrandLogoManager] generate+save failed', err);
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const hasAnyBrand =
    !!brand.icon192Url || !!brand.icon512Url || !!brand.appleTouch180Url || !!brand.sourceUrl;

  return (
    <div className="space-y-6">
      {/* Drop zone + bouton upload */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFilePick(f);
        }}
        className={`border-2 border-dashed rounded-xl p-6 transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-white/15 bg-black/30'
        }`}
      >
        <div className="flex flex-col items-center text-center space-y-3">
          {sourcePreview ? (
            <div className="relative">
              <img
                src={sourcePreview}
                alt="Logo source"
                className="h-32 w-32 object-contain rounded-lg bg-white/5 p-2"
              />
              {sourceFile && (
                <p className="text-xs text-white/50 mt-2 font-light">
                  {sourceFile.name} · {Math.round(sourceFile.size / 1024)} Ko
                </p>
              )}
            </div>
          ) : (
            <div className="h-24 w-24 rounded-full bg-white/5 flex items-center justify-center">
              <Upload className="h-10 w-10 text-white/30" />
            </div>
          )}
          <div className="space-y-1">
            <p className="text-white/80 text-sm font-light">
              Dépose ton logo ici ou choisis un fichier
            </p>
            <p className="text-white/40 text-xs font-light">
              PNG transparent recommandé · idéalement 1024×1024 · max 10 MB
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFilePick(f);
              e.target.value = ''; // reset pour re-sélection
            }}
          />
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={generating}
              className="border-white/15 text-white hover:bg-white/5 font-light"
            >
              <ImageIcon className="h-4 w-4 mr-2" /> Choisir un fichier
            </Button>
            <Button
              type="button"
              onClick={handleGenerateAndSave}
              disabled={!sourceFile || generating}
              className="bg-accent hover:bg-accent/90 text-white font-normal"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Génération…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" /> Générer & appliquer
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Barre de progression pendant génération */}
      {progress && (
        <div className="bg-white/5 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-light">
            <span className="text-white/80">{progress.stage}</span>
            <span className="text-white/40 font-mono">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Grille des variants — actuels (si déjà uploadés) */}
      {hasAnyBrand && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-white/80 text-sm font-light tracking-wide uppercase">
              Logos actuels
            </h4>
            {brand.generatedAt && (() => {
              // Fix #152 — Si les logos ont été générés il y a > 24h, on affiche
              // un hint visuel pour que l'admin sache qu'un re-clic sur "Générer
              // & appliquer" appliquera les dernières améliorations de l'algo
              // (notamment fix monochrome #148/#150 si applicable).
              const ageMs = Date.now() - new Date(brand.generatedAt).getTime();
              const isStale = ageMs > 24 * 60 * 60 * 1000;
              return (
                <p className={`text-xs font-mono ${isStale ? 'text-yellow-400/80' : 'text-white/40'}`}>
                  {isStale && '⚠ '}Généré le {new Date(brand.generatedAt).toLocaleString('fr-FR')}
                </p>
              );
            })()}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {SLOTS.map((slot) => {
              const url = (brand as Record<string, unknown>)[slot.storageSlot] as string | undefined;
              // Fix #152 — cache-bust via query param `?v=generatedAt` :
              // si l'admin re-génère, l'URL change → le browser refetch le PNG
              // au lieu de servir l'ancien depuis le cache. Indispensable car
              // Firebase Storage URLs n'ont pas de validation cache-control
              // courte par défaut → le browser peut conserver l'ancien PNG
              // jusqu'à plusieurs heures malgré une nouvelle version.
              const bustedUrl = url
                ? `${url}${url.includes('?') ? '&' : '?'}v=${brand.generatedAt || Date.now()}`
                : undefined;
              return (
                <Card
                  key={slot.key}
                  className="bg-black/40 border-white/10 p-3 space-y-2 flex flex-col items-center text-center"
                >
                  <div className="h-16 w-16 flex items-center justify-center bg-white/5 rounded-lg overflow-hidden">
                    {bustedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={bustedUrl}
                        alt={slot.label}
                        className="max-h-14 max-w-14 object-contain"
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-white/20" />
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-white text-xs font-medium">
                      {slot.label}{' '}
                      {url && <CheckCircle2 className="inline h-3 w-3 text-emerald-400 ml-0.5" />}
                    </p>
                    <p className="text-white/40 text-[10px] font-light leading-tight">
                      {slot.contextHint}
                    </p>
                    <p className="text-white/30 text-[10px] font-mono">{slot.size}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {!hasAnyBrand && !sourceFile && (
        <p className="text-white/40 text-xs text-center font-light italic">
          Aucun logo configuré pour le moment. Le site utilise actuellement le SVG par défaut.
        </p>
      )}
    </div>
  );
}
