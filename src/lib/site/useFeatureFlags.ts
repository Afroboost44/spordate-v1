/**
 * Phase 9.5 c8 — Client hook useFeatureFlags (real-time onSnapshot Firestore).
 * Phase 9.5 c21 — étendu pour discoveryMode 3-state via normalizeFlags.
 *
 * Séparé de `./featureFlags` pour éviter mix client/server import (Next.js 15
 * détecte useEffect/useState et refuse de bundler côté serveur).
 *
 * Pattern cohérent useCredits hook (Phase 8 SC1).
 *
 * @module
 */

'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { type FeatureFlags, DEFAULT_FLAGS, normalizeFlags } from './featureFlags';

/**
 * Subscribe en temps réel aux flags via Firestore onSnapshot.
 * Returns DEFAULT_FLAGS pendant le fetch initial OU si Firebase pas configuré.
 */
export function useFeatureFlags(): FeatureFlags & { loading: boolean } {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setLoading(false);
      return;
    }
    const ref = doc(db, 'settings', 'features');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setFlags(normalizeFlags(snap.data()));
        } else {
          setFlags(DEFAULT_FLAGS);
        }
        setLoading(false);
      },
      (err) => {
        console.warn('[useFeatureFlags] onSnapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  return { ...flags, loading };
}
