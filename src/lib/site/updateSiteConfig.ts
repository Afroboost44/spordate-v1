/**
 * Fix #145 — Service centralisé pour écrire dans `settings/site`.
 *
 * Pourquoi ce fichier ?
 * ----------------------
 * Le document Firestore `settings/site` est partagé entre PLUSIEURS sections
 * de l'admin :
 *   - hero (image + textes + sous-titre)
 *   - brand (logos générés par Canvas)
 *   - étapes 1/2/3
 *   - témoignages
 *   - section Swiss, partner, cta final, etc.
 *
 * Avant ce refactor, chaque section avait son propre `setDoc(...)`. Le bug
 * récurrent : si UN seul de ces appels oubliait `{ merge: true }`, il écrasait
 * TOUT le document, faisant disparaître les autres sections (logos, hero, etc.).
 *
 * Cas réels :
 *  - #143 : "Sauvegarder tout" effaçait les logos brand
 *  - hero URL qui réapparaissait l'image escalier par défaut après sauvegarde
 *  - logos qui disparaissaient quand on changeait les textes
 *
 * Solution : UN SEUL endroit dans le code qui touche `settings/site` :
 *   import { updateSiteConfig } from '@/lib/site/updateSiteConfig';
 *   await updateSiteConfig({ heroImage: 'https://...' });
 *
 * Garanties offertes :
 *  ✓ `{ merge: true }` toujours appliqué (impossible à oublier)
 *  ✓ `updatedAt` toujours mis à jour (audit + cache invalidation)
 *  ✓ Validation centrale (1 endroit pour vérifier les champs)
 *  ✓ Logs cohérents pour debug
 *
 * ANTI-PATTERN : ne JAMAIS faire `setDoc(doc(db, 'settings', 'site'), ...)`
 * directement ailleurs dans le code. Toujours passer par `updateSiteConfig()`.
 *
 * @module
 */

import type { Firestore } from 'firebase/firestore';

/**
 * Type partiel du document `settings/site`. On laisse `Record<string, unknown>`
 * pour permettre tous les sous-champs (brand, hero, steps, testimonials...)
 * sans devoir maintenir une union exhaustive ici.
 */
export type SiteConfigPartial = Record<string, unknown>;

/**
 * Écrit (ou merge) des champs dans `settings/site`.
 *
 * @param partial Sous-ensemble du document — uniquement les champs à modifier.
 *                Tous les autres champs existants sont PRÉSERVÉS.
 *
 * Exemple — mettre à jour uniquement le hero image :
 *   await updateSiteConfig({ heroImage: 'https://...' });
 *   // → brand reste intact, étapes restent intactes, textes restent intacts.
 *
 * Exemple — mettre à jour le brand (sous-objet) :
 *   await updateSiteConfig({ brand: { source: 'url', version: 5 } });
 *   // → heroImage, étapes, etc. restent intacts.
 *
 * @throws Si Firestore est non initialisé OU si l'écriture est refusée
 *         (règles, permissions, network).
 */
export async function updateSiteConfig(partial: SiteConfigPartial): Promise<void> {
  if (!partial || typeof partial !== 'object') {
    throw new Error('[updateSiteConfig] partial must be an object');
  }

  // Import lazy pour éviter d'embarquer firebase/firestore dans des bundles
  // qui n'écrivent jamais settings/site (build splitting Next.js).
  const { db } = await import('@/lib/firebase');
  if (!db) {
    throw new Error('[updateSiteConfig] Firestore non initialisé (db = null)');
  }

  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

  // `merge: true` est FORCÉ — c'est tout l'objectif de ce service.
  // Aucun caller ne peut bypasser parce qu'on ne passe pas d'options en argument.
  await setDoc(
    doc(db as Firestore, 'settings', 'site'),
    { ...partial, updatedAt: serverTimestamp() },
    { merge: true },
  );

  // Log pour faciliter le debug en prod : on saura toujours qui a écrit quoi.
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.log('[updateSiteConfig] saved keys:', Object.keys(partial));
  }

  // Fix FOUC — purge le cache Next.js des Server fetches qui lisent
  // settings/site (theme couleur, brand logos, site config strings).
  // Sans cet appel, `unstable_cache({ revalidate: 60 })` côté server peut
  // continuer à servir l'ancienne couleur / l'ancien hero pendant 60s,
  // causant un flash visible sur le premier paint après save admin.
  // Best-effort : si l'endpoint échoue, le cache se purge quand même au
  // bout de 60s (TTL), donc on ne bloque pas le save.
  if (typeof window !== 'undefined') {
    try {
      const { auth: clientAuth } = await import('@/lib/firebase');
      const token = await clientAuth?.currentUser?.getIdToken();
      if (token) {
        // fire-and-forget : on n'attend pas la réponse pour ne pas ralentir
        // le UX du save admin. Le revalidate est court (~50ms).
        void fetch('/api/admin/site/revalidate', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {
          /* Silent — TTL 60s fallback. */
        });
      }
    } catch {
      /* Silent — cache se purgera via TTL 60s. */
    }
  }
}
