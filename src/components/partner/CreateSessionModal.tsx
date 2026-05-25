/**
 * Fix B Option 3 — Modal de création d'une nouvelle session pour une activité.
 *
 * Reprend la UI de SessionEditModal en mode "création" :
 *  - Date + heure (datetime-local input, défaut : maintenant + 7 jours arrondi)
 *  - Toggle prix custom (idem B2)
 *  - Bouton "Créer" → POST /api/partner/sessions/create
 *
 * @module
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Gift, AlertTriangle, CalendarPlus } from 'lucide-react';
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
import { useLanguage } from '@/context/LanguageContext';
import { validateSessionDate } from '@/lib/billing/sessionDateValidation';

interface ActivityLike {
  activityId?: string;
  title?: string;
  name?: string;
  price?: number;
}

interface CreateSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: ActivityLike | null;
  onCreated?: () => void;
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateSessionModal({ open, onOpenChange, activity, onCreated }: CreateSessionModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [useCustom, setUseCustom] = useState(false);
  const [customPrice, setCustomPrice] = useState('');
  const [datetimeLocal, setDatetimeLocal] = useState('');
  const [creating, setCreating] = useState(false);

  // Pre-fill date par défaut à 7 jours dans le futur arrondi à l'heure pleine.
  useEffect(() => {
    if (!open) return;
    const defaultDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    defaultDate.setMinutes(0, 0, 0);
    setDatetimeLocal(toDatetimeLocal(defaultDate));
    setUseCustom(false);
    setCustomPrice('');
  }, [open]);

  const activityDefaultPriceCHF = typeof activity?.price === 'number' ? activity.price : 0;
  const activityLabel = activity?.title || activity?.name || '';

  const parsedPrice = (() => {
    const n = parseFloat(customPrice);
    return Number.isFinite(n) ? n : NaN;
  })();
  const priceInvalid = useCustom && (Number.isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 1000);
  const isFree = useCustom && parsedPrice === 0;

  const datetimeMs = datetimeLocal ? new Date(datetimeLocal).getTime() : NaN;
  const dateValidation = validateSessionDate(datetimeMs, Date.now());

  const canCreate = !creating && !priceInvalid && dateValidation.valid && !!activity?.activityId;

  const handleCreate = async () => {
    if (!user || !activity?.activityId || !canCreate) return;
    setCreating(true);
    try {
      const idToken = await user.getIdToken(true);
      const body: Record<string, unknown> = {
        activityId: activity.activityId,
        startAtMillis: datetimeMs,
        useCustomPrice: useCustom,
      };
      if (useCustom) body.customPriceCHF = parsedPrice;
      const res = await fetch('/api/partner/sessions/create', {
        method: 'POST',
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
        if (code === 'forbidden') msg = t('create_session_err_forbidden');
        else if (code === 'unauthenticated') msg = t('create_session_err_unauthenticated');
        else if (code === 'invalid-date-past') msg = t('create_session_err_date_past');
        else if (code === 'invalid-date-too-far') msg = t('create_session_err_date_too_far');
        toast({ title: t('create_session_error_title'), description: msg, variant: 'destructive' });
        return;
      }
      toast({
        title: t('create_session_success_title'),
        description: data?.mode === 'custom'
          ? t('create_session_success_custom', { price: data.effectivePriceCHF })
          : t('create_session_success_default', { price: activityDefaultPriceCHF }),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      onOpenChange(false);
      if (onCreated) onCreated();
    } catch (err) {
      console.warn('[CreateSessionModal] POST failed', err);
      toast({ title: t('create_session_error_title'), description: t('create_session_err_generic'), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-accent" />
            {t('create_session_modal_title')}
          </DialogTitle>
          <DialogDescription className="text-white/50 text-xs">
            {activityLabel && (
              <span>{t('create_session_activity_label')} <span className="text-accent">{activityLabel}</span></span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          {/* Date / Heure */}
          <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-2">
            <Label className="text-white text-sm font-medium">{t('create_session_datetime_required')}</Label>
            <Input
              type="datetime-local"
              value={datetimeLocal}
              onChange={(e) => setDatetimeLocal(e.target.value)}
              disabled={creating}
              className="bg-[#0D0D0D] border-white/10 h-11 text-white"
            />
            {!dateValidation.valid && datetimeLocal && (
              <p className="text-[11px] text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />
                {dateValidation.reason === 'past' && t('create_session_err_date_past')}
                {dateValidation.reason === 'too-far' && t('create_session_err_date_too_far')}
                {dateValidation.reason === 'invalid-date' && t('create_session_err_date_invalid')}
              </p>
            )}
          </div>

          {/* Prix override */}
          <div className="rounded-xl border border-white/10 bg-[#1A1A1A]/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label className="text-white text-sm font-medium">{t('create_session_custom_price_label')}</Label>
                <p className="text-[11px] text-white/40 mt-1 font-light">
                  {t('create_session_custom_price_hint')}
                </p>
              </div>
              <Switch checked={useCustom} onCheckedChange={setUseCustom} disabled={creating} />
            </div>
            {useCustom ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-white/50 flex-1 min-w-0 truncate">{t('create_session_custom_price_input')}</Label>
                  <Input
                    type="number"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder={t('create_session_free_placeholder')}
                    min={0}
                    max={1000}
                    step="1"
                    disabled={creating}
                    className="w-24 h-9 text-sm bg-[#0D0D0D] border-white/10"
                  />
                  <span className="text-xs text-white/30 w-8 text-right">CHF</span>
                </div>
                {isFree && (
                  <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                    <Gift className="h-3 w-3" />
                    {t('create_session_will_be_free')}
                  </p>
                )}
                {priceInvalid && (
                  <p className="text-[11px] text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    {t('create_session_err_price_invalid')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-white/30 font-light">
                {t('create_session_default_price_label')} <span className="text-white/60">{activityDefaultPriceCHF} CHF</span>
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creating} className="border-white/10">
            {t('common_cancel')}
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canCreate} className="bg-accent hover:bg-accent/80 text-white">
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('create_session_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
