/**
 * BUG #73 — Bandeau onboarding indiquant que cliquer sur le nom ou la photo
 * du header du chat ouvre le profil complet du correspondant.
 *
 * Comportement :
 *  - S'affiche UNIQUEMENT si flag localStorage 'chat_profile_hint_seen' absent
 *  - Dismissible par bouton ✕ → persiste le flag → ne réapparaît plus
 *  - Apparition douce (fade-in CSS) pour ne pas perturber la conversation
 *  - Charte stricte noir / accent / blanc
 *
 * Pourquoi un hint visible : sur la maquette Hinge inspirée par Bassi, le
 * profil complet (photos + prompts + stats + infos perso) est accessible
 * via tap sur le header. Sans signal visuel, les nouveaux utilisateurs ne
 * découvrent pas cette interaction. Le hint disparaît une fois vu.
 */

'use client';

import { useEffect, useState } from 'react';
import { ChevronUp, X, MousePointerClick } from 'lucide-react';

const STORAGE_KEY = 'spordate_chat_profile_hint_seen_v1';

export function ChatProfileHint() {
  const [visible, setVisible] = useState(false);
  // Évite flicker SSR : on attend le mount client avant d'afficher
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const seen = localStorage.getItem(STORAGE_KEY) === 'true';
      if (!seen) setVisible(true);
    } catch {
      // localStorage indisponible (mode privé strict) → on affiche le hint
      // (pas de persistance, mais l'expérience reste utile)
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  if (!mounted || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-3 mt-3 rounded-xl border border-accent/30 bg-accent/[0.08] px-3 py-2.5 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-1 duration-300"
    >
      <div className="rounded-full bg-accent/20 p-1.5 shrink-0">
        <MousePointerClick className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] sm:text-[13px] text-white/90 leading-snug">
          <ChevronUp className="inline-block h-3 w-3 text-accent mr-1 -translate-y-px" aria-hidden="true" />
          Touche le <span className="font-medium text-white">nom</span> ou la{' '}
          <span className="font-medium text-white">photo</span> en haut pour voir le profil complet.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fermer cette astuce"
        className="text-white/40 hover:text-white/80 transition-colors p-1 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
