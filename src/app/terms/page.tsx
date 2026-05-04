"use client";

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>

        <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
          Conditions Générales d&apos;Utilisation
        </h1>
        <p className="text-sm text-gray-500 font-light mb-10">
          Dernière mise à jour : 4 mai 2026 (ajout sections 7.bis Sanctions Trust &amp; Safety + 7.ter Reviews publiques)
        </p>

        <div className="space-y-8 text-gray-400 font-light leading-relaxed text-[15px]">

          <section>
            <h2 className="text-lg text-white font-normal mb-3">1. Objet et champ d&apos;application</h2>
            <p>
              Les présentes Conditions Générales d&apos;Utilisation (« CGU ») régissent l&apos;accès et l&apos;utilisation
              de la plateforme Spordate (ci-après « la Plateforme »), accessible à l&apos;adresse spordateur.com
              et via ses applications mobiles. La Plateforme est éditée et exploitée par Spordate,
              entreprise individuelle de droit suisse dont le siège est à Genève, Suisse.
            </p>
            <p className="mt-3">
              Spordate est un service de mise en relation entre particuliers (« Utilisateurs ») souhaitant
              pratiquer des activités sportives ou de danse ensemble, ainsi qu&apos;un outil de réservation
              auprès d&apos;établissements partenaires (« Partenaires »). En accédant à la Plateforme ou
              en créant un compte, l&apos;Utilisateur accepte sans réserve les présentes CGU.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">2. Inscription et compte utilisateur</h2>
            <p>
              L&apos;inscription est ouverte à toute personne physique âgée de 18 ans révolus et domiciliée en Suisse.
              L&apos;Utilisateur s&apos;engage à fournir des informations exactes, complètes et à jour lors de son
              inscription. Chaque Utilisateur ne peut disposer que d&apos;un seul compte.
            </p>
            <p className="mt-3">
              L&apos;Utilisateur est responsable de la confidentialité de ses identifiants de connexion. Toute
              utilisation du compte est réputée effectuée par l&apos;Utilisateur lui-même. En cas de soupçon
              d&apos;utilisation non autorisée, l&apos;Utilisateur doit en informer Spordate sans délai à
              l&apos;adresse contact@spordateur.com.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">3. Services proposés</h2>
            <p>La Plateforme offre les services suivants :</p>
            <p className="mt-2">
              <span className="text-white">Matching sportif et danse</span> — Mise en relation d&apos;Utilisateurs
              partageant des activités, un niveau et une localisation compatibles.
            </p>
            <p className="mt-2">
              <span className="text-white">Crédits Sport Date</span> — Achat de crédits unitaires permettant
              d&apos;organiser des rencontres sportives.
            </p>
            <p className="mt-2">
              <span className="text-white">Abonnement Premium</span> — Formule mensuelle ou annuelle offrant
              le matching illimité, des crédits mensuels, la mise en avant du profil, le chat illimité
              et la suppression des publicités.
            </p>
            <p className="mt-2">
              <span className="text-white">Réservations partenaires</span> — Réservation de cours et espaces
              sportifs auprès d&apos;établissements partenaires référencés sur la Plateforme.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">4. Paiements et tarifs</h2>
            <p>
              Tous les prix sont indiqués en francs suisses (CHF), TVA incluse le cas échéant.
              Les paiements sont traités par Stripe, prestataire certifié PCI DSS Level 1.
              Les moyens de paiement acceptés incluent la carte bancaire, TWINT et Apple Pay.
            </p>
            <p className="mt-3">
              <span className="text-white">Crédits :</span> Les crédits achetés sont valables sans
              limitation de durée. Ils ne sont ni remboursables ni transférables.
            </p>
            <p className="mt-3">
              <span className="text-white">Abonnements Premium :</span> L&apos;abonnement est conclu pour une
              durée déterminée (mensuelle ou annuelle) et se renouvelle automatiquement à échéance sauf
              résiliation par l&apos;Utilisateur avant la date de renouvellement. La résiliation prend effet
              à la fin de la période en cours ; les crédits non utilisés restent disponibles.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">5. Droit de révocation</h2>
            <p>
              Conformément à l&apos;art. 40a ss du Code des obligations suisse (CO), l&apos;Utilisateur dispose d&apos;un
              délai de révocation de 14 jours à compter de la conclusion du contrat pour les services
              non encore utilisés. La révocation doit être communiquée par écrit à contact@spordateur.com.
              Si l&apos;Utilisateur a commencé à utiliser le service avant l&apos;expiration du délai de révocation,
              le droit de révocation est éteint.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">6. Politique d&apos;annulation des réservations</h2>
            <p>
              L&apos;Utilisateur peut annuler une réservation sans frais jusqu&apos;à 1 heure avant le début prévu
              de l&apos;activité. Passé ce délai, aucun remboursement ne sera accordé et le montant sera
              intégralement reversé au Partenaire concerné.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">7. Obligations de l&apos;Utilisateur</h2>
            <p>L&apos;Utilisateur s&apos;engage à :</p>
            <p className="mt-2">
              — Utiliser la Plateforme de manière conforme à sa destination et aux présentes CGU ;
              — Ne pas publier de contenu illicite, offensant, discriminatoire ou portant atteinte aux
              droits de tiers ;
              — Se comporter de manière respectueuse envers les autres Utilisateurs et Partenaires
              (interdiction de harcèlement sexuel, comportement agressif ou irrespectueux, fake profile,
              substances ou état problématique pendant les sessions) ;
              — Honorer ses réservations (l&apos;absence sans excuse préalable constitue un no-show
              susceptible de sanctions, cf. section 7.bis) ;
              — Ne pas utiliser la Plateforme à des fins commerciales non autorisées ;
              — Disposer d&apos;une assurance personnelle couvrant la pratique sportive.
            </p>
            <p className="mt-3">
              Spordate se réserve le droit de suspendre ou supprimer tout compte contrevenant
              aux présentes CGU, sans préavis ni indemnité, dans le cadre du système de sanctions
              décrit en section 7.bis ci-dessous.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">7.bis Système de signalements et sanctions Trust &amp; Safety</h2>
            <p>
              <span className="text-white">Reports formels (anonymes).</span> Tout Utilisateur ayant
              participé à une même session peut signaler un autre participant pour l&apos;un des motifs
              structurés suivants : harcèlement sexuel, comportement agressif, fake profile, substance
              ou état problématique, no-show, autre (texte libre obligatoire). Les signalements sont
              traités par notre équipe modération de manière strictement confidentielle.
              L&apos;identité du signalant n&apos;est jamais communiquée au signalé (protection lanceur
              d&apos;alerte). Délai max de signalement : 30 jours après la session concernée.
            </p>
            <p className="mt-3">
              <span className="text-white">Workflow de sanctions automatisées (rolling 12 mois).</span>{' '}
              Pour limiter le bruit et les abus, les seuils suivants déclenchent des actions automatiques :
              1 signalement = revue humaine sans action automatique ;
              2 signalements indépendants = suspension automatique 7 jours pendant la revue humaine ;
              3+ signalements indépendants = suspension automatique 30 jours et revue prioritaire ;
              en cas de récidive avérée ou faits graves = bannissement permanent.
              Limite anti-abus : 3 signalements émis maximum par Utilisateur et par jour.
              Les motifs no-show suivent un workflow distinct (rolling 90 jours :
              1 = avertissement, 2 = avertissement + flag, 3 = suspension 30j + remboursement Partenaire,
              4+ = ban permanent).
            </p>
            <p className="mt-3">
              <span className="text-white">Workflow de bannissement progressif.</span>{' '}
              Quatre niveaux de sanction sont appliqués selon la gravité et la récurrence : avertissement
              (flag interne, pas de restriction), suspension 7 jours, suspension 30 jours
              (avec interdiction de re-création de compte avec le même e-mail), bannissement permanent.
              Toute sanction est notifiée à l&apos;Utilisateur par e-mail mentionnant la catégorie du
              signalement (sans nom de signalant), la durée, la date de fin (si suspension) et le
              mécanisme d&apos;appel.
            </p>
            <p className="mt-3">
              <span className="text-white">Droit d&apos;appel (1× par niveau de sanction).</span>{' '}
              L&apos;Utilisateur sanctionné dispose d&apos;un droit d&apos;appel exerçable une seule fois par
              niveau de sanction. L&apos;appel se formule par écrit à <span className="text-[#D91CD2]">contact@spordateur.com</span>{' '}
              en répondant à l&apos;e-mail de notification, en exposant les motifs détaillés et les
              éléments contradictoires. Délai de réponse de notre équipe modération : 7 jours
              calendaires (SLA Phase 7 ; 48 heures à terme avec équipe modération étendue).
              Les bannissements permanents font l&apos;objet d&apos;une revue annuelle automatique
              (protection des victimes contre la réinsertion prématurée du sanctionné).
            </p>
            <p className="mt-3">
              <span className="text-white">Procédure équitable (nLPD Art. 19, LCD Art. 3).</span>{' '}
              Toute décision de sanction est motivée, notifiée par écrit, susceptible d&apos;appel
              (1 × par niveau) et révisable par décision humaine. Spordate s&apos;engage à un
              traitement transparent, proportionné et non-discriminatoire des signalements.
            </p>
            <p className="mt-3">
              <span className="text-white">Liste de blocage personnelle (block list).</span>{' '}
              Tout Utilisateur peut bloquer un autre Utilisateur depuis son profil, une session
              ou le chat. Le blocage rend les deux comptes mutuellement invisibles
              (sessions, profils, chats). Aucune notification n&apos;est envoyée à la personne
              bloquée. Le blocage est réversible à tout moment depuis /profile/blocks et n&apos;est
              soumis à aucune limite numérique.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">7.ter Reviews publiques (notation post-session)</h2>
            <p>
              Tout Utilisateur ayant participé à une même session peut publier, dans une fenêtre de
              <span className="text-white"> 24 heures à 7 jours après la session</span>, une review qualitative
              comprenant une note de 1 à 5 étoiles et un commentaire optionnel. Le délai de 24 heures
              constitue un cooling-off anti-impulsion à chaud. Au-delà de 7 jours, la review n&apos;est
              plus possible.
            </p>
            <p className="mt-3">
              <span className="text-white">Anonymisation graduée selon la note.</span>{' '}
              Les reviews 5, 4 et 3 étoiles sont publiées de manière nominative (avatar et prénom du
              reviewer affichés). Les reviews 2 et 1 étoile sont publiées de manière{' '}
              <span className="text-white">anonymisée</span> (« Un·e participant·e ») et soumises à
              modération admin pré-publication afin de filtrer les insultes et attaques personnelles.
              Cette graduation protège l&apos;auteur du backlash potentiel d&apos;une review négative.
            </p>
            <p className="mt-3">
              <span className="text-white">Édition et suppression.</span> L&apos;Utilisateur peut éditer
              ou supprimer ses propres reviews dans une fenêtre de 24 heures après publication.
              Au-delà, la review est figée pour préserver l&apos;intégrité historique. Les reviews
              de représailles (review négative en réponse à une review négative reçue) sont détectées
              et peuvent être retirées par l&apos;équipe modération.
            </p>
            <p className="mt-3">
              <span className="text-white">Reviews optionnelles, jamais bloquantes.</span> Aucune
              fonctionnalité de la Plateforme n&apos;est conditionnée à la rédaction d&apos;une review.
              Pour encourager les reviews, un bonus de 5 crédits chat est offert pour toute review
              écrite après session.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">8. Limitation de responsabilité</h2>
            <p>
              Spordate agit exclusivement en qualité d&apos;intermédiaire technique. La Plateforme ne
              garantit ni la qualité des activités proposées par les Partenaires, ni la compatibilité
              effective entre Utilisateurs. Spordate décline toute responsabilité en cas d&apos;accident,
              de blessure ou de dommage survenant lors de la pratique d&apos;une activité sportive.
              La responsabilité de Spordate est dans tous les cas limitée au montant effectivement
              payé par l&apos;Utilisateur au cours des 12 derniers mois.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">9. Propriété intellectuelle</h2>
            <p>
              L&apos;ensemble des éléments de la Plateforme (marques, logos, textes, images, code source)
              sont la propriété exclusive de Spordate ou de ses partenaires et sont protégés par le
              droit suisse et les conventions internationales. Toute reproduction, représentation ou
              exploitation non autorisée est strictement interdite.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">10. Protection des données</h2>
            <p>
              Le traitement des données personnelles est régi par notre{' '}
              <Link href="/privacy" className="text-[#D91CD2] hover:underline">
                Politique de Confidentialité
              </Link>
              , établie conformément à la Loi fédérale sur la protection des données (nLPD, RS 235.1)
              entrée en vigueur le 1er septembre 2023.
            </p>
            <p className="mt-3">
              <span className="text-white">Sous-traitants (nLPD Art. 9, RGPD Art. 28).</span> Spordate
              recourt à des sous-traitants pour assurer le fonctionnement de la Plateforme : Stripe
              (paiements, États-Unis), Vercel (hébergement web, États-Unis), Firebase / Google Cloud
              (base de données, stockage, authentification, eur3 Frankfurt), Hostinger (mailbox
              contact@spordateur.com, Lituanie UE), Resend (e-mails transactionnels, États-Unis).
              La liste détaillée et les finalités de chaque sous-traitant figurent dans la Politique
              de Confidentialité, section 5.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">11. Modification des CGU</h2>
            <p>
              Spordate se réserve le droit de modifier les présentes CGU à tout moment. Les modifications
              seront notifiées aux Utilisateurs par e-mail ou notification in-app au moins 30 jours avant
              leur entrée en vigueur. La poursuite de l&apos;utilisation de la Plateforme après l&apos;entrée en
              vigueur des modifications vaut acceptation des nouvelles CGU.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">12. Droit applicable et for juridique</h2>
            <p>
              Les présentes CGU sont soumises au droit suisse, à l&apos;exclusion des règles de conflit
              de lois. Tout litige découlant de l&apos;utilisation de la Plateforme sera soumis à la
              compétence exclusive des tribunaux de Genève, Suisse, sous réserve des fors impératifs
              prévus par la loi.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">13. Contact</h2>
            <p>
              Pour toute question relative aux présentes CGU, veuillez contacter :
            </p>
            <p className="mt-2 text-white">
              Spordate — contact@spordateur.com
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-wrap gap-6 text-sm text-gray-600 font-light">
          <Link href="/privacy" className="hover:text-white transition-colors">Politique de Confidentialité</Link>
          <Link href="/legal" className="hover:text-white transition-colors">Mentions Légales</Link>
        </div>
      </div>
    </div>
  );
}
