/**
 * Spordateur — Phase 5
 * <HeroStorySection> — Section "Notre histoire" (Tactique 7 anti-ghost-town).
 *
 * Server Component (texte éditorial statique, optimisable LCP).
 *
 * Construit la confiance avant la transaction : 2-4 paragraphes sur l'origine
 * du concept + photo héroïque optionnelle (vraie photo Afroboost). Pas de CTA
 * dans cette section (aspirational pure, on laisse les autres sections pousser
 * le violet #D91CD2).
 *
 * ⚠️ COPY OBLIGATOIRE (LCD Suisse Art. 3) : les props `title` et `paragraphs`
 * sont obligatoires — pas de default mock. Le parent DOIT injecter du copy validé
 * par Bassi avant launch. Le mock MOCK_HERO_STORY (sessions-mock.ts) contient des
 * affirmations factuelles (ex: "des dizaines de Sport Dates par mois") qui seront
 * fausses au launch et exposent à risque de publicité trompeuse. À utiliser
 * uniquement en storybook/dev/test, jamais en production UI.
 *
 * Layout adaptatif :
 * - Sans photo → 1 colonne centrée (max-w-prose pour line-length 65-75)
 * - Avec photo → grid lg:grid-cols-2, photo droite / texte gauche (desktop), stacked mobile
 * - Photo en aspect-[4/5] (portrait éditorial, distingue de l'aspect-video sessions)
 *
 * Charte stricte :
 * - Title H2 white font-light (text-3xl sm:text-4xl)
 * - Paragraphes white/80 font-light leading-relaxed (WCAG AAA ~13:1 sur black)
 * - Pas d'accent #D91CD2 (calme aspirational, ce n'est pas une CTA)
 * - Pas de border / fond → la typographie porte tout
 *
 * Accessibilité :
 * - <section aria-labelledby="hero-story-heading">
 * - <h2> (la home a son H1 ailleurs)
 * - Image alt obligatoire (interface l'impose)
 *
 * Phase 7 (planifié) :
 * - Ajout `videoSrc?: string` (vidéo intro 30s mentionnée architecture.md Tactique 7)
 * - Migration vers Firestore `settings/site` admin-éditable (au lieu d'injection prop)
 *
 * @example Copy validé par Bassi (à utiliser dans /sessions/page.tsx — diff #16) :
 *
 *   const HERO_STORY_TITLE = 'Notre histoire';
 *
 *   const HERO_STORY_PARAGRAPHS = [
 *     "Spordateur est née à Genève en 2026 d'une conviction simple : le sport est le meilleur prétexte pour faire de vraies rencontres.",
 *     "Plutôt que de scroller des profils anonymes, viens bouger en groupe, transpirer, rire — et rencontrer naturellement les gens qui partagent ton énergie.",
 *     "On commence avec Afroboost, l'origine du concept. Lausanne, Zürich et Bern arrivent au fur et à mesure que des partenaires sportifs nous rejoignent.",
 *   ];
 *
 *   const HERO_STORY_PHOTO = {
 *     src: '/past-sessions/1.jpg',
 *     alt: "Cours Afroboost Silent en plein air aux Jeunes-Rives de Neuchâtel",
 *   };
 *
 *   <HeroStorySection
 *     title={HERO_STORY_TITLE}
 *     paragraphs={HERO_STORY_PARAGRAPHS}
 *     heroPhoto={HERO_STORY_PHOTO}
 *   />
 */

import Image from 'next/image';

export interface HeroStorySectionProps {
  /** Titre. Obligatoire (ex: 'Notre histoire'). */
  title: string;
  /**
   * Paragraphes du récit. Obligatoire — le parent doit injecter le copy validé
   * par Bassi (LCD Suisse Art. 3 : éviter affirmations factuelles non vérifiables).
   * 2 à 4 paragraphes recommandés.
   */
  paragraphs: readonly string[];
  /** Photo héroïque (Afroboost réelle). Si absente, layout 1 colonne. */
  heroPhoto?: { src: string; alt: string };
  className?: string;
}

export function HeroStorySection({
  title,
  paragraphs,
  heroPhoto,
  className = '',
}: HeroStorySectionProps) {
  const hasPhoto = !!heroPhoto;

  return (
    <section
      aria-labelledby="hero-story-heading"
      className={`py-8 sm:py-12 ${className}`}
    >
      <div
        className={
          hasPhoto
            ? 'grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center'
            : 'flex justify-center'
        }
      >
        {/* Bloc texte */}
        <div
          className={
            hasPhoto
              ? 'flex flex-col gap-5'
              : 'flex flex-col gap-5 max-w-prose'
          }
        >
          <h2
            id="hero-story-heading"
            className="text-3xl sm:text-4xl text-white font-light leading-tight"
          >
            {title}
          </h2>
          <div className="flex flex-col gap-4">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-base sm:text-lg text-white/80 font-light leading-relaxed"
              >
                {p}
              </p>
            ))}
          </div>
        </div>

        {/* Bloc photo (si fourni) */}
        {hasPhoto && (
          <div className="relative aspect-[4/5] rounded-xl overflow-hidden bg-black border border-white/10 lg:order-last">
            <Image
              src={heroPhoto.src}
              alt={heroPhoto.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        )}
      </div>
    </section>
  );
}
