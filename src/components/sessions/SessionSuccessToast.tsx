/**
 * Phase 9.5 c8 BUG 2 — Client island affichant un toast 7s sur ?status=success
 * (route /sessions/[id] post-réservation gratuite).
 *
 * Lit creditsGranted via useCredits() pour personnaliser le message.
 * Pas de side-effect au-delà du toast — pas de redirect.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface SessionSuccessToastProps {
  /** Crédits accordés (passé par le SSR caller). */
  creditsGranted?: number;
}

export function SessionSuccessToast({ creditsGranted }: SessionSuccessToastProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (searchParams?.get('status') !== 'success') return;
    firedRef.current = true;

    toast({
      title: '🎉 Réservation confirmée',
      description: creditsGranted
        ? `Tu as reçu ${creditsGranted} crédits chat.`
        : 'Bonne séance !',
      className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      duration: 7000,
    });

    // Strip ?status=success de l'URL (silent replaceState — pas de re-render)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('status');
      router.replace(url.pathname + (url.search || ''), { scroll: false });
    }
  }, [searchParams, creditsGranted, toast, router]);

  return null;
}
