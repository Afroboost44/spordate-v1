/**
 * Phase 7 sub-chantier 2 commit 3/4 — <BlockButton>.
 *
 * Bouton entry point block list. 2 variants visuels :
 * - 'profile' : bouton avec icon Ban + label "Bloquer" (header profil public)
 * - 'chat' : icon-only Ban (placement compact dans menu/header chat)
 *
 * Logique d'affichage :
 * - Hide si currentUserId == targetUid (pas de self-block UI)
 * - Hide si currentUserId vide (user non auth — fallback silencieux)
 * - Au mount : isBlocked check → hide si déjà bloqué (le user a déjà bloqué cette personne,
 *   ou la personne l'a bloqué — dans les 2 cas pas besoin du bouton)
 * - Loading state pendant isBlocked → return null (pas de flash UI)
 *
 * onClick → ouvre BlockUserDialog. Au succès → setBlocked(true) hide le bouton.
 *
 * Charte stricte : variant 'profile' = outline neutre, variant 'chat' = icon ghost.
 */

'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isBlocked as isBlockedService } from '@/lib/blocks';
import { BlockUserDialog } from './BlockUserDialog';

export interface BlockButtonProps {
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

export function BlockButton({
  targetUid,
  targetName,
  currentUserId,
  variant,
  className = '',
}: BlockButtonProps) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  // Auth-aware : skip rendering si self-block ou pas de user
  const shouldRender = currentUserId && currentUserId !== targetUid;

  useEffect(() => {
    if (!shouldRender) {
      setBlocked(true); // skip
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await isBlockedService(currentUserId, targetUid);
        if (!cancelled) setBlocked(res);
      } catch (err) {
        if (cancelled) return;
        console.warn('[BlockButton] isBlocked check failed (non-blocking)', err);
        setBlocked(false); // failsafe : afficher le bouton plutôt que le hide
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldRender, currentUserId, targetUid]);

  // Loading ou déjà bloqué ou self → rien
  if (blocked === null) return null;
  if (blocked) return null;
  if (!shouldRender) return null;

  const handleBlocked = () => {
    setBlocked(true);
  };

  if (variant === 'chat') {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={`Bloquer ${targetName}`}
          title={`Bloquer ${targetName}`}
          className={`h-8 w-8 text-white/60 hover:text-[#D91CD2] hover:bg-white/5 ${className}`}
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
        </Button>
        <BlockUserDialog
          targetUid={targetUid}
          targetName={targetName}
          currentUserId={currentUserId}
          open={open}
          onOpenChange={setOpen}
          onBlocked={handleBlocked}
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
        <Ban className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Bloquer
      </Button>
      <BlockUserDialog
        targetUid={targetUid}
        targetName={targetName}
        currentUserId={currentUserId}
        open={open}
        onOpenChange={setOpen}
        onBlocked={handleBlocked}
      />
    </>
  );
}
