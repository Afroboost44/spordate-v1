/**
 * Fix B B2 — Modal édition prix d'une session précise (partner).
 *
 * Décisions Bassi :
 *  - Modèle "Override total" : 1 toggle "Prix spécifique à cette session"
 *    + 1 input prix unique. ON = écrase les 3 tiers à cette valeur ; OFF =
 *    réinitialise depuis Activity.defaultPricingTiers.
 *  - 0 CHF = OFFERT → géré côté flow booking (handlePayment ligne 1093,
 *    Stripe bypass via Fix A getBookingPriceCHF retourne 0).
 *  - Max 1000 CHF (validation client miroir endpoint).
 *
 * Pipeline :
 *  - Pre-fill : toggle ON si session.pricingMode==='custom' (ou si les 3 tiers
 *    sont identiques en heuristique pour les sessions legacy sans pricingMode),
 *    input = early tier price / 100. Sinon toggle OFF, input vide.
 *  - Save → PATCH /api/partner/sessions/[id]/pricing { useCustomPrice, customPriceCHF }
 *  - Success toast + onSaved() callback → caller refresh la liste.
 *
 * @module
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Gift, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import type { Session } from '@/types/firestore';

/**
 * Subset minimal d'Activity utilisé par la modal (title + price). Permet
 * d'accepter aussi bien le type Activity global (from @/types/firestore)
 * que le type local défini dans /partner/offers/page.tsx qui diverge
 * légèrement (champs absents : geoPoint, partnerName, etc.).
 */
interface ActivityLike {
  activityId?: string;
  title?: string;
  name?: string;
  price?: number;
}

interface SessionPricingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
  activity: ActivityLike | null;
  onSaved?: () => void;
}

export function SessionPricingModal({
  open,
  onOpenChange,
  session,
  activity,
  onSaved,
}: SessionPricingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [useCustom, setUseCustom] = useState(false);
  const [customPrice, setCustomPrice] = useState('');
  const [saving, setSaving] = useState(false);

  // Pre-fill quand la modal s'ouvre / la session change.
  useEffect(() => {
    if (!open || !session) return;
    if (session.pricingMode === 'custom') {
      setUseCustom(true);
      const earlyTier = session.pricingTiers?.find((t) => t.kind === 'early');
      const cents = earlyTier?.price ?? 0;
      setCustomPrice(String(Math.round(cents / 100)));
    } else {
      setUseCustom(false);
      setCustomPrice('');
    }
  }, [open, session]);

  const startDate = session?.startAt && typeof session.startAt.toDate === 'function'
    ? session.startAt.toDate()
    : null;
  const dateLabel = startDate
    ? startDate.toLocaleString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const activityDefaultPriceCHF = typeof activity?.price === 'number' ? activity.price : 0;

  const parsedPrice = (() => {
    const n = parseFloat(customPrice);
    return Number.isFinite(n) ? n : NaN;
  })();
  const priceInvalid =
    useCustom && (Number.isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 1000);
  const isFree = useCustom && parsedPrice === 0;

  const handleSave = async () => {
    if (!user || !session || saving) return;
    if (priceInvalid) return;
    setSaving(true);
    try {
      // BUG B2 hotfix : force refresh du token (forceRefresh=true). Sans ça,
      // un token caché ayant expiré dans la dernière minute échoue côté admin
      // SDK avec aud-mismatch silencieux → 401 unauthenticated en sortie.
      const idToken = await user.getIdToken(true);
      if (!idToken) {
        toast({
          title: 'Session expirée',
          description: 'Reconnecte-toi pour modifier le prix.',
          variant: 'destructive',
        });
        return;
      }
      const res = await fetch(`/api/partner/sessions/${session.sessionId}/pricing`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          useCustomPrice: useCustom,
          customPriceCHF: useCustom ? parsedPrice : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data?.error as string) || `HTTP ${res.status}`;
        let msg = data?.detail || code;
        if (code === 'session-frozen') {
          msg = 'Cette session a déjà des réservations, son prix est gelé.';
        } else if (code === 'forbidden') {
          msg = 'Tu n\'es pas le propriétaire de cette session.';
        } else if (code === 'unauthenticated') {
          msg = 'Session expirée — reconnecte-toi (Quitter puis re-login partenaire).';
        }
        // Log diagnostic complet pour Bassi (DevTools console)
        console.warn('[SessionPricingModal] PATCH failed', {
          status: res.status,
          code,
          detail: data?.detail,
          sessionId: session.sessionId,
          hasToken: idToken.length > 0,
          tokenLength: idToken.length,
        });
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Prix mis à jour ✓',
        description:
          data?.mode === 'custom'
            ? `Cette session coûte maintenant ${data.effectivePriceCHF} CHF.`
            : `Cette session hérite du prix par défaut (${activityDefaultPriceCHF} CHF).`,
        className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      });
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      console.warn('[SessionPricingModal] PATCH failed', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour le prix. Réessaie.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Modifier le prix de cette session</DialogTitle>
          <DialogDescription className="text-white/50 text-xs">
            {dateLabel}
            {(activity?.title || activity?.name) && (
              <span className="block mt-1">
                Activité : <span className="text-[#D91CD2]">{activity.title || activity.name}</span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Toggle */}
          <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label className="text-white text-sm font-medium">
                  Prix spécifique à cette session
                </Label>
                <p className="text-[11px] text-white/40 mt-1 font-light">
                  Active pour définir un prix différent du prix par défaut de l&apos;activité.
                </p>
              </div>
              <Switch checked={useCustom} onCheckedChange={setUseCustom} disabled={saving} />
            </div>

            {useCustom ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-white/50 flex-1 min-w-0 truncate">
                    Prix de cette session
                  </Label>
                  <Input
                    type="number"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder="0 = OFFERT"
                    min={0}
                    max={1000}
                    step="1"
                    className="w-24 h-9 text-sm bg-[#0D0D0D] border-white/10"
                  />
                  <span className="text-xs text-white/30 w-8 text-right">CHF</span>
                </div>
                {isFree && (
                  <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                    <Gift className="h-3 w-3" />
                    Cette session sera OFFERTE — les participants n&apos;auront pas à payer.
                  </p>
                )}
                {priceInvalid && (
                  <p className="text-[11px] text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Prix invalide. Entre une valeur entre 0 et 1000 CHF.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-white/30 font-light">
                Prix par défaut de l&apos;activité : <span className="text-white/60">{activityDefaultPriceCHF} CHF</span>
              </p>
            )}
          </div>

          {/* Info V9 freeze (préventif si user n'a pas encore vu) */}
          <p className="text-[10px] text-white/30 font-light">
            ℹ️ Une fois qu&apos;une réservation a été prise sur cette session, son prix est
            définitivement gelé (anti-cheat).
          </p>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-white/10"
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || priceInvalid}
            className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
