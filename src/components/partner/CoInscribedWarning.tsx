/**
 * Phase 7 sub-chantier 4 commit 3/4 — <CoInscribedWarning>.
 *
 * Banner partner discret informant des conflits "block list co-inscrits sur même session".
 * Doctrine §9.sexies E : *"Si déjà inscrits à une même session : warning au partner pour
 * gestion physique séparée"*.
 *
 * Render :
 *  - Si 0 conflit → return null (banner invisible quand inutile)
 *  - Sinon : banner orange (signal informatif, pas alarmiste) avec :
 *    - Icon AlertTriangle
 *    - Titre "{N} conflit(s) bloqué(s) détecté(s)"
 *    - Liste compacte conflits (max 5 affichés, "+ X autres" si plus)
 *    - Format ligne : "{sessionTitle} — {userA} ↔ {userB}"
 *
 * Tone informatif (orange/amber, pas rouge danger). Doctrine §E "anti-confrontation"
 * appliquée : on informe le partner sans nommer "qui a bloqué qui" — info "paire
 * mutuellement bloquée" suffit pour gestion physique séparée.
 *
 * Props :
 *  - partnerId : current partner uid
 *  - sessionFilter (optionnel) : si fourni, filtre conflits sur cette session précise
 *    (utile pour partner check-in page).
 */

'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { getCoInscribedConflicts, type CoInscribedConflict } from '@/lib/sessions';

const MAX_VISIBLE = 5;

function shortUid(uid: string): string {
  if (uid.length <= 10) return uid;
  return `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

function formatConflictDate(d: { toDate?: () => Date } | undefined): string {
  if (!d?.toDate) return '';
  return d.toDate().toLocaleDateString('fr-CH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface CoInscribedWarningProps {
  partnerId: string;
  /** Filtre optionnel sur sessionId précis (partner check-in page). */
  sessionFilter?: string;
  className?: string;
}

export function CoInscribedWarning({
  partnerId,
  sessionFilter,
  className = '',
}: CoInscribedWarningProps) {
  const [conflicts, setConflicts] = useState<CoInscribedConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!partnerId) {
      setConflicts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await getCoInscribedConflicts(partnerId);
        if (!cancelled) setConflicts(list);
      } catch (err) {
        if (cancelled) return;
        console.warn('[CoInscribedWarning] fetch failed (non-blocking)', err);
        setConflicts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  if (loading) return null;

  // Filtrer sur sessionId précis si fourni
  const filtered = sessionFilter
    ? conflicts.filter((c) => c.sessionId === sessionFilter)
    : conflicts;

  if (filtered.length === 0) return null;

  const visible = expanded ? filtered : filtered.slice(0, MAX_VISIBLE);
  const hiddenCount = filtered.length - visible.length;
  const canExpand = filtered.length > MAX_VISIBLE;

  const title =
    sessionFilter && filtered.length > 0
      ? `${filtered.length} conflit${filtered.length > 1 ? 's' : ''} bloqué${filtered.length > 1 ? 's' : ''} sur cette session`
      : `${filtered.length} conflit${filtered.length > 1 ? 's' : ''} bloqué${filtered.length > 1 ? 's' : ''} dans tes prochaines sessions`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-amber-200 font-medium">{title}</p>
          <p className="text-xs text-amber-200/70 font-light mt-0.5 mb-2">
            Pour gestion physique séparée — les paires mutuellement bloquées partagent une session.
          </p>
          <ul className="flex flex-col gap-1 text-xs text-amber-100/90 font-light">
            {visible.map((c, idx) => (
              <li
                key={`${c.sessionId}_${c.userA}_${c.userB}_${idx}`}
                className="flex items-center gap-2 flex-wrap"
              >
                <span className="text-amber-300/80">
                  {c.sessionTitle || 'Session'} — {formatConflictDate(c.startAt)}
                </span>
                <span className="font-mono text-[10px] text-amber-200/60">
                  {shortUid(c.userA)} ↔ {shortUid(c.userB)}
                </span>
              </li>
            ))}
          </ul>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-amber-300 hover:text-amber-200 mt-2 flex items-center gap-1 font-light"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Réduire
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> + {hiddenCount} autre{hiddenCount > 1 ? 's' : ''}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
