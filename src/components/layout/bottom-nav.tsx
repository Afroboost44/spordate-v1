"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Dumbbell, MessageCircle, User } from 'lucide-react';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';

// Fix #194 — Icône Rencontres remplacée par le logo Spordateur SVG blanc
// (charte v4 demandée par l'utilisateur). Rendu via composant inline pour
// supporter la même API que les Lucide icons (className h-6 w-6, etc.).
function DiscoveryIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/spordateur-logo-v4.svg"
      alt=""
      aria-hidden="true"
      className={className}
      style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
    />
  );
}

interface NavItem {
  href: string;
  icon: typeof Home | typeof DiscoveryIcon;
  label: string;
}

const ACTIVITIES_ITEM: NavItem = { href: '/activities', icon: Dumbbell, label: 'Activités' };
const DISCOVERY_ITEM: NavItem = { href: '/discovery', icon: DiscoveryIcon, label: 'Rencontres' };
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
              <Icon className={`h-6 w-6 flex-shrink-0 ${isActive ? 'drop-shadow-[0_0_8px_rgb(var(--accent-color-rgb) / 0.6)]' : ''}`} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium truncate max-w-full px-1">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
