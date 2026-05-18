/**
 * Fix B Option 3 — Modal d'édition complète d'une session partner.
 *
 * Remplace SessionPricingModal (B2). Étendu pour permettre :
 *  - Modifier date + heure (input datetime-local)
 *  - Override prix (toggle + 1 input — repris de B2)
 *  - Supprimer la session (bouton rouge + AlertDialog confirm)
 *
 * V9 freeze (currentParticipants > 0) bloque TOUT (date + prix + delete).
 * Validation client + double-check serveur via PATCH/DELETE endpoints.
 *
 * Pipeline save :
 *   PATCH /api/partner/sessions/[sessionId] body { useCustomPrice,
 *     customPriceCHF?, startAtMillis? }
 *   → 200 success → onSaved() → close
 *
 * Pipeline delete :
 *   AlertDialog confirm → DELETE /api/partner/sessions/[sessionId]
 *   → 200 success → onSaved() → close
 *
 * @module
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Gift, AlertTriangle, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { validateSessionDate } from '@/lib/billing/sessionDateValidation';
import type { Session } from '@/types/firestore';

interface ActivityLike {
  activityId?: string;
  title?: string;
  name?: string;
  price?: number;
}

interface SessionEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
  activity: ActivityLike | null;
  onSaved?: () => void;
}

/** Convertit un Date en string format "YYYY-MM-DDTHH:mm" (datetime-local). */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionEditModal({
  open,
  onOpenChange,
  session,
  activity,
  onSaved,
}: SessionEditModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [useCustom, setUseCustom] = useState(false);
  const [customPrice, setCustomPrice] = useState('');
  const [datetimeLocal, setDatetimeLocal] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
    // Pre-fill date depuis session.startAt
    if (session.startAt && typeof session.startAt.toDate === 'function') {
      setDatetimeLocal(toDatetimeLocal(session.startAt.toDate()));
    } else {
      setDatetimeLocal('');
    }
  }, [open, session]);

  const isFrozen = (session?.currentParticipants ?? 0) > 0;

  const activityDefaultPriceCHF = typeof activity?.price === 'number' ? activity.price : 0;
  const activityLabel = activity?.title || activity?.name || '';

  const parsedPrice = (() => {
    const n = parseFloat(customPrice);
    return Number.isFinite(n) ? n : NaN;
  })();
  const priceInvalid =
    useCustom && (Number.isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 1000);
  const isFree = useCustom && parsedPrice === 0;

  // Validate date côté client (defensive — endpoint re-valide).
  const datetimeMs = datetimeLocal ? new Date(datetimeLocal).getTime() : NaN;
  const dateValidation = validateSessionDate(datetimeMs, Date.now());
  const dateChanged = (() => {
    if (!session?.startAt || typeof session.startAt.toMillis !== 'function') return true;
    return datetimeMs !== session.startAt.toMillis();
  })();

  const canSave = !saving && !priceInvalid && (dateChanged ? dateValidation.valid : true);

  const handleSave = async () => {
    if (!user || !session || saving || !canSave) return;
    setSaving(true);
    try {
      const idToken = await user.getIdToken(true);
      const body: Record<string, unknown> = {
        useCustomPrice: useCustom,
      };
      if (useCustom) body.customPriceCHF = parsedPrice;
      if (dateChanged && dateValidation.valid) body.startAtMillis = datetimeMs;
      const res = await fetch(`/api/partner/sessions/${session.sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data?.error as string) || `HTTP ${res.status}`;
        let msg = data?.detail || code;
        if (code === 'session-frozen') msg = 'Cette session a déjà des réservations, modifications bloquées.';
        else if (code === 'forbidden') msg = "Tu n'es pas le propriétaire de cette session.";
        else if (code === 'unauthenticated') msg = 'Session expirée — reconnecte-toi.';
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Session mise à jour ✓',
        description: data?.mode === 'custom'
          ? `Prix : ${data.effectivePriceCHF} CHF`
          : `Prix : ${activityDefaultPriceCHF} CHF (héritage activité)`,
        className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      });
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      console.warn('[SessionEditModal] PATCH failed', err);
      toast({ title: 'Erreur', description: 'Impossible de mettre à jour. Réessaie.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !session || deleting) return;
    setDeleting(true);
    try {
      const idToken = await user.getIdToken(true);
      const res = await fetch(`/api/partner/sessions/${session.sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data?.error as string) || `HTTP ${res.status}`;
        let msg = data?.detail || code;
        if (code === 'session-frozen') msg = 'Cette session a déjà des réservations, suppression impossible.';
        else if (code === 'forbidden') msg = "Tu n'es pas le propriétaire de cette session.";
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Session supprimée ✓',
        description: 'La session ne sera plus visible.',
        className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      });
      setConfirmDeleteOpen(false);
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      console.warn('[SessionEditModal] DELETE failed', err);
      toast({ title: 'Erreur', description: 'Impossible de supprimer. Réessaie.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[#0A0A0A] border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Modifier la session</DialogTitle>
            <DialogDescription className="text-white/50 text-xs">
              {activityLabel && (
                <span>Activité : <span className="text-[#D91CD2]">{activityLabel}</span></span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 space-y-4">
            {/* Date / Heure */}
            <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-2">
              <Label className="text-white text-sm font-medium">Date et heure</Label>
              <Input
                type="datetime-local"
                value={datetimeLocal}
                onChange={(e) => setDatetimeLocal(e.target.value)}
                disabled={isFrozen || saving}
                className="bg-[#0D0D0D] border-white/10 h-11 text-white"
              />
              {dateChanged && !dateValidation.valid && (
                <p className="text-[11px] text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  {dateValidation.reason === 'past' && 'La date doit être dans le futur.'}
                  {dateValidation.reason === 'too-far' && 'La date ne peut pas être à plus d\'1 an.'}
                  {dateValidation.reason === 'invalid-date' && 'Date invalide.'}
                </p>
              )}
            </div>

            {/* Prix override */}
            <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <Label className="text-white text-sm font-medium">Prix spécifique à cette session</Label>
                  <p className="text-[11px] text-white/40 mt-1 font-light">
                    Active pour définir un prix différent du prix par défaut de l&apos;activité.
                  </p>
                </div>
                <Switch checked={useCustom} onCheckedChange={setUseCustom} disabled={isFrozen || saving} />
              </div>
              {useCustom ? (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-3">
                    <Label className="text-xs text-white/50 flex-1 min-w-0 truncate">Prix de cette session</Label>
                    <Input
                      type="number"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      placeholder="0 = OFFERT"
                      min={0}
                      max={1000}
                      step="1"
                      disabled={isFrozen || saving}
                      className="w-24 h-9 text-sm bg-[#0D0D0D] border-white/10"
                    />
                    <span className="text-xs text-white/30 w-8 text-right">CHF</span>
                  </div>
                  {isFree && (
                    <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                      <Gift className="h-3 w-3" />
                      Cette session sera OFFERTE — les participants ne paient pas.
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

            {/* Note V9 freeze */}
            {isFrozen ? (
              <p className="text-[11px] text-amber-300 font-light px-1">
                🔒 Cette session a {session?.currentParticipants} réservation{(session?.currentParticipants ?? 0) > 1 ? 's' : ''} — modifications et suppression bloquées (anti-cheat).
              </p>
            ) : (
              <p className="text-[10px] text-white/30 font-light px-1">
                ℹ️ Une fois qu&apos;une réservation est prise, tout est gelé (anti-cheat).
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 mt-2 flex-row justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={isFrozen || saving || deleting}
              className="bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Supprimer
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="border-white/10">
                Annuler
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white"
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation suppression */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent className="bg-[#0A0A0A] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Supprimer cette session ?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Cette action est irréversible. La session sera retirée du calendrier et ne pourra plus être réservée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="border-white/10 bg-transparent text-white hover:bg-white/5">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
