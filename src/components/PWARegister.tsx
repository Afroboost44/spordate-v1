"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deferredPrompt: any = null;

/** Phase 9.5 c46 — localStorage key pour dismiss iOS banner (7-day cooldown). */
const IOS_BANNER_DISMISS_KEY = 'pwa-banner-dismissed-at';
const IOS_BANNER_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Phase 9.5 c49 — iOS detection robuste. iPadOS 13+ retourne "MacIntel" dans
 *  userAgent → fallback sur ontouchend + Mac platform check. Sans ça, les iPads
 *  modernes ne déclenchaient PAS le banner banner (cause #1 BUG 2 mobile). */
function detectIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ : "Macintosh" dans UA mais touch dispo
  const isTouch = 'ontouchend' in document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platform = (navigator as any).platform || '';
  const isMacUA = /Mac/.test(ua) || /Mac/.test(platform);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noMsStream = !(window as any).MSStream;
  return isTouch && isMacUA && noMsStream;
}

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

    const isIOS = detectIOS();
    const isAndroid = /Android/.test(navigator.userAgent);

    // Phase 9.5 c49 — Force-show banner via query ?pwa-debug=1 (bypass cooldown
    // + standalone check) pour diagnostic mobile chez Bassi. Visible aussi
    // dans la console pour confirmer la branche prise.
    const url = new URL(window.location.href);
    const forceDebug = url.searchParams.get('pwa-debug') === '1';

    console.log('[PWARegister c49]', {
      ua: navigator.userAgent.substring(0, 80),
      isIOS,
      isAndroid,
      isStandalone,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      legacyStandalone: (window.navigator as any).standalone,
      displayMode: window.matchMedia('(display-mode: standalone)').matches,
      forceDebug,
    });

    // Phase 9.5 c46 — splash custom React arrondi pour non-iOS standalone.
    // iOS a son propre splash via apple-touch-startup-image (layout.tsx).
    if (isStandalone && !isIOS) {
      setShowSplash(true);
      setTimeout(() => setShowSplash(false), 800);
    }

    // Phase 9.5 c49 — iOS install banner. Conditions :
    //   - iOS Safari (detectIOS) + pas standalone + cooldown expiré (7j)
    //   - OU ?pwa-debug=1 (force, bypass tous les checks)
    if (forceDebug || (isIOS && !isStandalone)) {
      try {
        const dismissedAt = window.localStorage.getItem(IOS_BANNER_DISMISS_KEY);
        const dismissedMs = dismissedAt ? parseInt(dismissedAt, 10) : 0;
        const cooldownExpired = !dismissedMs || Date.now() - dismissedMs > IOS_BANNER_DISMISS_COOLDOWN_MS;
        console.log('[PWARegister c49] iOS banner check', { dismissedMs, cooldownExpired });
        if (forceDebug || cooldownExpired) {
          // Phase 9.5 c49 — timeout réduit 3s → 1.2s pour visibilité rapide mobile
          setTimeout(() => setShowIosBanner(true), 1200);
        }
      } catch {
        setTimeout(() => setShowIosBanner(true), 1200);
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
          src="/icons/icon-192.png?v=28"
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
          src="/icons/icon-192.png?v=28"
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
          src="/icons/icon-192.png?v=28"
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
