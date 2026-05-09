import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

// Phase 9.5 hotfix c2 — defensive .trim() sur env vars Firebase.
// Anti-régression : si user copie-colle une valeur env var avec trailing \n dans Vercel UI,
// le code n'utilise plus la valeur brute mais .trim() pour éviter "Illegal url for new iframe"
// (%0A dans authDomain → URL iframe construite côté client cassée).
const firebaseConfig = {
  apiKey: (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim(),
  authDomain: (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '').trim(),
};

// Check if Firebase is properly configured with REAL credentials
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && 
  firebaseConfig.projectId &&
  firebaseConfig.apiKey.length > 10 &&
  !firebaseConfig.apiKey.includes('your_') &&
  firebaseConfig.apiKey.startsWith('AIzaSy')
);

// Check if Stripe is configured
export const isStripeConfigured = Boolean(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.length > 10 &&
  (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_') ||
   process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith('pk_live_'))
);

// App can work with Stripe alone (payments work, auth uses localStorage fallback)
export const isAppReady = isStripeConfigured;

// Full production mode requires both Firebase and Stripe
export const isProductionMode = isFirebaseConfigured && isStripeConfigured;

// Get missing configuration for error display (only critical ones)
export function getMissingConfig(): string[] {
  const missing: string[] = [];
  
  // Stripe is required for payments
  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_') &&
       !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith('pk_live_'))) {
    missing.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  }
  
  return missing;
}

// Initialize Firebase only if configured
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

try {
  if (isFirebaseConfigured) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    db = getFirestore(app);
    console.log('[Firebase] Successfully initialized');
  } else {
    console.log('[Firebase] Non configuré - utilisation du mode localStorage');
  }
} catch (error) {
  console.error('[Firebase] Initialization failed:', error);
  app = null;
  auth = null;
  db = null;
}

export { auth, db };
export default app;
