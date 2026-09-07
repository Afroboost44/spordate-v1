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
// Accent feature : remplace l'ancien <img PNG> statique par le SVG inline
// SpordateurLogo qui suit text-accent (dynamique via /admin "Couleur principale").
import { SpordateurLogo } from '@/components/SpordateurLogo';
import { EN_MODE_INTEGRE } from '@/lib/bridge/destination';

function SLogo({ className = "h-7 w-7" }: { className?: string }) {
  return <SpordateurLogo className={`${className} text-accent`} />;
}

// ─── RETOUR VERS AFROBOOST (mode intégré) ────────────────────────────────
// Spordateur est servi sous `afroboost.com/rencontre`. Un membre venu de là
// n'avait AUCUN chemin de retour : ni bouton, ni logo cliquable, ni route.
// Le seul moyen était la flèche « précédent » du navigateur — absente en PWA
// installée, où l'on se retrouvait donc enfermé.
//
// Le lien n'apparaît QUE dans le mode intégré, décidé par le `basePath` : en
// accès direct sur le domaine propre de Spordateur, il n'aurait aucun sens et
// reste donc invisible. Aucune condition codée en dur sur un domaine.
//
// `<a>` et non `<Link>` : on QUITTE l'application Next, on ne navigue pas
// dedans. Un `Link` tenterait une navigation cliente vers une route qui
// n'existe pas de ce côté.
function RetourAfroboost({ compact = false }: { compact?: boolean }) {
  if (!EN_MODE_INTEGRE) return null;
  return (
    <a
      href="/"
      aria-label="Retour à Afroboost"
      title="Retour à Afroboost"
      className={`flex items-center gap-1 text-white/60 hover:text-white transition-colors
                  ${compact ? 'text-xs pr-1' : 'text-sm mr-4'}`}
      data-testid="retour-afroboost"
    >
      <span aria-hidden="true">&larr;</span>
      <span>Afroboost</span>
    </a>
  );
}

export default function Header() {
  const { t, setLanguage, language } = useLanguage();
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

  // ── LE MENU DU MODE INTÉGRÉ ────────────────────────────────────────────
  // Simplifier la navigation ne doit JAMAIS revenir à supprimer un accès. Le
  // lot précédent avait retiré Activités, Profil, Premium et Notifications de
  // la barre : ils n'étaient plus atteignables qu'en tapant l'URL. Ils
  // reviennent ici, derrière une seule icône, au lieu de six liens alignés.
  //
  // CE SONT LES MÊMES ROUTES, pas des copies : `/activities`, `/discovery`,
  // `/chat`, `/profile`, `/premium`, `/notifications` existent déjà et ne sont
  // ni dupliquées ni réécrites. On ne fait que rouvrir la porte.
  //
  // « Messages » y figure alors qu'il n'est pas dans `navLinks` : il vivait
  // seulement dans la barre du bas, donc invisible sur desktop. Ajouter le lien
  // ICI plutôt que dans `navLinks` laisse le mode autonome strictement inchangé.
  const liensMenuIntegre = [
    ...navLinks.filter((l) => l.href !== '/profile'),
    { href: "/chat", label: t('nav_messages') || "Messages" },
    { href: "/profile", label: t('nav_profile') || "Mon Profil" },
    ...authenticatedLinks,
  ];

  const handleLogout = async () => {
    await logout();
  };

  /** Le menu compact du mode intégré : une icône, toutes les fonctions. */
  const MenuIntegre = () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu" data-testid="menu-integre">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="pt-12 bg-background w-[min(20rem,85vw)]">
        <SheetHeader>
          <SheetTitle className="sr-only">Menu</SheetTitle>
        </SheetHeader>
        {isLoggedIn && user?.displayName && (
          <div className="px-4 pb-4 mb-2 border-b border-border/20">
            <p className="text-sm font-medium truncate">{user.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}
        <nav className="flex flex-col text-base">
          {isLoggedIn && liensMenuIntegre.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-4 py-3 rounded-md hover:bg-accent/10 flex items-center gap-2"
              data-testid={`menu-integre-${link.href.replace('/', '')}`}
            >
              {(link as { isPremium?: boolean }).isPremium && <Crown className="h-4 w-4 text-accent" />}
              <span className="truncate">{link.label}</span>
            </Link>
          ))}
          {/* L'espace partenaire et la console admin restent proposés à qui y a
              droit : les masquer serait retirer un accès, pas simplifier. */}
          {isLoggedIn && isPartner && (
            <Link href="/partner/offers" className="px-4 py-3 rounded-md hover:bg-accent/10 text-accent flex items-center gap-2">
              <Building className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('header_partner_space')}</span>
            </Link>
          )}
          {isLoggedIn && <AdminMenuLink variant="mobile" />}
          {isLoggedIn && (
            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-3 rounded-md hover:bg-accent/10 flex items-center gap-2 text-left text-muted-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>{t('nav_logout') || 'Déconnexion'}</span>
            </button>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );

  return (
    <>
      {/* BUG #115 — Mini-header mobile (md:hidden) car le header desktop est
          hidden md:block → totalement invisible sur mobile. Bassi ne voyait
          donc PAS la cloche notifications sur PWA mobile. Ce mini-header
          affiche les 3 essentials : crédits, cloche, langue + petit logo. */}
      {!loading && isLoggedIn && (
        <header
          className="md:hidden sticky top-0 z-40 w-full border-b border-white/5 bg-black/95 backdrop-blur"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex items-center justify-between h-12 px-3">
            <div className="flex items-center gap-2 min-w-0">
              <RetourAfroboost compact />
              <Link
                href={EN_MODE_INTEGRE ? '/discovery' : '/'}
                className="flex items-center gap-1.5 min-w-0"
              >
                <SLogo className="h-6 w-6 shrink-0" />
                <span className="text-sm font-medium text-white truncate">
                  {EN_MODE_INTEGRE ? 'Rencontres' : 'Spordateur'}
                </span>
              </Link>
            </div>
            <div className="flex items-center gap-1">
              <CreditsBadge />
              <NotificationBadge />
              {EN_MODE_INTEGRE && <MenuIntegre />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <Languages className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setLanguage('fr')}>Français</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLanguage('en')}>English</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLanguage('de')}>Deutsch</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
      )}

    <header className="hidden md:block sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="flex items-center md:flex-1">
          <RetourAfroboost />
          {/* En mode intégré le logo ne ramène pas à la landing — il n'y a
              plus de landing dans ce parcours. Il mène aux Rencontres, seule
              destination de ce mode. */}
          <Link
            href={EN_MODE_INTEGRE ? '/discovery' : '/'}
            className="mr-6 flex items-center space-x-2"
          >
            <SLogo className="h-7 w-7" />
            <span className="font-bold">
              {EN_MODE_INTEGRE ? 'Rencontres' : 'Spordateur'}
            </span>
          </Link>
          {/* MODE INTÉGRÉ : la navigation historique de Spordateur disparaît.
              Sous `afroboost.com/rencontre`, une barre « Activités · Rencontres ·
              Mon Profil · Premium · Notifications » donne l'impression d'être
              entré dans un SECOND SITE — c'est précisément ce que le pont
              cherche à effacer.
              RIEN N'EST SUPPRIMÉ : ces routes existent toujours et restent
              atteignables depuis les actions qui en ont besoin (une carte mène
              au profil, un match ouvre le chat, une offre mène à la
              réservation). Seule la barre de navigation est retirée, et
              seulement ici. En mode autonome, elle est intacte. */}
          <nav className={`${EN_MODE_INTEGRE ? 'hidden' : 'hidden md:flex'} items-center space-x-6 text-sm font-medium`}>
            {!EN_MODE_INTEGRE && isLoggedIn && navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  (link as { isPremium?: boolean }).isPremium
                    ? "transition-colors hover:text-accent text-accent/70 flex items-center gap-1"
                    : "transition-colors hover:text-foreground/80 text-foreground/60"
                }
              >
                {(link as { isPremium?: boolean }).isPremium && <Crown className="h-3.5 w-3.5" />}
                {link.label}
              </Link>
            ))}
             {!EN_MODE_INTEGRE && isLoggedIn && authenticatedLinks.map((link) => (
              <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground/80 text-foreground/60">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        {/* BUG #76 — Badges crédits + notifications visibles TOUS breakpoints
            (mobile + desktop). Avant : enfermés dans la div hidden md:flex donc
            absents sur smartphone, le client ne voyait pas les notifications. */}
        {!loading && isLoggedIn && (
          <div className="flex items-center gap-2 md:hidden">
            <CreditsBadge />
            <NotificationBadge />
          </div>
        )}

        <div className="hidden items-center space-x-2 md:flex">
            {EN_MODE_INTEGRE && isLoggedIn && <MenuIntegre />}
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
                      // F1 — un nom long ne casse plus rien : il se coupe,
                      // il ne pousse pas. Sans `max-w`, « Association Sportive
                      // et Culturelle de … » elargissait le groupe a l'infini.
                      <span
                        className="text-sm text-foreground/60 hidden lg:inline-block max-w-[10rem] truncate align-middle"
                        title={user.displayName}
                      >
                        {user.displayName}
                      </span>
                    )}
                    <CreditsBadge />
                    <NotificationBadge />
                    {isPartner && (
                      <Button variant="ghost" asChild className="hidden lg:flex items-center gap-2 text-accent hover:text-accent/80">
                        <Link href="/partner/offers">
                          <Building className="h-4 w-4" />
                          Espace Partenaire
                        </Link>
                      </Button>
                    )}
                    {/* F1 — LES TROIS BOUTONS LIBELLES NE S'AFFICHENT QU'A
                        PARTIR DE `lg`. Mesure en production : pour un compte
                        partenaire ET admin, ce groupe reclame 715 px des 768 —
                        avec « ← Afroboost / Rencontres » a gauche, la barre
                        depassait de 200 px a 768, 148 a 820, 39 a 1024. Aucun
                        d'eux ne cede : ce sont des `whitespace-nowrap`.
                        RIEN N'EST RETIRE : entre 768 et 1023 les trois vivent
                        dans le menu deja present — `MenuIntegre` en mode
                        integre, le Sheet historique en mode autonome. C'est le
                        MEME menu, pas une seconde navigation. */}
                    <span className="hidden lg:flex">
                      <AdminMenuLink variant="desktop" />
                    </span>
                    <Button variant="ghost" onClick={handleLogout} className="hidden lg:flex items-center gap-2">
                      <LogOut className="h-4 w-4" />
                      {t('nav_logout') || "Déconnexion"}
                    </Button>
                </>
            ) : !loading ? (
                <>
                    <Button variant="ghost" asChild>
                        <Link href="/login">{t('nav_login') || "Connexion"}</Link>
                    </Button>
                    <Button asChild className="bg-accent text-white font-semibold">
                        <Link href="/signup">{t('nav_signup') || "Inscription"}</Link>
                    </Button>
                </>
            ) : null}
        </div>
        {/* F1 — CE SHEET EXISTAIT DEJA ET NE S'AFFICHAIT JAMAIS : `md:hidden`
            dans un header `hidden md:block`, il etait code mort. Il porte
            pourtant tout ce que les trois boutons libelles portent (liens,
            Espace Partenaire, Console admin, langue, Deconnexion). Il devient
            donc le menu tablette — EN MODE AUTONOME UNIQUEMENT : en mode
            integre `MenuIntegre` occupe deja ce role, et en afficher deux
            ferait exactement la seconde navigation qu'on veut eviter. */}
        <div className={`${EN_MODE_INTEGRE ? 'hidden' : 'flex lg:hidden'} items-center`}>
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
                  <Link href="/partner/offers" className="px-4 py-2 rounded-md hover:bg-accent/10 text-accent flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    {t('header_partner_space')}
                  </Link>
                )}
                {isLoggedIn && (
                  <AdminMenuLink variant="mobile" />
                )}
              </nav>

              {/* BUG #76 — Sélecteur de langue (FR/EN/DE) dans le menu mobile.
                  Avant : présent uniquement dans la nav desktop (hidden md:flex)
                  donc inaccessible sur smartphone. Pattern radio pills à plat,
                  cohérent avec l'UX globale du Sheet. */}
              <div className="mt-6 px-4">
                <div className="flex items-center gap-2 mb-2">
                  <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-light">
                    {t('settings_section_language')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { code: 'fr', label: 'Français' },
                      { code: 'en', label: 'English' },
                      { code: 'de', label: 'Deutsch' },
                    ] as const
                  ).map((opt) => (
                    <Button
                      key={opt.code}
                      type="button"
                      variant={language === opt.code ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setLanguage(opt.code)}
                      className={
                        language === opt.code
                          ? 'bg-accent text-white hover:bg-accent/90'
                          : 'border-border/30'
                      }
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

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
                        <Button asChild className="w-full bg-accent text-white font-semibold">
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
    </>
  );
}
