"use client";

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Rocket, Zap, MapPin, Clock, TrendingUp, Eye, Users, Loader2, Globe, ChevronLeft, CheckCircle, XCircle, CreditCard, Coins, ListChecks } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/context/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
// Phase 9.5 c30 — constants partagées avec /api/boost-credits/route.ts via lib.
import { BOOST_CREDITS_COST, CHF_PER_CREDIT } from '@/lib/billing/boostCredits';

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
const DEFAULT_DURATIONS: Array<{ value: string; label: string; price: number }> = [
  { value: '24h', label: '24 heures', price: 15 },
  { value: '3d',  label: '3 jours',   price: 35 },
  { value: '7d',  label: '1 semaine', price: 50 },
];

type LocationMode = 'choose' | 'swiss' | 'international-country' | 'international-city';

export default function PartnerBoostPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
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
  const [selectedActivityId, setSelectedActivityId] = useState('');
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
            label: '24 heures',
            price: typeof data.boostPartner24hPriceCHF === 'number' && data.boostPartner24hPriceCHF >= 0
              ? data.boostPartner24hPriceCHF : 15,
          },
          {
            value: '3d',
            label: '3 jours',
            price: typeof data.boostPartner3dPriceCHF === 'number' && data.boostPartner3dPriceCHF >= 0
              ? data.boostPartner3dPriceCHF : 35,
          },
          {
            value: '7d',
            label: '1 semaine',
            price: typeof data.boostPartner7dPriceCHF === 'number' && data.boostPartner7dPriceCHF >= 0
              ? data.boostPartner7dPriceCHF : 50,
          },
        ]);
      } catch (err) {
        console.warn('[/partner/boost] settings/pricing read failed, fallback defaults', err);
      }
    })();
  }, []);

  const currentPrice = durations.find(d => d.value === selectedDuration)?.price || 0;
  const currentCreditCost = selectedDuration ? BOOST_CREDITS_COST[selectedDuration] || 0 : 0;
  const hasEnoughCredits = credits >= currentCreditCost;

  // Phase 9.5 c32 — Helper PURE qui retourne la raison la plus prioritaire qui
  // bloque l'activation du boost. null si tout OK (bouton actif). Affiché sous
  // le bouton désactivé pour éviter le "ghost button silencieux" vécu en c29b.
  // Branche `credits` saute le check hasEnoughCredits (déjà géré par le bouton
  // alternatif "Solde insuffisant — Recharger" qui remplace le bouton normal).
  const getDisabledReason = (): string | null => {
    if (!selectedActivityId) return "Choisissez d'abord l'activité à booster";
    if (!selectedCity) return "Sélectionnez d'abord une ville ciblée";
    if (!selectedDuration) return 'Choisissez la durée du boost';
    if (isLoading) return 'Traitement en cours...';
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
        title: "Boost activé",
        description: `Activation en cours (quelques secondes)… Le boost ${durations.find(d => d.value === duration)?.label || duration} sera visible dans /partner/dashboard.`,
      });

      // Clean URL
      window.history.replaceState({}, '', '/partner/boost');
    } else if (status === 'cancel') {
      setPaymentStatus('cancel');
      toast({ title: "Paiement annulé", description: "Le boost n'a pas été activé.", variant: "destructive" });
      window.history.replaceState({}, '', '/partner/boost');
    }
  }, [searchParams, partnerId, user]);

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
          city: selectedCity,
          country: selectedCountry || undefined,
          // BUG #69 — activityId envoyée au /api/boost-checkout qui la passe en
          // Stripe metadata. Le webhook handleBoostPayment lit metadata.activityId
          // et persiste sur le doc boosts/ → Discovery filter (partnerId, activityId).
          activityId: selectedActivityId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      console.error('[Boost]', err);
      toast({
        title: "Erreur",
        description: err.message || "Impossible de lancer le paiement.",
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
          city: selectedCity,
          country: selectedCountry || undefined,
          // BUG #69 — activityId persistée directement dans boosts/ par l'API
          // (mode credits = pas de Stripe, pas de webhook, écriture inline).
          activityId: selectedActivityId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'insufficient-credits') {
          toast({
            title: 'Solde insuffisant',
            description: `Tu as ${data.have} crédits, il en faut ${data.need}.`,
            variant: 'destructive',
          });
        } else if (data.error === 'already-boosted') {
          toast({
            title: 'Boost déjà actif',
            description: data.detail || 'Attends son expiration avant d\'en activer un autre.',
            variant: 'destructive',
          });
        } else {
          throw new Error(data.detail || data.error || 'Erreur inconnue');
        }
        setIsLoading(false);
        return;
      }
      toast({
        title: 'Boost activé !',
        description: `Solde restant : ${data.creditsRemaining} crédits.`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      setPaymentStatus('success');
    } catch (err: any) {
      console.error('[BoostCredits]', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible d\'activer le boost.',
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
          <h2 className="text-2xl font-extralight text-white mb-2">Boost activé !</h2>
          <p className="text-white/40 font-light mb-8">Votre visibilité est maintenant boostée. Les utilisateurs verront votre offre en priorité.</p>
          <Button
            onClick={() => setPaymentStatus(null)}
            className="bg-accent hover:bg-accent/80 text-white rounded-full h-12 px-8 font-light"
          >
            Configurer un autre boost
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
            Booster ma visibilité
          </h1>
        </div>
        <p className="text-white/40 font-light mt-1">
          Mettez vos offres en avant auprès des utilisateurs qui matchent.
        </p>
      </div>

      {/* Cancel banner */}
      {paymentStatus === 'cancel' && (
        <div className="flex items-center gap-3 p-4 bg-red-500/5 border border-red-500/10 rounded-xl">
          <XCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400/80 font-light">Le paiement a été annulé. Vous pouvez réessayer quand vous voulez.</p>
          <button onClick={() => setPaymentStatus(null)} className="text-xs text-white/30 hover:text-white/60 ml-auto">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">

        {/* Configuration — left column */}
        <div className="md:col-span-3 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
            <h3 className="text-sm text-accent uppercase tracking-[0.2em] font-light">
              Configurer votre Boost
            </h3>

            {/* BUG #69 — Activity selector. Le partenaire DOIT choisir QUELLE
                activité booster (avant : boost s'appliquait à tout le compte). */}
            <div className="space-y-3">
              <label
                htmlFor="boost-activity-select"
                className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5"
              >
                <ListChecks className="h-3 w-3" /> Activité à booster
              </label>
              {partnerActivities.length === 0 ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/[0.05] p-4">
                  <p className="text-sm text-amber-300/90 font-light">
                    Aucune activité active. Crée d&apos;abord une activité dans{' '}
                    <a href="/partner/offers" className="text-accent underline">
                      Mes Offres
                    </a>
                    {' '}avant de pouvoir la booster.
                  </p>
                </div>
              ) : (
                <select
                  id="boost-activity-select"
                  value={selectedActivityId}
                  onChange={(e) => setSelectedActivityId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm font-light focus:outline-none focus:border-accent/40"
                >
                  <option value="">— Choisis l&apos;activité —</option>
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

            {/* Location selection */}
            <div className="space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Ville ciblée
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
                    Changer
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
                    <span className="text-sm font-light">Suisse</span>
                  </button>
                  <button
                    onClick={() => setLocationMode('international-country')}
                    className="flex items-center justify-center gap-2 p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 transition"
                  >
                    <Globe className="h-5 w-5" />
                    <span className="text-sm font-light">International</span>
                  </button>
                </div>
              )}

              {locationMode === 'swiss' && !selectedCity && (
                <div className="space-y-2">
                  <button
                    onClick={() => setLocationMode('choose')}
                    className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 font-light transition"
                  >
                    <ChevronLeft className="h-3 w-3" /> Retour
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
                    <ChevronLeft className="h-3 w-3" /> Retour
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

            {/* Duration selection */}
            <div className="space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Durée du boost
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
                      {d.label}
                    </p>
                    <p className={`text-2xl font-extralight mt-1 ${selectedDuration === d.value ? 'text-white' : 'text-white/30'}`}>
                      {d.price} <span className="text-xs">CHF</span>
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Phase 9.5 c29b BUG FF — Méthode de paiement (Stripe ou Crédits Spordate) */}
            <div className="border-t border-white/5 pt-6 space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light">
                Méthode de paiement
              </label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Méthode de paiement">
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
                  Carte / TWINT
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
                  Crédits Spordateur
                </button>
              </div>
              {paymentMethod === 'credits' && (
                <p className="text-[11px] text-white/40 font-light pl-1">
                  Solde : <span className="text-white">{credits}</span> crédits
                </p>
              )}
            </div>

            {/* Price + CTA */}
            <div className="pt-2 space-y-4">
              {paymentMethod === 'stripe' ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 font-light">Prix du boost</span>
                    <span className="text-3xl font-extralight text-white">
                      {currentPrice} <span className="text-sm text-white/30">CHF</span>
                    </span>
                  </div>
                  <Button
                    onClick={handleBoost}
                    disabled={!selectedActivityId || !selectedCity || !selectedDuration || isLoading}
                    className={`w-full rounded-full h-14 text-base font-semibold ${
                      selectedActivityId && selectedCity && selectedDuration
                        ? 'bg-accent hover:bg-accent/80 text-white'
                        : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? (
                      <><Loader2 className="animate-spin mr-2 h-5 w-5" /> Redirection vers Stripe...</>
                    ) : (
                      <><Zap className="mr-2 h-5 w-5" /> Payer et activer</>
                    )}
                  </Button>
                  {/* Phase 9.5 c32 — raison contextuelle si bouton désactivé */}
                  {disabledReason && (
                    <p className="text-center text-xs text-amber-400/80">
                      {disabledReason}
                    </p>
                  )}
                  <p className="mt-3 text-center text-[11px] text-zinc-500">
                    Visa · Mastercard · TWINT
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 font-light">Coût en crédits</span>
                    <div className="text-right">
                      <span className="text-3xl font-extralight text-white">
                        {currentCreditCost} <span className="text-sm text-white/30">crédits</span>
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
                      Solde insuffisant — Recharger
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
                        <><Loader2 className="animate-spin mr-2 h-5 w-5" /> Activation...</>
                      ) : (
                        <><Coins className="mr-2 h-5 w-5" /> Activer avec mes crédits</>
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
                    Débit instantané · pas de redirection
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
              Comment ça marche ?
            </h3>
            <p className="text-white/40 font-light text-sm leading-relaxed">
              Un Boost place votre activité dans la fenêtre &quot;IT&apos;S A MATCH&quot; des utilisateurs
              qui correspondent à votre offre. C&apos;est le meilleur moyen de transformer un match en réservation.
            </p>

            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Eye className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Visibilité x10</p>
                  <p className="text-xs text-white/30 font-light">Apparaissez en priorité dans les résultats</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MapPin className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Ciblage précis</p>
                  <p className="text-xs text-white/30 font-light">Touchez les utilisateurs de votre ville</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Users className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Badge &quot;Recommandé&quot;</p>
                  <p className="text-xs text-white/30 font-light">Votre offre se démarque visuellement</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <TrendingUp className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Plus de réservations</p>
                  <p className="text-xs text-white/30 font-light">Convertissez les matchs en clients</p>
                </div>
              </div>
            </div>
          </div>

          {/* Active boosts */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm text-white/30 uppercase tracking-wider font-light mb-4">Boosts actifs</h3>
            {activeBoosts.length > 0 ? (
              <div className="space-y-3">
                {activeBoosts.map(b => {
                  // BUG #69 — Map activityId → nom (résolu via partnerActivities chargées au mount).
                  // Si activityId absent (boost legacy avant fix #69) → label spécifique.
                  const actName = b.activityId
                    ? partnerActivities.find(a => a.id === b.activityId)?.name || 'Activité supprimée'
                    : 'Toutes les activités (legacy)';
                  return (
                    <div key={b.id} className="flex items-center gap-3 p-3 bg-accent/5 border border-accent/10 rounded-xl">
                      <Zap className="h-4 w-4 text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/80 font-light truncate" title={actName}>{actName}</p>
                        <p className="text-xs text-white/50 font-light">
                          {b.city} · {durations.find(d => d.value === b.duration)?.label || b.duration}
                        </p>
                        {b.expiresAt && (
                          <p className="text-[10px] text-white/30 font-light">
                            Expire {new Date(b.expiresAt.seconds ? b.expiresAt.seconds * 1000 : b.expiresAt).toLocaleDateString('fr-CH')}
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
                <p className="text-white/25 font-light text-sm">Aucun boost actif</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
