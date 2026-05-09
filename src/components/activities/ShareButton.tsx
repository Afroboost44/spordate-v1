/**
 * Phase 9.5 c10.B — <ShareButton> client component pour partage activité.
 *
 * UX :
 *  - Web Share API native si supportée (mobile iOS/Android, Edge desktop)
 *    → bottom sheet OS native avec apps installées
 *  - Fallback : navigator.clipboard.writeText(url) + toast "Lien copié"
 *  - Tooltip "Partager"
 *  - Charte stricte black/#D91CD2/white. Lucide Share2 icon.
 *
 * Pas de tracking analytics MVP (Phase 10 pourra ajouter event 'activity_shared').
 *
 * Pas de state authentifié requis — partage public sans login.
 */

'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  buildShareUrl,
  buildSharePayload,
  performShare,
} from '@/lib/share/shareHelper';

export interface ShareButtonProps {
  activity: {
    activityId: string;
    title?: string;
    name?: string;
  };
  /** className optionnel pour ajustement layout par caller. */
  className?: string;
}

export function ShareButton({ activity, className }: ShareButtonProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    const url = buildShareUrl(activity.activityId);
    const payload = buildSharePayload(activity, url);

    try {
      const result = await performShare({
        navigatorObj: typeof navigator !== 'undefined' ? navigator : undefined,
        payload,
      });
      if (result === 'shared') {
        // Native share sheet OK — pas de toast (l'OS confirme déjà)
        return;
      }
      if (result === 'copied') {
        toast({
          title: 'Lien copié',
          description: 'Partage-le avec tes amis !',
          className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
          duration: 3000,
        });
        return;
      }
      // result === 'cancelled' (Web Share API user-cancel) → silent
      if (result === 'unsupported') {
        toast({
          title: 'Partage indisponible',
          description: 'Copie l\'URL manuellement depuis la barre d\'adresse.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('[ShareButton] failed', err);
      toast({
        title: 'Erreur partage',
        description: 'Réessaie plus tard.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={busy}
            aria-label={`Partager ${activity.title || activity.name || 'cette activité'}`}
            className={`inline-flex items-center justify-center rounded-full border border-[#D91CD2]/30 bg-black/60 p-2 text-[#D91CD2] hover:border-[#D91CD2]/60 hover:bg-[#D91CD2]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 ${className ?? ''}`}
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-zinc-900 border border-[#D91CD2]/40 text-white"
        >
          <p className="text-xs">Partager cette activité</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
