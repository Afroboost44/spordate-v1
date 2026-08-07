/**
 * Catalogue des forfaits — SOURCE UNIQUE.
 *
 * ⚠️ EXTRAIT DE `api/checkout/route.ts` PARCE QU'IL Y A DÉSORMAIS DEUX CHEMINS
 * DE PAIEMENT. Stripe (carte) et pawaPay (Mobile Money) doivent facturer le MÊME
 * prix pour le MÊME forfait ; deux catalogues auraient divergé au premier
 * changement de tarif, et le client aurait payé deux montants différents selon
 * le bouton cliqué. Le contenu est repris À L'IDENTIQUE — aucun prix, aucun
 * crédit, aucune durée n'est modifié par cette extraction.
 *
 * Les surcharges admin (`settings/pricing` dans Firestore) restent le dernier mot,
 * avec le même cache de 5 minutes qu'avant.
 */
import 'server-only';
import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';

let _db: FirebaseFirestore.Firestore | null = null;
let _cachedPackages: typeof DEFAULT_PACKAGES | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// BUG #93 — `durationHours` permet aux plans Premium one_time (24h, 1 semaine)
// de transporter une durée d'activation jusqu'au webhook qui calcule
// `premiumExpiresAt = now + durationHours * 3600 * 1000`. Pour les subscriptions
// mensuel/annuel : Stripe gère le cycle via customer.subscription.* events,
// donc `durationHours` reste absent (-> isPremium tant que subscription active).
export const DEFAULT_PACKAGES: Record<string, {
  price: number; credits: number; label: string;
  description: string; type: 'one_time' | 'subscription';
  interval?: 'month' | 'year'; isActive?: boolean;
  durationHours?: number;
}> = {
  'test_1chf': { price: 100, credits: 1, label: 'Test 1 CHF', description: 'Package de test — 1 CHF', type: 'one_time' },
  // ----- Legacy packs (conservés pour rétro-compat, désactivables via admin) -----
  '1_date':    { price: 1000, credits: 1, label: 'Starter (legacy)', description: '1 crédit Sport Date', type: 'one_time' },
  '3_dates':   { price: 2500, credits: 3, label: 'Populaire (legacy)', description: '3 crédits Sport Date', type: 'one_time' },
  '10_dates':  { price: 6000, credits: 10, label: 'Premium (legacy)', description: '10 crédits Sport Date', type: 'one_time' },
  'premium_monthly': { price: 1990, credits: 5, label: 'Premium Mensuel (legacy)', description: 'Abonnement Premium mensuel', type: 'subscription', interval: 'month' },
  'premium_yearly':  { price: 14900, credits: 60, label: 'Premium Annuel (legacy)', description: 'Abonnement Premium annuel', type: 'subscription', interval: 'year' },
  'partner_monthly': { price: 4900, credits: 0, label: 'Partenaire Pro', description: 'Abonnement partenaire mensuel', type: 'subscription', interval: 'month' },

  // ----- BUG #93 — Nouveaux packs crédits (PRICING-PROPOSAL.md §3) -----
  // Coûts intra-app : likes premium + boost user + messages chat. JAMAIS pour réserver
  // une activité (qui se paye en Stripe direct via mode='session').
  'pack_starter': { price: 490,  credits: 50,   label: 'Starter',  description: '50 crédits Spordateur',   type: 'one_time' },
  'pack_confort': { price: 1190, credits: 150,  label: 'Confort',  description: '150 crédits Spordateur — économise 20%',  type: 'one_time' },
  'pack_pro':     { price: 2990, credits: 500,  label: 'Pro',      description: '500 crédits Spordateur — économise 40%',  type: 'one_time' },
  'pack_vip':     { price: 6990, credits: 1500, label: 'VIP',      description: '1500 crédits Spordateur — économise 52%', type: 'one_time' },

  // ----- BUG #93 — Abonnements Premium (PRICING-PROPOSAL.md §5) -----
  // 24h + semaine = one_time avec `durationHours` ; mois + an = Stripe subscription.
  'premium_24h':   { price: 490,   credits: 50,  label: 'Premium Flash 24h',        description: 'Accès Premium 24h + 50 crédits offerts',  type: 'one_time', durationHours: 24 },
  'premium_week':  { price: 1490,  credits: 100, label: 'Premium Découverte 1 semaine', description: 'Accès Premium 7 jours + 100 crédits',    type: 'one_time', durationHours: 24 * 7 },
  'premium_month': { price: 2990,  credits: 200, label: 'Premium Standard 1 mois',  description: 'Premium mensuel + 200 crédits / mois',   type: 'subscription', interval: 'month' },
  'premium_year':  { price: 19990, credits: 250, label: 'Premium Fidélité 1 an',    description: 'Premium annuel + 250 crédits / mois (16.65 CHF/mois)', type: 'subscription', interval: 'year' },
};

export async function getDb() {
  if (_db) return _db;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
    }
  }
  _db = getFirestore();
  return _db;
}

export async function loadPackages(): Promise<typeof DEFAULT_PACKAGES> {
  // Return cached if fresh
  if (_cachedPackages && Date.now() - _cacheTs < CACHE_TTL) return _cachedPackages;
  try {
    const db = await getDb();
    const snap = await db.collection('settings').doc('pricing').get();
    if (snap.exists) {
      const data = snap.data();
      if (data?.packages) {
        const merged = { ...DEFAULT_PACKAGES };
        for (const [id, pkg] of Object.entries(data.packages as Record<string, any>)) {
          if (merged[id]) {
            const priceCentimes = pkg.priceCHF ? Math.round(pkg.priceCHF * 100) : (pkg.price || merged[id].price);
            merged[id] = { ...merged[id], price: priceCentimes, credits: pkg.credits ?? merged[id].credits, label: pkg.label || merged[id].label };
            if (pkg.isActive === false) delete merged[id];
          }
        }
        _cachedPackages = merged;
        _cacheTs = Date.now();
        return merged;
      }
    }
  } catch (err) {
    console.warn('[Checkout] Firestore pricing error, using defaults:', err);
  }
  _cachedPackages = DEFAULT_PACKAGES;
  _cacheTs = Date.now();
  return DEFAULT_PACKAGES;
}
