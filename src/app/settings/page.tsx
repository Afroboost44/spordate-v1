/**
 * BUG #80 — Page /settings (Paramètres complets style Hinge).
 *
 * Sections (inspirées des captures Hinge fournies par Bassi 2026-05-21) :
 *  - Profil : Pause profil, Statut actif visible
 *  - Notifications : Push (lien) + Emails (toggle)
 *  - Langue : sélecteur FR/EN/DE
 *  - Comptes connectés : Google si linked
 *  - Mentions légales : CGU, Confidentialité, Préférences confidentialité
 *  - Compte : Déconnexion + Supprimer mon compte (RGPD Art.17)
 *
 * Tous les toggles écrivent dans users/{uid} via updateUser (service helper).
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, PauseCircle, Eye, Bell, Mail, Languages, Link2, FileText,
  LogOut, Trash2, Loader2, ShieldCheck, ExternalLink, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { updateUser } from '@/services/firestore';
import BackButton from '@/components/BackButton';
import { PushOptInSwitch } from '@/components/profile/PushOptInSwitch';

export default function SettingsPage() {
  const router = useRouter();
  const { user, userProfile } = useAuth();
  // Fix #151 — Avant : `t` était importé puis jeté via `void _t` → la page
  // ne se traduisait JAMAIS, même après setLanguage(). On câble t() partout.
  const { language, setLanguage, t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const [isPaused, setIsPaused] = useState(false);
  const [showLastActive, setShowLastActive] = useState(true);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);

  // Hydrate depuis Firestore userProfile
  useEffect(() => {
    if (!userProfile) return;
    setIsPaused(!!userProfile.isPaused);
    // default-on (doctrine cohérente aiSuggestionsOptIn / pushNotificationsEnabled)
    setShowLastActive(userProfile.showLastActive !== false);
    setEmailNotificationsEnabled(userProfile.emailNotificationsEnabled !== false);
  }, [userProfile]);

  const persist = async (
    label: string,
    payload: Record<string, unknown>,
    optimistic: () => void,
    rollback: () => void,
  ) => {
    if (!user) return;
    setSaving(label);
    optimistic();
    try {
      await updateUser(user.uid, payload);
    } catch (err) {
      console.error('[Settings] persist error', err);
      rollback();
      toast({
        title: t('common_error'),
        description: t('settings_save_error'),
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  const togglePaused = async (next: boolean) => {
    await persist(
      'paused',
      { isPaused: next },
      () => setIsPaused(next),
      () => setIsPaused(!next),
    );
  };

  const toggleShowLastActive = async (next: boolean) => {
    await persist(
      'lastActive',
      { showLastActive: next },
      () => setShowLastActive(next),
      () => setShowLastActive(!next),
    );
  };

  const toggleEmail = async (next: boolean) => {
    await persist(
      'email',
      { emailNotificationsEnabled: next },
      () => setEmailNotificationsEnabled(next),
      () => setEmailNotificationsEnabled(!next),
    );
  };

  const handleLogout = async () => {
    const { getAuth, signOut } = await import('firebase/auth');
    const auth = getAuth();
    await signOut(auth);
    router.push('/');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="animate-spin mr-2 h-5 w-5" /> Chargement…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        {/* Header sticky avec retour */}
        <div className="flex items-center gap-3 mb-8">
          <BackButton fallbackUrl="/profile" />
          <h1 className="text-2xl sm:text-3xl font-light tracking-wide">{t('settings_title')}</h1>
        </div>

        <div className="flex flex-col gap-6">
          {/* SECTION PROFIL */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light">
                {t('settings_section_profile')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SettingRow
                Icon={PauseCircle}
                title={t('settings_pause_title')}
                subtitle={t('settings_pause_subtitle')}
                control={
                  <Switch
                    checked={isPaused}
                    onCheckedChange={togglePaused}
                    disabled={saving === 'paused'}
                  />
                }
              />
              <SettingRow
                Icon={Eye}
                title={t('settings_last_active_title')}
                subtitle={t('settings_last_active_subtitle')}
                control={
                  <Switch
                    checked={showLastActive}
                    onCheckedChange={toggleShowLastActive}
                    disabled={saving === 'lastActive'}
                  />
                }
              />
            </CardContent>
          </Card>

          {/* SECTION NOTIFICATIONS */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light">
                {t('settings_section_notifications')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* BUG #82 — PushOptInSwitch a son propre layout complet (icon + label
                  + description + Switch) → on ne le wrappe PLUS dans SettingRow
                  (qui faisait doublon de labels et cassait l'affichage). */}
              {/* Fix #125 — Pass initialEnabled depuis userProfile pour que le toggle
                  reflète la VRAIE valeur stockée en Firestore. Sans ça, le toggle
                  defaultait toujours à ON visuellement (bug de réhydratation). */}
              <PushOptInSwitch
                uid={user.uid}
                initialEnabled={userProfile?.pushNotificationsEnabled}
              />
              {/* BUG #117 — Bouton "Tester les notifications push" pour valider
                  rapidement la chaîne FCM end-to-end. Si tu reçois la notif système,
                  toute la chaîne marche. Sinon, le message d'erreur indique où ça plante. */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { getAuth } = await import('firebase/auth');
                    const idToken = await getAuth().currentUser?.getIdToken();
                    if (!idToken) {
                      toast({ variant: 'destructive', title: 'Non connecté' });
                      return;
                    }
                    const res = await fetch('/api/test-push', {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${idToken}` },
                    });
                    const data = await res.json();
                    if (data.ok) {
                      toast({
                        title: 'Push envoyée ✓',
                        description: 'Vérifie ton écran d\'accueil. Si rien n\'apparaît, désactive puis réactive le toggle au-dessus.',
                        className: 'bg-zinc-900 border-accent/40 text-white',
                      });
                    } else {
                      const reasonMsg: Record<string, string> = {
                        'no-token': 'Aucun token enregistré. Active le toggle push au-dessus.',
                        'opt-out': 'Les push sont désactivées. Active le toggle.',
                        'token-invalid': 'Token périmé. Désactive puis réactive le toggle.',
                        'fcm-fail': 'Échec côté Firebase. Vérifie ta connexion.',
                        'db-error': 'Erreur Firestore. Réessaie dans un instant.',
                      };
                      toast({
                        variant: 'destructive',
                        title: 'Test échoué',
                        description: reasonMsg[data.reason] || `Raison: ${data.reason}`,
                      });
                    }
                  } catch (err) {
                    toast({ variant: 'destructive', title: 'Erreur', description: err instanceof Error ? err.message : 'unknown' });
                  }
                }}
                className="w-full h-11 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-light hover:bg-accent/10 hover:border-accent/50 transition-colors"
              >
                {t('settings_push_test_button')}
              </button>
              <SettingRow
                Icon={Mail}
                title={t('settings_emails_title')}
                subtitle={t('settings_emails_subtitle')}
                control={
                  <Switch
                    checked={emailNotificationsEnabled}
                    onCheckedChange={toggleEmail}
                    disabled={saving === 'email'}
                  />
                }
              />
            </CardContent>
          </Card>

          {/* SECTION LANGUE */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <Languages className="h-4 w-4 text-white/40" /> {t('settings_section_language')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { code: 'fr' as const, label: 'Français' },
                    { code: 'en' as const, label: 'English' },
                    { code: 'de' as const, label: 'Deutsch' },
                  ]
                ).map((opt) => (
                  <Button
                    key={opt.code}
                    type="button"
                    variant={language === opt.code ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLanguage(opt.code)}
                    className={
                      language === opt.code
                        ? 'bg-accent text-white hover:bg-accent/90'
                        : 'border-white/10 text-white/70'
                    }
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* SECTION COMPTES CONNECTÉS */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <Link2 className="h-4 w-4 text-white/40" /> {t('settings_section_connected_accounts')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white/80">Google</span>
                  {user.providerData?.some((p) => p.providerId === 'google.com') ? (
                    <span className="text-[10px] uppercase tracking-wider bg-green-500/10 border border-green-500/30 text-green-400 px-2 py-0.5 rounded-full">
                      {t('settings_google_connected')}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-white/40 px-2 py-0.5 rounded-full">
                      {t('settings_google_not_connected')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/40">{user.email}</p>
              </div>
            </CardContent>
          </Card>

          {/* SECTION MENTIONS LÉGALES */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <FileText className="h-4 w-4 text-white/40" /> {t('settings_section_legal')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <LegalLink href="/privacy" label={t('settings_legal_privacy')} />
              <LegalLink href="/terms" label={t('settings_legal_terms')} />
              <LegalLink href="/legal" label={t('settings_legal_legal')} />
            </CardContent>
          </Card>

          {/* SECTION COMPTE — Déconnexion + Suppression */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-white/40" /> {t('settings_section_account')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 h-11 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/30 transition-colors text-sm font-light"
              >
                <LogOut className="h-4 w-4" />
                {t('settings_logout_button')}
              </button>
              <Link
                href="/profile/delete"
                className="flex items-center justify-center gap-2 h-11 rounded-xl border border-red-500/20 text-red-400 hover:text-red-300 hover:border-red-500/40 transition-colors text-sm font-light"
              >
                <Trash2 className="h-4 w-4" />
                {t('settings_delete_account')}
              </Link>
              <p className="text-[11px] text-white/30 leading-relaxed text-center pt-1">
                {t('settings_legal_notice')}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Sous-composants
// =====================================================================

function SettingRow({
  Icon,
  title,
  subtitle,
  control,
}: {
  Icon: typeof PauseCircle;
  title: string;
  subtitle: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-full bg-white/5 p-2 shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-white/60" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-[11px] text-white/40 leading-relaxed mt-0.5">{subtitle}</p>
      </div>
      <div className="shrink-0 mt-0.5">{control}</div>
    </div>
  );
}

function LegalLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 py-2 text-sm text-white/70 hover:text-white transition-colors"
    >
      <span>{label}</span>
      <ExternalLink className="h-3.5 w-3.5 text-white/30" aria-hidden="true" />
    </Link>
  );
}
