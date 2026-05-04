/**
 * Phase 7 sub-chantier 2 commit 3/4 — <BlocksManagementList>.
 *
 * Liste des utilisateurs bloqués par le user courant. Affichée sur /profile/blocks.
 *
 * Pour chaque block : avatar + displayName + date relative ("il y a 3j") + bouton "Débloquer".
 *
 * Confirmation inline (pas de modal) :
 * - "Débloquer" → état confirmingUid → "Confirme ?" + "Oui" + "Annuler"
 * - Au "Oui" → onUnblock(blockedId) → toast + refresh liste local (filter out)
 *
 * Empty state : "Aucun utilisateur bloqué" avec icon discret.
 *
 * Charte stricte : background black, accent #D91CD2 sur bouton confirme, white/70 secondaire.
 */

'use client';

import { useState } from 'react';
import { Loader2, ShieldOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { Block } from '@/types/firestore';

export interface BlockedUserProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
}

export interface BlocksManagementListProps {
  blocks: Block[];
  /** Map uid → profil minimum (displayName + photoURL). Uids absents → fallback "Membre Spordateur". */
  userProfiles: Map<string, BlockedUserProfile>;
  /** Handler unblock — exécuté après confirmation user. Caller refresh sa liste après. */
  onUnblock: (blockedId: string) => Promise<void>;
  className?: string;
}

function formatRelativeDate(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'à l\'instant';
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `il y a ${diffD}j`;
  const diffM = Math.floor(diffD / 30);
  if (diffM < 12) return `il y a ${diffM} mois`;
  const diffY = Math.floor(diffM / 12);
  return `il y a ${diffY} an${diffY > 1 ? 's' : ''}`;
}

interface BlockRowProps {
  block: Block;
  profile: BlockedUserProfile | undefined;
  onUnblock: (blockedId: string) => Promise<void>;
}

function BlockRow({ block, profile, onUnblock }: BlockRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const displayName = profile?.displayName ?? 'Membre Spordateur';
  const date = block.createdAt.toDate();

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onUnblock(block.blockedId);
      // Le parent refresh sa liste — ce row sera unmount, pas besoin de reset state local.
    } catch (err) {
      console.error('[BlocksManagementList] unblock failed', err);
      setSubmitting(false);
      setConfirming(false);
    }
  };

  return (
    <article className="flex items-center gap-3 py-3 border-b border-white/10 last:border-0">
      <Avatar className="h-10 w-10 shrink-0">
        {profile?.photoURL && <AvatarImage src={profile.photoURL} alt={displayName} />}
        <AvatarFallback className="bg-white/10 text-white/70 text-sm">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <p className="text-sm text-white font-medium truncate">{displayName}</p>
        <p className="text-xs text-white/50 font-light">
          Bloqué·e {formatRelativeDate(date)}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={submitting}
            className="h-8 px-3 border-white/10 text-white/70 hover:bg-white/5 font-light"
          >
            Annuler
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-8 px-3 bg-[#D91CD2] text-black font-medium hover:bg-[#D91CD2]/90 disabled:opacity-40"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              'Oui débloquer'
            )}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          className="h-8 px-3 border-white/10 text-white/70 hover:bg-white/5 hover:text-[#D91CD2] hover:border-[#D91CD2]/40 font-light shrink-0"
        >
          Débloquer
        </Button>
      )}
    </article>
  );
}

export function BlocksManagementList({
  blocks,
  userProfiles,
  onUnblock,
  className = '',
}: BlocksManagementListProps) {
  if (blocks.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
        <ShieldOff className="h-10 w-10 text-white/20" aria-hidden="true" />
        <p className="text-sm text-white/50 font-light">Aucun utilisateur bloqué</p>
      </div>
    );
  }

  return (
    <section className={`flex flex-col ${className}`}>
      {blocks.map((block) => (
        <BlockRow
          key={block.blockId}
          block={block}
          profile={userProfiles.get(block.blockedId)}
          onUnblock={onUnblock}
        />
      ))}
    </section>
  );
}
