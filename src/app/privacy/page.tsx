"use client";

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>

        <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
          Politique de Confidentialité
        </h1>
        <p className="text-sm text-gray-500 font-light mb-10">
          Dernière mise à jour : 4 mai 2026 (refonte sections 2 / 5 / 7 / 8 — données T&amp;S, sous-traitants Hostinger+Resend, conservation, droits)
        </p>

        <div className="space-y-8 text-gray-400 font-light leading-relaxed text-[15px]">

          <section>
            <p>
              La présente Politique de Confidentialité décrit comment Spordate (ci-après « nous »,
              « notre » ou « Spordate ») collecte, utilise, conserve et protège vos données personnelles
              conformément à la Loi fédérale sur la protection des données (nLPD, RS 235.1) et, dans
              la mesure applicable, au Règlement général sur la protection des données (RGPD) de
              l&apos;Union européenne.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">1. Responsable du traitement</h2>
            <p>
              Le responsable du traitement des données est :
            </p>
            <p className="mt-2">
              Spordate — Entreprise individuelle<br />
              Genève, Suisse<br />
              E-mail : contact@spordateur.com
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">2. Données collectées</h2>
            <p>Nous collectons les catégories de données suivantes :</p>
            <p className="mt-3">
              <span className="text-white">Données d&apos;inscription :</span> adresse e-mail, nom d&apos;affichage,
              photo de profil (facultative), mot de passe hashé. En cas de connexion via Google OAuth,
              nous recevons le nom, l&apos;e-mail et la photo de profil associés au compte Google.
            </p>
            <p className="mt-3">
              <span className="text-white">Données de profil :</span> genre, ville, biographie,
              sports pratiqués, styles de danse, niveaux, photos téléchargées.
            </p>
            <p className="mt-3">
              <span className="text-white">Données d&apos;utilisation :</span> activités de matching,
              historique de réservations, messages échangés via le chat.
            </p>
            <p className="mt-3">
              <span className="text-white">Données de paiement :</span> les informations de paiement
              (carte bancaire, TWINT) sont traitées exclusivement par notre prestataire Stripe Inc.
              Spordate ne stocke aucune donnée de carte bancaire. Nous conservons uniquement les
              identifiants de transaction, montants et dates.
            </p>
            <p className="mt-3">
              <span className="text-white">Données techniques :</span> adresse IP, type de navigateur,
              système d&apos;exploitation, pages consultées, horodatages — collectées automatiquement via
              des cookies techniques nécessaires au fonctionnement du service.
            </p>
            <p className="mt-3">
              <span className="text-white">Données Trust &amp; Safety (Phase 7) :</span> signalements
              émis et reçus (motif, date, statut), reviews publiées (note, commentaire, date), historique
              des sanctions appliquées, traces d&apos;audit administratif (collection adminActions —
              identifiant admin, action, motif, horodatage). En cas de bannissement permanent, un
              enregistrement Banlist (hash anonymisé du compte + raison + date + drapeau de non-recréation)
              est conservé indéfiniment pour empêcher le contournement par création d&apos;un nouveau
              compte avec les mêmes informations d&apos;identification.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">3. Finalités du traitement</h2>
            <p>Vos données sont traitées pour les finalités suivantes :</p>
            <p className="mt-2">
              — Fourniture et amélioration du service de matching sportif ;
              — Gestion de votre compte et de votre profil ;
              — Traitement des paiements et gestion des abonnements ;
              — Communication relative au service (notifications, e-mails transactionnels via Resend) ;
              — <span className="text-white">Modération et sécurité de la Plateforme</span> :
              traitement des signalements Trust &amp; Safety, application des sanctions, prévention
              du harcèlement et des comportements inappropriés, audit des décisions admin ;
              — Prévention des fraudes ;
              — Respect de nos obligations légales.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">4. Bases juridiques du traitement</h2>
            <p>Le traitement de vos données repose sur les bases juridiques suivantes (art. 31 nLPD) :</p>
            <p className="mt-2">
              — <span className="text-white">Exécution du contrat</span> : traitement nécessaire à la fourniture
              des services que vous avez souscrits ;
              — <span className="text-white">Consentement</span> : pour les données facultatives (photos, biographie)
              et les communications marketing ;
              — <span className="text-white">Intérêt légitime</span> : amélioration du service, prévention des fraudes ;
              — <span className="text-white">Obligation légale</span> : conservation des données de facturation.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">5. Hébergement et sous-traitants</h2>
            <p>Vos données sont hébergées et traitées par les prestataires (sous-traitants au sens de l&apos;art. 9 nLPD / art. 28 RGPD) suivants :</p>
            <p className="mt-3">
              <span className="text-white">Firebase / Google Cloud Platform</span> — Authentification,
              base de données Firestore (région eur3 multi-region Frankfurt), stockage de fichiers,
              Cloud Functions (région europe-west1 Belgique). Google LLC est certifié selon le
              Swiss-U.S. Data Privacy Framework. Finalité : socle technique de la Plateforme.
            </p>
            <p className="mt-3">
              <span className="text-white">Vercel Inc.</span> — Hébergement de l&apos;application web
              (États-Unis et Europe). Vercel est conforme au RGPD. Finalité : exécution du serveur
              web Next.js et des routes API.
            </p>
            <p className="mt-3">
              <span className="text-white">Stripe Inc.</span> — Traitement des paiements (États-Unis,
              Vermont). Stripe est certifié PCI DSS Level 1 et conforme au RGPD. Les données de carte
              bancaire ne transitent jamais par nos serveurs. Finalité : encaissement des sessions et
              abonnements en CHF.
            </p>
            <p className="mt-3">
              <span className="text-white">Hostinger International Ltd.</span> — Mailbox{' '}
              contact@spordateur.com (Lituanie, UE). Hostinger est conforme au RGPD. Finalité : relais
              des e-mails entrants utilisateurs (notamment les appels de sanctions T&amp;S).
            </p>
            <p className="mt-3">
              <span className="text-white">Resend.com</span> — E-mails transactionnels sortants
              (États-Unis, Delaware). Resend est conforme au RGPD et utilise des sous-traitants AWS
              (États-Unis et Europe). Finalité : envoi des notifications T&amp;S (avertissements,
              suspensions, accusés d&apos;appel), confirmations de réservation, rappels de review 48h.
              Les contenus des e-mails sont stockés temporairement (logs Resend, durée &lt; 30 jours).
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">6. Transferts internationaux</h2>
            <p>
              Certains de nos sous-traitants sont établis aux États-Unis. Ces transferts sont encadrés
              par le Swiss-U.S. Data Privacy Framework, les clauses contractuelles types (SCC) de la
              Commission européenne reconnues par le PFPDT, ou le consentement explicite de l&apos;Utilisateur.
              Nous veillons à ce que tout transfert offre un niveau de protection adéquat conformément
              aux art. 16-17 nLPD.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">7. Durée de conservation</h2>
            <p>
              Les données de profil sont conservées tant que votre compte est actif. En cas de suppression
              du compte, vos données personnelles sont effacées dans un délai de 30 jours, à l&apos;exception
              des données de facturation conservées pendant 10 ans conformément au droit commercial suisse
              (art. 958f CO) et des données nécessaires à la constatation, l&apos;exercice ou la défense de
              droits en justice.
            </p>
            <p className="mt-3">
              <span className="text-white">Durées spécifiques aux données Trust &amp; Safety
              (proportionnalité — nLPD Art. 7) :</span>
            </p>
            <p className="mt-2">
              — <span className="text-white">Reviews publiques</span> : conservation indéfinie
              sauf demande de suppression de l&apos;Utilisateur (art. 17 RGPD / nLPD) ;
              — <span className="text-white">Signalements actifs (12 derniers mois)</span> :
              conservation rolling 12 mois pour le calcul des seuils auto-sanctions ;
              — <span className="text-white">Signalements résolus</span> (warning émis, suspension
              ou ban exécuté) : 12 mois après résolution pour traçabilité audit et détection de
              récidive ;
              — <span className="text-white">Bannissements permanents — données personnelles (PII)</span> :
              24 mois (e-mail original, données de profil), puis anonymisation automatique ;
              — <span className="text-white">Bannissements permanents — enregistrement Banlist</span>
              (hash anonymisé du compte + raison + date + drapeau de non-recréation) :
              <span className="text-white"> conservation indéfinie</span> pour empêcher le
              contournement par création d&apos;un nouveau compte ; cet enregistrement ne contient
              aucune donnée personnelle identifiable après les 24 mois ;
              — <span className="text-white">Traces d&apos;audit administratif (adminActions)</span> :
              24 mois pour conformité et traçabilité des décisions de modération ;
              — <span className="text-white">Logs Resend (e-mails sortants)</span> : durée
              standard Resend (&lt; 30 jours).
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">8. Vos droits</h2>
            <p>Conformément à la nLPD, vous disposez des droits suivants :</p>
            <p className="mt-2">
              — <span className="text-white">Droit d&apos;accès</span> (art. 25 nLPD) : obtenir confirmation du
              traitement et une copie de vos données ;
              — <span className="text-white">Droit de rectification</span> : corriger vos données inexactes ;
              — <span className="text-white">Droit à l&apos;effacement</span> : demander la suppression de vos données ;
              — <span className="text-white">Droit à la portabilité</span> (art. 28 nLPD) : recevoir vos données
              dans un format structuré et couramment utilisé ;
              — <span className="text-white">Droit d&apos;opposition</span> : vous opposer au traitement fondé
              sur un intérêt légitime ;
              — <span className="text-white">Droit de retirer votre consentement</span> à tout moment.
            </p>
            <p className="mt-3">
              Pour exercer ces droits, contactez-nous à contact@spordateur.com. Nous répondrons dans
              un délai de 30 jours. En cas de désaccord, vous pouvez déposer une réclamation auprès
              du Préposé fédéral à la protection des données et à la transparence (PFPDT).
            </p>
            <p className="mt-3">
              <span className="text-white">Droit d&apos;information sur sanctions Trust &amp; Safety
              (nLPD Art. 19).</span> En cas de sanction (avertissement, suspension, bannissement),
              vous recevez par e-mail une notification motivée mentionnant la catégorie du
              signalement, la durée, la date de fin (si suspension) et le mécanisme d&apos;appel.
              L&apos;identité du signalant n&apos;est jamais communiquée (protection lanceur d&apos;alerte).
              Vous disposez d&apos;un droit d&apos;appel exerçable une seule fois par niveau de sanction
              (réponse à l&apos;e-mail ou écrit à contact@spordateur.com), avec un délai de réponse
              de notre équipe modération de 7 jours calendaires (Phase 7) — voir CGU section 7.bis.
            </p>
            <p className="mt-3">
              <span className="text-white">Droit à l&apos;effacement et anonymisation soft delete
              (RGPD Art. 17 / nLPD).</span> En cas de demande de suppression de votre compte,
              vos données personnelles sont effacées sous 30 jours conformément à la section 7.
              Les contenus relationnels nécessaires à l&apos;intégrité du système Trust &amp; Safety
              (signalements émis ou reçus, reviews publiées, traces d&apos;audit admin) sont
              <span className="text-white"> anonymisés</span> (suppression des informations
              d&apos;identification personnelle, conservation du contenu non-identifiant pour
              l&apos;intégrité historique). En Phase 7, cette anonymisation est effectuée
              manuellement par notre équipe modération sur demande ; en Phase 9, une procédure UI
              automatisée respectant les délais légaux sera mise en place.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">9. Cookies</h2>
            <p>
              La Plateforme utilise exclusivement des cookies techniques nécessaires au fonctionnement
              du service (authentification, préférences de session). Aucun cookie publicitaire ou de
              traçage n&apos;est utilisé. Aucun consentement préalable n&apos;est requis pour les cookies
              strictement nécessaires (art. 45c al. 2 LTC).
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">10. Sécurité</h2>
            <p>
              Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour
              protéger vos données contre tout accès non autorisé, modification, divulgation ou
              destruction. Cela inclut le chiffrement des données en transit (TLS) et au repos,
              l&apos;authentification renforcée, et la limitation d&apos;accès aux données selon le principe
              du besoin de connaître.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">11. Mineurs</h2>
            <p>
              La Plateforme est réservée aux personnes majeures (18 ans et plus). Nous ne collectons
              pas sciemment de données de mineurs. Si nous découvrons qu&apos;un mineur a créé un compte,
              celui-ci sera supprimé immédiatement.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">12. Modifications</h2>
            <p>
              Nous nous réservons le droit de modifier la présente Politique de Confidentialité.
              Les modifications substantielles seront notifiées par e-mail ou notification in-app
              au moins 30 jours avant leur entrée en vigueur.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">13. Contact</h2>
            <p>
              Pour toute question relative à la protection de vos données :
            </p>
            <p className="mt-2 text-white">
              Spordate — contact@spordateur.com
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-wrap gap-6 text-sm text-gray-600 font-light">
          <Link href="/terms" className="hover:text-white transition-colors">CGU</Link>
          <Link href="/legal" className="hover:text-white transition-colors">Mentions Légales</Link>
        </div>
      </div>
    </div>
  );
}
