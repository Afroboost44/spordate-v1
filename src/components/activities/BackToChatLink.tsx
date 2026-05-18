"use client";

/**
 * Fix UX — Lien "Retour au chat" affiché en haut de /activities/[id]
 * quand l'URL contient ?fromInvite=chat. Permet à l'user qui a cliqué
 * "Découvrir" dans la modal d'invitation chat (ActivitySelectorModal)
 * de revenir directement au chat sans repasser par /activities.
 *
 * Utilise router.back() pour préserver la modal state (selectedActivity,
 * search, etc.) — naviguer vers /chat?match=X redirigerait sur le chat
 * mais perdrait le contexte de la modal d'invitation.
 *
 * @module
 */

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function BackToChatLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded self-start"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      <span>Retour au chat</span>
    </button>
  );
}
