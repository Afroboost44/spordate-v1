/**
 * Phase 9.5 c8 BUG 2 — Etat "Réservation confirmée — En attente de planification".
 *
 * Affiché sur /sessions/[bookingId] quand l'id correspond à un Booking sans
 * session associée (free booking → pas de timestamps startAt/chatOpenAt).
 *
 * Charte stricte : black/#D91CD2/white.
 */

import Link from 'next/link';
import { Check, ArrowLeft, Coins, MapPin } from 'lucide-react';
import type { Activity, Booking } from '@/types/firestore';

interface BookingPendingHeroProps {
  booking: Booking;
  activity: Activity | null;
  /** Bundle crédits chat reçus (depuis activity.chatCreditsBundle ou central rules). */
  creditsGranted: number;
}

export function BookingPendingHero({
  booking,
  activity,
  creditsGranted,
}: BookingPendingHeroProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const title = activity?.title || (activity as any)?.name || 'Activité réservée';
  const partnerName = activity?.partnerName || '';
  const city = activity?.city || '';
  const sport = activity?.sport || booking.sport || '';
  const description = activity?.description || '';

  return (
    <section className="flex flex-col gap-6">
      {/* Confirmation banner */}
      <div className="rounded-lg border border-[#D91CD2]/40 bg-gradient-to-br from-[#D91CD2]/10 via-black to-black p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#D91CD2]/15">
            <Check className="h-5 w-5 text-[#D91CD2]" />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <h1 className="text-2xl sm:text-3xl text-white font-light">
              Réservation confirmée
            </h1>
            <p className="text-sm text-white/70">
              Le partenaire planifiera bientôt la session. Tu recevras une
              notification dès qu&apos;une date est fixée.
            </p>
          </div>
        </div>
      </div>

      {/* Activity details */}
      <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            Activité
          </span>
          <h2 className="text-xl text-white font-light">{title}</h2>
          {sport && (
            <span className="text-xs text-white/60">{sport}</span>
          )}
        </div>

        {partnerName && (
          <div className="flex items-center gap-2 text-sm text-white/70">
            <MapPin className="h-4 w-4 text-[#D91CD2]" />
            <span className="font-medium">{partnerName}</span>
            {city && <span className="text-white/40">— {city}</span>}
          </div>
        )}

        {description && (
          <p className="text-sm text-white/60 leading-relaxed line-clamp-3">
            {description}
          </p>
        )}

        {creditsGranted > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-[#D91CD2]/30 bg-[#D91CD2]/5 px-3 py-2">
            <Coins className="h-4 w-4 text-[#D91CD2]" />
            <span className="text-sm text-white">
              <span className="font-semibold">+{creditsGranted}</span> crédits chat reçus
            </span>
          </div>
        )}
      </div>

      {/* Back link */}
      <Link
        href="/activities"
        className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voir d&apos;autres activités
      </Link>
    </section>
  );
}
