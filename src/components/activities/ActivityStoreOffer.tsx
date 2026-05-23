/**
 * BUG #58 — <ActivityStoreOffer> bloc public "Avantages partenaire".
 *
 * Affiché sur /activities/[id] uniquement si activity.storeOffer contient
 * au moins un sous-champ utile (exclusiveDiscount ou equipmentAvailable=true).
 *
 * Layout : section dédiée avec icône ShoppingBag + heading h2 + cards à icônes.
 * Charte stricte black/#D91CD2/white. Pattern aligné <ActivityVenueDetails>.
 */

'use client';

import { ShoppingBag, Tag, Dumbbell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface StoreOfferData {
  exclusiveDiscount?: string;
  equipmentAvailable?: boolean;
  equipmentDescription?: string;
}

export interface ActivityStoreOfferProps {
  offer: StoreOfferData | undefined | null;
}

export function ActivityStoreOffer({ offer }: ActivityStoreOfferProps) {
  if (!offer) return null;
  const hasDiscount = !!offer.exclusiveDiscount && offer.exclusiveDiscount.trim().length > 0;
  const hasEquipment = offer.equipmentAvailable === true;
  if (!hasDiscount && !hasEquipment) return null;

  return (
    <section
      aria-labelledby="store-offer-heading"
      className="flex flex-col gap-4 rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.08] to-transparent p-4 sm:p-5"
    >
      <div className="flex items-center gap-2">
        <ShoppingBag className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2
          id="store-offer-heading"
          className="text-lg sm:text-xl text-white font-light"
        >
          Avantages partenaire
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Avantage exclusif en magasin */}
        {hasDiscount && (
          <StoreOfferCard
            Icon={Tag}
            label="Avantage exclusif en magasin"
            value={offer.exclusiveDiscount!}
            highlight
          />
        )}

        {/* Test/prêt de matériel — affiché uniquement si Oui */}
        {hasEquipment && (
          <StoreOfferCard
            Icon={Dumbbell}
            label="Matériel inclus (test ou prêt)"
            value={
              offer.equipmentDescription && offer.equipmentDescription.trim().length > 0
                ? offer.equipmentDescription
                : 'Du matériel est mis à disposition pendant l’activité.'
            }
          />
        )}
      </div>
    </section>
  );
}

function StoreOfferCard({
  Icon,
  label,
  value,
  highlight,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        highlight
          ? 'border-accent/40 bg-accent/[0.08]'
          : 'border-white/10 bg-zinc-950/50'
      }`}
    >
      <div className="rounded-full bg-accent/15 border border-accent/30 p-2 shrink-0">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="text-sm text-white font-medium leading-snug whitespace-pre-line">
          {value}
        </span>
      </div>
    </div>
  );
}
