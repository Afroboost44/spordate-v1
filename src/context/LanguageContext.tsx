"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

// DONNÉES PAR DÉFAUT (ROBUSTESSE)
// Phase 9.5 c23 BUG X — extension defaultTranslations avec ~20 clés manquantes
// (footer + common CTAs + landing sections + auth labels). FR/EN/DE complets.
const defaultTranslations: any = {
  fr: {
    // Hero + features (existant c0)
    hero_title: "Trouve ton Partenaire de Sport Idéal",
    hero_subtitle: "Connecte-toi avec des gens qui partagent ta passion. Du tennis au yoga, Spordateur est là.",
    cta_button: "Commencer l'aventure",
    feature_match_title: "Matchmaking Intelligent",
    feature_match_desc: "Notre algorithme trouve les partenaires adaptés à ton niveau.",
    feature_map_title: "Clubs à Proximité",
    feature_map_desc: "Trouve les meilleures salles et terrains autour de toi.",
    feature_chat_title: "Chat Sécurisé",
    feature_chat_desc: "Organise tes rencontres en toute simplicité.",
    // Navigation
    nav_login: "Connexion",
    nav_signup: "S'inscrire",
    nav_logout: "Déconnexion",
    nav_discovery: "Rencontres",
    nav_find_match: "Trouver un Match",
    nav_profile: "Mon Profil",
    nav_activities: "Activités",
    nav_notifications: "Notifications",
    // Footer (c23 NEW)
    footer_rights: "Tous droits réservés.",
    footer_cgu: "CGU",
    footer_privacy: "Confidentialité",
    footer_legal: "Mentions légales",
    footer_contact: "Contact",
    // Common CTAs (c23 NEW)
    common_save: "Enregistrer",
    common_cancel: "Annuler",
    common_confirm: "Confirmer",
    common_retry: "Réessayer",
    common_close: "Fermer",
    common_loading: "Chargement…",
    common_error: "Erreur",
    common_back: "Retour",
    common_next: "Suivant",
    common_search: "Rechercher",
    // Landing sections (c23 NEW)
    landing_method: "Méthode",
    landing_testimonials: "Témoignages",
    landing_partners: "Partenaires",
    landing_coverage: "Couverture",
    landing_how_it_works: "Comment ça marche",
    landing_join: "Rejoindre",
    landing_start: "Commencer",
    // Countdown (c25 NEW)
    countdown_days: "JOURS",
    countdown_hours: "HEURES",
    countdown_minutes: "MIN",
    countdown_seconds: "SEC",
    countdown_phase_before: "Le chat ouvre dans",
    countdown_phase_chat_open: "Démarre dans",
    countdown_phase_started: "En cours · termine dans",
    countdown_phase_ended: "Terminé",
    countdown_started: "Démarré",
    // PWA install banner (c25 NEW)
    pwa_install_title: "Installer Spordateur",
    pwa_install_subtitle: "Accès rapide depuis ton écran d'accueil",
    pwa_install_button: "Installer",
    // Discovery (c25 NEW)
    discovery_where_to_practice: "Où pratiquer ?",
    discovery_location_selected: "Sélectionné",
    discovery_location_recommended: "Recommandé",
    discovery_no_profiles_title: "Plus de profils pour le moment",
    discovery_no_profiles_subtitle: "Revenez plus tard ou recommencez",
    discovery_reset_button: "Recommencer",
    discovery_free_trial_button: "Essai gratuit",
    discovery_reserve_button: "Réserver",
    // Phase 9.5 c26 BUG CC — empty state quand aucun partenaire boosté n'a d'activité
    discovery_no_boosted_activities: "Aucune activité boostée disponible pour le moment",
    discovery_no_boosted_activities_subtitle: "Reviens bientôt — de nouvelles activités sont mises en avant chaque jour.",
    discovery_view_all_profiles: "Voir tous les profils",
    // Payment modal (c25 NEW)
    payment_modal_title: "Réserver une séance {title}",
    payment_duo_option_title: "J'invite mon partenaire",
    payment_duo_option_subtitle: "Offrir la séance (2 places)",
    payment_service_fee: "Frais de service",
    payment_total_label: "Total",
    payment_free_label: "OFFERT",
    payment_free_session_label: "SÉANCE D'ESSAI",
    payment_meeting_place_label: "Lieu de rendez-vous (optionnel)",
    payment_location_placeholder: "Choisir un lieu partenaire...",
    payment_pay_button: "Payer {price} CHF",
    payment_confirm_free_button: "Confirmer ma séance d'essai",
    payment_button_loading_free: "Confirmation...",
    payment_button_loading_paid: "Redirection vers Stripe...",
    payment_stripe_notice: "Paiement sécurisé Stripe",
    // Phase 9.5 c28 — Badge moyens de paiement acceptés (TWINT natif Stripe CH)
    payment_methods_accepted: "Visa · Mastercard · TWINT",
    // Phase 9.5 c29a CH4 — bouton désactivé quand pricingTiers absent/0 sur activité payante
    reserve_button_pricing_pending: "Configuration prix en cours",
    // Phase 9.5 c29b BUG FF — Boost via crédits Spordate
    boost_payment_method_label: "Méthode de paiement",
    boost_payment_credits: "Crédits Spordateur",
    boost_payment_card_twint: "Carte / TWINT",
    boost_credits_balance: "Solde : {balance} crédits",
    boost_credits_cost: "Coût : {cost} crédits ({chf} CHF équivalent)",
    boost_credits_insufficient: "Solde insuffisant — Recharger",
    boost_credits_activate_button: "Activer avec mes crédits",
    boost_credits_success: "Boost activé ! Solde restant : {remaining} crédits",
    // Phase 9.5 c30 BUG GG — bouton Réserver désactivé si pas de session future
    reserve_no_upcoming_session: "Pas de session planifiée",
    reserve_sessions_ended: "Sessions terminées",
    // Phase 9.5 c31 BUG HH — édition pricing tiers côté partner
    partner_pricing_section_title: "Prix progressif (optionnel)",
    partner_pricing_toggle_label: "Activer les 3 paliers de prix",
    partner_pricing_helper: "Récompense les réservations en avance et capture les late bookers",
    partner_pricing_early_label: "Early Bird (avant 7 jours)",
    partner_pricing_standard_label: "Standard (24h avant)",
    partner_pricing_last_label: "Last Minute (1h avant)",
    partner_pricing_reset_button: "Réinitialiser aux valeurs suggérées",
    partner_pricing_validation_order: "Les prix doivent être croissants : Early < Standard < Last Minute",
    partner_pricing_disabled_info: "Prix unique appliqué : {price} CHF",
    // Profile onboarding (c25 NEW)
    profile_about_section_title: "À propos de moi",
    profile_first_name_label: "Prénom *",
    profile_first_name_placeholder: "Votre prénom",
    profile_bio_label: "Bio",
    profile_bio_placeholder: "Parlez de vos sports favoris...",
    profile_city_label: "Ville *",
    profile_city_placeholder: "Sélectionnez votre ville",
    profile_gender_label: "Genre",
    profile_gender_female: "Femme",
    profile_gender_male: "Homme",
    profile_gender_other: "Autre",
    profile_sports_section_title: "Mes Sports *",
    profile_sports_subtitle: "Sélectionnez vos sports favoris",
    profile_dances_section_title: "Mes Danses",
    profile_dances_subtitle: "Sélectionnez vos styles de danse",
    profile_photos_subtitle: "Max 5 photos. Montrez-vous en action !",
    profile_add_photo_button: "Ajouter",
  },
  en: {
    hero_title: "Find Your Perfect Sports Partner",
    hero_subtitle: "Connect with people who share your passion. From tennis to yoga, Spordateur is here.",
    cta_button: "Get Started",
    feature_match_title: "Smart Matchmaking",
    feature_match_desc: "Our algorithm finds partners suited to your level.",
    feature_map_title: "Nearby Clubs",
    feature_map_desc: "Find the best gyms and courts around you.",
    feature_chat_title: "Secure Chat",
    feature_chat_desc: "Organize your meetings with ease.",
    // Navigation
    nav_login: "Login",
    nav_signup: "Sign Up",
    nav_logout: "Logout",
    nav_discovery: "Discovery",
    nav_find_match: "Find a Match",
    nav_profile: "My Profile",
    nav_activities: "Activities",
    nav_notifications: "Notifications",
    // Footer
    footer_rights: "All rights reserved.",
    footer_cgu: "Terms",
    footer_privacy: "Privacy",
    footer_legal: "Legal notice",
    footer_contact: "Contact",
    // Common CTAs
    common_save: "Save",
    common_cancel: "Cancel",
    common_confirm: "Confirm",
    common_retry: "Retry",
    common_close: "Close",
    common_loading: "Loading…",
    common_error: "Error",
    common_back: "Back",
    common_next: "Next",
    common_search: "Search",
    // Landing
    landing_method: "Method",
    landing_testimonials: "Testimonials",
    landing_partners: "Partners",
    landing_coverage: "Coverage",
    landing_how_it_works: "How it works",
    landing_join: "Join",
    landing_start: "Get started",
    // Countdown
    countdown_days: "DAYS",
    countdown_hours: "HOURS",
    countdown_minutes: "MIN",
    countdown_seconds: "SEC",
    countdown_phase_before: "Chat opens in",
    countdown_phase_chat_open: "Starts in",
    countdown_phase_started: "Ongoing · ends in",
    countdown_phase_ended: "Ended",
    countdown_started: "Started",
    // PWA install
    pwa_install_title: "Install Spordateur",
    pwa_install_subtitle: "Quick access from your home screen",
    pwa_install_button: "Install",
    // Discovery
    discovery_where_to_practice: "Where to practice?",
    discovery_location_selected: "Selected",
    discovery_location_recommended: "Recommended",
    discovery_no_profiles_title: "No more profiles for now",
    discovery_no_profiles_subtitle: "Come back later or restart",
    discovery_reset_button: "Restart",
    discovery_free_trial_button: "Free trial",
    discovery_reserve_button: "Book",
    discovery_no_boosted_activities: "No boosted activities available right now",
    discovery_no_boosted_activities_subtitle: "Come back soon — new activities are featured every day.",
    discovery_view_all_profiles: "Back to all profiles",
    // Payment modal
    payment_modal_title: "Book a {title} session",
    payment_duo_option_title: "Invite my partner",
    payment_duo_option_subtitle: "Gift the session (2 spots)",
    payment_service_fee: "Service fee",
    payment_total_label: "Total",
    payment_free_label: "FREE",
    payment_free_session_label: "TRIAL SESSION",
    payment_meeting_place_label: "Meeting place (optional)",
    payment_location_placeholder: "Choose a partner venue...",
    payment_pay_button: "Pay {price} CHF",
    payment_confirm_free_button: "Confirm my trial session",
    payment_button_loading_free: "Confirming...",
    payment_button_loading_paid: "Redirecting to Stripe...",
    payment_stripe_notice: "Secure payment by Stripe",
    payment_methods_accepted: "Visa · Mastercard · TWINT",
    reserve_button_pricing_pending: "Pricing setup in progress",
    boost_payment_method_label: "Payment method",
    boost_payment_credits: "Spordateur Credits",
    boost_payment_card_twint: "Card / TWINT",
    boost_credits_balance: "Balance: {balance} credits",
    boost_credits_cost: "Cost: {cost} credits ({chf} CHF equivalent)",
    boost_credits_insufficient: "Insufficient balance — Top up",
    boost_credits_activate_button: "Activate with my credits",
    boost_credits_success: "Boost activated! Remaining balance: {remaining} credits",
    reserve_no_upcoming_session: "No upcoming session",
    reserve_sessions_ended: "Sessions ended",
    partner_pricing_section_title: "Progressive pricing (optional)",
    partner_pricing_toggle_label: "Enable 3-tier pricing",
    partner_pricing_helper: "Rewards early bookings and captures late bookers",
    partner_pricing_early_label: "Early Bird (7 days before)",
    partner_pricing_standard_label: "Standard (24h before)",
    partner_pricing_last_label: "Last Minute (1h before)",
    partner_pricing_reset_button: "Reset to suggested values",
    partner_pricing_validation_order: "Prices must increase: Early < Standard < Last Minute",
    partner_pricing_disabled_info: "Single price applied: {price} CHF",
    // Profile onboarding
    profile_about_section_title: "About me",
    profile_first_name_label: "First name *",
    profile_first_name_placeholder: "Your first name",
    profile_bio_label: "Bio",
    profile_bio_placeholder: "Tell us about your favourite sports...",
    profile_city_label: "City *",
    profile_city_placeholder: "Select your city",
    profile_gender_label: "Gender",
    profile_gender_female: "Female",
    profile_gender_male: "Male",
    profile_gender_other: "Other",
    profile_sports_section_title: "My Sports *",
    profile_sports_subtitle: "Pick your favourite sports",
    profile_dances_section_title: "My Dances",
    profile_dances_subtitle: "Pick your dance styles",
    profile_photos_subtitle: "Max 5 photos. Show yourself in action!",
    profile_add_photo_button: "Add",
  },
  de: {
    hero_title: "Finde deinen idealen Sportpartner",
    hero_subtitle: "Verbinde dich mit Menschen, die deine Leidenschaft teilen. Von Tennis bis Yoga.",
    cta_button: "Loslegen",
    feature_match_title: "Intelligentes Matching",
    feature_match_desc: "Unser Algorithmus findet Partner, die deinem Niveau entsprechen.",
    feature_map_title: "Clubs in der Nähe",
    feature_map_desc: "Finde die besten Fitnessstudios und Plätze in deiner Umgebung.",
    feature_chat_title: "Sicherer Chat",
    feature_chat_desc: "Organisiere deine Treffen ganz einfach.",
    // Navigation
    nav_login: "Anmelden",
    nav_signup: "Registrieren",
    nav_logout: "Abmelden",
    nav_discovery: "Entdecken",
    nav_find_match: "Match finden",
    nav_profile: "Mein Profil",
    nav_activities: "Aktivitäten",
    nav_notifications: "Benachrichtigungen",
    // Footer
    footer_rights: "Alle Rechte vorbehalten.",
    footer_cgu: "AGB",
    footer_privacy: "Datenschutz",
    footer_legal: "Impressum",
    footer_contact: "Kontakt",
    // Common CTAs
    common_save: "Speichern",
    common_cancel: "Abbrechen",
    common_confirm: "Bestätigen",
    common_retry: "Erneut versuchen",
    common_close: "Schließen",
    common_loading: "Lädt…",
    common_error: "Fehler",
    common_back: "Zurück",
    common_next: "Weiter",
    common_search: "Suchen",
    // Landing
    landing_method: "Methode",
    landing_testimonials: "Stimmen",
    landing_partners: "Partner",
    landing_coverage: "Verfügbarkeit",
    landing_how_it_works: "So funktioniert's",
    landing_join: "Beitreten",
    landing_start: "Starten",
    // Countdown
    countdown_days: "TAGE",
    countdown_hours: "STUNDEN",
    countdown_minutes: "MIN",
    countdown_seconds: "SEK",
    countdown_phase_before: "Chat öffnet in",
    countdown_phase_chat_open: "Beginnt in",
    countdown_phase_started: "Läuft · endet in",
    countdown_phase_ended: "Beendet",
    countdown_started: "Gestartet",
    // PWA install
    pwa_install_title: "Spordateur installieren",
    pwa_install_subtitle: "Schneller Zugriff vom Startbildschirm",
    pwa_install_button: "Installieren",
    // Discovery
    discovery_where_to_practice: "Wo trainieren?",
    discovery_location_selected: "Ausgewählt",
    discovery_location_recommended: "Empfohlen",
    discovery_no_profiles_title: "Keine Profile mehr",
    discovery_no_profiles_subtitle: "Komm später wieder oder starte neu",
    discovery_reset_button: "Neustarten",
    discovery_free_trial_button: "Kostenlos testen",
    discovery_reserve_button: "Buchen",
    discovery_no_boosted_activities: "Derzeit keine geboosteten Aktivitäten verfügbar",
    discovery_no_boosted_activities_subtitle: "Komm bald wieder — jeden Tag werden neue Aktivitäten hervorgehoben.",
    discovery_view_all_profiles: "Zurück zu allen Profilen",
    // Payment modal
    payment_modal_title: "{title}-Sitzung buchen",
    payment_duo_option_title: "Partner einladen",
    payment_duo_option_subtitle: "Sitzung schenken (2 Plätze)",
    payment_service_fee: "Servicegebühr",
    payment_total_label: "Gesamt",
    payment_free_label: "GRATIS",
    payment_free_session_label: "PROBESTUNDE",
    payment_meeting_place_label: "Treffpunkt (optional)",
    payment_location_placeholder: "Partner-Ort wählen...",
    payment_pay_button: "{price} CHF zahlen",
    payment_confirm_free_button: "Probestunde bestätigen",
    payment_button_loading_free: "Bestätige...",
    payment_button_loading_paid: "Weiterleitung zu Stripe...",
    payment_stripe_notice: "Sichere Zahlung mit Stripe",
    payment_methods_accepted: "Visa · Mastercard · TWINT",
    reserve_button_pricing_pending: "Preiskonfiguration läuft",
    boost_payment_method_label: "Zahlungsart",
    boost_payment_credits: "Spordateur-Guthaben",
    boost_payment_card_twint: "Karte / TWINT",
    boost_credits_balance: "Guthaben: {balance} Credits",
    boost_credits_cost: "Kosten: {cost} Credits ({chf} CHF entspricht)",
    boost_credits_insufficient: "Guthaben unzureichend — Aufladen",
    boost_credits_activate_button: "Mit Guthaben aktivieren",
    boost_credits_success: "Boost aktiviert! Restguthaben: {remaining} Credits",
    reserve_no_upcoming_session: "Keine geplante Session",
    reserve_sessions_ended: "Sitzungen beendet",
    partner_pricing_section_title: "Progressive Preisgestaltung (optional)",
    partner_pricing_toggle_label: "3-Stufen-Preise aktivieren",
    partner_pricing_helper: "Belohnt frühe Buchungen und gewinnt Last-Minute-Bucher",
    partner_pricing_early_label: "Early Bird (7 Tage vorher)",
    partner_pricing_standard_label: "Standard (24h vorher)",
    partner_pricing_last_label: "Last Minute (1h vorher)",
    partner_pricing_reset_button: "Auf vorgeschlagene Werte zurücksetzen",
    partner_pricing_validation_order: "Preise müssen aufsteigend sein: Early < Standard < Last Minute",
    partner_pricing_disabled_info: "Einheitspreis angewendet: {price} CHF",
    // Profile onboarding
    profile_about_section_title: "Über mich",
    profile_first_name_label: "Vorname *",
    profile_first_name_placeholder: "Dein Vorname",
    profile_bio_label: "Bio",
    profile_bio_placeholder: "Erzähl uns von deinen Lieblingssportarten...",
    profile_city_label: "Stadt *",
    profile_city_placeholder: "Wähle deine Stadt",
    profile_gender_label: "Geschlecht",
    profile_gender_female: "Weiblich",
    profile_gender_male: "Männlich",
    profile_gender_other: "Andere",
    profile_sports_section_title: "Meine Sportarten *",
    profile_sports_subtitle: "Wähle deine Lieblingssportarten",
    profile_dances_section_title: "Meine Tänze",
    profile_dances_subtitle: "Wähle deine Tanzstile",
    profile_photos_subtitle: "Max. 5 Fotos. Zeig dich in Aktion!",
    profile_add_photo_button: "Hinzufügen",
  }
};

const LanguageContext = createContext<any>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState("fr");
  const [translations, setTranslations] = useState(defaultTranslations);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Chargement sécurisé
    try {
      const stored = localStorage.getItem('spordate_translations');
      if (stored) {
        setTranslations({ ...defaultTranslations, ...JSON.parse(stored) });
      }
    } catch (e) {
      console.error("Erreur chargement langue", e);
    }
    setIsLoaded(true);
  }, []);

  const updateTranslations = (lang: string, key: string, value: string) => {
    const newTrans = {
      ...translations,
      [lang]: { ...translations[lang], [key]: value }
    };
    setTranslations(newTrans);
    localStorage.setItem('spordate_translations', JSON.stringify(newTrans));
  };

  // Phase 9.5 c25 BUG AA — t() supporte interpolation {placeholder} pour les
  // strings paramétrés (ex: t('payment_pay_button', { price: 25 }) →
  // "Payer 25 CHF" / "Pay 25 CHF" / "25 CHF zahlen").
  const t = (key: string, params?: Record<string, string | number>) => {
    const raw = translations[language]?.[key] || defaultTranslations['fr'][key] || key;
    if (!params || typeof raw !== 'string') return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`
    );
  };

  if (!isLoaded) return <div className="bg-black h-screen"></div>;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, translations, updateTranslations }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
