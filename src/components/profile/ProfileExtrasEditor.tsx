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
          Taille (cm)
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
          Entre {HEIGHT_MIN_CM} et {HEIGHT_MAX_CM} cm
        </p>
      </div>

      {/* Profession */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-profession" className="text-xs uppercase tracking-wider text-white/60">
          Profession
        </Label>
        <Input
          id="extras-profession"
          type="text"
          maxLength={PROFESSION_MAX_LENGTH}
          value={value.profession ?? ''}
          onChange={(e) => set('profession', e.target.value)}
          disabled={disabled}
          placeholder="Ex: Indépendante dans la santé"
          className={fieldClass}
        />
      </div>

      {/* Ville d'origine */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-hometown" className="text-xs uppercase tracking-wider text-white/60">
          Ville d&apos;origine
        </Label>
        <Input
          id="extras-hometown"
          type="text"
          maxLength={HOMETOWN_MAX_LENGTH}
          value={value.hometown ?? ''}
          onChange={(e) => set('hometown', e.target.value)}
          disabled={disabled}
          placeholder="Ex: Bâle"
          className={fieldClass}
        />
      </div>

      {/* Études */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">Études</Label>
        <Select
          value={value.studies ?? UNSET}
          onValueChange={(v) => set('studies', v === UNSET ? undefined : (v as Extras['studies']))}
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="Non précisé" />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>Non précisé</SelectItem>
            {STUDIES_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Religion */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">Religion / Spiritualité</Label>
        <Select
          value={value.religion ?? UNSET}
          onValueChange={(v) => set('religion', v === UNSET ? undefined : (v as Extras['religion']))}
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="Non précisé" />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>Non précisé</SelectItem>
            {RELIGION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Origines / Ethnicité */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extras-ethnicity" className="text-xs uppercase tracking-wider text-white/60">
          Origines (libre)
        </Label>
        <Input
          id="extras-ethnicity"
          type="text"
          maxLength={ETHNICITY_MAX_LENGTH}
          value={value.ethnicity ?? ''}
          onChange={(e) => set('ethnicity', e.target.value)}
          disabled={disabled}
          placeholder="Ex: Sénégal, Suisse"
          className={fieldClass}
        />
      </div>

      {/* Type de relation */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">Type de relation</Label>
        <Select
          value={value.relationshipGoals ?? UNSET}
          onValueChange={(v) =>
            set('relationshipGoals', v === UNSET ? undefined : (v as Extras['relationshipGoals']))
          }
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="Non précisé" />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>Non précisé</SelectItem>
            {RELATIONSHIP_GOALS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Style de relation */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">Style de relation</Label>
        <Select
          value={value.relationshipStyle ?? UNSET}
          onValueChange={(v) =>
            set('relationshipStyle', v === UNSET ? undefined : (v as Extras['relationshipStyle']))
          }
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="Non précisé" />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>Non précisé</SelectItem>
            {RELATIONSHIP_STYLE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ouverture aux enfants */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-white/60">Ouverture aux enfants</Label>
        <Select
          value={value.openToChildren ?? UNSET}
          onValueChange={(v) =>
            set('openToChildren', v === UNSET ? undefined : (v as Extras['openToChildren']))
          }
          disabled={disabled}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="Non précisé" />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value={UNSET}>Non précisé</SelectItem>
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
            { field: 'alcohol', label: 'Alcool' },
            { field: 'smoking', label: 'Tabac' },
            { field: 'cannabis', label: 'Cannabis' },
            { field: 'drugs', label: 'Autres drogues' },
          ] as const
        ).map(({ field, label }) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wider text-white/60">{label}</Label>
            <Select
              value={(value[field] as string | undefined) ?? UNSET}
              onValueChange={(v) =>
                set(field, v === UNSET ? undefined : (v as Extras[typeof field]))
              }
              disabled={disabled}
            >
              <SelectTrigger className={triggerClass}>
                <SelectValue placeholder="Non précisé" />
              </SelectTrigger>
              <SelectContent className={selectContentClass}>
                <SelectItem value={UNSET}>Non précisé</SelectItem>
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
