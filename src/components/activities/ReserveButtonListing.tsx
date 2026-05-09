/**
 * Phase 9.5 c7 — <ReserveButtonListing> client component pour /activities listing card.
 *
 * Comportement :
 *  - !user → redirect /login?next=/activities
 *  - activity.price === 0 → "Réserver gratuitement" → POST /api/checkout {mode:'session-free', activityId}
 *    → redirect /sessions/{newId} (ou /dashboard si pas de session liée)
 *  - activity.price > 0 → "Réserver — {price} CHF" → POST /api/checkout {mode:'session', sessionId}
 *    → redirect Stripe checkout URL (flow Phase 3-9 inchangé)
 *
 * Préserve `<ReserveButton>` existant Phase 4 (used dans /sessions/[id]) — naming différent
 * pour éviter collision.
 *
 * Charte stricte black/#D91CD2/white.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { isFreeBooking } from '@/lib/billing/creditRules';

export interface ReserveButtonListingProps {
  /** Activity card (subset suffisant pour décider free vs paid). */
  activity: {
    activityId: string;
    title: string;
    price: number;
  };
  className?: string;
}

export function ReserveButtonListing({ activity, className }: ReserveButtonListingProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const free = isFreeBooking(activity);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) {
      router.push('/login?next=/activities');
      return;
    }
    setLoading(true);
    try {
      if (free) {
        // Free booking flow — server grants bundle direct, no Stripe
        const idToken = await user.getIdToken();
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            mode: 'session-free',
            activityId: activity.activityId,
            userId: user.uid,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 429) {
            toast({
              title: 'Déjà réservée',
              description: 'Tu as déjà réservé cette activité ces dernières 24h.',
              variant: 'destructive',
            });
          } else if (res.status === 503 && data?.error === 'index-not-ready') {
            toast({
              title: 'Système en cours de mise à jour',
              description: 'Réessaie dans 1 minute.',
              variant: 'destructive',
            });
          } else if (res.status === 412 && data?.error === 'gender-mismatch') {
            toast({
              title: 'Activité non éligible',
              description: 'Cette activité a une audience restreinte qui ne correspond pas à ton profil.',
              variant: 'destructive',
            });
          } else if (res.status === 412 && data?.error === 'gender-required') {
            toast({
              title: 'Profil incomplet',
              description: 'Complète ton genre dans /profile pour réserver cette activité.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Erreur réservation',
              description: 'Contacte le support si le problème persiste.',
              variant: 'destructive',
            });
          }
          return;
        }
        toast({
          title: '🎉 Réservation confirmée',
          description: `Tu as reçu ${data.creditsGranted ?? 5} crédits chat.`,
          className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
          duration: 7000,
        });
        // Phase 9.5 c8 BUG 2 : redirect /sessions/{bookingId} pour countdown ou état "en attente"
        if (data?.bookingId) {
          router.push(`/sessions/${data.bookingId}?status=success`);
        } else {
          router.push('/activities?status=success');
        }
      } else {
        // Paid booking flow — existing Phase 3-9 mode='session' Stripe checkout
        // Note: spec listing utilise activityId mais existing /api/checkout requires sessionId.
        // Pour MVP : redirect vers /activities/[id] où user choisit session puis booking.
        // (Phase 10 polish : skip session selection si activity has unique upcoming session)
        router.push(`/activities/${activity.activityId}`);
      }
    } catch (err) {
      console.error('[ReserveButtonListing] failed', err);
      toast({
        title: 'Erreur réseau',
        description: 'Vérifie ta connexion et réessaie.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const label = free
    ? 'Réserver gratuitement'
    : `Réserver — ${activity.price} CHF`;

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`font-semibold bg-primary hover:bg-primary/90 text-sm px-4 ${className ?? ''}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : null}
      {label}
    </Button>
  );
}
