"use client";

/**
 * Page outil admin : créer un compte partenaire à la main.
 *
 * Sécurité (Fix sécurité 2026-05-26) :
 *   - Avant : secret URL en clair (?secret=spordate2026) + credentials test
 *     hardcodés dans le code source → fuite GitHub + ouvert à tout connaisseur
 *     de l'URL. Bug critique.
 *   - Après : guard `useAuth()` strict — accessible UNIQUEMENT si user
 *     connecté avec `userProfile.role === 'admin'`. Sinon :
 *       · pas connecté → redirect /admin/login
 *       · connecté mais pas admin → message "accès refusé" + retour accueil
 *   - Les credentials du nouveau partenaire sont saisis en clair dans un
 *     formulaire (pas pré-remplis) et utilisés une seule fois pour créer le
 *     compte Firebase Auth + le doc partners + le doc users role='partner'.
 *
 * UX :
 *   - Formulaire dark mode, accent rose `bg-accent`, cohérent avec le reste
 *     du tooling admin (cf. /admin/manage).
 *   - i18n FR/EN/DE via t() — règle CLAUDE.md #9.bis.
 */

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp, GeoPoint } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function SetupPartnerPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, userProfile, loading: authLoading } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    iban: '',
    ibanHolder: '',
    city: 'Genève',
    canton: 'GE',
  });
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ─── Guards ──────────────────────────────────────────────────────────────
  // 1. Auth en cours → loader
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // 2. Pas connecté → redirect login admin
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace('/admin/login');
    }
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/40 text-sm">{t('setup_partner_redirect_login')}</p>
      </div>
    );
  }

  // 3. Connecté mais pas admin → accès refusé
  if (!userProfile || userProfile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full text-center">
          <ShieldOff className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">
            {t('setup_partner_denied_title')}
          </h1>
          <p className="text-sm text-white/50 mb-6">
            {t('setup_partner_denied_subtitle')}
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-accent hover:bg-accent/80 text-white rounded-full text-sm transition"
          >
            {t('setup_partner_back_home')}
          </Link>
        </div>
      </div>
    );
  }

  // ─── Création partenaire ────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');

    if (!auth || !db || !isFirebaseConfigured) {
      setError(t('setup_partner_err_firebase'));
      return;
    }
    if (!formData.email.trim() || !formData.password || !formData.displayName.trim()) {
      setError(t('setup_partner_err_missing_fields'));
      return;
    }
    if (formData.password.length < 6) {
      setError(t('setup_partner_err_password_short'));
      return;
    }

    setLoading(true);
    try {
      setStatus(t('setup_partner_status_creating_auth'));
      const cred = await createUserWithEmailAndPassword(
        auth,
        formData.email.trim(),
        formData.password,
      );
      await updateProfile(cred.user, { displayName: formData.displayName.trim() });
      const uid = cred.user.uid;

      setStatus(t('setup_partner_status_creating_partner'));
      const partnerId = `partner-${uid}`;
      await setDoc(
        doc(db, 'partners', partnerId),
        {
          partnerId,
          name: formData.displayName.trim(),
          email: formData.email.trim(),
          phone: '',
          address: '',
          city: formData.city,
          canton: formData.canton,
          geoPoint: new GeoPoint(46.2044, 6.1432),
          type: 'studio',
          description: '',
          logo: '',
          images: [],
          subscriptionStatus: 'active',
          subscriptionEnd: null,
          monthlyFee: 0,
          promoCode: '',
          referralId: '',
          isApproved: true,
          isActive: true,
          totalBookings: 0,
          totalRevenue: 0,
          rating: 0,
          reviewCount: 0,
          iban: formData.iban.trim(),
          ibanHolder: formData.ibanHolder.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setStatus(t('setup_partner_status_creating_user'));
      await setDoc(
        doc(db, 'users', uid),
        {
          uid,
          displayName: formData.displayName.trim(),
          email: formData.email.trim(),
          role: 'partner',
          city: formData.city,
          isPremium: false,
          credits: 0,
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      setStatus(t('setup_partner_status_done'));
      setDone(true);
    } catch (err: unknown) {
      console.error('[Setup Partner]', err);
      const msg = err instanceof Error ? err.message : t('setup_partner_err_unknown');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold text-white mb-2">
          {t('setup_partner_title')}
        </h1>
        <p className="text-sm text-white/40 mb-6">
          {t('setup_partner_subtitle')}
        </p>

        {status && (
          <div className="mb-4 p-3 rounded-lg bg-white/5 text-sm text-white/70">
            {status}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto" />
            <p className="text-green-400 font-medium">
              {t('setup_partner_success')}
            </p>
            <Link
              href="/partner/login"
              className="inline-block mt-4 px-6 py-3 bg-accent text-white rounded-full text-sm hover:bg-accent/80 transition"
            >
              {t('setup_partner_go_login')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="sp-displayName" className="text-white/70 text-sm">
                {t('setup_partner_label_name')}
              </Label>
              <Input
                id="sp-displayName"
                type="text"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData({ ...formData, displayName: e.target.value })
                }
                className="mt-1 bg-white/5 border-white/10 text-white"
                placeholder={t('setup_partner_placeholder_name')}
                disabled={loading}
                required
              />
            </div>

            <div>
              <Label htmlFor="sp-email" className="text-white/70 text-sm">
                {t('setup_partner_label_email')}
              </Label>
              <Input
                id="sp-email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="mt-1 bg-white/5 border-white/10 text-white"
                placeholder={t('setup_partner_placeholder_email')}
                disabled={loading}
                required
              />
            </div>

            <div>
              <Label htmlFor="sp-password" className="text-white/70 text-sm">
                {t('setup_partner_label_password')}
              </Label>
              <Input
                id="sp-password"
                type="password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="mt-1 bg-white/5 border-white/10 text-white"
                placeholder={t('setup_partner_placeholder_password')}
                disabled={loading}
                required
                minLength={6}
              />
            </div>

            <div>
              <Label htmlFor="sp-iban" className="text-white/70 text-sm">
                {t('setup_partner_label_iban')}
              </Label>
              <Input
                id="sp-iban"
                type="text"
                value={formData.iban}
                onChange={(e) =>
                  setFormData({ ...formData, iban: e.target.value })
                }
                className="mt-1 bg-white/5 border-white/10 text-white"
                placeholder={t('setup_partner_placeholder_iban')}
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="sp-iban-holder" className="text-white/70 text-sm">
                {t('setup_partner_label_iban_holder')}
              </Label>
              <Input
                id="sp-iban-holder"
                type="text"
                value={formData.ibanHolder}
                onChange={(e) =>
                  setFormData({ ...formData, ibanHolder: e.target.value })
                }
                className="mt-1 bg-white/5 border-white/10 text-white"
                placeholder={t('setup_partner_placeholder_iban_holder')}
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-accent hover:bg-accent/80 text-white rounded-full"
            >
              {loading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              {t('setup_partner_submit')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
