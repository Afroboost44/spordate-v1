/**
 * BUG #80 — Section "Sécurité" enrichie style Hinge.
 *
 * Affiche 3 cards de sécurité :
 *  - Vérification du selfie (status badge)
 *  - Liste Rouge (bloquer connaissances)
 *  - Filtre commentaires irrespectueux
 *
 * Plus une mini-section "Ressources sécurité" avec liens vers Centre d'aide et
 * conseils. Inspiré capture 2 du screenshot Hinge (Bassi 2026-05-21).
 *
 * Les actions concrètes (soumettre selfie, ajouter à la liste rouge) renvoient
 * pour l'instant vers des pages dédiées ou un toast info. À étendre en Phase B.
 */

'use client';

import Link from 'next/link';
import {
  ShieldCheck, Contact, MessageSquareWarning, HelpCircle, BookOpen, ChevronRight, CheckCircle2, BadgeCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UserProfile } from '@/types/firestore';

export interface ProfileSafetySectionProps {
  profile: Partial<UserProfile> | null;
}

export function ProfileSafetySection({ profile }: ProfileSafetySectionProps) {
  const selfieStatus = profile?.selfieVerificationStatus ?? 'not_started';
  const contactsCount = profile?.hiddenFromUids?.length ?? 0;

  return (
    <Card className="bg-[#1A1A1A] border-white/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <ShieldCheck className="h-5 w-5 text-accent" /> Sécurité
        </CardTitle>
        <p className="text-xs text-white/40 font-light mt-1">
          Garde le contrôle sur ta visibilité et ta sérénité.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Vérification du selfie */}
        <SafetyCard
          Icon={BadgeCheck}
          title="Vérification du selfie"
          subtitle={selfieStatusLabel(selfieStatus)}
          href="/profile/verify-selfie"
          rightBadge={
            selfieStatus === 'verified' ? (
              <CheckCircle2 className="h-4 w-4 text-green-400" />
            ) : null
          }
        />

        {/* BUG #82 — Renommé "Liste Rouge" → "Mes contacts".
            Nouveau concept : l'utilisateur ajoute ses contacts (email/téléphone)
            et ils reçoivent une invitation à rejoindre Spordateur. C'est plus
            positif et viral qu'un bouton de blocage. */}
        <SafetyCard
          Icon={Contact}
          title="Mes contacts"
          subtitle={
            contactsCount > 0
              ? `${contactsCount} contact${contactsCount > 1 ? 's' : ''} invité${contactsCount > 1 ? 's' : ''}`
              : 'Invite tes amis à rejoindre Spordateur — chacun reçoit une invitation directe'
          }
          href="/profile/contacts"
        />

        {/* Filtre commentaires */}
        <SafetyCard
          Icon={MessageSquareWarning}
          title="Filtre de commentaires"
          subtitle="Les messages contenant des termes irrespectueux sont automatiquement modérés (CGU art. 7.quater)."
          // Pas de href : c'est une info de modération automatique, pas une action
        />

        {/* BUG #82 — Mini-section ressources. Centre d'aide pointe désormais
            vers /help (FAQ avec bot Spordateur, créé fix #82), conseils
            sécurité vers la section dédiée du même page. */}
        <div className="mt-2 pt-3 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Link
            href="/help"
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/10 hover:border-accent/30 transition-colors text-xs text-white/70 hover:text-white"
          >
            <HelpCircle className="h-3.5 w-3.5 text-accent" /> Centre d&apos;aide
          </Link>
          <Link
            href="/help#securite"
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/10 hover:border-accent/30 transition-colors text-xs text-white/70 hover:text-white"
          >
            <BookOpen className="h-3.5 w-3.5 text-accent" /> Conseils sécurité
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function SafetyCard({
  Icon,
  title,
  subtitle,
  href,
  rightBadge,
}: {
  Icon: typeof ShieldCheck;
  title: string;
  subtitle: string;
  href?: string;
  rightBadge?: React.ReactNode;
}) {
  const inner = (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-zinc-950/40">
      <div className="rounded-full bg-accent/10 p-2 shrink-0">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium">{title}</p>
        <p className="text-[11px] text-white/40 leading-snug">{subtitle}</p>
      </div>
      {rightBadge}
      {href && <ChevronRight className="h-4 w-4 text-white/30 shrink-0" aria-hidden="true" />}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:opacity-90 transition-opacity">
        {inner}
      </Link>
    );
  }
  return inner;
}

function selfieStatusLabel(status: string): string {
  switch (status) {
    case 'verified':
      return 'Ton selfie a été vérifié ✓';
    case 'pending':
      return 'Vérification en cours…';
    case 'rejected':
      return 'Vérification refusée — réessaie';
    default:
      return 'Renforce la confiance avec un selfie de vérification';
  }
}
