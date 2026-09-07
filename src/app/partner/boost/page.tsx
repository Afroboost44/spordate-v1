"use client";

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Rocket, Zap, MapPin, Clock, TrendingUp, Eye, Users, Loader2, Globe, ChevronLeft, CheckCircle, XCircle, CreditCard, Coins, ListChecks } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCredits } from '@/hooks/useCredits';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
// Phase 9.5 c30 — constants partagées avec /api/boost-credits/route.ts via lib.
import { BOOST_CREDITS_COST, CHF_PER_CREDIT } from '@/lib/billing/boostCredits';
// R3c — nomme la cible d'un boost : activité Spordate OU offre Afroboost.
import { libelleCibleBoost } from '@/lib/boost/cible';
import MobileMoneyButton from '@/components/payment/MobileMoneyButton';

type PaymentMethod = 'stripe' | 'credits';

const SWISS_CITIES = ['Genève', 'Lausanne', 'Zurich', 'Berne', 'Bâle', 'Fribourg', 'Neuchâtel', 'Toute la Suisse'];

const INTERNATIONAL_COUNTRIES: Record<string, string[]> = {
  'France': ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Bordeaux', 'Lille', 'Strasbourg', 'Autre'],
  'Belgique': ['Bruxelles', 'Anvers', 'Liège', 'Gand', 'Charleroi', 'Autre'],
  'Canada': ['Montréal', 'Toronto', 'Vancouver', 'Ottawa', 'Québec', 'Autre'],
  'Côte d\'Ivoire': ['Abidjan', 'Yamoussoukro', 'Bouaké', 'Autre'],
  'Sénégal': ['Dakar', 'Saint-Louis', 'Thiès', 'Autre'],
  'Cameroun': ['Douala', 'Yaoundé', 'Bafoussam', 'Autre'],
  'RD Congo': ['Kinshasa', 'Lubumbashi', 'Goma', 'Autre'],
  'Maroc': ['Casablanca', 'Rabat', 'Marrakech', 'Tanger', 'Fès', 'Autre'],
  'Guinée': ['Conakry', 'Nzérékoré', 'Autre'],
  'Mali': ['Bamako', 'Sikasso', 'Autre'],
  'Burkina Faso': ['Ouagadougou', 'Bobo-Dioulasso', 'Autre'],
  'Autre pays': ['Autre ville'],
};

// BUG #95 — Defaults Boost partenaire alignés sur AdminPricingSection.
// Les VRAIS prix sont lus depuis settings/pricing.boostPartner{24h,3d,7d}PriceCHF
// dans le composant (useEffect). Si Firestore down ou champs absents, fallback
// sur ces defaults — qui correspondent aussi aux prix actuellement en prod.
const DEFAULT_DURATIONS: Array<{ value: string; labelKey: string; price: number }> = [
  { value: '24h', labelKey: 'partner_boost_duration_24h', price: 15 },
  { value: '3d',  labelKey: 'partner_boost_duration_3d',  price: 35 },
  { value: '7d',  labelKey: 'partner_boost_duration_7d',  price: 50 },
];

type LocationMode = 'choose' | 'swiss' | 'international-country' | 'international-city';

export default function PartnerBoostPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { credits } = useCredits();
  const [locationMode, setLocationMode] = useState<LocationMode>('choose');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDuration, setSelectedDuration] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [activeBoosts, setActiveBoosts] = useState<any[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'cancel' | null>(null);
  // Phase 9.5 c29b — méthode de paiement choisie (Stripe par défaut, switch vers Credits)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe');
  // BUG #69 — Liste des activités actives du partenaire + ID sélectionné.
  // Le boost cible désormais 1 activité précise (pas tout le compte).
  const [partnerActivities, setPartnerActivities] = useState<Array<{ id: string; name: string; sport?: string; city?: string }>>([]);
  // R3c — le catalogue Afroboost, en LECTURE SEULE, uniquement pour nommer
  // la cible d'un boost. Aucune offre n'est copiée ni persistée nulle part.
  const [offresAfroboost, setOffresAfroboost] = useState<Array<{ id: string; nom: string }>>([]);
  const [selectedActivityId, setSelectedActivityId] = useState('');
  // LOT B — LE RÉFÉRENTIEL CHOISI, EXPLICITEMENT. Deux catalogues étrangers ne
  // partagent pas un champ « id » : on nomme la source, puis on lit le bon
  // identifiant. C'est la même règle que le contrat Boost de R3b-2.
  const [sourceCible, setSourceCible] = useState<'spordate' | 'afroboost'>('spordate');
  const [offresSelectionnables, setOffresSelectionnables] = useState<Array<{
    id: string; nom: string; prix: number | null; ville: string | null;
    lieuTexte: string | null; image: string | null; typeOffre: string;
    proprietaire: string; voie: 'admin-gratuit' | 'partenaire-achete';
  }>>([]);
  const [selectedOffreId, setSelectedOffreId] = useState('');
  // Fait sur le compte courant, résolu par le SERVEUR. L'écran s'en sert pour
  // savoir s'il doit proposer un paiement ; la route d'activation ne le croit
  // jamais sur parole et refait la preuve.
  const [compteAdmin, setCompteAdmin] = useState(false);
  // BUG #95 — Prix Boost partenaire chargés depuis settings/pricing (admin-éditable).
  // Fallback sur DEFAULT_DURATIONS si Firestore down ou champs absents. Charge au mount.
  const [durations, setDurations] = useState(DEFAULT_DURATIONS);

  useEffect(() => {
    if (!db) return;
    const fbDb = db;
    (async () => {
      try {
        const snap = await getDoc(doc(fbDb, 'settings', 'pricing'));
        if (!snap.exists()) return;
        const data = snap.data() || {};
        setDurations([
          {
            value: '24h',
            labelKey: 'partner_boost_duration_24h',
            price: typeof data.boostPartner24hPriceCHF === 'number' && data.boostPartner24hPriceCHF >= 0
              ? data.boostPartner24hPriceCHF : 15,
          },
          {
            value: '3d',
            labelKey: 'partner_boost_duration_3d',
            price: typeof data.boostPartner3dPriceCHF === 'number' && data.boostPartner3dPriceCHF >= 0
              ? data.boostPartner3dPriceCHF : 35,
          },
          {
            value: '7d',
            labelKey: 'partner_boost_duration_7d',
            price: typeof data.boostPartner7dPriceCHF === 'number' && data.boostPartner7dPriceCHF >= 0
              ? data.boostPartner7dPriceCHF : 50,
          },
        ]);
      } catch (err) {
        console.warn('[/partner/boost] settings/pricing read failed, fallback defaults', err);
      }
    })();
  }, []);

  // LOT B — les offres que CE compte peut mettre en avant. La décision est
  // prise côté serveur : elle demande la preuve d'administration du LOT A ou la
  // liaison d'identité de R3b-ID, dont aucune n'est lisible d'ici.
  useEffect(() => {
    if (!user) return;
    let annule = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const rep = await fetch('/api/boost/afroboost-offers', {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        });
        if (!rep.ok) return;
        const d = await rep.json();
        if (annule) return;
        setOffresSelectionnables(Array.isArray(d?.offres) ? d.offres : []);
        setCompteAdmin(d?.admin === true);
      } catch {
        // silence volontaire : sans catalogue, l'écran garde son chemin natif.
      }
    })();
    return () => { annule = true; };
  }, [user]);

  const offreChoisie = offresSelectionnables.find(o => o.id === selectedOffreId) || null;
  /** LOT B — la mise en avant d'une offre de la plateforme ne se paie pas. */
  const miseEnAvantGratuite = sourceCible === 'afroboost' && offreChoisie?.voie === 'admin-gratuit';

  const currentPrice = durations.find(d => d.value === selectedDuration)?.price || 0;
  const currentCreditCost = selectedDuration ? BOOST_CREDITS_COST[selectedDuration] || 0 : 0;
  const hasEnoughCredits = credits >= currentCreditCost;

  // Phase 9.5 c32 — Helper PURE qui retourne la raison la plus prioritaire qui
  // bloque l'activation du boost. null si tout OK (bouton actif). Affiché sous
  // le bouton désactivé pour éviter le "ghost button silencieux" vécu en c29b.
  // Branche `credits` saute le check hasEnoughCredits (déjà géré par le bouton
  // alternatif "Solde insuffisant — Recharger" qui remplace le bouton normal).
  const getDisabledReason = (): string | null => {
    // LOT B — la cible dépend du référentiel choisi, et la ville d'une offre
    // Afroboost vient de l'offre elle-même : on ne la redemande pas.
    if (sourceCible === 'afroboost') {
      if (!selectedOffreId) return t('partner_boost_disabled_offer');
      if (!selectedDuration) return t('partner_boost_disabled_duration');
      if (isLoading) return t('partner_boost_disabled_loading');
      return null;
    }
    if (!selectedActivityId) return t('partner_boost_disabled_activity');
    if (!selectedCity) return t('partner_boost_disabled_city');
    if (!selectedDuration) return t('partner_boost_disabled_duration');
    if (isLoading) return t('partner_boost_disabled_loading');
    return null;
  };
  const disabledReason = getDisabledReason();

  // Load partner ID and active boosts
  useEffect(() => {
    if (!user?.uid || !db) return;
    const fbDb = db; // capture for async closure (already proven non-null by guard above)

    const load = async () => {
      try {
        // Get partner ID
        const docSnap = await getDoc(doc(fbDb, 'partners', user.uid));
        if (docSnap.exists()) {
          setPartnerId(docSnap.id);
        } else {
          const q = query(collection(fbDb, 'partners'), where('email', '==', user.email), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) setPartnerId(snap.docs[0].id);
        }

        // Load active boosts
        const boostQ = query(
          collection(fbDb, 'boosts'),
          where('partnerId', '==', user.uid),
          where('active', '==', true),
          limit(10)
        );
        const boostSnap = await getDocs(boostQ);
        const boosts = boostSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setActiveBoosts(boosts);

        // BUG #69 — Load partner's active activities pour le dropdown sélecteur.
        // On filtre isActive==true pour ne pas proposer des activités désactivées.
        const actQ = query(
          collection(fbDb, 'activities'),
          where('partnerId', '==', user.uid),
          where('isActive', '==', true),
          limit(50)
        );
        const actSnap = await getDocs(actQ);
        const acts = actSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            name: (data as any).name || (data as any).title || '(sans nom)',
            sport: data.sport,
            city: data.city,
          };
        });
        setPartnerActivities(acts);

        // R3c — le catalogue Afroboost, par la porte unique du LOT R2. Sert
        // UNIQUEMENT à nommer la cible d'un boost qui vise une offre. Un échec
        // est sans conséquence : le libellé retombe alors sur « indisponible ».
        try {
          const rep = await fetch('/api/afroboost/offers', { cache: 'no-store' });
          if (rep.ok) {
            const donnees = await rep.json();
            if (donnees?.etat === 'ok' && Array.isArray(donnees?.offres)) {
              setOffresAfroboost(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (donnees.offres as any[]).map((o) => ({ id: String(o?.id || ''), nom: String(o?.nom || '') })),
              );
            }
          }
        } catch {
          // silence volontaire : nommer une cible n'est pas une dépendance.
        }
        // Auto-sélection si une seule activité (cas le plus simple côté UX)
        if (acts.length === 1) {
          setSelectedActivityId(acts[0].id);
        }
      } catch (err) {
        console.error('[Boost] Load error:', err);
      }
    };

    load();
  }, [user]);

  // Handle payment return
  useEffect(() => {
    const status = searchParams.get('status');
    const sessionId = searchParams.get('session_id');
    const duration = searchParams.get('duration');
    const city = searchParams.get('city');

    if (status === 'success' && sessionId) {
      setPaymentStatus('success');

      // Phase 9.5 c26 BUG DD — La création du doc boosts/ est désormais
      // SERVER-SIDE via le webhook Stripe (handlers/stripe/handler.ts →
      // handleBoostPayment). Ne plus addDoc côté client : un user pouvait
      // sinon visiter /partner/boost?status=success&session_id=fake et
      // activer un boost sans avoir payé. Toast informatif côté client,
      // refresh activeBoosts au prochain useEffect mount (load() relit boosts/).
      toast({
        title: t('partner_boost_toast_activated_title'),
        description: t('partner_boost_toast_activation_pending', {
          duration: durations.find(d => d.value === duration) ? t(durations.find(d => d.value === duration)!.labelKey) : (duration ?? ''),
        }),
      });

      // Clean URL
      window.history.replaceState({}, '', '/partner/boost');
    } else if (status === 'cancel') {
      setPaymentStatus('cancel');
      toast({ title: t('partner_boost_toast_payment_cancelled_title'), description: t('partner_boost_toast_payment_cancelled_desc'), variant: "destructive" });
      window.history.replaceState({}, '', '/partner/boost');
    }
  }, [searchParams, partnerId, user]);

  /**
   * LOT B — LA MISE EN AVANT GRATUITE D'UNE OFFRE DE LA PLATEFORME.
   *
   * Aucun Stripe, aucun crédit, aucun règlement à somme nulle : l'activation
   * naît directement côté serveur, qui refait lui-même la preuve
   * d'administration. Ce bouton n'apparaît que pour une offre `admin-gratuit`.
   */
  const handleMiseEnAvantGratuite = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/boost/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          afroboostOfferId: selectedOffreId,
          duration: selectedDuration,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      toast({
        title: t('partner_boost_free_done_title'),
        description: data.avertissement === 'sans-ville-structuree'
          ? t('partner_boost_free_done_no_city')
          : t('partner_boost_free_done_desc'),
      });
      setPaymentStatus('success');
      setIsLoading(false);
      // Rafraîchit la liste des mises en avant actives.
      router.refresh();
    } catch (err: any) {
      console.error('[Boost admin]', err);
      toast({
        title: t('partner_boost_error'),
        description: err.message || t('partner_boost_payment_failed'),
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const handleBoost = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      // Phase 9.5 c33 BUG#4 — Bearer auth ajouté (server force partnerId = uid)
      const idToken = await user.getIdToken();
      const res = await fetch('/api/boost-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          duration: selectedDuration,
          city: sourceCible === 'afroboost' ? (offreChoisie?.ville || '') : selectedCity,
          country: selectedCountry || undefined,
          // BUG #69 — activityId envoyée au /api/boost-checkout qui la passe en
          // Stripe metadata. Le webhook handleBoostPayment lit metadata.activityId
          // et persiste sur le doc boosts/ → Discovery filter (partnerId, activityId).
          // LOT B — la cible, sous le champ de SON référentiel. Jamais les deux.
          ...(sourceCible === 'afroboost'
            ? { afroboostOfferId: selectedOffreId }
            : { activityId: selectedActivityId }),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      console.error('[Boost]', err);
      toast({
        title: t('partner_boost_error'),
        description: err.message || t('partner_boost_payment_failed'),
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  // Phase 9.5 c29b BUG FF — Paiement via crédits Spordate (alternative à Stripe).
  // Atomic côté serveur via /api/boost-credits (runTransaction : check credits +
  // idempotence + debit + create boost + log transaction).
  const handleBoostWithCredits = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/boost-credits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          // Phase 9.5 c33 BUG#4 — partnerId retiré du body (server force = uid Bearer).
          duration: selectedDuration,
          city: sourceCible === 'afroboost' ? (offreChoisie?.ville || '') : selectedCity,
          country: selectedCountry || undefined,
          // BUG #69 — activityId persistée directement dans boosts/ par l'API
          // (mode credits = pas de Stripe, pas de webhook, écriture inline).
          // LOT B — la cible, sous le champ de SON référentiel. Jamais les deux.
          ...(sourceCible === 'afroboost'
            ? { afroboostOfferId: selectedOffreId }
            : { activityId: selectedActivityId }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'insufficient-credits') {
          toast({
            title: t('partner_boost_toast_insufficient_title'),
            description: t('partner_boost_toast_insufficient_desc', { have: data.have, need: data.need }),
            variant: 'destructive',
          });
        } else if (data.error === 'already-boosted') {
          toast({
            title: t('partner_boost_toast_already_title'),
            description: data.detail || t('partner_boost_toast_already_desc'),
            variant: 'destructive',
          });
        } else {
          throw new Error(data.detail || data.error || t('partner_boost_unknown_error'));
        }
        setIsLoading(false);
        return;
      }
      toast({
        title: t('partner_boost_toast_activated_excl'),
        description: t('partner_boost_toast_remaining', { remaining: data.creditsRemaining }),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      setPaymentStatus('success');
    } catch (err: any) {
      console.error('[BoostCredits]', err);
      toast({
        title: t('partner_boost_error'),
        description: err.message || t('partner_boost_activate_failed'),
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const resetLocation = () => {
    setLocationMode('choose');
    setSelectedCountry('');
    setSelectedCity('');
  };

  const locationLabel = selectedCity
    ? (selectedCountry ? `${selectedCity}, ${selectedCountry}` : selectedCity)
    : '';

  // Success banner
  if (paymentStatus === 'success') {
    return (
      <div className="space-y-8">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-6">
            <CheckCircle className="h-10 w-10 text-green-400" />
          </div>
          <h2 className="text-2xl font-extralight text-white mb-2">{t('partner_boost_success_title')}</h2>
          <p className="text-white/40 font-light mb-8">{t('partner_boost_success_desc')}</p>
          <Button
            onClick={() => setPaymentStatus(null)}
            className="bg-accent hover:bg-accent/80 text-white rounded-full h-12 px-8 font-light"
          >
            {t('partner_boost_success_cta')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Rocket className="h-5 w-5 text-accent" />
          </div>
          <h1 className="text-2xl md:text-3xl font-extralight tracking-tight">
            {t('partner_boost_header_title')}
          </h1>
        </div>
        <p className="text-white/40 font-light mt-1">
          {t('partner_boost_header_subtitle')}
        </p>
      </div>

      {/* Cancel banner */}
      {paymentStatus === 'cancel' && (
        <div className="flex items-center gap-3 p-4 bg-red-500/5 border border-red-500/10 rounded-xl">
          <XCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400/80 font-light">{t('partner_boost_cancel_banner')}</p>
          <button onClick={() => setPaymentStatus(null)} className="text-xs text-white/30 hover:text-white/60 ml-auto">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">

        {/* Configuration — left column */}
        <div className="md:col-span-3 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
            <h3 className="text-sm text-accent uppercase tracking-[0.2em] font-light">
              {t('partner_boost_configure_title')}
            </h3>

            {/* LOT B — LE RÉFÉRENTIEL, D'ABORD. Deux catalogues étrangers : une
                activité Spordateur vit dans Firestore, une offre Afroboost dans
                son propre catalogue. Les mélanger sous un champ « id » commun
                serait la faute que le contrat R3b-2 a écartée. */}
            {offresSelectionnables.length > 0 && (
              <div className="space-y-3">
                <span className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5">
                  <ListChecks className="h-3 w-3" /> {t('partner_boost_source_label')}
                </span>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('partner_boost_source_label')}>
                  <button
                    type="button" role="radio" aria-checked={sourceCible === 'spordate'}
                    onClick={() => { setSourceCible('spordate'); setSelectedOffreId(''); }}
                    className={`rounded-xl px-4 py-3 text-sm font-light border transition ${
                      sourceCible === 'spordate'
                        ? 'border-accent/50 bg-accent/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/50 hover:text-white/80'
                    }`}
                  >
                    {t('partner_boost_source_spordate')}
                  </button>
                  <button
                    type="button" role="radio" aria-checked={sourceCible === 'afroboost'}
                    onClick={() => { setSourceCible('afroboost'); setSelectedActivityId(''); }}
                    className={`rounded-xl px-4 py-3 text-sm font-light border transition ${
                      sourceCible === 'afroboost'
                        ? 'border-accent/50 bg-accent/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/50 hover:text-white/80'
                    }`}
                  >
                    {t('partner_boost_source_afroboost')}
                  </button>
                </div>
              </div>
            )}

            {/* LOT B — le sélecteur d'offre Afroboost. Ne propose QUE ce que le
                serveur a jugé sélectionnable par ce compte : les offres de la
                plateforme pour un administrateur prouvé, les siennes pour un
                partenaire dont R3b-ID a résolu l'identité. */}
            {sourceCible === 'afroboost' && (
              <div className="space-y-3">
                <label
                  htmlFor="boost-offer-select"
                  className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5"
                >
                  <ListChecks className="h-3 w-3" /> {t('partner_boost_offer_label')}
                </label>
                <select
                  id="boost-offer-select"
                  value={selectedOffreId}
                  onChange={(e) => setSelectedOffreId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm font-light focus:outline-none focus:border-accent/40"
                >
                  <option value="">{t('partner_boost_offer_choose_option')}</option>
                  {offresSelectionnables.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nom}
                      {typeof o.prix === 'number' ? ` · ${o.prix === 0 ? t('payment_free_label') : `${o.prix} CHF`}` : ''}
                      {o.ville ? ` · ${o.ville}` : ''}
                    </option>
                  ))}
                </select>

                {offreChoisie && (
                  <div className="flex items-start gap-3 rounded-xl bg-white/5 border border-white/10 p-3">
                    {offreChoisie.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={offreChoisie.image.startsWith('http') ? offreChoisie.image : `https://afroboost.com${offreChoisie.image}`}
                        alt={offreChoisie.nom}
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-white/5"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{offreChoisie.nom}</p>
                      <p className="text-[11px] text-white/40 truncate">
                        {offreChoisie.lieuTexte || offreChoisie.ville || ''}
                      </p>
                      <p className="text-[11px] text-accent mt-0.5">
                        {offreChoisie.prix === 0
                          ? t('payment_free_label')
                          : typeof offreChoisie.prix === 'number' ? `${offreChoisie.prix} CHF` : ''}
                      </p>
                      {!offreChoisie.ville && (
                        <p className="text-[11px] text-amber-300/80 mt-1">
                          {t('partner_boost_offer_no_city')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* BUG #69 — Activity selector. Le partenaire DOIT choisir QUELLE
                activité booster (avant : boost s'appliquait à tout le compte).
                LOT B — masqué quand la cible est une offre Afroboost. */}
            {sourceCible === 'spordate' && (
            <div className="space-y-3">
              <label
                htmlFor="boost-activity-select"
                className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5"
              >
                <ListChecks className="h-3 w-3" /> {t('partner_boost_activity_label')}
              </label>
              {partnerActivities.length === 0 ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/[0.05] p-4">
                  <p className="text-sm text-amber-300/90 font-light">
                    {t('partner_boost_no_activities_pre')}{' '}
                    <a href="/partner/offers" className="text-accent underline">
                      {t('partner_boost_no_activities_link')}
                    </a>
                    {' '}{t('partner_boost_no_activities_post')}
                  </p>
                </div>
              ) : (
                <select
                  id="boost-activity-select"
                  value={selectedActivityId}
                  onChange={(e) => setSelectedActivityId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm font-light focus:outline-none focus:border-accent/40"
                >
                  <option value="">{t('partner_boost_activity_choose_option')}</option>
                  {partnerActivities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.sport ? ` · ${a.sport}` : ''}
                      {a.city ? ` · ${a.city}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            )}

            {/* Location selection — LOT B : sans objet pour une offre Afroboost,
                dont la ville est celle du catalogue, résolue par le serveur. */}
            {sourceCible === 'spordate' && (
            <div className="space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> {t('partner_boost_target_city_label')}
              </label>

              {selectedCity && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent border border-accent/30 text-sm font-light">
                    <MapPin className="h-3 w-3" />
                    {locationLabel}
                  </span>
                  <button
                    onClick={resetLocation}
                    className="text-xs text-white/30 hover:text-white/60 underline font-light transition"
                  >
                    {t('partner_boost_change_btn')}
                  </button>
                </div>
              )}

              {locationMode === 'choose' && !selectedCity && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setLocationMode('swiss')}
                    className="flex items-center justify-center gap-2 p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 transition"
                  >
                    <span className="text-lg">🇨🇭</span>
                    <span className="text-sm font-light">{t('partner_boost_swiss')}</span>
                  </button>
                  <button
                    onClick={() => setLocationMode('international-country')}
                    className="flex items-center justify-center gap-2 p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 transition"
                  >
                    <Globe className="h-5 w-5" />
                    <span className="text-sm font-light">{t('partner_boost_international')}</span>
                  </button>
                </div>
              )}

              {locationMode === 'swiss' && !selectedCity && (
                <div className="space-y-2">
                  <button
                    onClick={() => setLocationMode('choose')}
                    className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 font-light transition"
                  >
                    <ChevronLeft className="h-3 w-3" /> {t('partner_boost_back')}
                  </button>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {SWISS_CITIES.map(city => (
                      <button
                        key={city}
                        onClick={() => setSelectedCity(city)}
                        className="px-4 py-2.5 rounded-full text-sm font-light transition border bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/60"
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {locationMode === 'international-country' && !selectedCity && (
                <div className="space-y-2">
                  <button
                    onClick={() => setLocationMode('choose')}
                    className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 font-light transition"
                  >
                    <ChevronLeft className="h-3 w-3" /> {t('partner_boost_back')}
                  </button>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.keys(INTERNATIONAL_COUNTRIES).map(country => (
                      <button
                        key={country}
                        onClick={() => {
                          setSelectedCountry(country);
                          setLocationMode('international-city');
                        }}
                        className="px-4 py-2.5 rounded-full text-sm font-light transition border bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/60"
                      >
                        {country}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {locationMode === 'international-city' && selectedCountry && !selectedCity && (
                <div className="space-y-2">
                  <button
                    onClick={() => { setSelectedCountry(''); setLocationMode('international-country'); }}
                    className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 font-light transition"
                  >
                    <ChevronLeft className="h-3 w-3" /> {selectedCountry}
                  </button>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(INTERNATIONAL_COUNTRIES[selectedCountry] || []).map(city => (
                      <button
                        key={city}
                        onClick={() => setSelectedCity(city)}
                        className="px-4 py-2.5 rounded-full text-sm font-light transition border bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/60"
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Duration selection */}
            <div className="space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> {t('partner_boost_duration_label')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {durations.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setSelectedDuration(d.value)}
                    className={`p-4 rounded-xl text-center transition border ${
                      selectedDuration === d.value
                        ? 'bg-accent/10 border-accent/30'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <p className={`text-sm font-light ${selectedDuration === d.value ? 'text-accent' : 'text-white/50'}`}>
                      {t(d.labelKey)}
                    </p>
                    <p className={`text-2xl font-extralight mt-1 ${selectedDuration === d.value ? 'text-white' : 'text-white/30'}`}>
                      {d.price} <span className="text-xs">CHF</span>
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Phase 9.5 c29b BUG FF — Méthode de paiement (Stripe ou Crédits Spordate)
                LOT B — masqué quand la mise en avant est gratuite : proposer un
                moyen de paiement pour une somme nulle n'aurait aucun sens. */}
            {!miseEnAvantGratuite && (
            <div className="border-t border-white/5 pt-6 space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light">
                {t('partner_boost_payment_method_label')}
              </label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('partner_boost_payment_method_label')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentMethod === 'stripe'}
                  onClick={() => setPaymentMethod('stripe')}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-light transition border ${
                    paymentMethod === 'stripe'
                      ? 'bg-accent/10 border-accent/40 text-accent'
                      : 'bg-white/5 border-white/5 text-white/40 hover:text-white/60'
                  }`}
                >
                  <CreditCard className="h-4 w-4" />
                  {t('partner_boost_pay_card')}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentMethod === 'credits'}
                  onClick={() => setPaymentMethod('credits')}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-light transition border ${
                    paymentMethod === 'credits'
                      ? 'bg-accent/10 border-accent/40 text-accent'
                      : 'bg-white/5 border-white/5 text-white/40 hover:text-white/60'
                  }`}
                >
                  <Coins className="h-4 w-4" />
                  {t('partner_boost_pay_credits')}
                </button>
              </div>
              {paymentMethod === 'credits' && (
                <p className="text-[11px] text-white/40 font-light pl-1">
                  {t('partner_boost_balance_label')} <span className="text-white">{credits}</span> {t('partner_boost_credits_unit')}
                </p>
              )}
            </div>

            )}

            {/* Price + CTA */}
            <div className="pt-2 space-y-4">
              {miseEnAvantGratuite ? (
                /* LOT B — LA VOIE GRATUITE. Aucun Stripe, aucun crédit, aucun
                   règlement à zéro franc : le serveur crée directement la mise
                   en avant, après avoir refait lui-même la preuve d'administration. */
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 font-light">{t('partner_boost_price_label')}</span>
                    <span className="text-2xl font-extralight text-emerald-300">
                      {t('partner_boost_free_label')}
                    </span>
                  </div>
                  <Button
                    onClick={handleMiseEnAvantGratuite}
                    disabled={!selectedOffreId || !selectedDuration || isLoading}
                    className={`w-full rounded-full h-14 text-base font-semibold ${
                      selectedOffreId && selectedDuration
                        ? 'bg-accent hover:bg-accent/80 text-white'
                        : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? (
                      <><Loader2 className="animate-spin mr-2 h-5 w-5" /> {t('partner_boost_disabled_loading')}</>
                    ) : (
                      <><Zap className="mr-2 h-5 w-5" /> {t('partner_boost_free_cta')}</>
                    )}
                  </Button>
                  {disabledReason && (
                    <p className="text-xs text-white/30 text-center font-light">{disabledReason}</p>
                  )}
                </>
              ) : paymentMethod === 'stripe' ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 font-light">{t('partner_boost_price_label')}</span>
                    <span className="text-3xl font-extralight text-white">
                      {currentPrice} <span className="text-sm text-white/30">CHF</span>
                    </span>
                  </div>
                  <Button
                    onClick={handleBoost}
                    disabled={!!disabledReason}
                    className={`w-full rounded-full h-14 text-base font-semibold ${
                      !disabledReason
                        ? 'bg-accent hover:bg-accent/80 text-white'
                        : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? (
                      <><Loader2 className="animate-spin mr-2 h-5 w-5" /> {t('partner_boost_stripe_redirect')}</>
                    ) : (
                      <><Zap className="mr-2 h-5 w-5" /> {t('partner_boost_pay_and_activate')}</>
                    )}
                  </Button>

                  {/* V409 — Mobile Money A COTE de la carte, pour le boost.
                      Le montant suit la grille de DUREE (BOOST_PRICES), partagee
                      avec le chemin Stripe : 24h/3j/7j, jamais un prix de credits.
                      Le pays du boost voyage separement du pays Mobile Money. */}
                  {selectedActivityId && selectedCity && selectedDuration && (
                    <div className="mt-2">
                      <MobileMoneyButton
                        mode="boost"
                        user={user}
                        activityId={selectedActivityId}
                        duration={selectedDuration}
                        city={selectedCity}
                        country={selectedCountry || undefined}
                      />
                    </div>
                  )}
                  {/* Phase 9.5 c32 — raison contextuelle si bouton désactivé */}
                  {disabledReason && (
                    <p className="text-center text-xs text-amber-400/80">
                      {disabledReason}
                    </p>
                  )}
                  <p className="mt-3 text-center text-[11px] text-zinc-500">
                    {t('partner_boost_pay_brands')}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 font-light">{t('partner_boost_credits_cost_label')}</span>
                    <div className="text-right">
                      <span className="text-3xl font-extralight text-white">
                        {currentCreditCost} <span className="text-sm text-white/30">{t('partner_boost_credits_unit')}</span>
                      </span>
                      <p className="text-[11px] text-white/30 font-light mt-0.5">
                        ≈ {(currentCreditCost * CHF_PER_CREDIT).toFixed(2)} CHF
                      </p>
                    </div>
                  </div>
                  {selectedDuration && !hasEnoughCredits ? (
                    <Button
                      onClick={() => router.push('/payment')}
                      className="w-full rounded-full h-14 text-base font-semibold bg-white/5 hover:bg-white/10 text-white/60 border border-white/10"
                    >
                      {t('partner_boost_recharge_cta')}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleBoostWithCredits}
                      disabled={!selectedActivityId || !selectedCity || !selectedDuration || isLoading || !hasEnoughCredits}
                      className={`w-full rounded-full h-14 text-base font-semibold ${
                        selectedActivityId && selectedCity && selectedDuration && hasEnoughCredits
                          ? 'bg-accent hover:bg-accent/80 text-white'
                          : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
                      }`}
                    >
                      {isLoading ? (
                        <><Loader2 className="animate-spin mr-2 h-5 w-5" /> {t('partner_boost_activating')}</>
                      ) : (
                        <><Coins className="mr-2 h-5 w-5" /> {t('partner_boost_activate_with_credits')}</>
                      )}
                    </Button>
                  )}
                  {/* Phase 9.5 c32 — raison contextuelle si bouton désactivé (uniquement
                      sur la branche bouton "normal" — la branche "Solde insuffisant" ci-dessus
                      ne s'affiche que si selectedDuration+!hasEnoughCredits, donc city/loading
                      sont les seules raisons restantes ici). */}
                  {disabledReason && hasEnoughCredits && (
                    <p className="text-center text-xs text-amber-400/80">
                      {disabledReason}
                    </p>
                  )}
                  <p className="mt-3 text-center text-[11px] text-zinc-500">
                    {t('partner_boost_instant_debit')}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Info — right column */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
            <h3 className="text-sm text-accent uppercase tracking-[0.2em] font-light">
              {t('partner_boost_how_title')}
            </h3>
            <p className="text-white/40 font-light text-sm leading-relaxed">
              {t('partner_boost_how_desc')}
            </p>

            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Eye className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">{t('partner_boost_feat_visibility_title')}</p>
                  <p className="text-xs text-white/30 font-light">{t('partner_boost_feat_visibility_desc')}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MapPin className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">{t('partner_boost_feat_targeting_title')}</p>
                  <p className="text-xs text-white/30 font-light">{t('partner_boost_feat_targeting_desc')}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Users className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">{t('partner_boost_feat_badge_title')}</p>
                  <p className="text-xs text-white/30 font-light">{t('partner_boost_feat_badge_desc')}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <TrendingUp className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">{t('partner_boost_feat_bookings_title')}</p>
                  <p className="text-xs text-white/30 font-light">{t('partner_boost_feat_bookings_desc')}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Active boosts */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm text-white/30 uppercase tracking-wider font-light mb-4">{t('partner_boost_active_title')}</h3>
            {activeBoosts.length > 0 ? (
              <div className="space-y-3">
                {activeBoosts.map(b => {
                  // BUG #69 / R3c — le nom de la cible, quelle que soit sa sorte.
                  // Avant R3c, un boost visant une offre Afroboost affichait
                  // « activité supprimée » : un message FAUX, qui accusait le
                  // partenaire d'avoir effacé une cible en parfaite santé.
                  const actName = libelleCibleBoost(b, {
                    activite: (id) => partnerActivities.find(a => a.id === id)?.name,
                    offreAfroboost: (id) => offresAfroboost.find(o => o.id === id)?.nom,
                    repliActiviteAbsente: t('partner_boost_deleted_activity'),
                    repliOffreAbsente: t('partner_boost_afroboost_offer_unavailable'),
                    repliToutLeCompte: t('partner_boost_all_activities_legacy'),
                  });
                  const matchedDuration = durations.find(d => d.value === b.duration);
                  return (
                    <div key={b.id} className="flex items-center gap-3 p-3 bg-accent/5 border border-accent/10 rounded-xl">
                      <Zap className="h-4 w-4 text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/80 font-light truncate" title={actName}>{actName}</p>
                        <p className="text-xs text-white/50 font-light">
                          {b.city} · {matchedDuration ? t(matchedDuration.labelKey) : b.duration}
                        </p>
                        {b.expiresAt && (
                          <p className="text-[10px] text-white/30 font-light">
                            {t('partner_boost_expire_prefix')} {new Date(b.expiresAt.seconds ? b.expiresAt.seconds * 1000 : b.expiresAt).toLocaleDateString('fr-CH')}
                          </p>
                        )}
                      </div>
                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/5 flex items-center justify-center mb-3">
                  <Rocket className="h-5 w-5 text-white/15" />
                </div>
                <p className="text-white/25 font-light text-sm">{t('partner_boost_no_active')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
