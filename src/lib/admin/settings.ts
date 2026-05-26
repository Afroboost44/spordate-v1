/**
 * Helper générique pour lire un setting numérique paramétrable par l'admin
 * depuis Firestore `settings/pricing`.
 *
 * Pourquoi ce helper :
 *  Bassi peut éditer la plupart des prix Spordateur (chat, likes, boosts, packs,
 *  premium) depuis /admin/manage > onglet Tarifs. Le doc Firestore unique
 *  `settings/pricing` est la source de vérité. Pour les nouveaux paramètres
 *  numériques (ex: `minPayoutCHF`, fix #X), au lieu de répéter à chaque fois
 *  le pattern `getDoc(doc(db, 'settings', 'pricing')) → fallback`, on centralise.
 *
 * Contexte d'exécution : ce helper utilise le SDK client `firebase/firestore`,
 *  donc utilisable dans :
 *   - composants React client (`'use client'`)
 *   - services `firestore.ts` (qui consomment déjà le SDK client)
 *   - routes API Next.js côté serveur (le SDK client marche aussi côté Node si
 *     `db` est initialisé — c'est le cas pour Spordateur).
 *
 *  Pour le contexte Cloud Functions (Admin SDK), utilise plutôt
 *  `getSitePricing(admin.firestore())` dans `@/lib/pricing/sitePricing`.
 *
 * Comportement :
 *  - Si le doc n'existe pas → retourne `fallback`.
 *  - Si la clé est absente, NaN, négative, ou non-numérique → retourne `fallback`.
 *  - Si Firestore throw (network, permissions) → log + retourne `fallback`.
 *
 * On NE force PAS un floor absolu ici (responsabilité du caller : ex.
 * `validatePayoutRequest` clamp ensuite à `MIN_PAYOUT_CHF` côté lib/creators).
 */

import { db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * Lit une clé numérique depuis le doc Firestore `settings/pricing`.
 *
 * @param key      Nom du champ (ex: 'minPayoutCHF', 'likeCost', 'chatMessageCost')
 * @param fallback Valeur retournée si Firestore indispo / champ invalide
 * @returns Le nombre lu, ou `fallback` si quoi que ce soit cloche.
 */
export async function getAdminSetting(key: string, fallback: number): Promise<number> {
  if (!db || !isFirebaseConfigured) return fallback;
  try {
    const snap = await getDoc(doc(db, 'settings', 'pricing'));
    if (!snap.exists()) return fallback;
    const data = snap.data() || {};
    const raw = (data as Record<string, unknown>)[key];
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  } catch (err) {
    console.warn(`[getAdminSetting] read failed for key="${key}", using fallback=${fallback}`, err);
    return fallback;
  }
}
