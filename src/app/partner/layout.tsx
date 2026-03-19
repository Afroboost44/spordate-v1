"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building, LayoutDashboard, Rocket, LogOut, Wallet, Loader2, ShieldAlert } from 'lucide-react';
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

export default function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAuthPage = pathname.includes('/login') || pathname.includes('/register');

  const [checking, setChecking] = useState(true);
  const [partner, setPartner] = useState<PartnerData | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const navLinks = [
    { href: "/partner/dashboard", label: "Dashboard", icon: <LayoutDashboard /> },
    { href: "/partner/offers", label: "Mes Offres", icon: <Building /> },
    { href: "/partner/wallet", label: "Mon Portefeuille", icon: <Wallet /> },
    { href: "/partner/boost", label: "Boost", icon: <Rocket /> },
  ];

  // Auth pages don't need access control
  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-black">
        {children}
      </div>
    );
  }

  // Check partner access for non-auth pages
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push('/partner/login');
      return;
    }

    if (!db || !isFirebaseConfigured) {
      setChecking(false);
      return;
    }

    const checkPartnerAccess = async () => {
      try {
        const email = user.email || '';
        const partnerQ = query(
          collection(db!, 'partners'),
          where('email', '==', email),
          limit(1)
        );
        const snap = await getDocs(partnerQ);

        if (snap.empty) {
          setAccessDenied(true);
          setChecking(false);
          return;
        }

        const data = snap.docs[0].data() as PartnerData;
        setPartner(data);

        // Check: must have paid subscription AND be approved by admin
        const hasPaid = data.subscriptionStatus === 'active';
        const isApproved = data.isApproved === true;

        if (!hasPaid || !isApproved) {
          // Redirect back to login which will show the appropriate status
          router.push('/partner/login');
          return;
        }

        setChecking(false);
      } catch (err) {
        console.error('[Partner Layout] Access check error:', err);
        setChecking(false);
      }
    };

    checkPartnerAccess();
  }, [user, authLoading, router]);

  // Loading state
  if (authLoading || checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#05090e]">
        <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
      </div>
    );
  }

  // Access denied (not a partner at all)
  if (accessDenied) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#05090e] p-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="h-16 w-16 text-red-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">Accès refusé</h2>
          <p className="text-sm text-white/50">
            Votre compte n&apos;est pas associé à un profil partenaire.
          </p>
          <div className="flex gap-3 justify-center">
            <Button asChild variant="outline" className="border-gray-700 text-gray-400">
              <Link href="/">Accueil</Link>
            </Button>
            <Button asChild className="bg-cyan-600 hover:bg-cyan-500 text-black font-bold">
              <Link href="/partner/register">Devenir partenaire</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05090e] text-gray-200 flex">
      <aside className="w-64 bg-[#0a111a] border-r border-cyan-900/40 p-6 flex-col hidden md:flex">
        <h1 className="text-2xl font-bold text-cyan-400 mb-2">
          Portail Partenaire
        </h1>
        {partner && (
          <p className="text-xs text-white/30 mb-8 truncate">{partner.name}</p>
        )}
        <nav className="flex flex-col space-y-3 flex-1">
          {navLinks.map((link) => (
            <Button
              key={link.href}
              variant="ghost"
              className={`justify-start text-lg h-12 hover:bg-cyan-500/10 hover:text-cyan-300 ${
                pathname === link.href ? 'bg-cyan-500/10 text-cyan-300' : 'text-gray-400'
              }`}
              asChild
            >
              <Link href={link.href}>
                {link.icon}
                <span>{link.label}</span>
              </Link>
            </Button>
          ))}
        </nav>
        <Button variant="outline" className="justify-center text-lg h-12 border-cyan-800 hover:bg-cyan-800/50 hover:text-cyan-200" asChild>
          <Link href="/">
            <LogOut className="mr-2" /> Quitter
          </Link>
        </Button>
      </aside>
      <main className="flex-1 p-10 overflow-auto">
        {children}
      </main>
    </div>
  );
}
