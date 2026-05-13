"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Bell, Languages, LogOut, Crown, Building } from 'lucide-react';
import { NotificationBadge } from '@/components/notifications/NotificationBadge';
import { useLanguage } from '@/context/LanguageContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from '@/context/AuthContext';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';
import { CreditsBadge } from '@/components/layout/CreditsBadge';
import { AdminMenuLink } from '@/components/layout/AdminMenuLink';


// ─── S LOGO COMPONENT (Phase 9.5 c12 — branding refresh) ─────────
function SLogo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/icon-192.png?v=29"
      alt="Spordateur"
      className={className}
      width={32}
      height={32}
    />
  );
}

export default function Header() {
  const { t, setLanguage } = useLanguage();
  const { isLoggedIn, loading, logout, user, userProfile } = useAuth();
  // Phase 9.5 c21 — utilise discoveryMode 3-state (vs ancien boolean discoveryEnabled).
  // L'item nav 'Rencontres' apparaît si mode !== 'disabled' (préserve comportement c8).
  const { discoveryMode } = useFeatureFlags();
  const discoveryEnabled = discoveryMode !== 'disabled';
  const [isPartner, setIsPartner] = useState(false);

  // Check if current user is an active partner
  useEffect(() => {
    if (!isLoggedIn || !user?.email || !db || !isFirebaseConfigured) {
      setIsPartner(false);
      return;
    }
    const fbDb = db; // capture for async closure (already proven non-null by guard above)
    const checkPartner = async () => {
      try {
        const q = query(collection(fbDb, 'partners'), where('email', '==', user.email), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const data = snap.docs[0].data();
          setIsPartner(data.isApproved === true && data.subscriptionStatus === 'active');
        }
      } catch { /* silently fail */ }
    };
    checkPartner();
  }, [isLoggedIn, user?.email]);

  const navLinks = [
    { href: "/activities", label: t('nav_activities') || "Activités" },
    ...(discoveryEnabled
      ? [{ href: "/discovery", label: t('nav_discovery') || "Rencontres" }]
      : []),
    { href: "/profile", label: t('nav_profile') || "Mon Profil" },
    { href: "/premium", label: "Premium", isPremium: true },
  ];

  const authenticatedLinks = [
      { href: "/notifications", label: t('nav_notifications') || "Notifications" },
  ];

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="hidden md:block sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="flex items-center md:flex-1">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <SLogo className="h-7 w-7" />
            <span className="font-bold">Spordateur</span>
          </Link>
          <nav className="hidden items-center space-x-6 text-sm font-medium md:flex">
            {isLoggedIn && navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  (link as { isPremium?: boolean }).isPremium
                    ? "transition-colors hover:text-[#D91CD2] text-[#D91CD2]/70 flex items-center gap-1"
                    : "transition-colors hover:text-foreground/80 text-foreground/60"
                }
              >
                {(link as { isPremium?: boolean }).isPremium && <Crown className="h-3.5 w-3.5" />}
                {link.label}
              </Link>
            ))}
             {isLoggedIn && authenticatedLinks.map((link) => (
              <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground/80 text-foreground/60">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden items-center space-x-2 md:flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Languages className="h-5 w-5" />
                  <span className="sr-only">Changer de langue</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setLanguage('fr')}>
                  Français
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage('en')}>
                  English
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage('de')}>
                  Deutsch
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* --- Auth-dependent UI --- */}
            {!loading && isLoggedIn ? (
                <>
                    {user?.displayName && (
                      <span className="text-sm text-foreground/60 hidden lg:inline">
                        {user.displayName}
                      </span>
                    )}
                    <CreditsBadge />
                    <NotificationBadge />
                    {isPartner && (
                      <Button variant="ghost" asChild className="flex items-center gap-2 text-[#D91CD2] hover:text-[#D91CD2]/80">
                        <Link href="/partner/offers">
                          <Building className="h-4 w-4" />
                          Espace Partenaire
                        </Link>
                      </Button>
                    )}
                    <AdminMenuLink variant="desktop" />
                    <Button variant="ghost" onClick={handleLogout} className="flex items-center gap-2">
                      <LogOut className="h-4 w-4" />
                      {t('nav_logout') || "Déconnexion"}
                    </Button>
                </>
            ) : !loading ? (
                <>
                    <Button variant="ghost" asChild>
                        <Link href="/login">{t('nav_login') || "Connexion"}</Link>
                    </Button>
                    <Button asChild className="bg-[#D91CD2] text-white font-semibold">
                        <Link href="/signup">{t('nav_signup') || "Inscription"}</Link>
                    </Button>
                </>
            ) : null}
        </div>
        <div className="md:hidden flex items-center">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="pr-0 pt-12 bg-background">
               <SheetHeader>
                  <SheetTitle className="sr-only">Mobile Menu</SheetTitle>
              </SheetHeader>
              {isLoggedIn && user?.displayName && (
                <div className="px-4 pb-4 mb-4 border-b border-border/20">
                  <p className="text-sm font-medium">{user.displayName}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              )}
              <nav className="flex flex-col space-y-4 text-lg">
                {isLoggedIn && [...navLinks, ...authenticatedLinks].map((link) => (
                  <Link key={link.href} href={link.href} className="px-4 py-2 rounded-md hover:bg-accent/10">
                    {link.label}
                  </Link>
                ))}
                {isLoggedIn && isPartner && (
                  <Link href="/partner/offers" className="px-4 py-2 rounded-md hover:bg-accent/10 text-[#D91CD2] flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    Espace Partenaire
                  </Link>
                )}
                {isLoggedIn && (
                  <AdminMenuLink variant="mobile" />
                )}
              </nav>
              <div className="absolute bottom-8 left-4 right-4 flex flex-col space-y-2">
                 {!loading && isLoggedIn ? (
                     <Button variant="outline" onClick={handleLogout} className="w-full flex items-center gap-2">
                        <LogOut className="h-4 w-4" />
                        {t('nav_logout') || "Déconnexion"}
                     </Button>
                 ) : !loading ? (
                    <>
                        <Button variant="outline" asChild className="w-full">
                           <Link href="/login">{t('nav_login') || "Connexion"}</Link>
                        </Button>
                        <Button asChild className="w-full bg-[#D91CD2] text-white font-semibold">
                          <Link href="/signup">{t('nav_signup') || "Inscription"}</Link>
                        </Button>
                    </>
                 ) : null}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
