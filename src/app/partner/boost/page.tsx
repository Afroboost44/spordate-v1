"use client";

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Rocket, Zap, MapPin, Clock, TrendingUp, Eye, Users, Loader2, Globe, ChevronLeft, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, limit, addDoc, serverTimestamp } from 'firebase/firestore';

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

const DURATIONS = [
  { value: '24h', label: '24 heures', price: 15 },
  { value: '3d', label: '3 jours', price: 35 },
  { value: '7d', label: '1 semaine', price: 50 },
];

type LocationMode = 'choose' | 'swiss' | 'international-country' | 'international-city';

export default function PartnerBoostPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const [locationMode, setLocationMode] = useState<LocationMode>('choose');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDuration, setSelectedDuration] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [activeBoosts, setActiveBoosts] = useState<any[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'cancel' | null>(null);

  const currentPrice = DURATIONS.find(d => d.value === selectedDuration)?.price || 0;

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

      // Save boost to Firestore
      if (db && (partnerId || user?.uid)) {
        const durationHours: Record<string, number> = { '24h': 24, '3d': 72, '7d': 168 };
        const hours = durationHours[duration || '24h'] || 24;
        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

        addDoc(collection(db, 'boosts'), {
          partnerId: partnerId || user?.uid || '',
          city: city ? decodeURIComponent(city) : '',
          duration: duration || '24h',
          active: true,
          stripeSessionId: sessionId,
          createdAt: serverTimestamp(),
          expiresAt,
        }).then(() => {
          toast({ title: "Boost activé", description: `Votre boost est actif pour ${DURATIONS.find(d => d.value === duration)?.label || duration}.` });
        }).catch(err => console.error('[Boost] Save error:', err));
      }

      // Clean URL
      window.history.replaceState({}, '', '/partner/boost');
    } else if (status === 'cancel') {
      setPaymentStatus('cancel');
      toast({ title: "Paiement annulé", description: "Le boost n'a pas été activé.", variant: "destructive" });
      window.history.replaceState({}, '', '/partner/boost');
    }
  }, [searchParams, partnerId, user]);

  const handleBoost = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/boost-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: selectedDuration,
          city: selectedCity,
          country: selectedCountry || undefined,
          partnerId: partnerId || user?.uid || '',
          userId: user?.uid || '',
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
            className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white rounded-full h-12 px-8 font-light"
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
          <div className="w-10 h-10 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center">
            <Rocket className="h-5 w-5 text-[#D91CD2]" />
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
            <h3 className="text-sm text-[#D91CD2] uppercase tracking-[0.2em] font-light">
              Configurer votre Boost
            </h3>

            {/* Location selection */}
            <div className="space-y-3">
              <label className="text-xs text-white/30 uppercase tracking-wider font-light flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Ville ciblée
              </label>

              {selectedCity && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D91CD2]/10 text-[#D91CD2] border border-[#D91CD2]/30 text-sm font-light">
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
                {DURATIONS.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setSelectedDuration(d.value)}
                    className={`p-4 rounded-xl text-center transition border ${
                      selectedDuration === d.value
                        ? 'bg-[#D91CD2]/10 border-[#D91CD2]/30'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <p className={`text-sm font-light ${selectedDuration === d.value ? 'text-[#D91CD2]' : 'text-white/50'}`}>
                      {d.label}
                    </p>
                    <p className={`text-2xl font-extralight mt-1 ${selectedDuration === d.value ? 'text-white' : 'text-white/30'}`}>
                      {d.price} <span className="text-xs">CHF</span>
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Price + CTA */}
            <div className="border-t border-white/5 pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-white/40 font-light">Prix du boost</span>
                <span className="text-3xl font-extralight text-white">
                  {currentPrice} <span className="text-sm text-white/30">CHF</span>
                </span>
              </div>

              <Button
                onClick={handleBoost}
                disabled={!selectedCity || !selectedDuration || isLoading}
                className={`w-full rounded-full h-14 text-base font-semibold ${
                  selectedCity && selectedDuration
                    ? 'bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white'
                    : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
                }`}
              >
                {isLoading ? (
                  <><Loader2 className="animate-spin mr-2 h-5 w-5" /> Redirection vers Stripe...</>
                ) : (
                  <><Zap className="mr-2 h-5 w-5" /> Payer et activer</>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Info — right column */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
            <h3 className="text-sm text-[#D91CD2] uppercase tracking-[0.2em] font-light">
              Comment ça marche ?
            </h3>
            <p className="text-white/40 font-light text-sm leading-relaxed">
              Un Boost place votre activité dans la fenêtre &quot;IT&apos;S A MATCH&quot; des utilisateurs
              qui correspondent à votre offre. C&apos;est le meilleur moyen de transformer un match en réservation.
            </p>

            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Eye className="h-4 w-4 text-[#D91CD2]" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Visibilité x10</p>
                  <p className="text-xs text-white/30 font-light">Apparaissez en priorité dans les résultats</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MapPin className="h-4 w-4 text-[#D91CD2]" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Ciblage précis</p>
                  <p className="text-xs text-white/30 font-light">Touchez les utilisateurs de votre ville</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Users className="h-4 w-4 text-[#D91CD2]" />
                </div>
                <div>
                  <p className="text-sm text-white/70 font-light">Badge &quot;Recommandé&quot;</p>
                  <p className="text-xs text-white/30 font-light">Votre offre se démarque visuellement</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <TrendingUp className="h-4 w-4 text-[#D91CD2]" />
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
                {activeBoosts.map(b => (
                  <div key={b.id} className="flex items-center gap-3 p-3 bg-[#D91CD2]/5 border border-[#D91CD2]/10 rounded-xl">
                    <Zap className="h-4 w-4 text-[#D91CD2] flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-white/70 font-light">{b.city}</p>
                      <p className="text-xs text-white/30 font-light">
                        {DURATIONS.find(d => d.value === b.duration)?.label || b.duration}
                        {b.expiresAt && ` — expire ${new Date(b.expiresAt.seconds ? b.expiresAt.seconds * 1000 : b.expiresAt).toLocaleDateString('fr-CH')}`}
                      </p>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  </div>
                ))}
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
