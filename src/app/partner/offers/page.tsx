"use client";

import { useState, useEffect, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Edit, Trash2, Loader2, Clock, MapPin, Users, ImagePlus, X, Video, Play, Calendar, Gift, Lock, Edit3, ChevronLeft, ChevronRight, Check, Copy } from 'lucide-react';
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
import { AddressAutocomplete } from "@/components/partner/AddressAutocomplete";
import {
  VenueDetailsSection,
  type VenueDetailsValue,
} from "@/components/partner/VenueDetailsSection";
import {
  StoreOfferSection,
  type StoreOfferValue,
} from "@/components/partner/StoreOfferSection";
import type { MediaItem, PricingTier, Session, Partner, PartnerType } from "@/types/firestore";
import { isVenuePartner, isSportsStorePartner } from "@/types/firestore";
import { getBookingPriceCHF } from "@/lib/booking/price";
import { SessionEditModal } from "@/components/partner/SessionEditModal";
import { CreateSessionModal } from "@/components/partner/CreateSessionModal";
import { getMediaItems } from "@/lib/activities/media";
import {
  buildPricingTiersPayload,
  parsePricingTiersFromFirestore,
  suggestPricingTiersFromBase,
  validatePricingTiers,
} from "@/lib/billing/pricingTiersBuilder";
import { useLanguage } from "@/context/LanguageContext";
import { getVideoThumbnailChain } from "@/lib/activities/mediaParser";
import { isStorageVideoUrl } from "@/lib/media/driveMigration";
import { shouldCancelSessionOnActivityRemoval } from "@/lib/activities/lifecycle";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, orderBy, Timestamp, writeBatch
} from 'firebase/firestore';
import { computeFallbackTiers } from '@/services/firestore';
import { limit as firestoreLimit } from 'firebase/firestore';

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
  /** BUG #57 — Détails cadre/ambiance (bar/club/restaurant uniquement). */
  venueDetails?: VenueDetailsValue;
  /** BUG #58 — Avantage magasin + matériel (sports-store uniquement). */
  storeOffer?: StoreOfferValue;
  /** BUG #57 — Type partner denormalisé sur l'activity (gate conditionnel UI public). */
  partnerType?: PartnerType;
}

const SPORTS = [
  'Danse / Zumba', 'Afroboost', 'Salsa', 'Bachata', 'Hip-Hop',
  'Fitness', 'Yoga', 'Running', 'Tennis', 'Crossfit', 'Padel',
];
// BUG #53 — option "Autre" en bas du select sport. Si sélectionnée, un champ
// texte libre apparaît pour permettre au partenaire d'entrer son propre sport.
const SPORT_OTHER_VALUE = '__other__';

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
  const { t: tMedia } = useLanguage();
  const items = getMediaItems({ mediaUrls: act.mediaUrls, images: act.images });
  const first = items[0];

  // Rien à afficher → card sans media
  if (!first && !act.imageUrl) return null;

  // Cas 1 : video → thumbnail chain
  if (first?.type === 'video') {
    // Fix #207 — Cover custom (frame choisie via VideoThumbnailPicker). Si une
    // miniature custom existe, elle gagne TOUJOURS : on rend l'image statique
    // (persistante) au lieu de la 1ère frame de la vidéo. Sans ce court-circuit,
    // la branche `isUploadedVideo` ci-dessous rendait <video #t=0.1> et la frame
    // choisie n'apparaissait jamais. Vidéos sans cover → comportement inchangé.
    if (first.thumbnailUrl) {
      return (
        <div className="relative h-36 w-full bg-zinc-900 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={first.thumbnailUrl}
            alt={act.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/50 rounded-full p-2 backdrop-blur-sm">
              <Play className="h-5 w-5 text-accent fill-accent" aria-hidden="true" />
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] to-transparent pointer-events-none" />
          {items.length > 1 && (
            <span className="absolute top-2 right-2 bg-black/60 text-white/70 text-[10px] px-2 py-0.5 rounded-full">
              {items.length} {tMedia('partner_offers_media_unit')}
            </span>
          )}
        </div>
      );
    }
    // BUG #63 — Régression "play icon sans aperçu" sur la liste /partner/offers.
    // Cause identique à BUG #60 (cards /activities) + #62 (modal media row) :
    // pour les vidéos uploadées vers Firebase Storage, getVideoThumbnailChain
    // retourne un tableau vide (chain provider-specific YouTube/Drive only) →
    // exhausted=true direct → fallback icône Video et l'aperçu vidéo manque.
    // Fix : court-circuit avec <video preload="metadata"> qui affiche la
    // première frame sans télécharger toute la vidéo. Pas d'autoplay (le
    // commentaire historique au-dessus de PartnerCardMedia note qu'on évite
    // les requests réseau N×N sur la liste, preload="metadata" respecte ça).
    const isUploadedVideo =
      first.source === 'upload' || isStorageVideoUrl(first.url);
    if (isUploadedVideo && first.url) {
      // BUG #102 — Régression aperçu vidéo : Firebase Storage + preload metadata
      // ne charge plus la 1ère frame sur certains navigateurs (Safari, iOS PWA).
      // Fix : Media Fragments #t=0.1 force le seek + preload="auto" pour avoir
      // assez d'octets pour décoder.
      const srcWithFragment = first.url.includes('#') ? first.url : `${first.url}#t=0.1`;
      return (
        <div className="relative h-36 w-full bg-zinc-900 overflow-hidden">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={srcWithFragment}
            muted
            playsInline
            preload="auto"
            className="w-full h-full object-cover pointer-events-none"
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/50 rounded-full p-2 backdrop-blur-sm">
              <Play className="h-5 w-5 text-accent fill-accent" aria-hidden="true" />
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] to-transparent pointer-events-none" />
          {items.length > 1 && (
            <span className="absolute top-2 right-2 bg-black/60 text-white/70 text-[10px] px-2 py-0.5 rounded-full">
              {items.length} {tMedia('partner_offers_media_unit')}
            </span>
          )}
        </div>
      );
    }

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
            <Play className="h-5 w-5 text-accent fill-accent" aria-hidden="true" />
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] to-transparent pointer-events-none" />
        {items.length > 1 && (
          <span className="absolute top-2 right-2 bg-black/60 text-white/70 text-[10px] px-2 py-0.5 rounded-full">
            {items.length} {tMedia('partner_offers_media_unit')}
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
          {items.length > 0 ? `${items.length} ${tMedia('partner_offers_media_unit')}` : `${legacyImages.length} ${tMedia('partner_offers_photos_unit')}`}
        </span>
      )}
    </div>
  );
}

export default function PartnerOffersPage() {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  // Admin override : si l'utilisateur connecté est admin, on charge TOUTES les
  // activités (pas le filtre `partnerId == user.uid`). Le admin peut alors
  // éditer/supprimer/dupliquer/toggle n'importe quelle activité du site.
  // Cohérent avec firestore.rules /activities/{id} ligne ~227 où update/delete
  // sont déjà gated par `(partnerId == auth.uid) || isAdmin()`.
  const isAdmin = userProfile?.role === 'admin';

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);

  // BUG #53 — multi-step form (3 étapes). Reset à 1 quand le modal ouvre/ferme.
  // Étape 1 : Bases (Nom, Sport, Description)
  // Étape 2 : Logistique & Prix (Prix + progressif, Durée, Places, Ville, Adresse, Date)
  // Étape 3 : Médias & Ciblage (MediaManager, AudienceType)
  const [formStep, setFormStep] = useState<1 | 2 | 3>(1);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  // Fix #177 — Traductions optionnelles EN + DE pour titre + description.
  // Tabs FR/EN/DE dans l'étape 1 de la modal. Sauvegardé dans
  // activities/{id}.translations.{en,de}.{title,description}.
  const [formNameEn, setFormNameEn] = useState('');
  const [formDescEn, setFormDescEn] = useState('');
  const [formNameDe, setFormNameDe] = useState('');
  const [formDescDe, setFormDescDe] = useState('');
  const [formLangTab, setFormLangTab] = useState<'fr' | 'en' | 'de'>('fr');
  const [formSport, setFormSport] = useState('');
  // BUG #53 — flag "sport personnalisé" : true si user a choisi "Autre" dans
  // le select. Permet d'afficher l'input texte libre + de re-sélectionner
  // "Autre" dans la dropdown même quand formSport est vide ou custom.
  const [useCustomSport, setUseCustomSport] = useState(false);
  const [formPrice, setFormPrice] = useState('');
  const [formDuration, setFormDuration] = useState('60');
  const [formCity, setFormCity] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formSchedule, setFormSchedule] = useState('');
  const [formMax, setFormMax] = useState('10');
  const [formImages, setFormImages] = useState<string[]>(['', '', '']);
  const [formMediaItems, setFormMediaItems] = useState<MediaItem[]>([]);
  const [formAudienceType, setFormAudienceType] = useState<AudienceType>('all');
  // BUG #57 — Détails Cadre & Ambiance (rendu conditionnel partnerType bar/club/restaurant).
  const [formVenueDetails, setFormVenueDetails] = useState<VenueDetailsValue>({});
  // BUG #58 — Avantage magasin + test/prêt matériel (rendu conditionnel partnerType sports-store).
  const [formStoreOffer, setFormStoreOffer] = useState<StoreOfferValue>({});
  // BUG #57 — Doc partner fetché une fois au mount pour détecter le type
  // (bar/club/restaurant → affiche VenueDetailsSection en étape 3).
  const [partnerData, setPartnerData] = useState<Partner | null>(null);
  // Phase 9.5 c11 — date prochaine séance (optionnel, datetime-local format)
  const [formScheduledAt, setFormScheduledAt] = useState('');
  // Phase 9.5 c31 BUG HH — édition pricing tiers
  const [formPricingEnabled, setFormPricingEnabled] = useState(false);
  const [formEarlyPrice, setFormEarlyPrice] = useState('');
  const [formStandardPrice, setFormStandardPrice] = useState('');
  const [formLastPrice, setFormLastPrice] = useState('');
  // Fix B B1 (refactor) — sessions futures de l'activité éditée, chargées
  // dès l'ouverture du modal d'édition. Affichées en bas du formulaire pour
  // permettre au partenaire de voir + éditer le prix de chaque session.
  const [editingSessions, setEditingSessions] = useState<Session[]>([]);
  const [loadingEditingSessions, setLoadingEditingSessions] = useState(false);
  // Fix B B2/Option3 — modal édition session (date + prix + delete)
  const [editSessionModalOpen, setEditSessionModalOpen] = useState(false);
  const [editSessionTarget, setEditSessionTarget] = useState<Session | null>(null);
  // Fix B Option 3 — modal création nouvelle session
  const [createSessionModalOpen, setCreateSessionModalOpen] = useState(false);
  const [sessionsRefreshTick, setSessionsRefreshTick] = useState(0);
  const { t } = useLanguage();
  // Admin deep-link : `?edit=<activityId>` ouvre directement le modal d'édition.
  // Utilisé par AdminActivityActions sur /activities/[id] pour amener l'admin
  // ici en un clic. Appliqué une fois quand activities sont chargées.
  const searchParams = useSearchParams();
  const editTargetId = searchParams?.get('edit') || null;
  const [autoEditApplied, setAutoEditApplied] = useState(false);

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadActivities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  // BUG #57 — Fetch du Partner doc une fois au mount pour récupérer
  // partner.type (gate conditionnel "Cadre & Ambiance" en étape 3).
  //
  // ATTENTION convention double : selon la flow de création, le partner doc
  // est stocké soit à `partners/{uid}` (legacy), soit à `partners/partner-{uid}`
  // (auto-create via /partner/login, ref. connectHelpers.ts ligne 83). On essaie
  // d'abord la version préfixée (plus récente, convention canonique), puis
  // fallback sur uid brut. Identique au pattern getPartnerStripeAccount.
  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const prefixedSnap = await getDoc(doc(db!, 'partners', `partner-${user.uid}`));
        if (cancelled) return;
        if (prefixedSnap.exists()) {
          setPartnerData(prefixedSnap.data() as Partner);
          return;
        }
        const rawSnap = await getDoc(doc(db!, 'partners', user.uid));
        if (!cancelled && rawSnap.exists()) {
          setPartnerData(rawSnap.data() as Partner);
        }
      } catch (e) {
        console.warn('[Offers] Could not fetch partner doc', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Fix B B1 — Fetch sessions futures de l'activité éditée pour les afficher
  // dans la section "Sessions à venir" du modal (sous les champs form).
  // B2/Option3 : re-fetch après chaque create/save/delete via sessionsRefreshTick.
  useEffect(() => {
    if (!open || !editing || !db || !isFirebaseConfigured) {
      setEditingSessions([]);
      return;
    }
    let cancelled = false;
    setLoadingEditingSessions(true);
    (async () => {
      try {
        const nowTs = Timestamp.now();
        let snap;
        try {
          const q = query(
            collection(db!, 'sessions'),
            where('activityId', '==', editing.activityId),
            where('startAt', '>', nowTs),
            orderBy('startAt', 'asc'),
            firestoreLimit(50),
          );
          snap = await getDocs(q);
        } catch {
          // Fallback : index pas prêt → query sans orderBy + sort client-side
          const q = query(
            collection(db!, 'sessions'),
            where('activityId', '==', editing.activityId),
            firestoreLimit(50),
          );
          snap = await getDocs(q);
        }
        if (cancelled) return;
        const now = Date.now();
        const futures = snap.docs
          .map((d) => ({ ...(d.data() as Session), sessionId: d.id }))
          .filter((s) => s.startAt && s.startAt.toMillis() > now)
          .sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
        setEditingSessions(futures);
      } catch (err) {
        console.warn('[Offers] sessions list load failed', err);
      } finally {
        if (!cancelled) setLoadingEditingSessions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing, sessionsRefreshTick]);

  const handleEditSession = (session: Session) => {
    setEditSessionTarget(session);
    setEditSessionModalOpen(true);
  };

  const handleOpenCreateSession = () => {
    setCreateSessionModalOpen(true);
  };

  const handleSessionMutated = () => {
    setSessionsRefreshTick((tick) => tick + 1);
  };

  const loadActivities = async () => {
    if (!db || !user) return;
    try {
      let snap;
      try {
        // Admin : pas de filtre partnerId → charge toutes les activités du site.
        // Partner : filtre habituel par owner.
        const q = isAdmin
          ? query(collection(db, 'activities'), orderBy('createdAt', 'desc'))
          : query(collection(db, 'activities'), where('partnerId', '==', user.uid), orderBy('createdAt', 'desc'));
        snap = await getDocs(q);
      } catch {
        // Index might not be ready, retry without orderBy
        console.warn('[Partner] Index not ready, fetching without orderBy');
        const q = isAdmin
          ? query(collection(db, 'activities'))
          : query(collection(db, 'activities'), where('partnerId', '==', user.uid));
        snap = await getDocs(q);
      }
      setActivities(snap.docs.map(d => ({ ...d.data(), activityId: d.id } as Activity)));
    } catch (err) { console.error('Erreur chargement activités:', err); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setFormStep(1); // BUG #53 — toujours revenir à l'étape 1 au reset
    setUseCustomSport(false); // BUG #53 — reset flag custom sport
    setFormName(''); setFormDesc(''); setFormSport(''); setFormPrice(''); setFormDuration('60');
    // Fix #177 — Reset traductions à chaque nouveau formulaire
    setFormNameEn(''); setFormDescEn(''); setFormNameDe(''); setFormDescDe(''); setFormLangTab('fr');
    setFormCity(''); setFormAddress(''); setFormSchedule(''); setFormMax('10'); setFormImages(['', '', '']);
    setFormMediaItems([]);
    setFormAudienceType('all');
    setFormVenueDetails({}); // BUG #57 — reset Cadre & Ambiance
    setFormStoreOffer({}); // BUG #58 — reset Avantages partenaire
    setFormScheduledAt('');
    // Phase 9.5 c31 — reset pricing tiers
    setFormPricingEnabled(false);
    setFormEarlyPrice('');
    setFormStandardPrice('');
    setFormLastPrice('');
  };

  // BUG #53 — validation par étape avant de passer à la suivante.
  // Toast d'erreur si champ obligatoire manquant.
  const validateStep = (step: 1 | 2 | 3): { ok: boolean; reason?: string } => {
    if (step === 1) {
      if (!formName.trim()) return { ok: false, reason: t('partner_offers_val_name_required') };
      if (!formSport) return { ok: false, reason: t('partner_offers_val_sport_required') };
      return { ok: true };
    }
    if (step === 2) {
      if (!formPrice || Number(formPrice) < 0) return { ok: false, reason: t('partner_offers_val_price_invalid') };
      if (!formCity) return { ok: false, reason: t('partner_offers_val_city_required') };
      if (!formScheduledAt) return { ok: false, reason: t('partner_offers_val_date_required') };
      return { ok: true };
    }
    return { ok: true };
  };

  // BUG #53 fix phantom click — quand user passe step 2 → step 3, le bouton
  // "Suivant" est remplacé par "Publier" à la même position du DOM. Le mouseup
  // de l'user atterit alors sur Publier → submit accidentel. Solution : un
  // flag "stepTransitioning" qui désactive le Publier pendant 300ms après
  // chaque transition de step.
  const [stepTransitioning, setStepTransitioning] = useState(false);

  const handleStepNext = () => {
    const v = validateStep(formStep);
    if (!v.ok) {
      toast({ title: t('partner_offers_toast_required_title'), description: v.reason, variant: 'destructive' });
      return;
    }
    if (formStep < 3) {
      setStepTransitioning(true);
      setFormStep((s) => (s + 1) as 1 | 2 | 3);
      // 300ms suffit largement à laisser le mouseup tomber sur l'ancien Suivant
      // (qui a été unmount mais le click handler navigateur consomme l'event).
      setTimeout(() => setStepTransitioning(false), 300);
    }
  };
  const handleStepPrev = () => {
    if (formStep > 1) setFormStep((s) => (s - 1) as 1 | 2 | 3);
  };

  // Admin deep-link `?edit=<id>` — quand les activités sont chargées, si l'URL
  // contient `?edit=<id>` et qu'une activité matche, on ouvre automatiquement
  // le modal d'édition. One-shot (autoEditApplied flag).
  useEffect(() => {
    if (autoEditApplied) return;
    if (loading) return;
    if (!editTargetId) return;
    const target = activities.find(a => a.activityId === editTargetId);
    if (!target) return;
    setAutoEditApplied(true);
    openEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activities, editTargetId, autoEditApplied]);

  const openCreate = () => { setEditing(null); resetForm(); setOpen(true); };

  const openEdit = (act: Activity) => {
    setEditing(act); setFormName(act.name); setFormDesc(act.description || ''); setFormSport(act.sport);
    // Fix #177 — Pré-remplir les traductions existantes (act.translations) si présentes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tr = (act as any).translations || {};
    setFormNameEn(tr.en?.title || ''); setFormDescEn(tr.en?.description || '');
    setFormNameDe(tr.de?.title || ''); setFormDescDe(tr.de?.description || '');
    setFormLangTab('fr');
    setFormStep(1); // BUG #53 — toujours ouvrir édition à l'étape 1
    setUseCustomSport(act.sport !== '' && !SPORTS.includes(act.sport)); // BUG #53 — custom sport si sport pas dans liste
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
    // BUG #57 — load venueDetails persisted (objet vide si jamais saved)
    setFormVenueDetails(act.venueDetails ?? {});
    // BUG #58 — load storeOffer persisted (objet vide si jamais saved)
    setFormStoreOffer(act.storeOffer ?? {});
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
    // BUG #53 — guard : submit ne peut s'exécuter QUE depuis l'étape 3 (la
    // seule où le bouton "Publier" est rendu). Si un autre événement déclenche
    // submit (touche Enter, bouton sans type=button, etc.) sur les étapes 1-2,
    // on ignore complètement → empêche la disparition prématurée du modal.
    if (formStep !== 3) return;
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
          title: t('partner_offers_toast_pricing_invalid'),
          description:
            code === 'order'
              ? t('partner_pricing_validation_order')
              : t('partner_offers_toast_pricing_gt0'),
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
      // BUG #57 — venueDetails : on persiste UNIQUEMENT si le partner est venue
      // (bar/club/restaurant) ET qu'au moins un sous-champ est renseigné.
      // Sinon on omet la clé pour ne pas pollluer Firestore (Activity reste lean).
      const venueDetailsToSave =
        isVenuePartner(partnerData?.type) &&
        (formVenueDetails.bonus ||
          (formVenueDetails.spaceTypes && formVenueDetails.spaceTypes.length > 0) ||
          formVenueDetails.musicStyle)
          ? formVenueDetails
          : undefined;
      // BUG #58 — storeOffer : même principe que venueDetails, mais pour sports-store.
      // On persiste si au moins un avantage est défini OU si equipmentAvailable a été
      // explicitement répondu (true/false), pour ne pas perdre une réponse "Non" du partner.
      const storeOfferToSave =
        isSportsStorePartner(partnerData?.type) &&
        ((formStoreOffer.exclusiveDiscount &&
          formStoreOffer.exclusiveDiscount.trim().length > 0) ||
          formStoreOffer.equipmentAvailable !== undefined)
          ? formStoreOffer
          : undefined;
      const data: Record<string, unknown> = {
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
        // BUG #57 — denorm partnerType + venueDetails (si applicable).
        // Admin override : si admin édite une activité dont il n'est PAS owner,
        // on ne doit PAS réécraser partnerId/partnerType avec ses propres
        // valeurs (sinon transfert involontaire de propriété + perte du type
        // partner d'origine). On préserve les valeurs existantes de l'activité.
        partnerType: (editing && isAdmin && editing.partnerId !== user.uid)
          ? (editing.partnerType ?? null)
          : (partnerData?.type ?? null),
        partnerId: (editing && isAdmin && editing.partnerId !== user.uid)
          ? editing.partnerId
          : user.uid,
        isActive: true, updatedAt: serverTimestamp(),
      };
      if (venueDetailsToSave) {
        data.venueDetails = venueDetailsToSave;
      }
      if (storeOfferToSave) {
        data.storeOffer = storeOfferToSave;
      }
      // Fix #177 — Sauvegarde des traductions EN + DE si saisies par le partenaire.
      // Structure : translations: { en: { title, description }, de: { title, description } }
      // Champs vides ignorés (= seulement les langues réellement traduites sont stockées).
      const translations: Record<string, Record<string, string>> = {};
      if (formNameEn.trim() || formDescEn.trim()) {
        translations.en = {};
        if (formNameEn.trim()) translations.en.title = formNameEn.trim();
        if (formDescEn.trim()) translations.en.description = formDescEn.trim();
      }
      if (formNameDe.trim() || formDescDe.trim()) {
        translations.de = {};
        if (formNameDe.trim()) translations.de.title = formNameDe.trim();
        if (formDescDe.trim()) translations.de.description = formDescDe.trim();
      }
      if (Object.keys(translations).length > 0) {
        data.translations = translations;
      }
      if (editing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateDoc(doc(db, 'activities', editing.activityId), data as any);

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
              : computeFallbackTiers(data.price as number);
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
          title: t('partner_offers_toast_updated_title'),
          description:
            synced + preserved === 0
              ? undefined
              : t('partner_offers_toast_synced_desc', { synced, preserved }),
        });
      } else {
        const ref = doc(collection(db, 'activities'));
        await setDoc(ref, { ...data, activityId: ref.id, currentParticipants: 0, rating: 0, reviewCount: 0, createdAt: serverTimestamp() });
        toast({ title: t('partner_offers_toast_created_title'), description: t('partner_offers_toast_created_desc', { name: formName }) });
      }
      setOpen(false); resetForm(); setEditing(null); await loadActivities();
    } catch (err) { toast({ variant: 'destructive', title: t('partner_offers_error'), description: String(err) }); }
    finally { setSaving(false); }
  };

  // Fix #121 — Duplique une activité existante (utile pour créer rapidement
  // une variante : même cours sur un autre créneau, ou même format à un autre
  // lieu). La copie est créée INACTIVE par défaut pour éviter une publication
  // accidentelle avant que le partenaire vérifie les champs (créneau, prix, etc.).
  // currentParticipants, rating, reviewCount sont RESET à 0 (nouvelle activité,
  // pas de réservations héritées). createdAt = maintenant.
  const handleDuplicate = async (act: Activity) => {
    if (!db) return;
    try {
      const ref = doc(collection(db, 'activities'));
      // Clone safe : on EXCLUT les champs qui doivent être unique/reset.
      // Cast en Record pour pouvoir destructurer librement (Activity type peut
      // ne pas inclure tous les champs Firestore — createdAt notamment).
      const actData = act as unknown as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { activityId: _id, createdAt: _ca, currentParticipants: _cp, rating: _r, reviewCount: _rc, ...rest } = actData;
      await setDoc(ref, {
        ...rest,
        activityId: ref.id,
        name: `${act.name} ${t('partner_offers_copy_suffix')}`,
        isActive: false, // Force inactive — partner doit éditer avant publication
        currentParticipants: 0,
        rating: 0,
        reviewCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({
        title: t('partner_offers_toast_duplicated_title'),
        description: t('partner_offers_toast_duplicated_desc', { name: act.name }),
      });
      await loadActivities();
    } catch (err) {
      console.error('[Offers] duplicate failed', err);
      toast({ variant: 'destructive', title: t('partner_offers_toast_duplicate_error'), description: String(err) });
    }
  };

  const handleDelete = async (act: Activity) => {
    if (!db || !confirm(t('partner_offers_confirm_delete', { name: act.name }))) return;
    try {
      // BUG #3 — cascade AVANT le hard-delete : sinon les sessions futures
      // deviennent orphelines (activity introuvable, mais session "Réserver" active).
      const cancelled = await cascadeCancelFutureSessions(act.activityId);
      await deleteDoc(doc(db, 'activities', act.activityId));
      toast({
        title: t('partner_offers_toast_deleted_title'),
        description: cancelled > 0 ? t('partner_offers_toast_sessions_cancelled', { count: cancelled }) : undefined,
      });
      await loadActivities();
    }
    catch (err) { toast({ variant: 'destructive', title: t('partner_offers_error'), description: String(err) }); }
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
          toast({ title: t('partner_offers_toast_deactivated_title'), description: t('partner_offers_toast_sessions_cancelled', { count: cancelled }) });
        }
      } catch (err) {
        console.warn('[Offers] cascade cancel sessions failed:', err);
        toast({
          variant: 'destructive',
          title: t('partner_offers_toast_sync_failed_title'),
          description: t('partner_offers_toast_sync_failed_desc'),
        });
      }
    }
    await loadActivities();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-accent animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-light text-white tracking-tight">{t('partner_offers_page_title')}</h1>
          <p className="text-sm text-white/40">{t('partner_offers_page_subtitle')}</p>
        </div>
        <Button onClick={openCreate} className="bg-white/5 backdrop-blur-xl border border-accent text-white font-light tracking-wider uppercase h-12 px-6 hover:bg-accent/10">
          <PlusCircle className="mr-2 h-4 w-4" /> {t('partner_offers_new_btn')}
        </Button>
      </div>

      {activities.length === 0 ? (
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="py-12 text-center">
            <PlusCircle className="h-12 w-12 text-white/10 mx-auto mb-4" />
            <p className="text-white/30">{t('partner_offers_empty_title')}</p>
            <p className="text-xs text-white/20 mt-1">{t('partner_offers_empty_subtitle')}</p>
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
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge className={`text-xs ${act.isActive ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-white/5 text-white/30 border-white/10'}`}>
                        {act.isActive ? t('partner_offers_active') : t('partner_offers_inactive')}
                      </Badge>
                      {isAdmin && user && act.partnerId !== user.uid && (
                        <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20 uppercase tracking-wider">
                          {t('partner_offers_admin_other_owner_badge')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Switch checked={act.isActive} onCheckedChange={() => handleToggleActive(act)} />
                </div>
                {act.description && (
                  <p className="text-xs text-white/30 mb-3 line-clamp-2">{act.description}</p>
                )}
                <div className="space-y-2 text-sm text-white/50 mb-4">
                  <p className="flex items-center gap-2"><span className="text-accent">{act.sport}</span> · <span className="text-white font-medium">{act.price} CHF</span> · <span>{act.duration || 60} min</span></p>
                  <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {act.city}{act.address ? ` — ${act.address}` : ''}</p>
                  <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {act.schedule}</p>
                  <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {act.currentParticipants || 0}/{act.maxParticipants} {t('partner_offers_participants')}</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => openEdit(act)} variant="outline" size="sm" className="flex-1 border-white/10 text-white/50 hover:text-white"><Edit className="h-3.5 w-3.5 mr-1.5" /> {t('partner_offers_edit_btn')}</Button>
                  {/* Fix #121 — bouton Dupliquer : crée copie inactive éditable */}
                  <Button onClick={() => handleDuplicate(act)} variant="outline" size="sm" className="border-white/10 text-white/50 hover:text-accent" title={t('partner_offers_duplicate_title')}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button onClick={() => handleDelete(act)} variant="outline" size="sm" className="border-red-500/20 text-red-400/50 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => {
        // BUG #53 DEBUG — log toutes les fermetures pour diagnostiquer
        // pourquoi step 3 disparait. À retirer une fois bug compris.
        if (!v) {
          // eslint-disable-next-line no-console
          console.warn('[ActivityForm] Modal closing — formStep was:', formStep);
        }
        setOpen(v);
        if (!v) { setEditing(null); resetForm(); }
      }}>
        {/* Phase 9.5 c35 BUG2 — override DialogContent shadcn p-6 → p-4 (Option B).
            Réduit le padding interne 24px → 16px sur cette modal uniquement, sans
            impacter les autres modals du site. Résout la "zone vide à droite" qui
            persistait malgré c31.1/c32.1/c34 (cause = DialogContent.p-6, jamais
            touché précédemment, pas la grid pricing). */}
        <DialogContent
          className="sm:max-w-[500px] bg-black border-white/10 p-4"
          // BUG #53 — empêche la fermeture du modal sur clic en dehors ou touche
          // Escape, qui pouvait être déclenchée par accident en step 2→3 transition
          // (focus shift quand MediaManager mount). Seul le bouton Annuler/X ferme.
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-white text-xl font-light">{editing ? t('partner_offers_modal_edit_title') : t('partner_offers_modal_create_title')}</DialogTitle>
              <DialogDescription>{editing ? t('partner_offers_modal_edit_desc') : t('partner_offers_modal_create_desc')}</DialogDescription>
            </DialogHeader>
            {/* Phase 9.5 c34 BUG#6 — Retrait pr-2 (gutter scrollbar) qui laissait
                une zone vide ~8px à droite après que c25 ait rendu la scrollbar
                globale 6px auto-hide transparente. La scrollbar se superpose
                légèrement (6px) au contenu au hover, acceptable car auto-hide.
                BUG #7 — grid-cols-1 (= minmax(0,1fr)) + min-w-0 : sans colonnes
                explicites, la grille `auto` laissait un enfant (MediaManager) au
                min-content blow-out → débordait à droite par rapport au header /
                aux inputs. Avec minmax(0,1fr) toutes les sections partagent la
                même largeur exacte (bord droit Description = bord droit cards). */}
            <div className="grid grid-cols-1 min-w-0 gap-4 py-4 max-h-[60vh] overflow-y-auto">
              {/* BUG #53 — Progress bar 3 étapes en haut du modal */}
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                {[1, 2, 3].map((s, i) => (
                  <div key={s} className="flex items-center gap-2 flex-1">
                    <div
                      className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold transition-colors ${
                        formStep === s
                          ? 'bg-accent text-white'
                          : formStep > s
                            ? 'bg-accent/40 text-white'
                            : 'bg-white/10 text-white/40'
                      }`}
                    >
                      {formStep > s ? <Check className="h-3.5 w-3.5" /> : s}
                    </div>
                    <span className={`text-xs font-medium whitespace-nowrap ${formStep === s ? 'text-white' : 'text-white/40'}`}>
                      {s === 1 ? t('partner_offers_step_basics') : s === 2 ? t('partner_offers_step_logistics') : t('partner_offers_step_media')}
                    </span>
                    {i < 2 && <div className={`h-px flex-1 ${formStep > s ? 'bg-accent/40' : 'bg-white/10'}`} />}
                  </div>
                ))}
              </div>

              {/* === ÉTAPE 1 : Bases (Nom, Sport, Description) === */}
              {formStep === 1 && (
                <>
                  {/* Fix #177 — Tabs FR/EN/DE pour saisir les traductions du titre
                      et de la description. FR = champs principaux (obligatoires).
                      EN + DE = optionnels, fallback FR si vide. */}
                  <div className="flex items-center gap-1 mb-1">
                    {(['fr', 'en', 'de'] as const).map(lng => (
                      <button
                        key={lng}
                        type="button"
                        onClick={() => setFormLangTab(lng)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition ${
                          formLangTab === lng
                            ? 'bg-accent text-white'
                            : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {lng === 'fr' ? '🇫🇷 FR' : lng === 'en' ? '🇬🇧 EN' : '🇩🇪 DE'}
                      </button>
                    ))}
                    {formLangTab !== 'fr' && (
                      <span className="ml-2 text-[10px] text-white/30">
                        {t('partner_offers_translation_optional_hint')}
                      </span>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-white/50">{t('partner_offers_field_name')}</Label>
                    {formLangTab === 'fr' && (
                      <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('partner_offers_field_name_placeholder')} className="bg-[#1A1A1A] border-white/10 h-12" />
                    )}
                    {formLangTab === 'en' && (
                      <Input value={formNameEn} onChange={e => setFormNameEn(e.target.value)} placeholder={t('partner_offers_field_name_placeholder_en')} className="bg-[#1A1A1A] border-white/10 h-12" />
                    )}
                    {formLangTab === 'de' && (
                      <Input value={formNameDe} onChange={e => setFormNameDe(e.target.value)} placeholder={t('partner_offers_field_name_placeholder_de')} className="bg-[#1A1A1A] border-white/10 h-12" />
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-white/50">{t('partner_offers_field_sport')}</Label>
                    {/* BUG #53 — Select avec option "Autre" en bas. Si user choisit
                        "Autre", un input texte libre apparaît pour custom sport.
                        Édition activité legacy avec sport custom : input visible direct. */}
                    <Select
                      value={
                        useCustomSport
                          ? SPORT_OTHER_VALUE
                          : (SPORTS.includes(formSport) ? formSport : '')
                      }
                      onValueChange={(v) => {
                        if (v === SPORT_OTHER_VALUE) {
                          setUseCustomSport(true);
                          setFormSport('');
                        } else {
                          setUseCustomSport(false);
                          setFormSport(v);
                        }
                      }}
                    >
                      <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12">
                        <SelectValue placeholder={t('partner_offers_select_placeholder')} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[250px]">
                        {SPORTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        <SelectItem value={SPORT_OTHER_VALUE}>{t('partner_offers_sport_other')}</SelectItem>
                      </SelectContent>
                    </Select>
                    {(useCustomSport || (formSport && !SPORTS.includes(formSport))) && (
                      <Input
                        value={formSport}
                        onChange={e => setFormSport(e.target.value)}
                        placeholder={t('partner_offers_sport_custom_placeholder')}
                        className="bg-[#1A1A1A] border-white/10 h-10 text-sm"
                        autoFocus={useCustomSport && !formSport}
                      />
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-white/50">{t('partner_offers_field_description')}</Label>
                    {/* Fix #177 — Description : même tabs FR/EN/DE que pour le nom. */}
                    {formLangTab === 'fr' && (
                      <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder={t('partner_offers_field_description_placeholder')} className="bg-[#1A1A1A] border border-white/10 rounded-md px-3 py-2 text-sm text-white min-h-[120px] resize-none focus:outline-none focus:ring-1 focus:ring-accent" />
                    )}
                    {formLangTab === 'en' && (
                      <textarea value={formDescEn} onChange={e => setFormDescEn(e.target.value)} placeholder={t('partner_offers_field_description_placeholder_en')} className="bg-[#1A1A1A] border border-white/10 rounded-md px-3 py-2 text-sm text-white min-h-[120px] resize-none focus:outline-none focus:ring-1 focus:ring-accent" />
                    )}
                    {formLangTab === 'de' && (
                      <textarea value={formDescDe} onChange={e => setFormDescDe(e.target.value)} placeholder={t('partner_offers_field_description_placeholder_de')} className="bg-[#1A1A1A] border border-white/10 rounded-md px-3 py-2 text-sm text-white min-h-[120px] resize-none focus:outline-none focus:ring-1 focus:ring-accent" />
                    )}
                  </div>
                </>
              )}

              {/* === ÉTAPE 2 : Logistique & Prix === */}
              {formStep === 2 && (
                <>
              <div className="grid gap-2">
                <Label className="text-white/50">{t('partner_offers_field_price')}</Label>
                <Input value={formPrice} onChange={e => setFormPrice(e.target.value)} type="number" placeholder="25" className="bg-[#1A1A1A] border-white/10 h-12" />
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
                      className="text-[11px] text-accent/70 hover:text-accent underline transition-colors"
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

              {/* Fix B B1 (refactor) — Section "Sessions à venir" positionnée
                  juste après le bloc tarification (logique : sessions = overrides
                  du prix activity). Visible UNIQUEMENT en édition d'une activité
                  existante. Bouton "Modifier" stub B1 → modal édition prix B2. */}
              {editing && (
                <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-accent" />
                    <Label className="text-white text-sm font-medium">{t('partner_offers_sessions_title')}</Label>
                    {editingSessions.length > 0 && (
                      <span className="text-[10px] text-white/40 ml-auto">
                        {editingSessions.length} {editingSessions.length > 1 ? t('partner_offers_sessions_plural') : t('partner_offers_sessions_singular')}
                      </span>
                    )}
                  </div>
                  {/* Fix B Option 3 — bouton "Ajouter une session" */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleOpenCreateSession}
                    className="w-full border-dashed border-accent/40 text-accent hover:bg-accent/5 hover:border-accent/60 h-9"
                  >
                    <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
                    {t('partner_offers_add_session_btn')}
                  </Button>
                  {loadingEditingSessions ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 text-accent animate-spin" />
                    </div>
                  ) : editingSessions.length === 0 ? (
                    <p className="text-[11px] text-white/40 font-light py-2">
                      {t('partner_offers_sessions_empty')}
                    </p>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/30 divide-y divide-white/5">
                      {editingSessions.map((s) => {
                        const effectivePriceCHF = getBookingPriceCHF({
                          session: s,
                          activity: editing,
                          now: new Date(),
                          isDuo: false,
                        });
                        const isFree = effectivePriceCHF === 0;
                        const isFrozen = (s.currentParticipants ?? 0) > 0;
                        const startDate = s.startAt && typeof s.startAt.toDate === 'function' ? s.startAt.toDate() : null;
                        return (
                          <div key={s.sessionId} className="px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="text-xs text-white/70 font-light">
                                {startDate
                                  ? startDate.toLocaleString('fr-FR', {
                                      weekday: 'short',
                                      day: 'numeric',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </span>
                              {isFree ? (
                                <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[9px] h-5">
                                  <Gift className="h-2.5 w-2.5 mr-1" />
                                  {t('partner_offers_free_badge')}
                                </Badge>
                              ) : (
                                <span className="text-xs font-medium text-accent">{effectivePriceCHF} CHF</span>
                              )}
                              {isFrozen && (
                                <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] h-5">
                                  <Lock className="h-2.5 w-2.5 mr-1" />
                                  {s.currentParticipants}
                                </Badge>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditSession(s)}
                              disabled={isFrozen}
                              className="text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-40 h-7 text-[11px]"
                            >
                              <Edit3 className="h-3 w-3 mr-1" />
                              {t('partner_offers_edit_btn')}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">{t('partner_offers_field_duration')}</Label>
                  <Input value={formDuration} onChange={e => setFormDuration(e.target.value)} type="number" placeholder="60" className="bg-[#1A1A1A] border-white/10 h-12" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">{t('partner_offers_field_max')}</Label>
                  <Input value={formMax} onChange={e => setFormMax(e.target.value)} type="number" placeholder="10" className="bg-[#1A1A1A] border-white/10 h-12" />
                </div>
              </div>
              {/* BUG #55 — Adresse avec autocomplete OpenStreetMap Nominatim.
                  Sélection auto-remplit la Ville. Si pas de match, Ville reste
                  modifiable via le select classique en dessous. */}
              <AddressAutocomplete
                value={formAddress}
                onChange={setFormAddress}
                onCitySelected={(city) => {
                  // Match exact case-insensitive sur les villes prédéfinies, sinon
                  // on garde le nom retourné par Nominatim (cas ville hors liste).
                  const matched = CITIES.find(c => c.toLowerCase() === city.toLowerCase());
                  setFormCity(matched ?? city);
                }}
              />
              <div className="grid gap-2">
                <Label className="text-white/50">{t('partner_offers_field_city')}</Label>
                <Select value={formCity} onValueChange={setFormCity}>
                  <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12">
                    <SelectValue placeholder="Choisir" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px]">
                    {CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    {/* Si formCity est custom (via autocomplete), on l'ajoute comme option pour qu'il soit affiché */}
                    {formCity && !CITIES.includes(formCity) && (
                      <SelectItem value={formCity}>{formCity}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {/* Phase 9.5 c33 BUG#1 — Champ "Horaires *" texte libre retiré pour
                  simplification (confusion 2 champs horaires côté Bassi). Le seul
                  champ de planning est désormais "Prochaine séance" (datetime-local
                  structuré), maintenant OBLIGATOIRE. Backward-compat : on conserve
                  schedule:formSchedule dans le payload (vide pour les nouvelles
                  activités) pour ne pas casser les Activities legacy en lecture. */}
              <div className="grid gap-2">
                <Label className="text-white/50 flex items-center justify-between">
                  <span>{t('partner_offers_next_session_label')}</span>
                </Label>
                <Input
                  type="datetime-local"
                  value={formScheduledAt}
                  onChange={e => setFormScheduledAt(e.target.value)}
                  className="bg-[#1A1A1A] border-white/10 h-12 text-white"
                />
                <p className="text-[11px] text-white/40">
                  {t('partner_offers_next_session_helper')}
                </p>
              </div>
                </>
              )}

              {/* === ÉTAPE 3 : Médias & Ciblage === */}
              {formStep === 3 && (
                <>
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
                  {/* Phase 9 SC6 c1/4 — Audience type selector (Q1=A enum) */}
                  <AudienceTypeSelector value={formAudienceType} onChange={setFormAudienceType} disabled={saving} />
                  {/* BUG #57 — Cadre & Ambiance (bar/club/restaurant uniquement).
                      Auto-détection via Partner.type fetché au mount. Si le partner
                      n'est pas un venue, la section est simplement non rendue. */}
                  {isVenuePartner(partnerData?.type) && (
                    <VenueDetailsSection
                      value={formVenueDetails}
                      onChange={setFormVenueDetails}
                      disabled={saving}
                    />
                  )}
                  {/* BUG #58 — Avantages partenaire (sports-store uniquement).
                      Auto-détection via Partner.type === 'sports-store'. */}
                  {isSportsStorePartner(partnerData?.type) && (
                    <StoreOfferSection
                      value={formStoreOffer}
                      onChange={setFormStoreOffer}
                      disabled={saving}
                    />
                  )}
                </>
              )}
            </div>
            {/* BUG #53 — Footer avec navigation multi-step */}
            <DialogFooter className="gap-2 flex-wrap">
              {formStep > 1 ? (
                <Button type="button" variant="outline" onClick={handleStepPrev} className="border-white/10">
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {t('partner_offers_btn_prev')}
                </Button>
              ) : (
                <DialogClose asChild><Button type="button" variant="outline" className="border-white/10">{t('partner_offers_btn_cancel')}</Button></DialogClose>
              )}
              {formStep < 3 ? (
                <Button type="button" onClick={handleStepNext} className="bg-accent hover:bg-accent/80 text-white">
                  {t('partner_offers_btn_next')}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button type="submit" disabled={saving || stepTransitioning} className="bg-accent hover:bg-accent/80 text-white">
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? t('partner_offers_btn_update') : t('partner_offers_btn_publish')}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Fix B B2/Option3 — Modal édition session (date + prix + delete).
          Rendue en dehors du Dialog activity pour éviter conflits portal. */}
      <SessionEditModal
        open={editSessionModalOpen}
        onOpenChange={(o) => {
          if (!o) setEditSessionTarget(null);
          setEditSessionModalOpen(o);
        }}
        session={editSessionTarget}
        activity={editing}
        onSaved={handleSessionMutated}
      />

      {/* Fix B Option 3 — Modal création nouvelle session */}
      <CreateSessionModal
        open={createSessionModalOpen}
        onOpenChange={setCreateSessionModalOpen}
        activity={editing}
        onCreated={handleSessionMutated}
      />
    </div>
  );
}
