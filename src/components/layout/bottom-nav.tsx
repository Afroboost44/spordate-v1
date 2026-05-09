"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Dumbbell, MessageCircle, User } from 'lucide-react';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';

interface NavItem {
  href: string;
  icon: typeof Home;
  label: string;
}

const ACTIVITIES_ITEM: NavItem = { href: '/activities', icon: Dumbbell, label: 'Activités' };
const DISCOVERY_ITEM: NavItem = { href: '/discovery', icon: Home, label: 'Rencontres' };
const CHAT_ITEM: NavItem = { href: '/chat', icon: MessageCircle, label: 'Messages' };
const PROFILE_ITEM: NavItem = { href: '/profile', icon: User, label: 'Profil' };

export default function BottomNav() {
  const pathname = usePathname();
  const { discoveryEnabled } = useFeatureFlags();

  // Phase 9.5 c8 — Activités en premier (default landing post-login).
  // Rencontres conditionné à discoveryEnabled (feature flag /admin).
  const navItems: NavItem[] = [
    ACTIVITIES_ITEM,
    ...(discoveryEnabled ? [DISCOVERY_ITEM] : []),
    CHAT_ITEM,
    PROFILE_ITEM,
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-[#D91CD2]/30 bg-black/80 backdrop-blur-xl safe-area-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 w-16 h-full transition-colors ${
                isActive
                  ? 'text-[#D91CD2]'
                  : 'text-white/40 active:text-white/70'
              }`}
            >
              <Icon className={`h-6 w-6 ${isActive ? 'drop-shadow-[0_0_8px_rgba(217,28,210,0.6)]' : ''}`} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
