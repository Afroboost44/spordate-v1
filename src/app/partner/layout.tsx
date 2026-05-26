"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building, LogOut, Wallet, Loader2,
  ShieldAlert, Rocket, Menu, X, Compass, Home, Languages
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { SpordateurLogo } from '@/components/SpordateurLogo';
import { NotificationBadge } from '@/components/notifications/NotificationBadge';

interface PartnerData {
  partnerId: string;
  name: string;
  isApproved: boolean;
  isActive: boolean;
  subscriptionStatus: string;
}

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, userProfile, loading: authLoading, logout } = useAuth();
  const { t, setLanguage } = useLanguage();
  const isAuthPage = pathname.includes('/login') || pathname.includes('/register');
  const [checking, setChecking] = useState(true);
  const [partner, setPartner] = useState<PartnerData | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Admin override : un admin peut accéder à /partner/* pour modérer ou
  // modifier les offres de tous les partenaires (cf. firestore.rules
  // /activities/{id} allow update/delete avec isAdmin() branch). Skip
  // accessDenied + partner subscription gate dans ce cas.
  const isAdmin = userProfile?.role === 'admin';

  const navLinks = [
    { href: "/partner/dashboard", label: t('partner_layout_nav_dashboard'), icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/partner/offers", label: t('partner_layout_nav_offers'), icon: <Building className="h-5 w-5" /> },
    { href: "/partner/wallet", label: t('partner_layout_nav_wallet'), icon: <Wallet className="h-5 w-5" /> },
    { href: "/partner/boost", label: t('partner_layout_nav_boost'), icon: <Rocket className="h-5 w-5" /> },
  ];

  // useEffect MUST be called before any early return (React hooks rules)
  useEffect(() => {
    if (isAuthPage) { setChecking(false); return; }
    if (authLoading) return;
    if (!user) { router.push('/partner/login'); return; }
    if (!db || !isFirebaseConfigured) { setChecking(false); return; }

    // Admin bypass : accès libre à /partner/* (modération + édition multi-tenant).
    // On NE charge PAS de partner doc pour l'admin (il n'en a pas forcément un).
    if (isAdmin) { setChecking(false); return; }

    const checkPartnerAccess = async () => {
      try {
        const email = user.email || '';
        const partnerQ = query(collection(db!, 'partners'), where('email', '==', email), limit(1));
        const snap = await getDocs(partnerQ);
        if (snap.empty) { setAccessDenied(true); setChecking(false); return; }

        const data = snap.docs[0].data() as PartnerData;
        setPartner(data);

        const hasPaid = data.subscriptionStatus === 'active';
        const isApproved = data.isApproved === true;
        if (!hasPaid || !isApproved) { router.push('/partner/login'); return; }
        setChecking(false);
      } catch (err) { console.error('[Partner Layout]', err); setChecking(false); }
    };

    checkPartnerAccess();
  }, [user, authLoading, router, isAuthPage, isAdmin]);

  // Auth pages don't need access control
  if (isAuthPage) return <div className="min-h-screen bg-black">{children}</div>;

  if (authLoading || checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="text-center space-y-6 max-w-md">
          <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <ShieldAlert className="h-10 w-10 text-red-400" />
          </div>
          <h2 className="text-2xl font-extralight tracking-tight">{t('partner_layout_access_denied_title')}</h2>
          <p className="text-white/50 font-light">{t('partner_layout_access_denied_desc')}</p>
          <div className="flex gap-3 justify-center">
            <Button asChild className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-6 h-11">
              <Link href="/">{t('partner_layout_home')}</Link>
            </Button>
            <Button asChild className="bg-accent hover:bg-accent/80 text-white font-semibold rounded-full px-6 h-11">
              <Link href="/partner/register">{t('partner_layout_become_partner')}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top bar — mobile + desktop */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/90">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden text-white/40 hover:text-white/70">
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link href="/" className="flex items-center gap-2">
              {/* Accent feature — SVG inline (admin Couleur principale). */}
              <SpordateurLogo className="h-8 w-8 text-accent" />
              <span className="text-lg font-light tracking-widest uppercase hidden sm:block">{t('partner_layout_brand')}</span>
            </Link>
            {partner && (
              <span className="text-xs text-white/30 font-light hidden md:block ml-4 border-l border-white/10 pl-4">{partner.name}</span>
            )}
            {isAdmin && !partner && (
              <span className="text-[10px] uppercase tracking-wider hidden md:block ml-4 border-l border-white/10 pl-4 bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">{t('partner_layout_admin_badge')}</span>
            )}
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <Link key={link.href} href={link.href}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-light transition ${
                  pathname === link.href
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}>
                {link.icon}
                <span>{link.label}</span>
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* Fix #180 — Cloche notifications (badge unread géré par le composant) */}
            <NotificationBadge />
            {/* Fix #180 — Toggle langue FR/EN/DE — partenaire peut switcher comme un user normal */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-white/40 hover:text-white/70 hover:bg-white/5">
                  <Languages className="h-4 w-4" />
                  <span className="sr-only">{t('partner_layout_change_lang')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#0F0F0F] border-white/15 text-white">
                <DropdownMenuItem className="cursor-pointer hover:bg-accent/20 focus:bg-accent/20" onClick={() => setLanguage('fr')}>Français</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer hover:bg-accent/20 focus:bg-accent/20" onClick={() => setLanguage('en')}>English</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer hover:bg-accent/20 focus:bg-accent/20" onClick={() => setLanguage('de')}>Deutsch</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Link href="/activities" className="text-white/30 hover:text-white/50 transition flex items-center gap-2 text-sm font-light px-3 py-2 rounded-full hover:bg-white/5">
              <Compass className="h-4 w-4" />
              <span className="hidden lg:inline">{t('partner_layout_activities')}</span>
            </Link>
            <Link href="/" className="text-white/30 hover:text-white/50 transition flex items-center gap-2 text-sm font-light px-3 py-2 rounded-full hover:bg-white/5">
              <Home className="h-4 w-4" />
              <span className="hidden lg:inline">{t('partner_layout_home')}</span>
            </Link>
            <button onClick={() => { logout(); router.push('/'); }} className="text-white/30 hover:text-white/50 transition flex items-center gap-2 text-sm font-light px-3 py-2 rounded-full hover:bg-white/5">
              <LogOut className="h-4 w-4" />
              <span className="hidden lg:inline">{t('partner_layout_logout')}</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/95 pt-20 px-6">
          <div className="space-y-2">
            {navLinks.map(link => (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-5 py-4 rounded-2xl text-base font-light transition ${
                  pathname === link.href
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'text-white/50 hover:bg-white/5'
                }`}>
                {link.icon}
                <span>{link.label}</span>
              </Link>
            ))}
            <div className="border-t border-white/10 pt-4 mt-4 space-y-2">
              <Link href="/activities" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-5 py-4 rounded-2xl text-base font-light text-white/50 hover:bg-white/5 transition">
                <Compass className="h-5 w-5" />
                <span>{t('partner_layout_view_activities')}</span>
              </Link>
              <Link href="/" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-5 py-4 rounded-2xl text-base font-light text-white/50 hover:bg-white/5 transition">
                <Home className="h-5 w-5" />
                <span>{t('partner_layout_home')}</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        {children}
      </main>
    </div>
  );
}
