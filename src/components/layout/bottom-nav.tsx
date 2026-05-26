"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Dumbbell, MessageCircle, User } from 'lucide-react';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';
import { SpordateurLogo } from '@/components/icons/SpordateurLogo';

// Fix #205 (hotfix bonus) — Icône Rencontres migrée du PNG raster vers SVG
// vectoriel inline (composant SpordateurLogo). Le PNG d'origine ne pouvait
// pas être teinté en rose quand l'onglet est actif (text-[var(--accent-color)]
// n'a aucun effet sur <img>). Le SVG inline utilise fill="currentColor" sur
// tous ses paths, donc il hérite la couleur du parent (rose actif, blanc inactif).

interface NavItem {
  href: string;
  icon: typeof Home | typeof SpordateurLogo;
  label: string;
}

const ACTIVITIES_ITEM: NavItem = { href: '/activities', icon: Dumbbell, label: 'Activités' };
const DISCOVERY_ITEM: NavItem = { href: '/discovery', icon: SpordateurLogo, label: 'Rencontres' };
const CHAT_ITEM: NavItem = { href: '/chat', icon: MessageCircle, label: 'Messages' };
const PROFILE_ITEM: NavItem = { href: '/profile', icon: User, label: 'Profil' };

export default function BottomNav() {
  const pathname = usePathname();
  // Phase 9.5 c21 — discoveryMode 3-state. Item Rencontres visible si mode !== 'disabled'.
  const { discoveryMode } = useFeatureFlags();
  const discoveryEnabled = discoveryMode !== 'disabled';

  // Phase 9.5 c8 — Activités en premier (default landing post-login).
  // Rencontres conditionné à discoveryEnabled (feature flag /admin).
  const navItems: NavItem[] = [
    ACTIVITIES_ITEM,
    ...(discoveryEnabled ? [DISCOVERY_ITEM] : []),
    CHAT_ITEM,
    PROFILE_ITEM,
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-accent/30 bg-black/80 backdrop-blur-xl safe-area-bottom">
      {/* BUG #37 — w-16 (64px fixe) × 4 items + padding débordait sur petits
          écrans (iPhone SE 320px). flex-1 distribue équitablement la largeur.
          justify-around remplacé par défaut flex (gap-0) pour pas double-spacing. */}
      <div className="flex items-center h-16 max-w-lg mx-auto px-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full transition-colors ${
                isActive
                  ? 'text-accent'
                  : 'text-white/40 active:text-white/70'
              }`}
            >
              {/* Fix #204 — Icône active rose comme le label. Bassi report :
                  le texte virait bien à text-accent quand actif mais l'icône
                  restait blanche. Lucide hérite normalement de currentColor,
                  mais on force explicitement la couleur ici pour lever toute
                  ambiguïté (et couvrir DiscoveryIcon <img> via filter hue).
                  Inactive : text-white/40 (cohérent avec le Link parent). */}
              <Icon
                className={`h-6 w-6 flex-shrink-0 ${
                  isActive
                    ? 'text-[var(--accent-color)] drop-shadow-[0_0_8px_rgb(var(--accent-color-rgb) / 0.6)]'
                    : 'text-white/40'
                }`}
                strokeWidth={isActive ? 2.5 : 1.5}
              />
              <span className="text-[10px] font-medium truncate max-w-full px-1">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
