/**
 * BUG #58 — <StoreOfferSection> pour partners sports-store.
 *
 * Deux champs optionnels (cf. spec utilisateur 2026-05-21) :
 *  1. "Avantage exclusif en magasin" — zone de texte court (Textarea)
 *  2. "Test ou prêt de matériel inclus" — radio Oui/Non. Si Oui, ouverture
 *     d'une zone de texte pour décrire le matériel disponible.
 *
 * Rendu uniquement quand Partner.type === 'sports-store' (gate côté form).
 * Pattern visuel aligné <VenueDetailsSection> : charte stricte black / #D91CD2 / white,
 * section avec bordure accent légère + label uppercase tracking-wider.
 */

'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ShoppingBag, Dumbbell, Tag } from 'lucide-react';

// =====================================================================
// Types
// =====================================================================

export interface StoreOfferValue {
  exclusiveDiscount?: string;
  equipmentAvailable?: boolean;
  equipmentDescription?: string;
}

// =====================================================================
// Composant
// =====================================================================

export interface StoreOfferSectionProps {
  value: StoreOfferValue | undefined;
  onChange: (next: StoreOfferValue) => void;
  disabled?: boolean;
}

export function StoreOfferSection({
  value,
  onChange,
  disabled,
}: StoreOfferSectionProps) {
  const current: StoreOfferValue = value ?? {};
  // Tri-state pour la radio : true / false / undefined (pas encore répondu).
  // Stocké comme string dans la RadioGroup ('yes'|'no'|'') puis traduit en bool.
  const equipmentRadioValue =
    current.equipmentAvailable === true
      ? 'yes'
      : current.equipmentAvailable === false
        ? 'no'
        : '';

  const setDiscount = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) {
      const { exclusiveDiscount: _drop, ...rest } = current;
      void _drop;
      onChange(rest);
      return;
    }
    onChange({ ...current, exclusiveDiscount: next });
  };

  const setEquipmentRadio = (v: string) => {
    if (v === 'yes') {
      onChange({ ...current, equipmentAvailable: true });
      return;
    }
    if (v === 'no') {
      // On retire description quand "Non" (cohérence storage)
      const { equipmentDescription: _drop, ...rest } = current;
      void _drop;
      onChange({ ...rest, equipmentAvailable: false });
      return;
    }
    // Désélection (improbable via UI, mais safe)
    const { equipmentAvailable: _a, equipmentDescription: _d, ...rest } = current;
    void _a;
    void _d;
    onChange(rest);
  };

  const setEquipmentDescription = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) {
      const { equipmentDescription: _drop, ...rest } = current;
      void _drop;
      onChange(rest);
      return;
    }
    onChange({ ...current, equipmentDescription: next });
  };

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-accent/20 bg-accent/[0.03] p-4">
      <div className="flex items-start gap-2">
        <ShoppingBag className="h-4 w-4 text-accent mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <Label className="text-xs uppercase tracking-wider text-accent font-medium">
            Avantages partenaire
          </Label>
          <p className="text-[11px] text-white/50 leading-relaxed">
            Détails Magasin de sport — affichés sur la page publique pour valoriser
            l&apos;offre exclusive et les services proposés.
          </p>
        </div>
      </div>

      {/* 1. Avantage exclusif en magasin */}
      <div className="flex flex-col gap-2">
        <Label
          htmlFor="store-discount"
          className="text-[11px] uppercase tracking-wider text-white/60 flex items-center gap-2"
        >
          <Tag className="h-3.5 w-3.5 text-accent/80" aria-hidden="true" />
          Avantage exclusif en magasin (optionnel)
        </Label>
        <Input
          id="store-discount"
          value={current.exclusiveDiscount ?? ''}
          onChange={(e) => setDiscount(e.target.value)}
          disabled={disabled}
          maxLength={120}
          placeholder="Ex: -15% sur tout le magasin le jour de l'événement"
          className="bg-zinc-900/60 border-white/10 text-white placeholder:text-white/30"
        />
        <p className="text-[10px] text-white/40 leading-relaxed">
          Texte court (max 120 caractères) — affiché en évidence sur la page publique.
        </p>
      </div>

      {/* 2. Test ou prêt de matériel inclus */}
      <div className="flex flex-col gap-2">
        <Label
          className="text-[11px] uppercase tracking-wider text-white/60 flex items-center gap-2"
        >
          <Dumbbell className="h-3.5 w-3.5 text-accent/80" aria-hidden="true" />
          Test ou prêt de matériel inclus (optionnel)
        </Label>
        <RadioGroup
          value={equipmentRadioValue}
          onValueChange={setEquipmentRadio}
          disabled={disabled}
          className="flex gap-3"
        >
          {/* Oui */}
          <label
            htmlFor="store-equip-yes"
            className={`flex items-center gap-2 rounded-md border px-4 py-2.5 cursor-pointer transition-colors flex-1 justify-center ${
              equipmentRadioValue === 'yes'
                ? 'border-accent/60 bg-accent/10'
                : 'border-white/10 bg-zinc-900/40 hover:border-accent/40'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RadioGroupItem
              value="yes"
              id="store-equip-yes"
              className="border-white/30 text-accent"
            />
            <span className="text-sm font-medium text-white">Oui</span>
          </label>
          {/* Non */}
          <label
            htmlFor="store-equip-no"
            className={`flex items-center gap-2 rounded-md border px-4 py-2.5 cursor-pointer transition-colors flex-1 justify-center ${
              equipmentRadioValue === 'no'
                ? 'border-accent/60 bg-accent/10'
                : 'border-white/10 bg-zinc-900/40 hover:border-accent/40'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RadioGroupItem
              value="no"
              id="store-equip-no"
              className="border-white/30 text-accent"
            />
            <span className="text-sm font-medium text-white">Non</span>
          </label>
        </RadioGroup>

        {/* Description du matériel — visible uniquement si Oui */}
        {current.equipmentAvailable === true && (
          <div className="flex flex-col gap-2 mt-2 pl-1">
            <Label
              htmlFor="store-equip-desc"
              className="text-[11px] uppercase tracking-wider text-white/60"
            >
              Quel matériel est disponible ?
            </Label>
            <Textarea
              id="store-equip-desc"
              value={current.equipmentDescription ?? ''}
              onChange={(e) => setEquipmentDescription(e.target.value)}
              disabled={disabled}
              maxLength={300}
              rows={3}
              placeholder="Ex: Chaussures de running, montres connectées, tapis de fitness"
              className="bg-zinc-900/60 border-white/10 text-white placeholder:text-white/30 resize-none"
            />
            <p className="text-[10px] text-white/40 leading-relaxed">
              Décris brièvement les équipements proposés en test ou prêt (max 300 caractères).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
