/**
 * BUG #71 — Editor pour les champs profileExtras (lifestyle + infos perso).
 *
 * Utilisé dans /profile édition. Composant contrôlé : reçoit value + onChange.
 * Mappe toutes les options des constantes profile/extras.ts vers des
 * <select> et <input> stylés cohérents avec la charte.
 *
 * Tous les champs sont optionnels. L'utilisateur peut sauvegarder vide.
 */

'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/context/LanguageContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UserProfile } from '@/types/firestore';
import {
  FREQUENCY_OPTIONS,
  CHILDREN_OPTIONS,
  STUDIES_OPTIONS,
  RELIGION_OPTIONS,
  RELATIONSHIP_GOALS_OPTIONS,
  RELATIONSHIP_STYLE_OPTIONS,
  HEIGHT_MIN_CM,
  HEIGHT_MAX_CM,
  HOMETOWN_MAX_LENGTH,
  PROFESSION_MAX_LENGTH,
  ETHNICITY_MAX_LENGTH,
} from '@/lib/profile/extras';

type Extras = NonNullable<UserProfile['profileExtras']>;

export interface ProfileExtrasEditorProps {
  value: Extras;
  onChange: (next: Extras) => void;
  disabled?: boolean;
}

const UNSET = '__unset__';

export function ProfileExtrasEditor({ value, onChange, disabled }: ProfileExtrasEditorProps) {
  const { t } = useLanguage();
  const set = <K extends keyof Extras>(key: K, v: Extras[K] | undefined) => {
    const next = { ...value };
    if (v === undefined || v === null || v === '') {
      delete next[key];
    } else {
      next[key] = v;
    }
    onChange(next);
  };

  const fieldClass = 'bg-zinc-900/60 border-white/10 text-white';
  const triggerClass = `${fieldClass} h-11`;
  const selectContentClass = 'bg-zinc-950 border border-white/10 text-white';

  return (
    <div className="flex flex-col gap-5">
      {/* Taille */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-height" className="text-xs uppercase tracking-wider text-white/60">
          {t('extras_height_label')}
        </Label>
        <Input
          id="extras-height"
          type="number"
          inputMode="numeric"
          min={HEIGHT_MIN_CM}
          max={HEIGHT_MAX_CM}
          value={value.height ?? ''}
          onChange={(e) => {
            // BUG #72 — pas de clamp PENDANT la saisie (sinon "1" devient 130
            // instantanément, l'utilisateur ne peut plus taper "172"). On
            // accepte raw, on valide à blur ou on caps via min/max HTML.
            const raw = e.target.value;
            if (raw === '') {
              set('height', undefined);
              return;
            }
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n)) {
              return; // ignore les caractères non-numériques
            }
            set('height', n);
          }}
          onBlur={(e) => {
            // Clamp uniquement à la perte de focus : si l'user a tapé 5 ou 500,
            // on le ramène à la plage valide une seule fois — non bloquant.
            const n = parseInt(e.target.value, 10);
            if (!Number.isFinite(n)) return;
            const clamped = Math.max(HEIGHT_MIN_CM, Math.min(HEIGHT_MAX_CM, n));
            if (clamped !== n) set('height', clamped);
          }}
          disabled={disabled}
          placeholder="Ex: 172"
          className={fieldClass}
        />
        <p className="text-[10px] text-white/40">
          {t('extras_height_range', { min: HEIGHT_MIN_CM, max: HEIGHT_MAX_CM })}
        </p>
      </div>

      {/* Profession */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-profession" className="text-xs uppercase tracking-wider text-white/60">
          {t('extras_profession_label')}
        </Label>
        <Input
          id="extras-profession"
          type="text"
          maxLength={PROFESSION_MAX_LENGTH}
          value={value.profession ?? ''}
          onChange={(e) => set('profession', e.target.value)}
          disabled={disabled}
          placeholder={t('extras_profession_placeholder')}
          className={fieldClass}
        />
      </div>

      {/* Ville d'origine */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-hometown" className="text-xs uppercase tracking-wider text-white/60">
          {t('extras_hometown_label')}
        </Label>
        <Input
          id="extras-hometown"
          type="text"
          maxLength={HOMETOWN_MAX_LENGTH}
          value={value.hometown ?? ''}
          onChange={(e) => set('hometown', e.target.value)}
          disabled={disabled}
          placeholder={t('extras_hometown_placeholder')}
          className={fieldClass}
        />
      </div>

      {/* Études */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">{t('extras_studies_label')}</Label>
        <Select
          value={value.studies ?? UNSET}
          onValueChange={(v) => set('studies', v === UNSET ? undefined : (v as Extras['studies']))}
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t('extras_unspecified')} />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>{t('extras_unspecified')}</SelectItem>
            {STUDIES_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Religion */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">{t('extras_religion_label')}</Label>
        <Select
          value={value.religion ?? UNSET}
          onValueChange={(v) => set('religion', v === UNSET ? undefined : (v as Extras['religion']))}
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t('extras_unspecified')} />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>{t('extras_unspecified')}</SelectItem>
            {RELIGION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Origines / Ethnicité */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-ethnicity" className="text-xs uppercase tracking-wider text-white/60">
          {t('extras_ethnicity_label')}
        </Label>
        <Input
          id="extras-ethnicity"
          type="text"
          maxLength={ETHNICITY_MAX_LENGTH}
          value={value.ethnicity ?? ''}
          onChange={(e) => set('ethnicity', e.target.value)}
          disabled={disabled}
          placeholder={t('extras_ethnicity_placeholder')}
          className={fieldClass}
        />
      </div>

      {/* Type de relation */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">{t('extras_relationship_goals_label')}</Label>
        <Select
          value={value.relationshipGoals ?? UNSET}
          onValueChange={(v) =>
            set('relationshipGoals', v === UNSET ? undefined : (v as Extras['relationshipGoals']))
          }
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t('extras_unspecified')} />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>{t('extras_unspecified')}</SelectItem>
            {RELATIONSHIP_GOALS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Style de relation */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">{t('extras_relationship_style_label')}</Label>
        <Select
          value={value.relationshipStyle ?? UNSET}
          onValueChange={(v) =>
            set('relationshipStyle', v === UNSET ? undefined : (v as Extras['relationshipStyle']))
          }
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t('extras_unspecified')} />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>{t('extras_unspecified')}</SelectItem>
            {RELATIONSHIP_STYLE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ouverture aux enfants */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">{t('extras_children_label')}</Label>
        <Select
          value={value.openToChildren ?? UNSET}
          onValueChange={(v) =>
            set('openToChildren', v === UNSET ? undefined : (v as Extras['openToChildren']))
          }
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t('extras_unspecified')} />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>{t('extras_unspecified')}</SelectItem>
            {CHILDREN_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lifestyle frequencies (alcool / tabac / cannabis / drogues) — grid 2x2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(
          [
            { field: 'alcohol', labelKey: 'extras_alcohol_label' },
            { field: 'smoking', labelKey: 'extras_smoking_label' },
            { field: 'cannabis', labelKey: 'extras_cannabis_label' },
            { field: 'drugs', labelKey: 'extras_drugs_label' },
          ] as const
        ).map(({ field, labelKey }) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wider text-white/60">{t(labelKey)}</Label>
            <Select
              value={(value[field] as string | undefined) ?? UNSET}
              onValueChange={(v) =>
                set(field, v === UNSET ? undefined : (v as Extras[typeof field]))
              }
              disabled={disabled}
            >
              <SelectTrigger className={triggerClass}>
                <SelectValue placeholder={t('extras_unspecified')} />
              </SelectTrigger>
              <SelectContent className={selectContentClass}>
                <SelectItem value={UNSET}>{t('extras_unspecified')}</SelectItem>
                {FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
