/**
 * BUG #82 — Page /help — Centre d'aide Spordateur avec FAQ + mini-bot Q/R.
 *
 * Approche : FAQ structurée par thématiques + un mini-bot de recherche
 * client-side qui filtre les questions selon la saisie. Pas de vrai chatbot
 * AI (pas de coût LLM, pas de gestion d'historique conversation). Quand
 * aucune question ne match, on propose un mailto:contact@spordateur.com.
 *
 * Sections couvertes :
 *  - Compte & connexion
 *  - Crédits & paiement
 *  - Matchs & messages
 *  - Sécurité & confidentialité (anchor #securite)
 *  - Activités & sessions
 *  - Partenaires (boost, dashboard)
 */

'use client';

import { useState, useMemo } from 'react';
import {
  HelpCircle, Search, Mail, ShieldCheck, MessageCircle, CreditCard,
  Users, Calendar, Building, ChevronDown,
} from 'lucide-react';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import BackButton from '@/components/BackButton';

interface FaqItem {
  id: string;
  category: string;
  Icon: typeof HelpCircle;
  question: string;
  answer: string;
  anchor?: string;
}

const FAQ: FaqItem[] = [
  // ===== COMPTE =====
  {
    id: 'account-1',
    category: 'Compte',
    Icon: Users,
    question: 'Comment je crée mon compte Spordateur ?',
    answer:
      "Sur la page d'accueil, clique sur \"Inscription\". Tu peux utiliser ton e-mail + mot de passe ou Google. Une fois inscrit·e, tu compléteras ton profil (photos, prompts, sports) en quelques étapes.",
  },
  {
    id: 'account-2',
    category: 'Compte',
    Icon: Users,
    question: 'J\'ai oublié mon mot de passe, que faire ?',
    answer:
      "Sur la page Connexion, clique sur \"Mot de passe oublié\". Tu recevras un e-mail avec un lien pour le réinitialiser.",
  },
  {
    id: 'account-3',
    category: 'Compte',
    Icon: Users,
    question: 'Comment supprimer mon compte ?',
    answer:
      "Va dans Paramètres → \"Supprimer ou suspendre mon compte\". Tu disposes d'un délai de grâce de 30 jours avant la suppression définitive (conformité RGPD Art. 17 / nLPD Art. 19).",
  },

  // ===== CRÉDITS =====
  {
    id: 'credits-1',
    category: 'Crédits',
    Icon: CreditCard,
    question: 'Comment fonctionnent les crédits ?',
    answer:
      "Les crédits servent à envoyer des messages dans le chat (1 crédit/texte, 2 crédits/audio). Tu reçois 50 crédits gratuits à l'inscription. Top-up disponible depuis ton solde en haut à droite.",
  },
  {
    id: 'credits-2',
    category: 'Crédits',
    Icon: CreditCard,
    question: 'Comment recharger mes crédits ?',
    answer:
      'Clique sur ton solde de crédits en haut à droite, ou va dans /payment. 3 packs disponibles : Starter (1 crédit = 10 CHF), Populaire (3 crédits = 25 CHF), Premium (10 crédits = 60 CHF). Paiement Visa, Mastercard, TWINT.',
  },

  // ===== MATCHS =====
  {
    id: 'match-1',
    category: 'Matchs',
    Icon: MessageCircle,
    question: 'Pourquoi je ne vois pas de matchs ?',
    answer:
      "Vérifie d'abord que ton profil est complet (photos + 3 réponses) — Spordateur affiche en priorité les profils riches. Va aussi dans Préférences pour ajuster ton filtrage (genre, distance, âge).",
  },
  {
    id: 'match-2',
    category: 'Matchs',
    Icon: MessageCircle,
    question: 'Comment se déverrouille le chat ?',
    answer:
      "Le chat s'ouvre quand toi et ton match avez tous les deux réservé la même séance, ou quand l'un de vous achète la place de l'autre (mode Duo).",
  },

  // ===== SÉCURITÉ =====
  {
    id: 'safety-1',
    category: 'Sécurité',
    Icon: ShieldCheck,
    question: 'Comment vérifier mon profil avec un selfie ?',
    answer:
      "Va dans Profil → Confidentialité → Vérification du selfie. Suis les instructions pour prendre un selfie qui sera comparé à tes photos de profil. Une fois vérifié·e, un badge ✓ apparaîtra sur ton profil public.",
    anchor: 'securite',
  },
  {
    id: 'safety-2',
    category: 'Sécurité',
    Icon: ShieldCheck,
    question: 'Comment bloquer ou signaler une personne ?',
    answer:
      "Sur le profil d'une personne, clique sur les 3 points en haut à droite → \"Bloquer\" ou \"Signaler\". Ton signalement est traité sous 7 jours par l'équipe Trust & Safety.",
    anchor: 'securite',
  },
  {
    id: 'safety-3',
    category: 'Sécurité',
    Icon: ShieldCheck,
    question: 'Comment éviter de croiser mes connaissances ?',
    answer:
      "Va dans Profil → Confidentialité → Mes contacts. Tu peux y inviter tes amis (positif) ou masquer certaines personnes que tu ne veux pas voir (collègues, ex, famille).",
    anchor: 'securite',
  },
  {
    id: 'safety-4',
    category: 'Sécurité',
    Icon: ShieldCheck,
    question: 'Conseils pour un premier date en sécurité',
    answer:
      "Choisis un lieu public, dis à un proche où tu vas, garde ton téléphone chargé. Spordateur ne partage JAMAIS tes coordonnées avant que tu n'aies confirmé une activité. En cas de souci pendant l'événement, contacte support@spordateur.com.",
    anchor: 'securite',
  },

  // ===== ACTIVITÉS =====
  {
    id: 'activity-1',
    category: 'Activités',
    Icon: Calendar,
    question: 'Comment réserver une activité ?',
    answer:
      "Sur la fiche d'une activité, clique \"Réserver\". Tu choisis ta séance, tu payes via Stripe (Visa/TWINT), et tu reçois une confirmation par e-mail. Tu peux annuler jusqu'à 24h avant.",
  },
  {
    id: 'activity-2',
    category: 'Activités',
    Icon: Calendar,
    question: 'Puis-je annuler une réservation ?',
    answer:
      "Oui, jusqu'à 24h avant le début de la séance. Va dans \"Mes Activités\" → clique sur la séance → \"Annuler\". Remboursement automatique sur ton moyen de paiement initial sous 5 jours ouvrés.",
  },

  // ===== PARTENAIRES =====
  {
    id: 'partner-1',
    category: 'Partenaires',
    Icon: Building,
    question: 'Comment devenir partenaire Spordateur ?',
    answer:
      "Va sur /partner/register pour créer ton compte partenaire (studio, coach, restaurant, etc.). Tu pourras ensuite publier tes activités sportives et événements depuis ton Espace Partenaire.",
  },
  {
    id: 'partner-2',
    category: 'Partenaires',
    Icon: Building,
    question: 'Comment booster mon activité ?',
    answer:
      "Dans ton Espace Partenaire → onglet Boost. Tu choisis l'activité à promouvoir, la ville cible et la durée (24h / 3j / 7j). Ton activité apparaîtra en priorité dans la fenêtre IT'S A MATCH des utilisateurs.",
  },
];

const CATEGORIES = ['Tous', 'Compte', 'Crédits', 'Matchs', 'Sécurité', 'Activités', 'Partenaires'];

export default function HelpPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('Tous');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ.filter((f) => {
      if (category !== 'Tous' && f.category !== category) return false;
      if (!q) return true;
      return (
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-8">
          <BackButton fallbackUrl="/profile" />
          <h1 className="text-2xl sm:text-3xl font-light tracking-wide flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-accent" />
            Centre d&apos;aide
          </h1>
        </div>

        {/* Bot Q/R simple : input de recherche qui filtre la FAQ en live */}
        <div className="mb-6">
          <p className="text-sm text-white/60 font-light mb-3">
            Pose ta question, on cherche la réponse pour toi.
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex: comment recharger mes crédits ?"
              className="pl-9 bg-zinc-900/60 border-white/10 text-white placeholder:text-white/30 h-12 rounded-full"
            />
          </div>
        </div>

        {/* Filtres catégories */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-hide">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                category === cat
                  ? 'bg-accent text-white'
                  : 'bg-white/5 text-white/60 hover:text-white border border-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Anchor pour les liens depuis ProfileSafetySection */}
        <a id="securite" />

        {/* Liste FAQ filtrée — accordion */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ChevronDown className="h-8 w-8 text-white/20" />
            <p className="text-sm text-white/70">
              Aucune réponse pour &laquo; {query} &raquo;.
            </p>
            <p className="text-xs text-white/40 leading-relaxed max-w-sm">
              Écris-nous directement et on revient vers toi sous 24h.
            </p>
            <a
              href="mailto:contact@spordateur.com"
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/40 text-accent hover:bg-accent/10 text-sm font-medium"
            >
              <Mail className="h-4 w-4" />
              contact@spordateur.com
            </a>
          </div>
        ) : (
          <Accordion type="single" collapsible className="flex flex-col gap-2">
            {filtered.map((f) => {
              const Icon = f.Icon;
              return (
                <AccordionItem
                  key={f.id}
                  value={f.id}
                  className="bg-[#1A1A1A] border border-white/5 rounded-xl px-4 data-[state=open]:border-accent/30"
                >
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="flex items-center gap-3 flex-1 text-left">
                      <Icon className="h-4 w-4 text-accent shrink-0" />
                      <span className="text-sm sm:text-base text-white font-medium">
                        {f.question}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-white/70 font-light leading-relaxed pb-4 pl-7">
                    {f.answer}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}

        {/* Footer contact direct */}
        <div className="mt-10 p-5 rounded-2xl border border-white/10 bg-zinc-900/40 flex items-start gap-3">
          <div className="rounded-full bg-accent/10 p-2 shrink-0">
            <Mail className="h-4 w-4 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">Tu ne trouves pas ?</p>
            <p className="text-xs text-white/50 mt-0.5">
              Écris-nous à{' '}
              <a
                href="mailto:contact@spordateur.com"
                className="text-accent hover:underline"
              >
                contact@spordateur.com
              </a>
              {' '}— on répond sous 24h.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
