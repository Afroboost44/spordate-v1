"use client";

import { useState, useEffect, FormEvent } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Edit, Trash2, Loader2, Clock, MapPin, Users, ImagePlus, X, Video, Play } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AudienceTypeSelector } from "@/components/partner/AudienceTypeSelector";
import type { AudienceType } from "@/lib/audience";
import { MediaManager } from "@/components/partner/MediaManager";
import type { MediaItem, PricingTier } from "@/types/firestore";
import { getMediaItems } from "@/lib/activities/media";
import {
  buildPricingTiersPayload,
  parsePricingTiersFromFirestore,
  suggestPricingTiersFromBase,
  validatePricingTiers,
} from "@/lib/billing/pricingTiersBuilder";
import { useLanguage } from "@/context/LanguageContext";
import { getVideoThumbnailChain } from "@/lib/activities/mediaParser";
import { shouldCancelSessionOnActivityRemoval } from "@/lib/activities/lifecycle";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, orderBy, Timestamp, writeBatch
} from 'firebase/firestore';
import { computeFallbackTiers } from '@/services/firestore';

/**
 * BUG #3 — Cascade suppression/désactivation activity → sessions futures.
 * Marque les sessions futures non-annulées (status → 'cancelled') via WriteBatch
 * atomique. Réutilise le pattern Phase 9.5 c33 (propagation aux sessions futures).
 * Retourne le nombre de sessions annulées.
 */
async function cascadeCancelFutureSessions(activityId: string): Promise<number> {
  if (!db) return 0;
  const now = Timestamp.now();
  const sessionsSnap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('activityId', '==', activityId),
      where('startAt', '>', now),
    ),
  );
  const nowMs = now.toMillis();
  const toCancel = sessionsSnap.docs.filter((sdoc) =>
    shouldCancelSessionOnActivityRemoval(
      sdoc.data() as { status?: string; startAt?: { toMillis?: () => number } },
      nowMs,
    ),
  );
  if (toCancel.length === 0) return 0;
  const batch = writeBatch(db);
  for (const sdoc of toCancel) {
    batch.update(sdoc.ref, { status: 'cancelled', updatedAt: serverTimestamp() });
  }
  await batch.commit();
  return toCancel.length;
}

interface Activity {
  activityId: string;
  partnerId: string;
  name: string;
  description: string;
  sport: string;
  price: number;
  duration: number;
  city: string;
  address: string;
  schedule: string;
  maxParticipants: number;
  currentParticipants: number;
  isActive: boolean;
  imageUrl: string;
  images?: string[];
  /** Phase 9.5 c4 — rich media items (image upload/URL OU video embed). */
  mediaUrls?: MediaItem[];
  audienceType?: AudienceType;
  /** Phase 9.5 c11 — Date prochaine séance (Firestore Timestamp côté lecture). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduledAt?: any;
  /** Phase 9.5 c31 BUG HH — 3 paliers de prix progressifs (optionnel — fallback c29a si absent). */
  defaultPricingTiers?: PricingTier[];
}

const SPORTS = [
  'Danse / Zumba', 'Afroboost', 'Salsa', 'Bachata', 'Hip-Hop',
  'Fitness', 'Yoga', 'Running', 'Tennis', 'Crossfit', 'Padel',
];

const CITIES = [
  'Genève', 'Lausanne', 'Zurich', 'Berne', 'Bâle', 'Lucerne', 'Fribourg', 'Neuchâtel',
];

/**
 * Phase 9.5 c20 — Card media partner-side (thumbnail-only, pas iframe live).
 *
 * Priorité d'affichage :
 *  1. mediaUrls[0] type='video' (YouTube) → thumbnail chain hq→mq→default + Play overlay
 *  2. mediaUrls[0] type='image' → <img> direct
 *  3. images[0] / imageUrl legacy → <img> direct
 *  4. Si rien → null (pas de section media affichée)
 *
 * Note : pour partner UI on garde thumbnail static (pas autoplay iframe pour
 * éviter les requests réseau N×N sur la liste). L'iframe live est sur
 * /sessions/[id] détail page uniquement (c18).
 */
function PartnerCardMedia({ act }: { act: Activity }) {
  const [imgIdx, setImgIdx] = useState(0);
  const items = getMediaItems({ mediaUrls: act.mediaUrls, images: act.images });
  const first = items[0];

  // Rien à afficher → card sans media
  if (!first && !act.imageUrl) return null;

  // Cas 1 : video → thumbnail chain
  if (first?.type === 'video') {
    const chain = getVideoThumbnailChain(first);
    const exhausted = imgIdx >= chain.length;
    return (
      <div className="relative h-36 w-full bg-zinc-900 overflow-hidden">
        {!exhausted ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={chain[imgIdx]}
            alt={act.name}
            className="w-full h-full object-cover"
            onError={() => setImgIdx((i) => i + 1)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Video className="h-12 w-12 text-white/30" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-2 backdrop-blur-sm">
            <Play className="h-5 w-5 text-[#D91CD2] fill-[#D91CD2]" aria-hidden="true" />
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] to-transparent pointer-events-none" />
        {items.length > 1 && (
          <span className="absolute top-2 right-2 bg-black/60 text-white/70 text-[10px] px-2 py-0.5 rounded-full">
            {items.length} médias
          </span>
        )}
      </div>
    );
  }

  // Cas 2 : image — mosaic si plusieurs (legacy comportement préservé)
  const legacyImages = act.images && act.images.length > 0
    ? act.images
    : (act.imageUrl ? [act.imageUrl] : []);
  const firstImageUrl = first?.type === 'image' ? first.url : legacyImages[0];
  const extraImages = first?.type === 'image'
    ? items.slice(1).filter((i) => i.type === 'image').map((i) => i.url)
    : legacyImages.slice(1);

  if (!firstImageUrl) return null;

  return (
    <div className="relative h-36 w-full">
      {extraImages.length > 0 ? (
        <div className="flex h-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={firstImageUrl} alt={act.name} className="w-1/2 h-full object-cover" />
          <div className="w-1/2 flex flex-col">
            {extraImages.slice(0, 2).map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img}
                alt={`${act.name} ${i + 2}`}
                className={`w-full ${extraImages.length > 1 ? 'h-1/2' : 'h-full'} object-cover`}
              />
            ))}
          </div>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={firstImageUrl} alt={act.name} className="w-full h-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] to-transparent" />
      {(extraImages.length > 0 || items.length > 1) && (
        <span className="absolute top-2 right-2 bg-black/60 text-white/70 text-[10px] px-2 py-0.5 rounded-full">
          {items.length > 0 ? `${items.length} médias` : `${legacyImages.length} photos`}
        </span>
      )}
    </div>
  );
}

export default function PartnerOffersPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSport, setFormSport] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formDuration, setFormDuration] = useState('60');
  const [formCity, setFormCity] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formSchedule, setFormSchedule] = useState('');
  const [formMax, setFormMax] = useState('10');
  const [formImages, setFormImages] = useState<string[]>(['', '', '']);
  const [formMediaItems, setFormMediaItems] = useState<MediaItem[]>([]);
  const [formAudienceType, setFormAudienceType] = useState<AudienceType>('all');
  // Phase 9.5 c11 — date prochaine séance (optionnel, datetime-local format)
  const [formScheduledAt, setFormScheduledAt] = useState('');
  // Phase 9.5 c31 BUG HH — édition pricing tiers
  const [formPricingEnabled, setFormPricingEnabled] = useState(false);
  const [formEarlyPrice, setFormEarlyPrice] = useState('');
  const [formStandardPrice, setFormStandardPrice] = useState('');
  const [formLastPrice, setFormLastPrice] = useState('');
  const { t } = useLanguage();

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadActivities();
  }, [user]);

  const loadActivities = async () => {
    if (!db || !user) return;
    try {
      let snap;
      try {
        const q = query(collection(db, 'activities'), where('partnerId', '==', user.uid), orderBy('createdAt', 'desc'));
        snap = await getDocs(q);
      } catch {
        // Index might not be ready, retry without orderBy
        console.warn('[Partner] Index not ready, fetching without orderBy');
        const q = query(collection(db, 'activities'), where('partnerId', '==', user.uid));
        snap = await getDocs(q);
      }
      setActivities(snap.docs.map(d => ({ ...d.data(), activityId: d.id } as Activity)));
    } catch (err) { console.error('Erreur chargement activités:', err); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setFormName(''); setFormDesc(''); setFormSport(''); setFormPrice(''); setFormDuration('60');
    setFormCity(''); setFormAddress(''); setFormSchedule(''); setFormMax('10'); setFormImages(['', '', '']);
    setFormMediaItems([]);
    setFormAudienceType('all');
    setFormScheduledAt('');
    // Phase 9.5 c31 — reset pricing tiers
    setFormPricingEnabled(false);
    setFormEarlyPrice('');
    setFormStandardPrice('');
    setFormLastPrice('');
  };

  const openCreate = () => { setEditing(null); resetForm(); setOpen(true); };

  const openEdit = (act: Activity) => {
    setEditing(act); setFormName(act.name); setFormDesc(act.description || ''); setFormSport(act.sport);
    setFormPrice(String(act.price)); setFormDuration(String(act.duration || 60)); setFormCity(act.city);
    setFormAddress(act.address || ''); setFormSchedule(act.schedule); setFormMax(String(act.maxParticipants));
    // Load images: use images array if available, fallback to single imageUrl
    const imgs = act.images && act.images.length > 0
      ? [...act.images, '', '', ''].slice(0, 3)
      : [act.imageUrl || '', '', ''];
    setFormImages(imgs);
    // Phase 9.5 c4 — load mediaUrls (rich) avec fallback images (string[]) via getMediaItems
    setFormMediaItems(getMediaItems(act));
    setFormAudienceType(act.audienceType ?? 'all');
    // Phase 9.5 c11 — load scheduledAt (Timestamp → input datetime-local format YYYY-MM-DDTHH:mm)
    if (act.scheduledAt) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ts = act.scheduledAt as any;
      const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
      // Local time → datetime-local string (no Z, no offset, browser timezone)
      const pad = (n: number) => String(n).padStart(2, '0');
      const localStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setFormScheduledAt(localStr);
    } else {
      setFormScheduledAt('');
    }
    // Phase 9.5 c31 — pré-remplir les 3 inputs depuis defaultPricingTiers Firestore
    const parsed = parsePricingTiersFromFirestore(act.defaultPricingTiers);
    if (parsed) {
      setFormPricingEnabled(true);
      setFormEarlyPrice(String(parsed.earlyCHF));
      setFormStandardPrice(String(parsed.standardCHF));
      setFormLastPrice(String(parsed.lastMinuteCHF));
    } else {
      setFormPricingEnabled(false);
      setFormEarlyPrice('');
      setFormStandardPrice('');
      setFormLastPrice('');
    }
    setOpen(true);
  };

  // Phase 9.5 c31 — toggle ON depuis OFF : pré-remplir avec les valeurs suggérées
  // (80/100/120% du formPrice actuel). Aussi appelé par "Réinitialiser".
  const populateSuggestedTiers = () => {
    const base = parseInt(formPrice) || 0;
    const sug = suggestPricingTiersFromBase(base);
    setFormEarlyPrice(String(sug.earlyCHF));
    setFormStandardPrice(String(sug.standardCHF));
    setFormLastPrice(String(sug.lastMinuteCHF));
  };

  const handleTogglePricing = (next: boolean) => {
    setFormPricingEnabled(next);
    // Au passage OFF→ON, pré-remplir si les inputs sont vides
    if (next && !formEarlyPrice && !formStandardPrice && !formLastPrice) {
      populateSuggestedTiers();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;

    // Phase 9.5 c31 — Validation pricing tiers AVANT submit (bloquant si invalide)
    let pricingTiersPayload: PricingTier[] = [];
    if (formPricingEnabled) {
      const tiersInput = {
        earlyCHF: parseFloat(formEarlyPrice) || 0,
        standardCHF: parseFloat(formStandardPrice) || 0,
        lastMinuteCHF: parseFloat(formLastPrice) || 0,
      };
      try {
        validatePricingTiers(tiersInput);
      } catch (validationErr) {
        const code = validationErr instanceof Error ? validationErr.message : 'invalid';
        toast({
          variant: 'destructive',
          title: 'Prix progressif invalide',
          description:
            code === 'order'
              ? t('partner_pricing_validation_order')
              : 'Tous les prix doivent être supérieurs à 0.',
        });
        return;
      }
      pricingTiersPayload = buildPricingTiersPayload(true, tiersInput);
    }

    setSaving(true);
    try {
      const filteredImages = formImages.filter(url => url.trim() !== '');
      // Phase 9.5 c4 — derive backward compat images[] from formMediaItems (1ère image type='image')
      // Conserve aussi formImages legacy si MediaManager pas encore utilisé (transition douce).
      const mediaItemsImages = formMediaItems
        .filter(m => m.type === 'image')
        .map(m => m.url);
      const finalImages = mediaItemsImages.length > 0 ? mediaItemsImages : filteredImages;
      // Phase 9.5 c11 — scheduledAt : datetime-local string → JS Date (browser timezone)
      // → Firestore Timestamp.fromDate (Admin SDK convertit automatiquement via setDoc).
      // Empty string = pas de séance planifiée → null explicite (override edit).
      const scheduledAtValue = formScheduledAt
        ? new Date(formScheduledAt)
        : null;
      const data = {
        name: formName, description: formDesc, sport: formSport,
        price: parseInt(formPrice) || 0, duration: parseInt(formDuration) || 60,
        city: formCity, address: formAddress, schedule: formSchedule,
        maxParticipants: parseInt(formMax) || 10,
        images: finalImages,
        imageUrl: finalImages[0] || '',
        // Phase 9.5 c4 — rich mediaUrls (priorité MediaCarousel + getMediaItems backward compat)
        mediaUrls: formMediaItems,
        audienceType: formAudienceType,
        scheduledAt: scheduledAtValue,
        // Phase 9.5 c31 BUG HH — défaut tiers (vide = fallback c29a auto)
        defaultPricingTiers: pricingTiersPayload,
        partnerId: user.uid, isActive: true, updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'activities', editing.activityId), data);

        // Phase 9.5 c33 BUG#2 — Propagation aux sessions futures SANS réservations.
        // Bassi voyait /sessions/{X} avec anciens prix 8/10/12 alors qu'il avait
        // updaté l'Activity à 25 CHF côté /partner/offers. Sync uniquement les
        // sessions sans bookings (currentParticipants===0) pour respecter le V9
        // anti-cheat freeze + cohérence contractuelle envers les users payants.
        let synced = 0;
        let preserved = 0;
        try {
          const now = Timestamp.now();
          const sessionsQ = query(
            collection(db, 'sessions'),
            where('activityId', '==', editing.activityId),
            where('startAt', '>', now),
          );
          const sessionsSnap = await getDocs(sessionsQ);
          // Tiers à appliquer : priorité defaultPricingTiers (partner config),
          // sinon fallback automatique sur le nouveau price (cohérent c29a).
          const newTiers =
            pricingTiersPayload.length > 0
              ? pricingTiersPayload
              : computeFallbackTiers(data.price);
          const earlyTier = newTiers.find((t) => t.kind === 'early');
          for (const sdoc of sessionsSnap.docs) {
            const sdata = sdoc.data();
            if ((sdata.currentParticipants || 0) > 0) {
              preserved++;
              continue;
            }
            await updateDoc(sdoc.ref, {
              pricingTiers: newTiers,
              currentTier: 'early',
              currentPrice: earlyTier?.price ?? 0,
            });
            synced++;
          }
        } catch (syncErr) {
          console.warn('[Offers] Session sync failed:', syncErr);
        }

        toast({
          title: 'Activité mise à jour !',
          description:
            synced + preserved === 0
              ? undefined
              : `${synced} session(s) future(s) synchronisée(s). ${preserved} préservée(s) (réservations).`,
        });
      } else {
        const ref = doc(collection(db, 'activities'));
        await setDoc(ref, { ...data, activityId: ref.id, currentParticipants: 0, rating: 0, reviewCount: 0, createdAt: serverTimestamp() });
        toast({ title: 'Activité créée !', description: `"${formName}" est maintenant visible.` });
      }
      setOpen(false); resetForm(); setEditing(null); await loadActivities();
    } catch (err) { toast({ variant: 'destructive', title: 'Erreur', description: String(err) }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (act: Activity) => {
    if (!db || !confirm(`Supprimer "${act.name}" ?`)) return;
    try {
      // BUG #3 — cascade AVANT le hard-delete : sinon les sessions futures
      // deviennent orphelines (activity introuvable, mais session "Réserver" active).
      const cancelled = await cascadeCancelFutureSessions(act.activityId);
      await deleteDoc(doc(db, 'activities', act.activityId));
      toast({
        title: 'Activité supprimée',
        description: cancelled > 0 ? `${cancelled} session(s) future(s) annulée(s).` : undefined,
      });
      await loadActivities();
    }
    catch (err) { toast({ variant: 'destructive', title: 'Erreur', description: String(err) }); }
  };

  const handleToggleActive = async (act: Activity) => {
    if (!db) return;
    // Toggle active → inactive = soft-delete : il faut cascader sur les sessions.
    // Inactive → active = réactivation : on NE ressuscite PAS les sessions annulées
    // (le partenaire republie manuellement).
    const isDeactivating = act.isActive;
    await updateDoc(doc(db, 'activities', act.activityId), { isActive: !act.isActive, updatedAt: serverTimestamp() });
    if (isDeactivating) {
      try {
        const cancelled = await cascadeCancelFutureSessions(act.activityId);
        if (cancelled > 0) {
          toast({ title: 'Activité désactivée', description: `${cancelled} session(s) future(s) annulée(s).` });
        }
      } catch (err) {
        console.warn('[Offers] cascade cancel sessions failed:', err);
        toast({
          variant: 'destructive',
          title: 'Sessions non synchronisées',
          description: "Les sessions futures n'ont pas pu être annulées — réessaie de désactiver l'activité.",
        });
      }
    }
    await loadActivities();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-light text-white tracking-tight">Mes Activités</h1>
          <p className="text-sm text-white/40">Créez, modifiez ou supprimez vos activités sportives</p>
        </div>
        <Button onClick={openCreate} className="bg-white/5 backdrop-blur-xl border border-[#D91CD2] text-white font-light tracking-wider uppercase h-12 px-6 hover:bg-[#D91CD2]/10">
          <PlusCircle className="mr-2 h-4 w-4" /> Nouvelle activité
        </Button>
      </div>

      {activities.length === 0 ? (
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="py-12 text-center">
            <PlusCircle className="h-12 w-12 text-white/10 mx-auto mb-4" />
            <p className="text-white/30">Aucune activité pour le moment</p>
            <p className="text-xs text-white/20 mt-1">Créez votre première activité pour recevoir des réservations</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activities.map((act) => (
            <Card key={act.activityId} className={`bg-[#1A1A1A] border-white/5 transition-all overflow-hidden ${!act.isActive ? 'opacity-50' : ''}`}>
              {/* Phase 9.5 c20 BUG M — card media supporte mediaUrls (image + YouTube vidéo).
                  Avant : check uniquement images[]/imageUrl → card vide si partner avait
                  ajouté seulement une URL YouTube. Maintenant : utilise getMediaItems +
                  thumbnail chain pour les vidéos. */}
              <PartnerCardMedia act={act} />

              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-medium">{act.name}</h3>
                    <Badge className={`mt-1 text-xs ${act.isActive ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-white/5 text-white/30 border-white/10'}`}>
                      {act.isActive ? 'Actif' : 'Inactif'}
                    </Badge>
                  </div>
                  <Switch checked={act.isActive} onCheckedChange={() => handleToggleActive(act)} />
                </div>
                {act.description && (
                  <p className="text-xs text-white/30 mb-3 line-clamp-2">{act.description}</p>
                )}
                <div className="space-y-2 text-sm text-white/50 mb-4">
                  <p className="flex items-center gap-2"><span className="text-[#D91CD2]">{act.sport}</span> · <span className="text-white font-medium">{act.price} CHF</span> · <span>{act.duration || 60} min</span></p>
                  <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {act.city}{act.address ? ` — ${act.address}` : ''}</p>
                  <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {act.schedule}</p>
                  <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {act.currentParticipants || 0}/{act.maxParticipants} participants</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => openEdit(act)} variant="outline" size="sm" className="flex-1 border-white/10 text-white/50 hover:text-white"><Edit className="h-3.5 w-3.5 mr-1.5" /> Modifier</Button>
                  <Button onClick={() => handleDelete(act)} variant="outline" size="sm" className="border-red-500/20 text-red-400/50 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); resetForm(); } }}>
        {/* Phase 9.5 c35 BUG2 — override DialogContent shadcn p-6 → p-4 (Option B).
            Réduit le padding interne 24px → 16px sur cette modal uniquement, sans
            impacter les autres modals du site. Résout la "zone vide à droite" qui
            persistait malgré c31.1/c32.1/c34 (cause = DialogContent.p-6, jamais
            touché précédemment, pas la grid pricing). */}
        <DialogContent className="sm:max-w-[500px] bg-black border-white/10 p-4">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-white text-xl font-light">{editing ? "Modifier l'activité" : "Nouvelle activité"}</DialogTitle>
              <DialogDescription>{editing ? "Mettez à jour les détails." : "Créez une activité pour recevoir des réservations."}</DialogDescription>
            </DialogHeader>
            {/* Phase 9.5 c34 BUG#6 — Retrait pr-2 (gutter scrollbar) qui laissait
                une zone vide ~8px à droite après que c25 ait rendu la scrollbar
                globale 6px auto-hide transparente. La scrollbar se superpose
                légèrement (6px) au contenu au hover, acceptable car auto-hide. */}
            <div className="grid gap-4 py-6 max-h-[60vh] overflow-y-auto">
              <div className="grid gap-2">
                <Label className="text-white/50">Nom de l&apos;activité *</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Cours de Zumba" className="bg-[#1A1A1A] border-white/10 h-12" required />
              </div>
              <div className="grid gap-2">
                <Label className="text-white/50">Description</Label>
                <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Décrivez votre activité, l'ambiance, ce que les participants vont vivre..." className="bg-[#1A1A1A] border border-white/10 rounded-md px-3 py-2 text-sm text-white min-h-[80px] resize-none focus:outline-none focus:ring-1 focus:ring-[#D91CD2]" />
              </div>
              {/* Phase 9.5 c4 — MediaManager (drag&drop reorder + image upload + URL embed) */}
              {user && (
                <MediaManager
                  value={formMediaItems}
                  onChange={setFormMediaItems}
                  partnerId={user.uid}
                  maxItems={5}
                  disabled={saving}
                />
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">Sport *</Label>
                  <Select value={formSport} onValueChange={setFormSport}><SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12"><SelectValue placeholder="Choisir" /></SelectTrigger><SelectContent>{SPORTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">Prix (CHF) *</Label>
                  <Input value={formPrice} onChange={e => setFormPrice(e.target.value)} type="number" placeholder="25" className="bg-[#1A1A1A] border-white/10 h-12" required />
                </div>
              </div>

              {/* Phase 9.5 c31 BUG HH — Section Prix progressif (optionnel) */}
              <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Label className="text-white text-sm font-medium">
                      {t('partner_pricing_section_title')}
                    </Label>
                    <p className="text-xs text-white/40 mt-1">
                      {t('partner_pricing_helper')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      checked={formPricingEnabled}
                      onCheckedChange={handleTogglePricing}
                      aria-label={t('partner_pricing_toggle_label')}
                    />
                    <span className="text-xs text-white/60">
                      {t('partner_pricing_toggle_label')}
                    </span>
                  </div>
                </div>

                {formPricingEnabled ? (
                  <div className="space-y-3">
                    {/* Phase 9.5 c32.1 fix radical — stack vertical permanent (label
                        + input fixe à droite + CHF). Anciens grid-cols-3 (c31) puis
                        responsive grid (c31.1) débordaient encore sur modal ~470px.
                        Layout label flex-1 + input w-20 fixe + "CHF" trailing : pas de
                        possibilité d'overflow horizontal quel que soit le viewport. */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <Label className="text-xs text-white/50 flex-1 min-w-0 truncate">
                          {t('partner_pricing_early_label')}
                        </Label>
                        <Input
                          type="number"
                          value={formEarlyPrice}
                          onChange={(e) => setFormEarlyPrice(e.target.value)}
                          placeholder="12"
                          className="w-20 h-9 text-sm bg-[#0D0D0D] border-white/10"
                        />
                        <span className="text-xs text-white/30 w-8 text-right">CHF</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Label className="text-xs text-white/50 flex-1 min-w-0 truncate">
                          {t('partner_pricing_standard_label')}
                        </Label>
                        <Input
                          type="number"
                          value={formStandardPrice}
                          onChange={(e) => setFormStandardPrice(e.target.value)}
                          placeholder="15"
                          className="w-20 h-9 text-sm bg-[#0D0D0D] border-white/10"
                        />
                        <span className="text-xs text-white/30 w-8 text-right">CHF</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Label className="text-xs text-white/50 flex-1 min-w-0 truncate">
                          {t('partner_pricing_last_label')}
                        </Label>
                        <Input
                          type="number"
                          value={formLastPrice}
                          onChange={(e) => setFormLastPrice(e.target.value)}
                          placeholder="18"
                          className="w-20 h-9 text-sm bg-[#0D0D0D] border-white/10"
                        />
                        <span className="text-xs text-white/30 w-8 text-right">CHF</span>
                      </div>
                    </div>
                    {(() => {
                      const e = parseFloat(formEarlyPrice) || 0;
                      const s = parseFloat(formStandardPrice) || 0;
                      const l = parseFloat(formLastPrice) || 0;
                      if (e && s && l && !(e < s && s < l)) {
                        return (
                          <p className="text-[11px] text-red-400/80">
                            {t('partner_pricing_validation_order')}
                          </p>
                        );
                      }
                      return null;
                    })()}
                    <button
                      type="button"
                      onClick={populateSuggestedTiers}
                      className="text-[11px] text-[#D91CD2]/70 hover:text-[#D91CD2] underline transition-colors"
                    >
                      {t('partner_pricing_reset_button')}
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-white/30 font-light">
                    {t('partner_pricing_disabled_info', { price: parseInt(formPrice) || 0 })}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">Durée (min) *</Label>
                  <Input value={formDuration} onChange={e => setFormDuration(e.target.value)} type="number" placeholder="60" className="bg-[#1A1A1A] border-white/10 h-12" required />
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">Places max</Label>
                  <Input value={formMax} onChange={e => setFormMax(e.target.value)} type="number" placeholder="10" className="bg-[#1A1A1A] border-white/10 h-12" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">Ville *</Label>
                  <Select value={formCity} onValueChange={setFormCity}><SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12"><SelectValue placeholder="Choisir" /></SelectTrigger><SelectContent>{CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">Adresse</Label>
                  <Input value={formAddress} onChange={e => setFormAddress(e.target.value)} placeholder="Rue du Sport 12" className="bg-[#1A1A1A] border-white/10 h-12" />
                </div>
              </div>
              {/* Phase 9.5 c33 BUG#1 — Champ "Horaires *" texte libre retiré pour
                  simplification (confusion 2 champs horaires côté Bassi). Le seul
                  champ de planning est désormais "Prochaine séance" (datetime-local
                  structuré), maintenant OBLIGATOIRE. Backward-compat : on conserve
                  schedule:formSchedule dans le payload (vide pour les nouvelles
                  activités) pour ne pas casser les Activities legacy en lecture. */}
              <div className="grid gap-2">
                <Label className="text-white/50 flex items-center justify-between">
                  <span>Prochaine séance — date et heure *</span>
                </Label>
                <Input
                  type="datetime-local"
                  value={formScheduledAt}
                  onChange={e => setFormScheduledAt(e.target.value)}
                  className="bg-[#1A1A1A] border-white/10 h-12 text-white"
                  required
                />
                <p className="text-[11px] text-white/40">
                  Date et heure de la prochaine séance disponible à la réservation.
                  Un compte à rebours s&apos;affiche aux participants sur leur page de réservation.
                </p>
              </div>
              {/* Phase 9 SC6 c1/4 — Audience type selector (Q1=A enum) */}
              <AudienceTypeSelector value={formAudienceType} onChange={setFormAudienceType} disabled={saving} />
            </div>
            <DialogFooter className="gap-2">
              <DialogClose asChild><Button type="button" variant="outline" className="border-white/10">Annuler</Button></DialogClose>
              <Button type="submit" disabled={saving} className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? "Mettre à jour" : "Publier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
