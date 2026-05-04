/**
 * Phase 7 sub-chantier 6 commit 2/2 — <SessionTSActions>.
 *
 * Section "Sécurité" sur /sessions/[sessionId] : entry point pragmatique block + report
 * sur le partenaire de la session (doctrine §9.sexies E "card session entry point").
 *
 * Phase 7 wire seulement le partner :
 *  - UI complete participants list différée Phase 9 (privacy considerations + UX scope)
 *  - 80% du use case "j'ai un problème avec le partner de cette session" couvert
 *  - Lien /profile/blocks pour gestion existante (Q1 hybride)
 *
 * Client island (page parent /sessions/[sessionId] est Server Component).
 * Cohérent ReviewTrigger pattern (sub-chantier 1).
 *
 * Auth-aware via useAuth — hidden si user non connecté OR self-partner edge case.
 */

'use client';

import Link from 'next/link';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { BlockButton } from '@/components/blocks/BlockButton';
import { ReportButton } from '@/components/reports/ReportButton';

export interface SessionTSActionsProps {
  /** Partner uid (from activity.partnerId). */
  partnerId: string;
  /** Partner displayName fallback (from activity.partnerName). */
  partnerName: string;
}

export function SessionTSActions({ partnerId, partnerName }: SessionTSActionsProps) {
  const { user } = useAuth();

  // Hide si user non connecté OR self-partner (un partenaire ne se signale pas lui-même)
  if (!user?.uid || user.uid === partnerId || !partnerId) return null;

  const safeName = partnerName || 'le partenaire';

  return (
    <section
      aria-labelledby="ts-section-heading"
      className="flex flex-col gap-3 pt-4 border-t border-white/5"
    >
      <h2
        id="ts-section-heading"
        className="text-xs uppercase tracking-[0.18em] text-white/40 font-light flex items-center gap-2"
      >
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
        Sécurité
      </h2>
      <p className="text-sm text-white/60 font-light leading-relaxed">
        Si un comportement du partenaire t&apos;a posé problème, tu peux le signaler ou le bloquer.
        Les signalements sont anonymes (cf. CGU §7.bis).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ReportButton
          variant="profile"
          targetUid={partnerId}
          targetName={safeName}
          currentUserId={user.uid}
        />
        <BlockButton
          variant="profile"
          targetUid={partnerId}
          targetName={safeName}
          currentUserId={user.uid}
        />
        <Link
          href="/profile/blocks"
          className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-[#D91CD2] font-light transition-colors"
        >
          Gérer mes blocages
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
