/**
 * BUG #55 — Autocomplétion d'adresse via OpenStreetMap Nominatim (gratuit, sans clé API).
 *
 * UX :
 *  - User tape dans le champ adresse
 *  - Debounce 400ms → fetch Nominatim API
 *  - Dropdown de 5 suggestions max
 *  - Sélection → remplit adresse complète + appelle onCitySelected(ville)
 *
 * Nominatim usage policy :
 *  - 1 req/sec max → debounce 400ms est largement OK
 *  - User-Agent custom recommandé (set côté fetch)
 *  - Pas d'usage commercial intensif (ok pour Spordateur)
 *
 * Pays ciblés : Suisse, France, Belgique (countrycodes=ch,fr,be).
 *
 * @module
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, Loader2 } from 'lucide-react';

interface NominatimAddress {
  road?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  country?: string;
  country_code?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  address: NominatimAddress;
  lat: string;
  lon: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  /** Appelé quand user sélectionne une suggestion → set la ville côté form. */
  onCitySelected?: (city: string) => void;
  /** Pays autorisés (codes ISO 2 lettres). Default : ch,fr,be. */
  countryCodes?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  onCitySelected,
  countryCodes = 'ch,fr,be',
  placeholder = 'Rue du Sport 12',
  disabled,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedValue, setDebouncedValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounce 400ms — respect Nominatim 1 req/sec policy
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), 400);
    return () => clearTimeout(t);
  }, [value]);

  // Fetch quand debounced value change ET length >= 3 chars
  useEffect(() => {
    if (debouncedValue.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    // Cancel previous fetch si en vol
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      debouncedValue,
    )}&format=json&addressdetails=1&limit=5&countrycodes=${countryCodes}`;

    fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim recommande User-Agent custom (peut être bloqué côté browser, on essaie quand même)
        'Accept-Language': 'fr,en',
      },
    })
      .then((r) => r.json() as Promise<NominatimResult[]>)
      .then((data) => {
        setSuggestions(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.warn('[AddressAutocomplete] fetch error:', err);
        setSuggestions([]);
        setIsLoading(false);
      });
    return () => controller.abort();
  }, [debouncedValue, countryCodes]);

  // Click outside → ferme la dropdown
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleSelect = (s: NominatimResult) => {
    // Construit l'adresse propre : "Rue + numéro" si dispo, sinon display_name first part
    const road = s.address.road ?? '';
    const num = s.address.house_number ?? '';
    const street = num ? `${road} ${num}` : road;
    const address = street || s.display_name.split(',')[0];
    onChange(address.trim());
    // City : prefer city > town > village
    const city = s.address.city ?? s.address.town ?? s.address.village ?? '';
    if (city && onCitySelected) onCitySelected(city);
    setIsOpen(false);
    setSuggestions([]);
  };

  return (
    <div ref={containerRef} className="relative grid gap-2">
      <Label className="text-white/50">Adresse</Label>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="bg-[#1A1A1A] border-white/10 h-12 pr-10"
          autoComplete="off"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-accent animate-spin" />
          ) : (
            <MapPin className="h-4 w-4 text-white/30" />
          )}
        </div>
      </div>
      {isOpen && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-zinc-900 border border-white/10 rounded-md shadow-xl max-h-[280px] overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
            >
              <div className="text-sm text-white font-medium truncate">
                {s.address.road ?? s.display_name.split(',')[0]}
                {s.address.house_number ? ` ${s.address.house_number}` : ''}
              </div>
              <div className="text-xs text-white/50 truncate">
                {[
                  s.address.postcode,
                  s.address.city ?? s.address.town ?? s.address.village,
                  s.address.country,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
