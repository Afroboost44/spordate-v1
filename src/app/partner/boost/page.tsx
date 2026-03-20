"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Rocket, Zap, MapPin, Clock, TrendingUp, Eye, Users, Loader2, Globe, ChevronLeft } from 'lucide-react';

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
  const [locationMode, setLocationMode] = useState<LocationMode>('choose');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDuration, setSelectedDuration] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const currentPrice = DURATIONS.find(d => d.value === selectedDuration)?.price || 0;

  const handleBoost = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 2000);
  };

  const resetLocation = () => {
    setLocationMode('choose');
    setSelectedCountry('');
    setSelectedCity('');
  };

  const locationLabel = selectedCity
    ? (selectedCountry ? `${selectedCity}, ${selectedCountry}` : selectedCity)
    : '';

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

              {/* Show selected location badge if city is chosen */}
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

              {/* Step 1: Choose Swiss or International */}
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

              {/* Step 2a: Swiss cities */}
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

              {/* Step 2b: International — pick country */}
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

              {/* Step 3: International — pick city */}
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
                  <><Loader2 className="animate-spin mr-2 h-5 w-5" /> Traitement...</>
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
            <div className="flex flex-col items-center py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/5 flex items-center justify-center mb-3">
                <Rocket className="h-5 w-5 text-white/15" />
              </div>
              <p className="text-white/25 font-light text-sm">Aucun boost actif</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
