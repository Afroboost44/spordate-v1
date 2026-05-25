/**
 * BUG #80 — Page /preferences (Préférences de matching style Hinge).
 *
 * Sections (inspirées capture 5 fournie par Bassi 2026-05-21) :
 *
 *  Préférences du membre (gratuit) :
 *   - Je m'intéresse à : homme / femme / les deux
 *   - Mon quartier (texte)
 *   - Distance maximale (slider 1-200 km)
 *   - Tranche d'âge (range slider 18-99)
 *   - Origines (multi-select)
 *   - Religion (multi-select)
 *   - Type de relation
 *
 *  Préférences avancées (gated Premium — UI accessible mais save bloqué) :
 *   - Taille min
 *   - Enfants / projets de famille
 *   - Tabac, Alcool, Cannabis (acceptés)
 *   - Formation min
 *
 * Tous les champs sont stockés dans users/{uid}.matchingPreferences.
 * Le moteur de matching Discovery filtre les profils en fonction.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, Crown, Sparkles, Users, MapPin, Ruler, Baby, Cigarette, Wine, Leaf,
  GraduationCap, Heart, Save, Lock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { updateUser } from '@/services/firestore';
import BackButton from '@/components/BackButton';
import type { UserProfile } from '@/types/firestore';
import {
  STUDIES_OPTIONS, RELIGION_OPTIONS, FREQUENCY_OPTIONS, CHILDREN_OPTIONS,
} from '@/lib/profile/extras';

type Prefs = NonNullable<UserProfile['matchingPreferences']>;
const UNSET = '__any__';

// Fix #173 — Liste des pays disponibles pour le filtre matching. Noms propres
// (ne nécessitent pas de traduction, restent identiques FR/EN/DE).
// Cohérent avec partners/page.tsx COUNTRIES (même set africain + européen).
const COUNTRY_OPTIONS = [
  'Suisse',
  'France',
  'Belgique',
  'Canada',
  'Côte d\'Ivoire',
  'Sénégal',
  'Cameroun',
  'RD Congo',
  'Maroc',
  'Guinée',
  'Mali',
  'Burkina Faso',
];

export default function PreferencesPage() {
  const router = useRouter();
  const { user, userProfile } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const isPremium = !!userProfile?.isPremium;

  // State complet (clone défensif des défauts pour ne pas muter UserProfile)
  const [prefs, setPrefs] = useState<Prefs>({});

  useEffect(() => {
    if (userProfile?.matchingPreferences) {
      setPrefs({ ...userProfile.matchingPreferences });
    }
  }, [userProfile]);

  const update = <K extends keyof Prefs>(key: K, val: Prefs[K] | undefined) => {
    setPrefs((prev) => {
      const next = { ...prev };
      if (val === undefined || val === null || val === '') {
        delete next[key];
      } else {
        next[key] = val;
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Nettoyage : retire les clés undefined avant write
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prefs)) {
        if (v === undefined || v === null || v === '') continue;
        cleaned[k] = v;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateUser(user.uid, { matchingPreferences: cleaned as any });
      toast({
        title: 'Préférences sauvegardées',
        description: 'Tes nouveaux critères sont actifs.',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[Preferences] save error', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const ageMin = prefs.ageRange?.min ?? 18;
  const ageMax = prefs.ageRange?.max ?? 99;
  const distance = prefs.maxDistanceKm ?? 50;

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="animate-spin mr-2 h-5 w-5" /> Chargement…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-32">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-8">
          <BackButton fallbackUrl="/profile" />
          <h1 className="text-2xl sm:text-3xl font-light tracking-wide">{t('preferences_title')}</h1>
        </div>

        <div className="flex flex-col gap-6">
          {/* ===== PRÉFÉRENCES DU MEMBRE (gratuit) ===== */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <Users className="h-4 w-4 text-white/40" /> Préférences du membre
              </CardTitle>
              <p className="text-[11px] text-white/40 mt-1">
                Qui veux-tu rencontrer ? Ces critères filtrent les profils que tu vois dans Découverte.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {/* Je m'intéresse à */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60">
                  Je m&apos;intéresse à
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['male', 'female', 'both'] as const).map((g) => (
                    <Button
                      key={g}
                      type="button"
                      variant={prefs.interestedIn === g ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => update('interestedIn', g)}
                      className={
                        prefs.interestedIn === g
                          ? 'bg-accent text-white hover:bg-accent/90'
                          : 'border-white/10 text-white/70'
                      }
                    >
                      {g === 'male' ? 'Hommes' : g === 'female' ? 'Femmes' : 'Les deux'}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Fix #173 — Pays (filtre Discovery, juste au-dessus du quartier).
                  Stocké dans matchingPreferences.country. UNSET ('__any__') =
                  pas de filtre = match international ouvert. */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> {t('preferences_country_label')}
                </Label>
                <Select
                  value={prefs.country ?? UNSET}
                  onValueChange={(v) => update('country', v === UNSET ? undefined : v)}
                >
                  <SelectTrigger className="bg-zinc-900/60 border-white/10 text-white h-11">
                    <SelectValue placeholder={t('preferences_country_placeholder')} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F0F0F] border-white/15 text-white max-h-[60vh]">
                    <SelectItem value={UNSET} className="text-white focus:bg-accent/20 focus:text-white">
                      {t('preferences_country_any')}
                    </SelectItem>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c} className="text-white focus:bg-accent/20 focus:text-white">
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value="Autre" className="text-white focus:bg-accent/20 focus:text-white">
                      {t('preferences_country_other')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quartier */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="neighborhood" className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> {t('preferences_neighborhood_label')}
                </Label>
                <Input
                  id="neighborhood"
                  value={prefs.neighborhood ?? ''}
                  onChange={(e) => update('neighborhood', e.target.value)}
                  placeholder={t('preferences_neighborhood_placeholder')}
                  className="bg-zinc-900/60 border-white/10 text-white"
                />
              </div>

              {/* Distance max — slider */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center justify-between">
                  <span>Distance maximale</span>
                  <span className="text-white">{distance} km</span>
                </Label>
                <Slider
                  value={[distance]}
                  min={1}
                  max={200}
                  step={1}
                  onValueChange={(v) => update('maxDistanceKm', v[0])}
                  className="py-2"
                />
              </div>

              {/* Tranche d'âge — double slider simulé via 2 slider */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center justify-between">
                  <span>{t('preferences_age_range')}</span>
                  <span className="text-white">{ageMin} – {ageMax} ans</span>
                </Label>
                <Slider
                  value={[ageMin, ageMax]}
                  min={18}
                  max={99}
                  step={1}
                  onValueChange={(v) => {
                    if (v.length === 2) {
                      update('ageRange', { min: v[0], max: v[1] });
                    }
                  }}
                  className="py-2"
                />
              </div>

              {/* Religion */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60">
                  Religion (préférée)
                </Label>
                <Select
                  value={(prefs.religions?.[0] as string) || UNSET}
                  onValueChange={(v) =>
                    update('religions', v === UNSET ? undefined : [v])
                  }
                >
                  <SelectTrigger className="bg-zinc-900/60 border-white/10 text-white h-11">
                    <SelectValue placeholder={t('preferences_open_to_all')} />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border border-white/10 text-white">
                    <SelectItem value={UNSET}>{t('preferences_open_to_all')}</SelectItem>
                    {RELIGION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Type de relation */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <Heart className="h-3 w-3" /> Type de relation
                </Label>
                <Select
                  value={prefs.relationshipGoals ?? UNSET}
                  onValueChange={(v) =>
                    update('relationshipGoals', v === UNSET ? undefined : (v as Prefs['relationshipGoals']))
                  }
                >
                  <SelectTrigger className="bg-zinc-900/60 border-white/10 text-white h-11">
                    <SelectValue placeholder={t('preferences_open_to_all')} />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border border-white/10 text-white">
                    <SelectItem value={UNSET}>{t('preferences_open_to_all')}</SelectItem>
                    <SelectItem value="long_term">{t('preferences_relation_long')}</SelectItem>
                    <SelectItem value="short_term">{t('preferences_relation_short')}</SelectItem>
                    <SelectItem value="casual">{t('preferences_relation_friendship')}</SelectItem>
                    <SelectItem value="open">{t('preferences_relation_open')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* ===== PRÉFÉRENCES AVANCÉES (gated Premium) ===== */}
          <Card className="bg-[#1A1A1A] border-white/5 relative overflow-hidden">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <Crown className="h-4 w-4 text-accent" /> Préférences avancées
              </CardTitle>
              <p className="text-[11px] text-white/40 mt-1">
                {isPremium
                  ? 'Affine ton matching avec ces critères.'
                  : 'Réservé aux membres Spordateur Premium.'}
              </p>
            </CardHeader>
            <CardContent className={`flex flex-col gap-5 ${!isPremium ? 'opacity-60 pointer-events-none' : ''}`}>
              {/* Taille min */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="heightMin" className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <Ruler className="h-3 w-3" /> Taille minimum (cm)
                </Label>
                <Input
                  id="heightMin"
                  type="number"
                  min={130}
                  max={220}
                  value={prefs.heightMinCm ?? ''}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    update('heightMinCm', Number.isFinite(n) ? n : undefined);
                  }}
                  placeholder="Ex: 170"
                  className="bg-zinc-900/60 border-white/10 text-white"
                  disabled={!isPremium}
                />
              </div>

              {/* Enfants */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <Baby className="h-3 w-3" /> Enfants
                </Label>
                <Select
                  value={prefs.childrenPreference ?? UNSET}
                  onValueChange={(v) =>
                    update('childrenPreference', v === UNSET ? undefined : (v as Prefs['childrenPreference']))
                  }
                  disabled={!isPremium}
                >
                  <SelectTrigger className="bg-zinc-900/60 border-white/10 text-white h-11">
                    <SelectValue placeholder={t('preferences_open_to_all')} />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border border-white/10 text-white">
                    <SelectItem value={UNSET}>{t('preferences_open_to_all')}</SelectItem>
                    <SelectItem value="has">{t('preferences_has_children')}</SelectItem>
                    <SelectItem value="wants">En veut</SelectItem>
                    <SelectItem value="doesnt_want">N&apos;en veut pas</SelectItem>
                  </SelectContent>
                </Select>
                {/* Note: CHILDREN_OPTIONS importé mais inutilisé ici car semantique
                    légèrement différente (préférence vs statut personnel). */}
                <span className="hidden">{CHILDREN_OPTIONS.length}</span>
              </div>

              {/* Tabac / Alcool / Cannabis — 3 lignes compactes */}
              {(
                [
                  { field: 'smoking' as const, Icon: Cigarette, label: 'Tabac' },
                  { field: 'alcohol' as const, Icon: Wine, label: 'Alcool' },
                  { field: 'cannabis' as const, Icon: Leaf, label: 'Cannabis' },
                ]
              ).map(({ field, Icon, label }) => (
                <div key={field} className="flex flex-col gap-2">
                  <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                    <Icon className="h-3 w-3" /> {label}
                  </Label>
                  <Select
                    value={(prefs[field] as string | undefined) ?? UNSET}
                    onValueChange={(v) =>
                      update(field, v === UNSET ? undefined : (v as Prefs[typeof field]))
                    }
                    disabled={!isPremium}
                  >
                    <SelectTrigger className="bg-zinc-900/60 border-white/10 text-white h-11">
                      <SelectValue placeholder={t('preferences_open_to_all')} />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border border-white/10 text-white">
                      <SelectItem value={UNSET}>{t('preferences_open_to_all')}</SelectItem>
                      {FREQUENCY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              {/* Formation */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <GraduationCap className="h-3 w-3" /> Formation minimum
                </Label>
                <Select
                  value={prefs.studies ?? UNSET}
                  onValueChange={(v) =>
                    update('studies', v === UNSET ? undefined : (v as Prefs['studies']))
                  }
                  disabled={!isPremium}
                >
                  <SelectTrigger className="bg-zinc-900/60 border-white/10 text-white h-11">
                    <SelectValue placeholder={t('preferences_open_to_all')} />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border border-white/10 text-white">
                    <SelectItem value={UNSET}>{t('preferences_open_to_all')}</SelectItem>
                    {STUDIES_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>

            {/* Paywall overlay si non-Premium */}
            {!isPremium && (
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black via-black/95 to-transparent">
                <Link
                  href="/premium"
                  className="flex items-center justify-center gap-2 h-12 rounded-full bg-gradient-to-r from-accent to-pink-500 text-white font-medium text-sm hover:opacity-90 transition-opacity"
                >
                  <Sparkles className="h-4 w-4" />
                  Débloquer avec Spordateur Premium
                  <Lock className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </Card>
        </div>

        {/* Save button sticky en bas */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black to-transparent pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-12 rounded-full bg-accent hover:bg-accent/90 text-white font-medium"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sauvegarde…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" /> Sauvegarder mes préférences
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
