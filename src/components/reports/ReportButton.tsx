/**
 * Phase 7 sub-chantier 3 commit 4/5 — <ReportButton>.
 *
 * Bouton entry point report. 2 variants visuels :
 * - 'profile' : bouton avec icon Flag + label "Signaler" (header profil public, à côté de BlockButton)
 * - 'chat' : icon-only Flag (placement compact dans header conversation chat)
 *
 * Logique d'affichage :
 * - Hide si currentUserId == targetUid (pas de self-report UI)
 * - Hide si currentUserId vide (user non auth — fallback silencieux)
 *
 * Pas de useEffect pre-check rate-limit (Phase 7 simple — l'erreur remonte au submit
 * avec toast user-friendly via ReportUserDialog gestion ReportError).
 *
 * onClick → ouvre ReportUserDialog. Au succès → toast + close (state local pas modifié).
 *
 * Charte stricte : variant 'profile' = outline neutre (cohérent BlockButton),
 * variant 'chat' = icon ghost.
 */

'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReportUserDialog } from './ReportUserDialog';

export interface ReportButtonProps {
  /** UID cible. */
  targetUid: string;
  /** Nom affiché dans le dialog confirmation. */
  targetName: string;
  /** UID utilisateur courant — caller responsabilité de fournir l'auth context. */
  currentUserId: string;
  /** Variant visuel : 'profile' (outline + label) ou 'chat' (icon ghost). */
  variant: 'profile' | 'chat';
  className?: string;
}

export function ReportButton({
  targetUid,
  targetName,
  currentUserId,
  variant,
  className = '',
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);

  // Auth-aware : skip rendering si self-report ou pas de user
  const shouldRender = currentUserId && currentUserId !== targetUid;
  if (!shouldRender) return null;

  if (variant === 'chat') {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={`Signaler ${targetName}`}
          title={`Signaler ${targetName}`}
          className={`h-8 w-8 text-white/60 hover:text-[#D91CD2] hover:bg-white/5 ${className}`}
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
        </Button>
        <ReportUserDialog
          targetUid={targetUid}
          targetName={targetName}
          currentUserId={currentUserId}
          open={open}
          onOpenChange={setOpen}
        />
      </>
    );
  }

  // variant === 'profile'
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={`border-white/10 text-white/70 hover:bg-white/5 hover:text-[#D91CD2] hover:border-[#D91CD2]/40 font-light ${className}`}
      >
        <Flag className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Signaler
      </Button>
      <ReportUserDialog
        targetUid={targetUid}
        targetName={targetName}
        currentUserId={currentUserId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
