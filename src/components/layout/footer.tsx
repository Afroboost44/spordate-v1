"use client";

import { Twitter, Linkedin } from "lucide-react";
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { SpordateurLogo } from '@/components/SpordateurLogo';

export default function Footer() {
  // Phase 9.5 c23 BUG X — i18n via useLanguage t() pour footer links + copyright.
  const { t } = useLanguage();

  return (
    <footer className="border-t border-zinc-800 bg-black relative">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center space-y-6 md:space-y-0">
          <div className="flex items-center space-x-2">
            {/* Accent feature — SVG inline qui suit text-accent (dynamique
                via /admin "Couleur principale"). Remplace l'ancien <img PNG>
                statique pour cohérence avec header + landing + PWA install. */}
            <SpordateurLogo className="h-7 w-7 text-accent" />
            <span className="font-light text-lg text-white">Spordateur</span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 text-xs text-gray-500 font-light">
            <Link href="/terms" className="hover:text-white transition-colors">{t('footer_cgu')}</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">{t('footer_privacy')}</Link>
            <Link href="/legal" className="hover:text-white transition-colors">{t('footer_legal')}</Link>
          </nav>

          <div className="flex items-center space-x-4">
            <Link href="#" className="text-gray-600 hover:text-white transition-colors">
              <Twitter className="h-4 w-4" />
              <span className="sr-only">Twitter</span>
            </Link>
            <Link href="#" className="text-gray-600 hover:text-white transition-colors">
              <Linkedin className="h-4 w-4" />
              <span className="sr-only">LinkedIn</span>
            </Link>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800/50 text-center">
          <Link href="/admin/login" className="text-xs text-gray-700 hover:text-gray-500 transition-colors font-light" title="Admin">
            &copy; {new Date().getFullYear()} Spordateur — Association Afroboosteur, Neuchâtel, Suisse
          </Link>
        </div>
      </div>
    </footer>
  );
}
