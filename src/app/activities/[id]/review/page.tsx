/**
 * Phase 9.5 c50 — Page review activité destination du lien email reviewReminder.
 *
 * Avant c50 : email cron envoyait `${baseUrl}/activities/${activityId}/review`
 * mais la page n'existait pas → 404 chez l'utilisateur cliquant depuis l'email.
 *
 * Page :
 *  1. AuthGuard (redirect /login si non connecté)
 *  2. Lit Activity + Partner via Firestore client SDK
 *  3. Affiche introduction + <ReviewForm> auto-open
 *  4. onSuccess → toast + redirect /sessions
 *  5. Si user ferme le Dialog → bouton "Laisser un avis" pour ré-ouvrir
 *
 * Réutilise <ReviewForm> existant (c7 SC1) qui encapsule createReview() avec
 * toutes les validations doctrine §9.sexies C (cooling-off, fenêtre 7j,
 * anti-duplicate, rating + comment lengths).
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, MessageSquareText, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { getActivity, getUser } from '@/services/firestore';
import type { Activity, UserProfile } from '@/types/firestore';

function ReviewPageContent() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const activityId = params?.id || '';
  const { toast } = useToast();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [partner, setPartner] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!activityId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const act = await getActivity(activityId);
        if (cancelled) return;
        if (!act) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setActivity(act);
        if (act.partnerId) {
          const p = await getUser(act.partnerId);
          if (!cancelled) setPartner(p);
        }
        if (!cancelled) {
          setLoading(false);
          // Auto-open le Dialog ReviewForm (UX one-tap depuis email)
          setFormOpen(true);
        }
      } catch (err) {
        console.warn('[review page] load failed', err);
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  const handleSuccess = (_reviewId: string, status: 'published' | 'pending') => {
    toast({
      title: status === 'published' ? 'Avis publié — merci ! ⭐' : 'Avis envoyé pour modération',
      description: status === 'published'
        ? '+5 crédits chat ajoutés à ton solde.'
        : 'Ton avis sera publié après modération (sous 72h).',
      className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
    });
    // Redirect après ~600ms pour laisser le toast s'afficher
    setTimeout(() => router.push('/sessions'), 600);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-[#D91CD2] animate-spin" />
      </div>
    );
  }

  if (notFound || !activity) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-md text-center">
        <MessageSquareText className="h-12 w-12 text-white/30 mx-auto mb-4" />
        <h1 className="text-xl text-white font-light mb-2">Activité introuvable</h1>
        <p className="text-sm text-white/50 mb-6">
          Cette activité n&apos;existe plus ou le lien est invalide.
        </p>
        <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/90">
          <Link href="/sessions">Retour aux sessions</Link>
        </Button>
      </div>
    );
  }

  const revieweeName = partner?.displayName || activity.partnerName || 'le partenaire';
  const activityLabel = activity.title || activity.sport || 'cette session';

  return (
    <div className="container mx-auto px-4 py-8 max-w-md">
      <Link
        href="/sessions"
        className="inline-flex items-center gap-1.5 text-white/60 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour
      </Link>

      <div className="text-center">
        <MessageSquareText className="h-12 w-12 text-[#D91CD2] mx-auto mb-4" />
        <h1 className="text-2xl text-white font-light mb-2">
          Reviewer ta session
        </h1>
        <p className="text-sm text-white/60 mb-1">
          <span className="text-white">{activityLabel}</span>
        </p>
        <p className="text-sm text-white/40 mb-8">
          Avec <span className="text-white/70">{revieweeName}</span>
        </p>

        {user && user.uid !== activity.partnerId ? (
          <Button
            onClick={() => setFormOpen(true)}
            className="bg-gradient-to-br from-[#D91CD2] to-[#E91E63] text-white font-semibold px-8 h-12"
          >
            Laisser un avis
          </Button>
        ) : user && user.uid === activity.partnerId ? (
          <p className="text-sm text-white/50">
            Tu ne peux pas reviewer ta propre activité.
          </p>
        ) : null}

        <p className="text-xs text-white/30 mt-6">
          +5 crédits chat bonus si ton avis est publié (note ≥ 3★).
        </p>
      </div>

      {user && activity.partnerId && user.uid !== activity.partnerId && (
        <ReviewForm
          activityId={activityId}
          reviewerId={user.uid}
          revieweeId={activity.partnerId}
          revieweeName={revieweeName}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}

export default function ActivityReviewPage() {
  return (
    <AuthGuard>
      <ReviewPageContent />
    </AuthGuard>
  );
}
