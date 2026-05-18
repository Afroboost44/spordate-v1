"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { SpordateurLogo } from '@/components/SpordateurLogo';

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
  // Phase 9.5 c51 — banner mobile générique (iOS + Android sans beforeinstallprompt fired)
  const [showMobileBanner, setShowMobileBanner] = useState(false);
  const [deviceType, setDeviceType] = useState<'ios' | 'android' | null>(null);
  const [hasNativePrompt, setHasNativePrompt] = useState(false);
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
    const isMobile = isIOS || isAndroid;
    setDeviceType(isIOS ? 'ios' : isAndroid ? 'android' : null);

    // Force-show banner via query ?pwa-debug=1 (bypass cooldown + standalone check)
    const url = new URL(window.location.href);
    const forceDebug = url.searchParams.get('pwa-debug') === '1';

    console.log('[PWARegister c51]', {
      ua: navigator.userAgent.substring(0, 80),
      isIOS,
      isAndroid,
      isMobile,
      isStandalone,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      legacyStandalone: (window.navigator as any).standalone,
      displayMode: window.matchMedia('(display-mode: standalone)').matches,
      forceDebug,
    });

    // Phase 9.5 c46 — splash custom React arrondi pour non-iOS standalone.
    if (isStandalone && !isIOS) {
      setShowSplash(true);
      setTimeout(() => setShowSplash(false), 800);
    }

    // Phase 9.5 c51 BUG B — banner mobile (iOS OU Android) après 1.2s.
    // Avant c51 : seulement iOS. Cause BUG B : Chrome Android ne fire pas
    // beforeinstallprompt sans interaction user heuristique → banner attendait
    // indéfiniment. Maintenant : on affiche aussi le banner Android avec
    // instructions menu ⋮ ; si l'event finit par fire, le bouton "Installer"
    // dans le banner utilisera deferredPrompt.prompt() pour le natif.
    if (forceDebug || (isMobile && !isStandalone)) {
      try {
        const dismissedAt = window.localStorage.getItem(IOS_BANNER_DISMISS_KEY);
        const dismissedMs = dismissedAt ? parseInt(dismissedAt, 10) : 0;
        const cooldownExpired = !dismissedMs || Date.now() - dismissedMs > IOS_BANNER_DISMISS_COOLDOWN_MS;
        console.log('[PWARegister c51] mobile banner check', { dismissedMs, cooldownExpired });
        if (forceDebug || cooldownExpired) {
          setTimeout(() => setShowMobileBanner(true), 1200);
        }
      } catch {
        setTimeout(() => setShowMobileBanner(true), 1200);
      }
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      setHasNativePrompt(true);
      // Phase 9.5 c51 — Sur desktop (pas mobile) garde le comportement c46 :
      // banner "showInstall" dédié. Sur mobile, le banner showMobileBanner est
      // déjà affiché et son bouton "Installer" lira deferredPrompt s'il existe.
      if (!isMobile) {
        setShowInstall(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    window.addEventListener('appinstalled', () => {
      setShowInstall(false);
      setShowMobileBanner(false);
      setHasNativePrompt(false);
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
      setShowMobileBanner(false);
      setHasNativePrompt(false);
      deferredPrompt = null;
    }
  };

  const handleMobileDismiss = () => {
    setShowMobileBanner(false);
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
        <div
          style={{
            width: 160,
            height: 160,
            marginBottom: 24,
            borderRadius: '50%',
            backgroundColor: 'rgb(var(--accent-color-rgb) / 0.10)',
            boxShadow: '0 0 80px rgb(var(--accent-color-rgb) / 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SpordateurLogo className="h-24 w-24 text-accent" />
        </div>
        <h1 style={{ color: 'var(--accent-color)', fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
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
          border: '1px solid rgb(var(--accent-color-rgb) / 0.3)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: 'rgb(var(--accent-color-rgb) / 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <SpordateurLogo className="h-7 w-7 text-accent" />
        </div>
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
            background: 'var(--accent-color)',
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

  if (showMobileBanner) {
    // Phase 9.5 c51 — banner mobile générique avec contenu adapté par OS :
    //  - iOS Safari : icône partage + instruction "Tap [share] → Ajouter…"
    //  - Android Chrome + deferredPrompt fired : bouton "Installer" natif
    //  - Android Chrome sans event : icône menu ⋮ + instruction "Tap ⋮ → …"
    const isAndroidWithPrompt = deviceType === 'android' && hasNativePrompt;
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
          border: '1px solid rgb(var(--accent-color-rgb) / 0.3)',
        }}
      >
        {/* Accent feature : inline SVG SpordateurLogo suit text-accent
            (dynamique via /admin "Couleur principale"). Wrapper rounded bg
            pour conserver visuellement le "badge" rond du logo PWA. */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            flexShrink: 0,
            backgroundColor: 'rgb(var(--accent-color-rgb) / 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SpordateurLogo className="h-7 w-7 text-accent" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: 'white', margin: 0, fontWeight: 600, fontSize: 14 }}>
            {t('pwa_install_title') || 'Installer Spordateur'}
          </p>
          {deviceType === 'ios' && (
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
                <path d="M7 1L4 4M7 1L10 4M7 1V11" stroke="var(--accent-color)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 8H1V16C1 16.5523 1.44772 17 2 17H12C12.5523 17 13 16.5523 13 16V8H12" stroke="var(--accent-color)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>{t('pwa_ios_install_step2') || "puis « Ajouter à l'écran d'accueil »"}</span>
            </p>
          )}
          {deviceType === 'android' && !hasNativePrompt && (
            <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span>{t('pwa_android_install_step1') || 'Tap'}</span>
              {/* Phase 9.5 c51 — 3-dots vertical (Chrome Android menu icon) */}
              <svg
                width="4"
                height="16"
                viewBox="0 0 4 16"
                fill="var(--accent-color)"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: 'inline-block', verticalAlign: 'middle' }}
                aria-label="menu icon"
              >
                <circle cx="2" cy="2" r="2" />
                <circle cx="2" cy="8" r="2" />
                <circle cx="2" cy="14" r="2" />
              </svg>
              <span>{t('pwa_android_install_step2') || "puis « Ajouter à l'écran d'accueil »"}</span>
            </p>
          )}
          {deviceType === 'android' && hasNativePrompt && (
            <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: 12 }}>
              {t('pwa_install_subtitle') || "Accès rapide depuis ton écran d'accueil"}
            </p>
          )}
        </div>
        {isAndroidWithPrompt && (
          <button
            onClick={handleInstall}
            style={{
              background: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: 12,
              padding: '8px 14px',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t('pwa_install_button') || 'Installer'}
          </button>
        )}
        <button
          onClick={handleMobileDismiss}
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
