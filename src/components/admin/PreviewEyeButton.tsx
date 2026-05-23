/**
 * BUG #97/#98 — Bouton icône œil affiché à côté du switch on/off de chaque
 * carte éditeur dans /admin/manage tab Tarifs.
 *
 * Au click → dispatch un événement custom `admin-preview-toggle`. Le parent
 * admin/manage écoute pour toggle la visibilité de la mini-card d'aperçu
 * dans le panneau droit.
 *
 * Pour rester en sync avec le parent (qui pourrait toggle via un autre
 * mécanisme), CE composant écoute aussi le même événement et maintient son
 * propre état `active` local. Tous les boutons partageant le même `targetId`
 * resteront ainsi synchronisés visuellement.
 *
 * Anti-régression : si personne n'écoute, le click reste silencieux. Le
 * composant est purement client-side.
 */

'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PreviewEyeButtonProps {
  /** ID de l'aperçu cible (e.g. "preview-pack_starter"). Routed via event. */
  targetId: string;
  /** Tooltip + aria-label */
  label?: string;
  /** Force l'état actif (ignore le toggle local). Optionnel. */
  active?: boolean;
  /** Optionnel : classe additionnelle pour positionnement */
  className?: string;
}

export function PreviewEyeButton({ targetId, label = 'Voir l\'aperçu', active, className = '' }: PreviewEyeButtonProps) {
  const [localActive, setLocalActive] = useState(false);

  useEffect(() => {
    // Écoute les toggles pour rester en sync avec le parent + autres
    // instances du même targetId. Ignore les events pour d'autres IDs.
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ targetId: string }>).detail?.targetId;
      if (id === targetId) {
        setLocalActive(prev => !prev);
      }
    };
    window.addEventListener('admin-preview-toggle', handler);
    return () => window.removeEventListener('admin-preview-toggle', handler);
  }, [targetId]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('admin-preview-toggle', { detail: { targetId } }),
    );
  };

  // Si le parent passe `active` explicitement, il prend le pas sur l'état local.
  const isActive = active !== undefined ? active : localActive;
  const Icon = isActive ? Eye : EyeOff;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all flex-shrink-0 ${
        isActive
          ? 'border-accent/60 bg-accent/15 text-accent shadow-md shadow-accent/20'
          : 'border-white/10 text-white/40 hover:text-accent hover:border-accent/40 hover:bg-accent/5'
      } ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
