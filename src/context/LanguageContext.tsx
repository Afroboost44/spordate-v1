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

  const t = (key: string) => {
    return translations[language]?.[key] || defaultTranslations['fr'][key] || key;
  };

  if (!isLoaded) return <div className="bg-black h-screen"></div>;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, translations, updateTranslations }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
