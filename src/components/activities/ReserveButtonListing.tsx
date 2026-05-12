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
import { useLanguage } from '@/context/LanguageContext';
import { isFreeBooking } from '@/lib/billing/creditRules';
import { hasUpcomingSchedule } from '@/lib/activities/scheduled';

export interface ReserveButtonListingProps {
  /** Activity card (subset suffisant pour décider free vs paid). */
  activity: {
    activityId: string;
    title: string;
    price: number;
    /** Phase 9.5 c42 — scheduledAt sur Activity = source UX du texte
     *  "Prochaine séance". Si défini et futur, le bouton est activé même
     *  sans nextSessionId : le clic appellera /api/sessions/ensure-from-activity
     *  pour créer (idempotent) la Session manquante puis router vers elle. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scheduledAt?: any;
  };
  /** Phase 9.5 c30 BUG GG — sessionId de la prochaine séance future pour cette
   *  activity (résolu par /activities/page.tsx via batch query sessions). Si
   *  undefined ET activity.scheduledAt absent/passé → bouton désactivé. */
  nextSessionId?: string;
  className?: string;
}

export function ReserveButtonListing({ activity, nextSessionId, className }: ReserveButtonListingProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  const free = isFreeBooking(activity);
  // Phase 9.5 c42 — bouton activé si soit une Session future existe (nextSessionId),
  // soit l'Activity a un scheduledAt futur (même source que le texte affiché). Le
  // 2e cas déclenchera la création on-demand de la Session via ensure-from-activity.
  const hasFutureSchedule = hasUpcomingSchedule({ scheduledAt: activity.scheduledAt });
  const canReserve = free || !!nextSessionId || hasFutureSchedule;
  const paidButNoSession = !canReserve;

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
          // Phase 9.5 c15 BUG A — 429 cooldown : si server renvoie existingBookingId,
          // redirect direct vers la réservation existante (au lieu d'un toast destructif).
          if (res.status === 429 && typeof data?.existingBookingId === 'string') {
            toast({
              title: 'Tu as déjà réservé',
              description: 'On t\'amène à ta réservation existante.',
              className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
              duration: 4000,
            });
            router.push(`/sessions/${data.existingBookingId}?status=success`);
            return;
          }
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
      } else if (nextSessionId) {
        // Phase 9.5 c30 BUG GG — paid flow : route directement vers la prochaine
        // session future (countdown + tabs prix + bouton Réserver phase-aware).
        // Avant c30 ça redirigeait vers /activities/{activityId} (page statique
        // sans countdown ni tabs prix → impossible de finaliser le checkout).
        router.push(`/sessions/${nextSessionId}`);
      } else if (hasFutureSchedule) {
        // Phase 9.5 c42 — Activity a scheduledAt futur mais aucune Session ne
        // l'a encore matérialisé dans sessions/. Appel server-side idempotent
        // pour créer la Session (ou récupérer l'id si race-condition créé
        // entre temps), puis route classique /sessions/{id}.
        const idToken = await user.getIdToken();
        const res = await fetch('/api/sessions/ensure-from-activity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ activityId: activity.activityId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.sessionId) {
          router.push(`/sessions/${data.sessionId}`);
        } else {
          console.warn('[ReserveButtonListing] ensure-from-activity failed', { status: res.status, data });
          toast({
            title: t('reserve_no_upcoming_session'),
            description: data?.detail || data?.error || undefined,
            variant: 'destructive',
          });
        }
      } else {
        // Aucune session future → état impossible (le bouton aurait dû être
        // désactivé). Filet : afficher un toast informatif et rester sur page.
        toast({
          title: t('reserve_no_upcoming_session'),
          variant: 'destructive',
        });
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

  const label = paidButNoSession
    ? t('reserve_no_upcoming_session')
    : free
      ? 'Réserver gratuitement'
      : `Réserver — ${activity.price} CHF`;

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={loading || paidButNoSession}
      aria-disabled={paidButNoSession}
      className={`font-semibold text-sm px-4 ${
        paidButNoSession
          ? 'bg-white/5 text-white/30 cursor-not-allowed hover:bg-white/5'
          : 'bg-primary hover:bg-primary/90'
      } ${className ?? ''}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : null}
      {label}
    </Button>
  );
}
