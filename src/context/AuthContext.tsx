"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { createUser, getUser } from '@/services/firestore';
import type { UserProfile } from '@/types/firestore';

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  isLoggedIn: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Load or create Firestore profile for authenticated user
  const ensureUserProfile = async (firebaseUser: User): Promise<UserProfile | null> => {
    try {
      let profile = await getUser(firebaseUser.uid);
      if (!profile) {
        // First time user → create Firestore profile
        profile = await createUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || '',
          photoURL: firebaseUser.photoURL || '',
        });
        console.log('[Auth] Profil Firestore créé pour', firebaseUser.email);
      }
      return profile;
    } catch (err) {
      console.warn('[Auth] Firestore profile load failed (offline?):', err);
      return null;
    }
  };

  // Refresh profile from Firestore
  const refreshProfile = async () => {
    if (user) {
      const profile = await ensureUserProfile(user);
      setUserProfile(profile);
    }
  };

  // Listen to Firebase auth state
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const profile = await ensureUserProfile(firebaseUser);
        setUserProfile(profile);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const clearError = () => setError(null);

  // Translate Firebase error codes to French.
  // Phase 9.5 hotfix : étendu avec 5 codes Google Sign-In + 2 silent cases (return null).
  // Caller skip setError si message === null (case: user a fermé popup volontairement).
  function getFirebaseErrorMessage(code: string): string | null {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Cette adresse email est déjà utilisée.';
      case 'auth/invalid-email':
        return 'Adresse email invalide.';
      case 'auth/weak-password':
        return 'Le mot de passe doit contenir au moins 6 caractères.';
      case 'auth/user-not-found':
        return 'Aucun compte trouvé avec cet email.';
      case 'auth/wrong-password':
        return 'Mot de passe incorrect.';
      case 'auth/invalid-credential':
        return 'Email ou mot de passe incorrect.';
      case 'auth/too-many-requests':
        return 'Trop de tentatives. Réessayez dans quelques minutes.';
      case 'auth/network-request-failed':
        return 'Erreur réseau. Vérifiez votre connexion internet.';
      // Phase 9.5 hotfix — Google Sign-In error codes étendus
      case 'auth/account-exists-with-different-credential':
        return 'Ce compte existe déjà avec email/mot de passe. Connecte-toi avec ton mot de passe puis lie Google depuis ton profil.';
      case 'auth/unauthorized-domain':
        return 'Domaine non autorisé. Contacte l\'administrateur.';
      case 'auth/operation-not-allowed':
        return 'Connexion Google temporairement désactivée.';
      case 'auth/popup-blocked':
        return 'Popup bloquée. Autorise les popups pour ce site.';
      // Silent cases — user a annulé volontairement, pas un vrai error
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return null;
      default:
        return 'Une erreur est survenue. Veuillez réessayer.';
    }
  }

  const login = async (email: string, password: string) => {
    if (!auth) {
      setError('Firebase non configuré. Contactez l\'administrateur.');
      return;
    }
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/discovery');
    } catch (err: any) {
      setError(getFirebaseErrorMessage(err.code));
      throw err;
    }
  };

  const signup = async (email: string, password: string, displayName: string) => {
    if (!auth) {
      setError('Firebase non configuré. Contactez l\'administrateur.');
      return;
    }
    setError(null);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Set display name
      await updateProfile(userCredential.user, { displayName });
      router.push('/discovery');
    } catch (err: any) {
      setError(getFirebaseErrorMessage(err.code));
      throw err;
    }
  };

  const loginWithGoogle = async () => {
    if (!auth) {
      setError('Firebase non configuré. Contactez l\'administrateur.');
      return;
    }
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.push('/discovery');
    } catch (err: any) {
      // Phase 9.5 hotfix — surface real err.code pour debug prod
      console.error('[loginWithGoogle] Firebase error code:', err?.code, 'message:', err?.message);
      const message = getFirebaseErrorMessage(err?.code);
      if (message !== null) {
        setError(message);
      }
      throw err;
    }
  };

  const logout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      router.push('/');
    } catch (err: any) {
      setError('Erreur lors de la déconnexion.');
    }
  };

  const resetPassword = async (email: string) => {
    if (!auth) {
      setError('Firebase non configuré.');
      return;
    }
    setError(null);
    try {
      // Phase 9.5 hotfix c3 — route via API Resend (anti-SPAM Firebase Auth default sender).
      // Cf. /api/auth/send-reset-password : Admin SDK génère le link Firebase + Resend send.
      // Anti-enumeration : API retourne 200 même si user-not-found (silent).
      const res = await fetch('/api/auth/send-reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        // 400 invalid-input ou 500 internal → afficher message générique
        const body = await res.json().catch(() => ({}));
        if (body?.error === 'invalid-input') {
          setError('Adresse email invalide.');
        } else {
          setError('Une erreur est survenue. Veuillez réessayer.');
        }
        throw new Error(`Reset password API ${res.status}`);
      }
    } catch (err: any) {
      console.error('[resetPassword] failed', err?.message);
      if (!err?.message?.startsWith('Reset password API')) {
        // Network / fetch error
        setError('Erreur réseau. Vérifiez votre connexion internet.');
      }
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      userProfile,
      isLoggedIn: !!user,
      loading,
      login,
      signup,
      loginWithGoogle,
      logout,
      resetPassword,
      refreshProfile,
      error,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
