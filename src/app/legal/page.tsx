"use client";

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>

        <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
          Mentions Légales
        </h1>
        <p className="text-sm text-gray-500 font-light mb-10">
          Conformément à l&apos;art. 3 de la Loi fédérale contre la concurrence déloyale (LCD)
          et à l&apos;Ordonnance sur les indications de prix (OIP)
        </p>

        <div className="space-y-8 text-gray-400 font-light leading-relaxed text-[15px]">

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Éditeur du site</h2>
            <p>
              Spordate<br />
              Entreprise individuelle de droit suisse<br />
              Genève, Suisse
            </p>
            <p className="mt-3">
              E-mail : contact@spordateur.com<br />
              Site web : spordateur.com
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Représentant légal</h2>
            <p>
              Henri Bassi, fondateur et exploitant.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Hébergement</h2>
            <p>
              <span className="text-white">Application web :</span><br />
              Vercel Inc.<br />
              340 S Lemon Ave #4133<br />
              Walnut, CA 91789, États-Unis<br />
              vercel.com
            </p>
            <p className="mt-3">
              <span className="text-white">Base de données et authentification :</span><br />
              Google Cloud Platform — Firebase<br />
              Région : europe-west6 (Zurich, Suisse)<br />
              Google Ireland Limited<br />
              Gordon House, Barrow Street, Dublin 4, Irlande
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Prestataire de paiement</h2>
            <p>
              Stripe Payments Europe, Ltd.<br />
              1 Grand Canal Street Lower, Grand Canal Dock<br />
              Dublin 2, Irlande<br />
              Certification PCI DSS Level 1
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Propriété intellectuelle</h2>
            <p>
              Le nom « Spordate », le logo et l&apos;ensemble des contenus du site (textes, images,
              graphismes, vidéos, architecture, code source) sont protégés par le droit d&apos;auteur
              suisse (Loi fédérale sur le droit d&apos;auteur, LDA, RS 231.1) et les conventions
              internationales applicables. Toute reproduction, même partielle, est soumise à
              autorisation préalable.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Protection des données</h2>
            <p>
              Le traitement des données personnelles est régi par notre{' '}
              <Link href="/privacy" className="text-[#D91CD2] hover:underline">
                Politique de Confidentialité
              </Link>
              , établie conformément à la nouvelle Loi fédérale sur la protection des données
              (nLPD, RS 235.1).
            </p>
            <p className="mt-3">
              <span className="text-white">Autorité de surveillance :</span><br />
              Préposé fédéral à la protection des données et à la transparence (PFPDT)<br />
              Feldeggweg 1, 3003 Berne, Suisse<br />
              edoeb.admin.ch
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Indications sur les prix</h2>
            <p>
              Conformément à l&apos;Ordonnance sur l&apos;indication des prix (OIP, RS 942.211),
              tous les prix affichés sur la Plateforme sont indiqués en francs suisses (CHF)
              et incluent la TVA applicable. Les prix des abonnements Premium sont les suivants :
            </p>
            <p className="mt-3">
              — Premium Mensuel : CHF 19.90 / mois (renouvellement automatique)<br />
              — Premium Annuel : CHF 149.00 / an (renouvellement automatique, soit CHF 12.42 / mois)
            </p>
            <p className="mt-3">
              Les crédits Sport Date sont proposés à l&apos;unité ou en packs selon les tarifs
              affichés sur la page d&apos;achat.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Résolution des litiges</h2>
            <p>
              En cas de litige, nous encourageons l&apos;Utilisateur à nous contacter en premier lieu
              à contact@spordateur.com afin de rechercher une solution amiable. À défaut d&apos;accord,
              les tribunaux de Genève sont compétents, sous réserve des fors impératifs prévus par
              le droit suisse. Le droit suisse est applicable.
            </p>
            <p className="mt-3">
              <span className="text-white">Sanctions Trust &amp; Safety.</span> Les sanctions appliquées
              dans le cadre du système de modération privée Trust &amp; Safety (cf. CGU section 7.bis)
              ne constituent pas des décisions juridictionnelles. Elles relèvent exclusivement de la
              modération privée de Spordate. Tout Utilisateur sanctionné dispose d&apos;un droit d&apos;appel
              motivé adressé par écrit à contact@spordateur.com (1 appel par niveau de sanction,
              SLA de réponse 7 jours calendaires) avant tout recours juridictionnel.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Clause de non-responsabilité</h2>
            <p>
              Malgré le soin apporté à la rédaction du contenu de ce site, Spordate ne peut garantir
              l&apos;exactitude, la fiabilité ou l&apos;exhaustivité des informations publiées. Spordate décline
              toute responsabilité pour les dommages résultant de l&apos;utilisation ou de l&apos;impossibilité
              d&apos;utiliser les informations diffusées sur ce site, y compris en cas de perte de données
              ou de virus informatiques. Spordate se réserve le droit de modifier, compléter ou
              supprimer tout ou partie des informations publiées, sans préavis.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">Liens externes</h2>
            <p>
              La Plateforme peut contenir des liens vers des sites tiers. Spordate n&apos;exerce aucun
              contrôle sur ces sites et décline toute responsabilité quant à leur contenu, leur
              politique de confidentialité ou leurs pratiques.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-wrap gap-6 text-sm text-gray-600 font-light">
          <Link href="/terms" className="hover:text-white transition-colors">CGU</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">Politique de Confidentialité</Link>
        </div>
      </div>
    </div>
  );
}
