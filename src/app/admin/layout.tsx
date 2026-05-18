"use client";

/**
 * Phase 9 sub-chantier 0 commit 1/X — Admin layout server-side defense-in-depth.
 *
 * Q2=B vote : cleanup localStorage residual + server-side admin guard layout.
 *
 * Comble Différé Phase 9 ligne 891 :
 *   « ⏳ Refactor admin auth Firebase Auth role-based (vs localStorage email actuel) »
 *
 * Architecture :
 *   /admin/login          → public (rendu sans guard via PUBLIC_ROUTES check)
 *   /admin/dashboard      → guard : auth + role='admin'
 *   /admin/sports         → guard : auth + role='admin'
 *   /admin/manage         → guard : auth + role='admin'
 *   /admin/revenue        → guard : auth + role='admin'
 *
 * Pipeline :
 *   1. Si pathname dans PUBLIC_ROUTES → render children sans guard (login)
 *   2. AuthContext loading → render loader fullscreen
 *   3. Pas de user → redirect /admin/login
 *   4. user mais userProfile.role !== 'admin' → redirect /admin/login
 *   5. user + admin → render children
 *
 * Defense-in-depth : tous les endpoints admin (`/api/admin/*`) ont déjà leur propre
 * `verifyAuth + isAdminRole` server-side (pattern SC4 verifyAuth). Le layout ici =
 * guard UI avec UX propre (loader, redirect). Pas de fuite de données admin sans
 * server-side validation côté API.
 */

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/** Routes admin publiques (pas de guard requis). */
const PUBLIC_ADMIN_ROUTES: ReadonlyArray<string> = ['/admin/login'];

function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        {label && <p className="text-white/50 text-sm font-light">{label}</p>}
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const { user, userProfile, loading } = useAuth();

  const isPublicRoute = PUBLIC_ADMIN_ROUTES.includes(pathname);

  useEffect(() => {
    if (loading || isPublicRoute) return;
    if (!user) {
      router.replace('/admin/login');
      return;
    }
    if (userProfile && userProfile.role !== 'admin') {
      router.replace('/admin/login');
    }
  }, [user, userProfile, loading, pathname, isPublicRoute, router]);

  if (isPublicRoute) {
    return <>{children}</>;
  }
  if (loading) {
    return <FullScreenLoader label="Vérification accès admin…" />;
  }
  if (!user || (userProfile && userProfile.role !== 'admin')) {
    return <FullScreenLoader label="Redirection…" />;
  }
  // userProfile may still be loading even if user is set — brief flicker acceptable
  if (!userProfile) {
    return <FullScreenLoader label="Chargement profil…" />;
  }
  return <>{children}</>;
}
