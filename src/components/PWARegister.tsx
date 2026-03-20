"use client";

import { useEffect, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deferredPrompt: any = null;

export default function PWARegister() {
  const [showInstall, setShowInstall] = useState(false);
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
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setShowSplash(true);
      setTimeout(() => setShowSplash(false), 2500);
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    window.addEventListener('appinstalled', () => {
      setShowInstall(false);
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

  if (showSplash) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'linear-gradient(135deg, #9333EA 0%, #A855F7 50%, #C026D3 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'splashFade 0.5s ease 2s forwards',
        }}
      >
        <img
          src="/icons/icon-192.png"
          alt="Spordate"
          width={120}
          height={120}
          style={{ borderRadius: 28, marginBottom: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
        />
        <h1 style={{ color: 'white', fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
          Spordate
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, marginTop: 8 }}>
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
          background: 'rgba(26, 26, 46, 0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: 16,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          border: '1px solid rgba(147, 51, 234, 0.3)',
        }}
      >
        <img
          src="/icons/icon-192.png"
          alt=""
          width={48}
          height={48}
          style={{ borderRadius: 12 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: 'white', margin: 0, fontWeight: 600, fontSize: 15 }}>
            Installer Spordate
          </p>
          <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: 13 }}>
            Accès rapide depuis ton écran d'accueil
          </p>
        </div>
        <button
          onClick={handleInstall}
          style={{
            background: 'linear-gradient(135deg, #9333EA, #C026D3)',
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
          Installer
        </button>
        <button
          onClick={() => setShowInstall(false)}
          aria-label="Fermer"
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

  return null;
}
