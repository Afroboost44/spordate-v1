/**
 * Spordateur — Phase 5
 * <WaitlistCityCard> — Carte d'expansion par ville (Tactique 4 + 6 anti-ghost-town).
 *
 * Server Component (zéro JS, accessible nativement, pas de hydration cost).
 *
 * Affiche :
 * - Ville (MapPin + nom en relief)
 * - Date attendue ("Sessions prévues : Été 2026")
 * - Compteur d'intérêt optionnel ("23 membres intéressés")
 * - CTA "Me notifier" → mailto: contact@spordateur.com pré-rempli
 *
 * Décision wording : pas de mot "Bientôt" en gros (effet inverse "rien ici"). À la
 * place, on met en relief la date attendue + le compteur d'intérêt qui transforme
 * la promesse en signal de demande organique.
 *
 * CTA stratégie Phase 5 : <a href="mailto:..."> avec sujet + corps pré-remplis.
 * Marche zéro-JS, accessible, fonctionnel dès le launch sans backend.
 *
 * Phase 7 migration (planifiée) : remplacer mailto par <form action="/api/waitlist">
 * POST qui écrit dans Firestore collection `waitlistSignups/{signupId}` { city, email,
 * createdAt }. La signature props ne changera pas (compatibilité ascendante garantie).
 *
 * Charte stricte :
 * - Bouton outlined accent #D91CD2 (CTA secondaire — distingue du "Réserver" plein violet)
 * - Hover : fill #D91CD2 + text-black (transition-colors, pas de scale → reduced-motion)
 * - focus-visible:ring-2 ring-[#D91CD2] cohérent avec ReserveButton
 *
 * Accessibilité :
 * - <article> sémantique avec aria-labelledby (id slugifié)
 * - <h3> pour la ville (la section parent doit avoir un <h2>)
 * - Compteur en tabular-nums (cohérent avec InterestCounter / SpotsIndicator)
 *
 * Usage :
 *   <WaitlistCityCard city="Lausanne" expectedDate="Été 2026" interested={23} />
 *   <WaitlistCityCard city="Zürich" expectedDate="Automne 2026" />  // sans counter
 *   <WaitlistCityCard ... contactEmail="hello@partner.ch" />        // override email
 */

import { MapPin, Calendar, Users, ArrowRight } from 'lucide-react';

const DEFAULT_CONTACT_EMAIL = 'contact@spordateur.com';

export interface WaitlistCityCardProps {
  /** Nom de la ville (ex: 'Lausanne'). */
  city: string;
  /** Étiquette de phase d'expansion (ex: 'Été 2026'). */
  expectedDate: string;
  /** Compteur d'intérêt mocké/réel. Si fourni et >0, affiché. */
  interested?: number;
  /** Email destinataire pour le mailto. Défaut 'contact@spordateur.com'. */
  contactEmail?: string;
  /** Si false, masque le compteur "interested" même s'il est fourni. Défaut true. */
  showInterested?: boolean;
  className?: string;
}

/**
 * Slugifie un nom de ville pour usage dans les ids ARIA.
 * "Zürich" → "zurich", "Bern" → "bern", "Saint-Gall" → "saint-gall".
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function WaitlistCityCard({
  city,
  expectedDate,
  interested,
  contactEmail = DEFAULT_CONTACT_EMAIL,
  showInterested = true,
  className = '',
}: WaitlistCityCardProps) {
  const headingId = `waitlist-${slugify(city)}-heading`;
  const dateDescId = `waitlist-${slugify(city)}-date`;

  // Mailto pré-rempli (subject + body encodés)
  const subject = `Notify-me — Sessions Spordate ${city}`;
  const body = `Bonjour,\n\nJe souhaite être notifié(e) dès qu'une session Spordate s'ouvre à ${city} (prévu ${expectedDate}).\n\nMerci.`;
  const mailtoHref = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const showCounter =
    showInterested && typeof interested === 'number' && interested > 0;

  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-5 ${className}`}
      aria-labelledby={headingId}
    >
      {/* Ville */}
      <h3
        id={headingId}
        className="flex items-center gap-2 text-lg text-white font-medium leading-tight"
      >
        <MapPin
          className="h-5 w-5 text-[#D91CD2] flex-shrink-0"
          aria-hidden="true"
        />
        <span>{city}</span>
      </h3>

      {/* Date attendue */}
      <div id={dateDescId} className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-light">
          Sessions prévues
        </span>
        <p className="flex items-center gap-2 text-sm text-white font-light">
          <Calendar
            className="h-4 w-4 text-[#D91CD2] flex-shrink-0"
            aria-hidden="true"
          />
          <span>{expectedDate}</span>
        </p>
      </div>

      {/* Compteur d'intérêt (optionnel, affiché uniquement si > 0) */}
      {showCounter && (
        <p className="flex items-center gap-2 text-sm text-white/70 font-light">
          <Users
            className="h-4 w-4 text-[#D91CD2] flex-shrink-0"
            aria-hidden="true"
          />
          <span>
            <span className="text-white font-medium tabular-nums">
              {interested}
            </span>{' '}
            {interested === 1 ? 'membre intéressé' : 'membres intéressés'}
          </span>
        </p>
      )}

      {/* CTA Me notifier */}
      <a
        href={mailtoHref}
        aria-describedby={dateDescId}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#D91CD2] text-[#D91CD2] text-sm font-medium hover:bg-[#D91CD2] hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <span>Me notifier</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </article>
  );
}
