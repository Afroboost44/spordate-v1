/**
 * Limites du système de parrainage Spordateur.
 *
 * Centralise les bornes anti-abuse pour le flow parrainage :
 *  - MAX_REFERRALS_PER_USER : plafond du nombre de filleuls par parrain
 *    (lu par processReferralSignup pour bloquer la création d'un nouveau
 *    lien quand un parrain a déjà atteint ce seuil).
 *
 * Pourquoi ce plafond :
 *  Sans borne, un attaquant peut créer N faux comptes pointant tous vers
 *  son code parrain pour farmer des bonus (cf. audit 2026-05). Le plafond
 *  par défaut est conservateur et peut être relevé manuellement pour les
 *  vrais ambassadeurs en éditant cette constante ou en allowlistant un
 *  user spécifique côté admin.
 *
 * IMPORTANT — comportement à la limite :
 *  Quand un nouveau filleul s'inscrit avec un code parrain qui a déjà
 *  atteint son plafond, son INSCRIPTION RÉUSSIT NORMALEMENT — seul le
 *  bonus parrainage est skippé silencieusement (log côté serveur, pas
 *  d'erreur user-facing). On ne casse jamais l'onboarding.
 */

/** Plafond du nombre de filleuls actifs par parrain (cf. processReferralSignup). */
export const MAX_REFERRALS_PER_USER = 50;
