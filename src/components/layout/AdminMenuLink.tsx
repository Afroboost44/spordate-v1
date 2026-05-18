/**
 * Phase 9.5 c9 — <AdminMenuLink> link header conditionnel.
 *
 * Affiché uniquement si userProfile.role === 'admin'. Renvoie null sinon
 * (pas de container vide).
 *
 * Charte stricte black/#D91CD2/white. Variante :
 *   - desktop : Button ghost + icône Shield + label "Console admin"
 *   - mobile : Link bloc dans la sheet menu
 *
 * Le composant centralise le check role (avant : 2× inline dans header.tsx).
 */

'use client';

import Link from 'next/link';
import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

export interface AdminMenuLinkProps {
  /** 'desktop' = Button ghost (default) ; 'mobile' = bloc Link sheet */
  variant?: 'desktop' | 'mobile';
  /** Callback invoqué au click (utile pour fermer la mobile sheet). */
  onClick?: () => void;
}

export function AdminMenuLink({ variant = 'desktop', onClick }: AdminMenuLinkProps) {
  const { userProfile } = useAuth();

  if (userProfile?.role !== 'admin') return null;

  if (variant === 'mobile') {
    return (
      <Link
        href="/admin/manage"
        onClick={onClick}
        className="px-4 py-2 rounded-md hover:bg-accent/10 text-accent flex items-center gap-2"
      >
        <Shield className="h-5 w-5" />
        Console admin
      </Link>
    );
  }

  return (
    <Button
      variant="ghost"
      asChild
      className="flex items-center gap-2 text-accent hover:text-accent/80"
      onClick={onClick}
    >
      <Link href="/admin/manage">
        <Shield className="h-4 w-4" />
        Console admin
      </Link>
    </Button>
  );
}
