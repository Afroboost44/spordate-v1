"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deferredPrompt: any = null;

/** Phase 9.5 c46 — localStorage key pour dismiss iOS banner (7-day cooldown). */
const IOS_BANNER_DISMISS_KEY = 'pwa-banner-dismissed-at';
const IOS_BANNER_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export default function PWARegister() {
  const { t } = useLanguage();
  const [showInstall, setShowInstall] = useState(false);
  const [showIosBanner, setShowIosBanner] = useState(false);
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered:', reg.scope);
        })
        .catch((err) => {
          console.log('[PWA] Service Worker registration failed:', err);
        });
    }

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    // Phase 9.5 c46 — splash custom React arrondi pour tous les non-iOS en
    // mode standalone. iOS a son propre splash natif via apple-touch-startup-image
    // (cf. layout.tsx) → skip pour éviter doublon.
    if (isStandalone && !isIOS) {
      setShowSplash(true);
      setTimeout(() => setShowSplash(false), 800);
    }

    // Phase 9.5 c46 BUG 4 — iOS install banner (Android utilise beforeinstallprompt).
    // Affiché si : iOS Safari + pas standalone + pas dismissed dans les 7 derniers j.
    if (isIOS && !isStandalone) {
      try {
        const dismissedAt = window.localStorage.getItem(IOS_BANNER_DISMISS_KEY);
        const dismissedMs = dismissedAt ? parseInt(dismissedAt, 10) : 0;
        if (!dismissedMs || Date.now() - dismissedMs > IOS_BANNER_DISMISS_COOLDOWN_MS) {
          // Afficher après 3s pour laisser la page se charger (non-intrusif first impression)
          setTimeout(() => setShowIosBanner(true), 3000);
        }
      } catch {
        // localStorage indisponible (private browsing) → afficher banner anyway
        setTimeout(() => setShowIosBanner(true), 3000);
      }
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    window.addEventListener('appinstalled', () => {
      setShowInstall(false);
      setShowIosBanner(false);
      deferredPrompt = null;
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setShowInstall(false);
      deferredPrompt = null;
    }
  };

  const handleIosDismiss = () => {
    setShowIosBanner(false);
    try {
      window.localStorage.setItem(IOS_BANNER_DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore (private browsing)
    }
  };

  if (showSplash) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: '#000000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'splashFade 0.3s ease 0.5s forwards',
        }}
      >
        <img
          src="/icons/icon-192.png?v=27"
          alt="Spordateur"
          width={160}
          height={160}
          style={{
            marginBottom: 24,
            borderRadius: '50%',
            boxShadow: '0 0 80px rgba(217,28,210,0.5)',
          }}
        />
        <h1 style={{ color: '#D91CD2', fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
          Spordateur
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 8 }}>
          Rencontres sportives en Suisse
        </p>
        <style>{`@keyframes splashFade { to { opacity: 0; pointer-events: none; } }`}</style>
      </div>
    );
  }

  if (showInstall) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: 16,
          right: 16,
          zIndex: 9998,
          background: 'rgba(0, 0, 0, 0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: 16,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          border: '1px solid rgba(217, 28, 210, 0.3)',
        }}
      >
        <img
          src="/icons/icon-192.png?v=27"
          alt=""
          width={48}
          height={48}
          style={{ borderRadius: '50%' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: 'white', margin: 0, fontWeight: 600, fontSize: 15 }}>
            {t('pwa_install_title')}
          </p>
          <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: 13 }}>
            {t('pwa_install_subtitle')}
          </p>
        </div>
        <button
          onClick={handleInstall}
          style={{
            background: '#D91CD2',
            color: 'white',
            border: 'none',
            borderRadius: 12,
            padding: '10px 20px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('pwa_install_button')}
        </button>
        <button
          onClick={() => setShowInstall(false)}
          aria-label={t('common_close')}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            fontSize: 22,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  if (showIosBanner) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: 16,
          right: 16,
          zIndex: 9998,
          background: 'rgba(0, 0, 0, 0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: 16,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          border: '1px solid rgba(217, 28, 210, 0.3)',
        }}
      >
        <img
          src="/icons/icon-192.png?v=27"
          alt=""
          width={48}
          height={48}
          style={{ borderRadius: '50%', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: 'white', margin: 0, fontWeight: 600, fontSize: 14 }}>
            {t('pwa_ios_install_title') || 'Installer Spordateur'}
          </p>
          <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span>{t('pwa_ios_install_step1') || 'Tap'}</span>
            <svg
              width="14"
              height="18"
              viewBox="0 0 14 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: 'inline-block', verticalAlign: 'middle' }}
              aria-label="share icon"
            >
              <path d="M7 1L4 4M7 1L10 4M7 1V11" stroke="#D91CD2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 8H1V16C1 16.5523 1.44772 17 2 17H12C12.5523 17 13 16.5523 13 16V8H12" stroke="#D91CD2" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{t('pwa_ios_install_step2') || "puis « Ajouter à l'écran d'accueil »"}</span>
          </p>
        </div>
        <button
          onClick={handleIosDismiss}
          aria-label={t('common_close')}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            fontSize: 22,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}
