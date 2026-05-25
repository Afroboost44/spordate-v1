/**
 * Fix #131 — Hook client-side pour lire settings/site.brand en realtime.
 *
 * Pattern singleton : un seul onSnapshot Firestore est actif pour toute l'app
 * (peu importe combien de SpordateurLogo / BrandLogo sont rendus). Chaque
 * consommateur s'abonne au store local via setState + listener pattern.
 *
 * Quand l'admin uploade un nouveau logo via /admin/manage > Logos du site,
 * Firestore push l'update → tous les SpordateurLogo (header, footer, modals,
 * PWA install card) se mettent à jour sans refresh.
 *
 * @module
 */

'use client';

import { useEffect, useState } from 'react';
import type { BrandLogos } from '@/lib/brand/generateLogos';

// État partagé module-level — un seul snapshot Firestore alimente toute l'app
const STORAGE_KEY = 'spordateur:brand:v1';

function readCachedBrand(): BrandLogos | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BrandLogos;
  } catch {
    return null;
  }
}

function writeCachedBrand(brand: BrandLogos | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (brand && brand.version) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(brand));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota / disabled — silent */
  }
}

// Initialise depuis localStorage au module-load → le logo apparaît instantanément
// au prochain reload même si le SSR brand est null.
let currentBrand: BrandLogos | null = readCachedBrand();
let listeners: Array<(b: BrandLogos | null) => void> = [];
let initialized = false;
let unsubscribeFirestore: (() => void) | null = null;

function notifyListeners(brand: BrandLogos | null) {
  currentBrand = brand;
  writeCachedBrand(brand); // persiste pour le prochain reload
  listeners.forEach((fn) => {
    try {
      fn(brand);
    } catch (err) {
      console.warn('[useBrandLogos] listener error', err);
    }
  });
}

/**
 * Fix #132 — Injecte le brand initial fetché côté SSR par le layout.
 * Appelé par <BrandProvider> avant le premier render des consommateurs pour
 * éliminer le FOUC (flash du SVG fallback avant la réponse Firestore).
 */
export function setInitialBrand(brand: BrandLogos | null): void {
  if (currentBrand === null && brand) {
    currentBrand = brand;
    // Notifier les listeners déjà attachés (au cas où ils se sont abonnés
    // avant que BrandProvider n'ait poussé l'init)
    listeners.forEach((fn) => {
      try {
        fn(brand);
      } catch (err) {
        console.warn('[setInitialBrand] listener error', err);
      }
    });
  }
}

async function initializeBrandSubscription() {
  if (initialized) return;
  initialized = true;
  try {
    const { db, isFirebaseConfigured } = await import('@/lib/firebase');
    if (!db || !isFirebaseConfigured) return;
    const { doc, onSnapshot } = await import('firebase/firestore');
    const ref = doc(db, 'settings', 'site');
    unsubscribeFirestore = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        const brand = data?.brand as BrandLogos | undefined;
        notifyListeners(brand ?? null);
      },
      (err) => {
        console.warn('[useBrandLogos] onSnapshot error (silent)', err);
      },
    );
  } catch (err) {
    console.warn('[useBrandLogos] init failed (silent)', err);
  }
}

/**
 * Hook React qui retourne le brand actuel (lit settings/site.brand en realtime).
 * Renvoie null tant que Firestore n'a pas répondu OU si aucun brand n'est configuré.
 */
export function useBrandLogos(): BrandLogos | null {
  const [brand, setBrand] = useState<BrandLogos | null>(currentBrand);

  useEffect(() => {
    // S'abonner aux mises à jour
    const listener = (b: BrandLogos | null) => setBrand(b);
    listeners.push(listener);
    // Démarrer le subscription Firestore si pas déjà fait
    initializeBrandSubscription();
    // Si l'init est déjà finie, synchroniser immédiatement
    if (currentBrand !== brand) {
      setBrand(currentBrand);
    }
    return () => {
      listeners = listeners.filter((fn) => fn !== listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return brand;
}

/**
 * Helper pour récupérer la meilleure URL d'icône utilisable pour rendu UI inline
 * (header, install card, modals, splash écran chargement React).
 *
 * Fix #134 — Priorité au SOURCE PNG transparent original, PAS les variants
 * composités avec fond noir (qui sont réservés à l'OS-level install : favicon,
 * apple-touch, manifest PWA). Sinon on aurait un vilain carré noir autour du
 * logo dans les contextes inline.
 */
export function getBestLogoUrl(brand: BrandLogos | null): string | null {
  if (!brand) return null;
  const v = brand.version ? `?v=${brand.version}` : '';
  // 1) Source PNG transparent original (le mieux pour rendu inline UI)
  if (brand.sourceUrl) return `${brand.sourceUrl}${v}`;
  // 2) Fallbacks : variants composités avec fond noir (visible carré si l'arrière
  // plan UI parent n'est pas noir, mais mieux que rien)
  if (brand.icon512Url) return `${brand.icon512Url}${v}`;
  if (brand.icon192Url) return `${brand.icon192Url}${v}`;
  if (brand.appleTouch180Url) return `${brand.appleTouch180Url}${v}`;
  return null;
}
