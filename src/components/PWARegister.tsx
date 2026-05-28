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
  // Fix #204 — toast affiché 2s avant le reload auto quand le SW est mis à jour
  const [showUpdateToast, setShowUpdateToast] = useState(false);

  useEffect(() => {
    // Fix #204 — handles à nettoyer au unmount.
    let updateInterval: number | null = null;
    let controllerChangeHandler: (() => void) | null = null;

    if ('serviceWorker' in navigator) {
      // Fix #204 — cache-bust du body /sw.js à chaque déploiement. Le
      // navigateur ne ré-évalue le SW que si le BODY a changé ; sans query
      // string distincte les déploiements rapides (même hash byte-à-byte
      // possible) peuvent rater l'update. NEXT_PUBLIC_BUILD_ID est injecté
      // par next.config.ts à chaque build.
      const buildId = process.env.NEXT_PUBLIC_BUILD_ID || '';
      const swUrl = buildId ? `/sw.js?v=${buildId}` : '/sw.js';

      navigator.serviceWorker
        .register(swUrl)
        .then((reg) => {
          console.log('[PWA] Service Worker registered:', reg.scope, 'buildId=', buildId);

          // Fix #204 — si un SW est déjà en attente au moment du register
          // (page rouverte après update background), on l'active tout de suite.
          if (reg.waiting && navigator.serviceWorker.controller) {
            console.log('[PWA] SW déjà waiting au load → SKIP_WAITING');
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          // Fix #204 — détection d'une nouvelle version pendant que la page
          // est ouverte. updatefound fire dès que le navigateur download un
          // nouveau /sw.js différent. On attend que son state passe à
          // 'installed', puis on demande SKIP_WAITING pour activer la v+1
          // immédiatement. controllerchange (plus bas) rechargera la page.
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            console.log('[PWA] updatefound — new SW installing');
            newWorker.addEventListener('statechange', () => {
              console.log('[PWA] new SW statechange:', newWorker.state);
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                // navigator.serviceWorker.controller existe → un ancien SW
                // contrôlait déjà la page → c'est bien un UPDATE (pas un
                // premier install). On force l'activation.
                console.log('[PWA] new SW installed → SKIP_WAITING');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });

          // Fix #204 — check périodique pour détecter une nouvelle version
          // sans dépendre du navigateur (qui ne check que sur navigation ou
          // toutes les 24h). Toutes les 60s on demande au browser de re-fetch
          // /sw.js → s'il a changé, updatefound fire.
          updateInterval = window.setInterval(() => {
            reg.update().catch((e) => {
              console.log('[PWA] reg.update() failed (silent):', e);
            });
          }, 60_000);
        })
        .catch((err) => {
          console.log('[PWA] Service Worker registration failed:', err);
        });

      // Fix #204 — controllerchange fire quand un NOUVEAU SW prend le contrôle
      // de la page (suite à SKIP_WAITING + clients.claim côté SW). On affiche
      // un toast 2s puis on reload pour repartir sur un bundle JS cohérent
      // avec le nouveau SW (sinon mix vieux JS / nouveau cache = crash).
      // Anti-boucle : flag local hasReloaded pour ne reload qu'UNE fois par
      // chargement de page (sinon en théorie controllerchange pourrait refire
      // si plusieurs updates rapides).
      let hasReloaded = false;
      // Fix #204 v2 — protections combinées contre les boucles de reload :
      //  a) hasReloaded local : 1 seul reload par chargement de page.
      //  b) sessionStorage 'pwa-reloaded' : 1 seul reload par session
      //     navigateur. Si pour une raison X (SW mal activé, race condition)
      //     on relande controllerchange immédiatement après reload, on
      //     bloque définitivement jusqu'à fermeture de l'onglet.
      //  c) Visibility-aware : si l'utilisateur regarde une vidéo en
      //     background (document.hidden), on diffère le reload jusqu'au
      //     prochain focus pour ne pas interrompre la lecture.
      const scheduleReload = () => {
        if (hasReloaded) return;
        if (window.sessionStorage.getItem('pwa-reloaded') === '1') {
          console.log('[PWA] controllerchange ignoré — déjà reloadé cette session');
          return;
        }
        hasReloaded = true;
        window.sessionStorage.setItem('pwa-reloaded', '1');
        console.log('[PWA] controllerchange = SW update → reload in 2s');
        setShowUpdateToast(true);

        const doReload = () => {
          if (document.hidden) {
            // Onglet en arrière-plan : attendre le retour au foreground.
            // Évite de couper une vidéo / musique en lecture background.
            console.log('[PWA] doc hidden → reload différé jusqu\'au focus');
            const onVisible = () => {
              if (!document.hidden) {
                document.removeEventListener('visibilitychange', onVisible);
                window.location.reload();
              }
            };
            document.addEventListener('visibilitychange', onVisible);
            return;
          }
          window.location.reload();
        };

        window.setTimeout(doReload, 2000);
      };

      controllerChangeHandler = () => {
        // Edge case : au tout premier install (jamais eu de controller avant),
        // controllerchange fire aussi. On évite alors le reload — la page
        // tourne déjà avec le bundle JS qui matche le SW fresh. On se base sur
        // sessionStorage 'pwa-sw-seen' marqué au load si controller existait.
        const isFirstInstall =
          !window.sessionStorage.getItem('pwa-sw-seen');
        window.sessionStorage.setItem('pwa-sw-seen', '1');
        if (isFirstInstall) {
          console.log('[PWA] controllerchange = first install → no reload');
          return;
        }
        scheduleReload();
      };
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        controllerChangeHandler
      );

      // Marquer la session comme "SW déjà vu" si controller existe au load.
      if (navigator.serviceWorker.controller) {
        window.sessionStorage.setItem('pwa-sw-seen', '1');
      }
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
      // Fix #204 v2 — nettoyer le controllerchange listener + l'interval
      // d'update. Sans ça, en cas d'unmount/remount (HMR dev, route switch),
      // on accumule des handlers qui pourraient déclencher plusieurs reloads.
      if (controllerChangeHandler && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          controllerChangeHandler,
        );
      }
      if (updateInterval !== null) {
        window.clearInterval(updateInterval);
      }
    };
  }, []);

  // Fix #208 BUG 2 — handleInstall robuste :
  //   1. Si `deferredPrompt` (beforeinstallprompt fired) → on lance la popup
  //      native via prompt() + on lit userChoice pour gérer accept/dismiss.
  //   2. Sinon (Safari iOS, ou Chrome Android sans event encore fired) → on
  //      bascule sur le tutoriel manuel (showManualTutorial state).
  const [showManualTutorial, setShowManualTutorial] = useState(false);

  const handleInstall = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result?.outcome === 'accepted') {
          setShowInstall(false);
          setShowMobileBanner(false);
          setHasNativePrompt(false);
          deferredPrompt = null;
          return;
        }
        // Dismissed : on enregistre le cooldown + on ferme la bannière.
        try {
          window.localStorage.setItem(IOS_BANNER_DISMISS_KEY, String(Date.now()));
        } catch {
          // ignore (private browsing)
        }
        setShowInstall(false);
        setShowMobileBanner(false);
        deferredPrompt = null;
        setHasNativePrompt(false);
        return;
      } catch (err) {
        // prompt() peut throw si déjà consommé → fallback tutoriel.
        console.log('[PWARegister] prompt() failed, fallback tutorial:', err);
      }
    }
    // Pas de prompt natif dispo → afficher tutoriel manuel inline.
    setShowManualTutorial(true);
  };

  const handleMobileDismiss = () => {
    setShowMobileBanner(false);
    try {
      window.localStorage.setItem(IOS_BANNER_DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore (private browsing)
    }
  };

  // Fix #204 — toast "Nouvelle version" affiché en priorité 2s avant reload.
  // Z-index 10000 > splash 9999 + banners 9998 pour passer par-dessus tout.
  // Coexiste avec le rendu : on le wrappe dans un Fragment avec le contenu
  // existant via showUpdateToast en condition AVANT les autres early-returns.
  // Cas rare où le toast apparaît pendant un banner install : le toast prend
  // visuellement le dessus (top du viewport) sans masquer le banner (bottom).
  const updateToast = showUpdateToast ? (
    <div
      key="pwa-update-toast"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.95)',
        backdropFilter: 'blur(12px)',
        color: 'white',
        borderRadius: 12,
        padding: '12px 20px',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        border: '1px solid rgb(var(--accent-color-rgb) / 0.3)',
        maxWidth: '90vw',
      }}
    >
      {t('pwa_new_version_reloading')}
    </div>
  ) : null;

  // Fix #208 BUG 2 — overlay tutoriel manuel quand le prompt natif n'est
  // pas disponible (Safari iOS, ou Chrome Android sans event fired).
  // Affichage modal centré avec icône + instructions step-by-step + close.
  if (showManualTutorial) {
    return (
      <>
      {updateToast}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
        onClick={() => setShowManualTutorial(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#0a0a0a',
            border: '1px solid rgb(var(--accent-color-rgb) / 0.3)',
            borderRadius: 20,
            padding: '24px 20px',
            maxWidth: 360,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: 'rgb(var(--accent-color-rgb) / 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SpordateurLogo className="h-9 w-9 text-accent" />
          </div>
          <p style={{ color: 'white', margin: 0, fontWeight: 700, fontSize: 18, textAlign: 'center' }}>
            {t('pwa_install_title')}
          </p>
          {deviceType === 'ios' ? (
            <p style={{ color: '#bbb', margin: 0, fontSize: 14, textAlign: 'center', lineHeight: 1.5 }}>
              {t('pwa_ios_install_step1')}{' '}
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
              </svg>{' '}
              {t('pwa_ios_install_step2')}
            </p>
          ) : (
            <p style={{ color: '#bbb', margin: 0, fontSize: 14, textAlign: 'center', lineHeight: 1.5 }}>
              {t('pwa_android_install_step1')}{' '}
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
              </svg>{' '}
              {t('pwa_android_install_step2')}
            </p>
          )}
          <button
            onClick={() => setShowManualTutorial(false)}
            style={{
              background: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: 12,
              padding: '10px 28px',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            {t('common_close')}
          </button>
        </div>
      </div>
      </>
    );
  }

  if (showSplash) {
    return (
      <>
      {updateToast}
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
      </>
    );
  }

  if (showInstall) {
    return (
      <>
      {updateToast}
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
      </>
    );
  }

  if (showMobileBanner) {
    // Phase 9.5 c51 — banner mobile générique avec contenu adapté par OS :
    //  - iOS Safari : icône partage + instruction "Tap [share] → Ajouter…"
    //  - Android Chrome + deferredPrompt fired : bouton "Installer" natif
    //  - Android Chrome sans event : icône menu ⋮ + instruction "Tap ⋮ → …"
    // Fix #208 BUG 2 — bouton "Installer" maintenant affiché sur Android
    // EN PERMANENCE (même sans event beforeinstallprompt déjà fired).
    // Le clic appelle handleInstall qui :
    //   - utilise deferredPrompt.prompt() si dispo (Chrome Android, Edge,
    //     Samsung Browser…)
    //   - bascule sur showManualTutorial sinon (Safari iOS, fallback).
    // Sur iOS, on n'affiche pas de bouton "Installer" (l'API n'existe pas
    // et iOS exige une action manuelle dans le menu partage de Safari) —
    // on garde les instructions visuelles avec l'icône share natif.
    const showInstallButton = deviceType === 'android';
    return (
      <>
      {updateToast}
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
        {showInstallButton && (
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
      </>
    );
  }

  // Fix #204 — si seul le toast d'update est actif (cas normal), on le rend
  // sans autre bannière.
  if (updateToast) {
    return updateToast;
  }

  return null;
}
