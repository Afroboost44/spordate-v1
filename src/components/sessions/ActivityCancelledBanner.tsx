/**
 * BUG #3 — Banner affiché en tête de /sessions/[id] quand l'activity parente a
 * été supprimée ou désactivée par le partenaire (session orpheline).
 *
 * Wording neutre, SANS promesse de remboursement automatique (il n'existe pas
 * encore de logique de refund self-service) : on oriente vers le support.
 *
 * Server Component — pas d'interactivité. Charte stricte black / #D91CD2 / white.
 */

import { AlertTriangle } from 'lucide-react';

export function ActivityCancelledBanner() {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3.5 sm:px-5 sm:py-4"
    >
      <AlertTriangle
        className="h-5 w-5 text-accent flex-shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm sm:text-base text-white font-medium">
          Cette activité a été annulée par le partenaire.
        </p>
        <p className="text-xs sm:text-sm text-white/70 font-light leading-relaxed">
          La session n&apos;est plus réservable. Si tu avais déjà réservé, écris à{' '}
          <a
            href="mailto:support@spordateur.com"
            className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded"
          >
            support@spordateur.com
          </a>{' '}
          pour le remboursement.
        </p>
      </div>
    </div>
  );
}
