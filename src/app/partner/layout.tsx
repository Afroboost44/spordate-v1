"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Dumbbell, LayoutDashboard, Building, LogOut, Wallet, Loader2,
  ShieldAlert, Rocket, Menu, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

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
  const { user, loading: authLoading, logout } = useAuth();
  const isAuthPage = pathname.includes('/login') || pathname.includes('/register');
  const [checking, setChecking] = useState(true);
  const [partner, setPartner] = useState<PartnerData | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { href: "/partner/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/partner/offers", label: "Mes Offres", icon: <Building className="h-5 w-5" /> },
    { href: "/partner/wallet", label: "Portefeuille", icon: <Wallet className="h-5 w-5" /> },
    { href: "/partner/boost", label: "Boost", icon: <Rocket className="h-5 w-5" /> },
  ];

  // Auth pages don't need access control
  if (isAuthPage) return <div className="min-h-screen bg-black">{children}</div>;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/partner/login'); return; }
    if (!db || !isFirebaseConfigured) { setChecking(false); return; }

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
  }, [user, authLoading, router]);

  if (authLoading || checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
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
          <h2 className="text-2xl font-extralight tracking-tight">Accès refusé</h2>
          <p className="text-white/50 font-light">Votre compte n&apos;est pas associé à un profil partenaire.</p>
          <div className="flex gap-3 justify-center">
            <Button asChild className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-6 h-11">
              <Link href="/">Accueil</Link>
            </Button>
            <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold rounded-full px-6 h-11">
              <Link href="/partner/register">Devenir partenaire</Link>
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
              <Dumbbell className="h-7 w-7 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] rounded-md p-1 text-white" />
              <span className="text-lg font-light tracking-widest uppercase hidden sm:block">Spordateur</span>
            </Link>
            {partner && (
              <span className="text-xs text-white/30 font-light hidden md:block ml-4 border-l border-white/10 pl-4">{partner.name}</span>
            )}
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <Link key={link.href} href={link.href}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-light transition ${
                  pathname === link.href
                    ? 'bg-[#D91CD2]/10 text-[#D91CD2] border border-[#D91CD2]/20'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}>
                {link.icon}
                <span>{link.label}</span>
              </Link>
            ))}
          </div>

          <button onClick={() => { logout(); router.push('/'); }} className="text-white/30 hover:text-white/50 transition flex items-center gap-2 text-sm font-light">
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Quitter</span>
          </button>
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
                    ? 'bg-[#D91CD2]/10 text-[#D91CD2] border border-[#D91CD2]/20'
                    : 'text-white/50 hover:bg-white/5'
                }`}>
                {link.icon}
                <span>{link.label}</span>
              </Link>
            ))}
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
