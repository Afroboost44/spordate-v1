"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

// DONNÉES PAR DÉFAUT (ROBUSTESSE)
const defaultTranslations: any = {
  fr: {
    hero_title: "Trouve ton Partenaire de Sport Idéal",
    hero_subtitle: "Connecte-toi avec des gens qui partagent ta passion. Du tennis au yoga, Spordateur est là.",
    cta_button: "Commencer l'aventure",
    nav_login: "Connexion",
    nav_signup: "S'inscrire",
    nav_logout: "Déconnexion",
    feature_match_title: "Matchmaking Intelligent",
    feature_match_desc: "Notre algorithme trouve les partenaires adaptés à ton niveau.",
    feature_map_title: "Clubs à Proximité",
    feature_map_desc: "Trouve les meilleures salles et terrains autour de toi.",
    feature_chat_title: "Chat Sécurisé",
    feature_chat_desc: "Organise tes rencontres en toute simplicité.",
    footer_rights: "Tous droits réservés.",
    nav_discovery: "Rencontres",
    nav_find_match: "Trouver un Match",
    nav_profile: "Mon Profil",
    nav_activities: "Activités",
    nav_notifications: "Notifications",
  },
  en: {
    hero_title: "Find Your Perfect Sports Partner",
    hero_subtitle: "Connect with people who share your passion. From tennis to yoga, Spordateur is here.",
    cta_button: "Get Started",
    nav_login: "Login",
    nav_signup: "Sign Up",
    nav_logout: "Logout",
    feature_match_title: "Smart Matchmaking",
    feature_match_desc: "Our algorithm finds partners suited to your level.",
    feature_map_title: "Nearby Clubs",
    feature_map_desc: "Find the best gyms and courts around you.",
    feature_chat_title: "Secure Chat",
    feature_chat_desc: "Organize your meetings with ease.",
    footer_rights: "All rights reserved.",
    nav_discovery: "Discovery",
    nav_find_match: "Find a Match",
    nav_profile: "My Profile",
    nav_activities: "Activities",
    nav_notifications: "Notifications",
  },
  de: {
    hero_title: "Finde deinen idealen Sportpartner",
    hero_subtitle: "Verbinde dich mit Menschen, die deine Leidenschaft teilen. Von Tennis bis Yoga.",
    cta_button: "Loslegen",
    nav_login: "Anmelden",
    nav_signup: "Registrieren",
    nav_logout: "Abmelden",
    feature_match_title: "Intelligentes Matching",
    feature_match_desc: "Unser Algorithmus findet Partner, die deinem Niveau entsprechen.",
    feature_map_title: "Clubs in der Nähe",
    feature_map_desc: "Finde die besten Fitnessstudios und Plätze in deiner Umgebung.",
    feature_chat_title: "Sicherer Chat",
    feature_chat_desc: "Organisiere deine Treffen ganz einfach.",
    footer_rights: "Alle Rechte vorbehalten.",
    nav_discovery: "Entdecken",
    nav_find_match: "Match finden",
    nav_profile: "Mein Profil",
    nav_activities: "Aktivitäten",
    nav_notifications: "Benachrichtigungen",
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
