/**
 * Spordateur — Phase 5
 * <EmptyStateSessions> — État vide ou erreur sur la liste de sessions.
 *
 * Client Component ('use client') :
 * - Le variant 'error' loggue côté client (console.error → futur /api/error-log Phase 7).
 * - Le bouton "Réessayer" appelle onRetry() ou fallback window.location.reload().
 * - Le variant 'empty' n'utilise pas de hook mais bénéficie du même fichier (overhead négligeable).
 *
 * 2 variants distincts :
 *
 * | Variant | Trigger                                    | Tonalité    | CTA          |
 * |---------|--------------------------------------------|-------------|--------------|
 * | empty   | getUpcomingSessions() retourne []          | encourageante | "Me prévenir" mailto |
 * | error   | fetch échoue / Firestore error             | sobre, technique | "Réessayer" button   |
 *
 * Doctrine wording (Tactique 1 stricte — anti-ghost-town) :
 * - INTERDIT : "aucune", "vide", "0", "pas de", "rien"
 * - REQUIS sur variant 'empty' : forme aspirationnelle ("Les prochaines sessions arrivent")
 * - Le wording 'error' n'est PAS soumis à cette doctrine — il signale honnêtement une panne
 *   technique, ce qui est légitime (≠ ghost-town implicite).
 *
 * Charte stricte :
 * - Aucun rouge / orange (charte black/magenta/white). L'erreur est signalée par icône
 *   AlertCircle + wording, pas par couleur. Cohérent WCAG color-not-only.
 * - Bouton outlined #D91CD2 (cohérent WaitlistCityCard).
 * - Icône grosse h-12 w-12 white/40 (empty) ou white/60 (error).
 *
 * Accessibilité :
 * - role="status" aria-live="polite" sur 'empty' (annoncé sans interrompre)
 * - role="alert" aria-live="assertive" sur 'error' (annoncé immédiatement)
 * - Bouton retry type="button" focusable
 *
 * Usage :
 *   <EmptyStateSessions variant="empty" />
 *   <EmptyStateSessions variant="error" errorDetails="Connexion Firestore perdue" onRetry={refetch} />
 */

'use client';

import { useEffect } from 'react';
import { Calendar, AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';

const DEFAULT_CONTACT_EMAIL = 'contact@spordateur.com';

const EMPTY_MAILTO_SUBJECT = 'Me prévenir des prochaines sessions Spordateur';
const EMPTY_MAILTO_BODY =
  "Bonjour, j'aimerais être prévenu·e dès que de nouvelles sessions Spordateur sont publiées. Merci !";

export interface EmptyStateSessionsProps {
  variant: 'empty' | 'error';
  /** Détails techniques (variant='error' uniquement). Affichés en text-xs white/40 font-mono. */
  errorDetails?: string;
  /** Email pour le mailto du variant 'empty'. Défaut 'contact@spordateur.com'. */
  contactEmail?: string;
  /** Action de retry pour variant='error'. Si absente, fallback window.location.reload(). */
  onRetry?: () => void;
  className?: string;
}

export function EmptyStateSessions({
  variant,
  errorDetails,
  contactEmail = DEFAULT_CONTACT_EMAIL,
  onRetry,
  className = '',
}: EmptyStateSessionsProps) {
  // Logging variant 'error' côté client (Phase 7 path : POST /api/error-log)
  useEffect(() => {
    if (variant === 'error') {
      console.error('[Spordate] EmptyStateSessions error variant rendered', {
        errorDetails,
      });
    }
  }, [variant, errorDetails]);

  if (variant === 'empty') {
    const mailtoHref = `mailto:${contactEmail}?subject=${encodeURIComponent(EMPTY_MAILTO_SUBJECT)}&body=${encodeURIComponent(EMPTY_MAILTO_BODY)}`;

    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col items-center text-center gap-5 max-w-md mx-auto py-12 px-6 ${className}`}
      >
        <Calendar
          className="h-12 w-12 text-white/40"
          aria-hidden="true"
          strokeWidth={1.25}
        />
        <h2 className="text-xl sm:text-2xl text-white font-light leading-tight">
          Les prochaines sessions arrivent
        </h2>
        <p className="text-sm sm:text-base text-white/70 font-light leading-relaxed">
          On t&apos;avertit dès qu&apos;une nouvelle date est publiée.
        </p>
        <a
          href={mailtoHref}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-[#D91CD2] text-[#D91CD2] text-sm font-medium hover:bg-[#D91CD2] hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <span>Me prévenir</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    );
  }

  // variant === 'error'
  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex flex-col items-center text-center gap-5 max-w-md mx-auto py-12 px-6 ${className}`}
    >
      <AlertCircle
        className="h-12 w-12 text-white/60"
        aria-hidden="true"
        strokeWidth={1.25}
      />
      <h2 className="text-xl sm:text-2xl text-white font-light leading-tight">
        Impossible de charger les sessions
      </h2>
      <p className="text-sm sm:text-base text-white/70 font-light leading-relaxed">
        Une erreur réseau a interrompu le chargement. Réessaie dans un instant.
      </p>
      {errorDetails && (
        <code className="block text-xs text-white/40 font-mono break-all">
          {errorDetails}
        </code>
      )}
      <button
        type="button"
        onClick={handleRetry}
        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-[#D91CD2] text-[#D91CD2] text-sm font-medium hover:bg-[#D91CD2] hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        <span>Réessayer</span>
      </button>
    </div>
  );
}
