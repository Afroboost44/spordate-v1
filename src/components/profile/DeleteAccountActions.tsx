/**
 * Phase 9 sub-chantier 6 commit 3/4 — <DeleteAccountActions>.
 *
 * Client island wraps softDeleteUser / restoreSoftDeletedUser actions.
 *
 * Pattern :
 *  - useAuth pour user.uid
 *  - On confirm delete: call softDeleteUser → toast → redirect /
 *  - On restore: call restoreSoftDeletedUser → toast → router.refresh()
 *  - AlertDialog confirm avant action destructive (cohérent SC4 patterns)
 *
 * Charte stricte black/#D91CD2/white user-facing.
 *
 * Q7=A : restore option inline pendant grace period (RGPD/nLPD friendly + reversibility).
 */

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  softDeleteUser,
  restoreSoftDeletedUser,
  SoftDeleteError,
  SOFT_DELETE_REASON_MAX_LENGTH,
} from '@/lib/users';

export interface DeleteAccountActionsProps {
  /** True si user.softDeletedAt déjà set (mode restore). */
  isAlreadySoftDeleted: boolean;
  /** Days remaining si déjà soft-deleted (UI display). */
  graceDaysRemaining?: number;
}

export function DeleteAccountActions({
  isAlreadySoftDeleted,
  graceDaysRemaining,
}: DeleteAccountActionsProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  const handleSoftDelete = () => {
    if (!user?.uid) return;
    startTransition(async () => {
      try {
        await softDeleteUser({ uid: user.uid, reason });
        toast({
          title: t('delete_account_pending_title'),
          description: t('delete_account_pending_desc'),
          className: 'bg-zinc-900 border-accent/40 text-white',
        });
        // Logout + redirect home
        try {
          await logout?.();
        } catch (err) {
          console.warn('[DeleteAccountActions] logout failed (non-blocking)', err);
        }
        router.push('/');
      } catch (err) {
        const code =
          err instanceof SoftDeleteError ? err.code : err instanceof Error ? err.message : 'unknown';
        toast({
          title: t('delete_account_error_title'),
          description:
            code === 'already-soft-deleted'
              ? t('delete_account_error_already_pending')
              : code === 'already-anonymized'
                ? t('delete_account_error_already_anon')
                : `${t('delete_account_error_failed_prefix')} ${code}`,
          variant: 'destructive',
        });
      }
    });
  };

  const handleRestore = () => {
    if (!user?.uid) return;
    startTransition(async () => {
      try {
        await restoreSoftDeletedUser({ uid: user.uid });
        toast({
          title: t('delete_account_restored_title'),
          description: t('delete_account_restored_desc'),
          className: 'bg-zinc-900 border-green-500/40 text-white',
        });
        router.refresh();
      } catch (err) {
        const code =
          err instanceof SoftDeleteError ? err.code : err instanceof Error ? err.message : 'unknown';
        toast({
          title: t('delete_account_error_title'),
          description:
            code === 'grace-expired'
              ? t('delete_account_error_grace_expired')
              : code === 'not-soft-deleted'
                ? t('delete_account_error_not_pending')
                : `${t('delete_account_error_restore_failed_prefix')} ${code}`,
          variant: 'destructive',
        });
      }
    });
  };

  if (isAlreadySoftDeleted) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-amber-300" aria-hidden="true" />
          <div className="flex-1 text-sm text-amber-200">
            <p className="font-medium mb-1">{t('delete_account_pending_banner_title')}</p>
            <p className="text-amber-300/80">
              {t('delete_account_pending_banner_prefix')} <strong>{graceDaysRemaining ?? 0} {t('delete_account_pending_banner_days')}</strong>. {t('delete_account_pending_banner_suffix')}
            </p>
          </div>
        </div>
        <Button
          onClick={handleRestore}
          disabled={pending}
          className="self-start bg-amber-500 hover:bg-amber-500/80 text-zinc-950"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Undo2 className="h-4 w-4 mr-2" />
          )}
          {t('delete_account_cancel_deletion')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4 text-sm text-white/80 leading-relaxed">
        <p className="font-medium text-red-300 mb-2">{t('delete_account_warning_title')}</p>
        <ul className="text-xs text-white/60 space-y-1 list-disc list-inside">
          <li>{t('delete_account_warning_item_1')}</li>
          <li>{t('delete_account_warning_item_2')}</li>
          <li>{t('delete_account_warning_item_3')}</li>
          <li>{t('delete_account_warning_item_4')}</li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="delete-reason" className="text-xs uppercase tracking-wider text-white/50">
          {t('delete_account_reason_label_prefix')} {SOFT_DELETE_REASON_MAX_LENGTH} {t('delete_account_reason_label_suffix')}
        </Label>
        <Textarea
          id="delete-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={SOFT_DELETE_REASON_MAX_LENGTH}
          placeholder={t('delete_account_reason_placeholder')}
          rows={3}
          className="bg-zinc-900 border-white/10 text-white placeholder:text-white/30"
          disabled={pending}
        />
        <p className="text-[11px] text-white/30 text-right">
          {reason.length} / {SOFT_DELETE_REASON_MAX_LENGTH}
        </p>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            disabled={pending}
            className="self-start bg-red-600 hover:bg-red-700 text-white"
          >
            {t('delete_account_delete_button')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="bg-zinc-950 border border-zinc-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-400" />
              {t('delete_account_confirm_title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60 text-sm">
              {t('delete_account_confirm_desc_prefix')} <code className="text-accent">/profile/delete</code>. {t('delete_account_confirm_desc_suffix')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800">
              {t('delete_account_cancel_button')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSoftDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('delete_account_confirm_button')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
