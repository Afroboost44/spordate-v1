/**
 * F1 — LE HEADER DÉBORDAIT, ET SEULEMENT POUR CERTAINS COMPTES.
 *
 * Exécution :
 *   npx tsx tests/layout/header-responsive.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Le groupe d'actions du header desktop apparaît d'un coup à 768 px (`md:`),
 * avec TOUS ses boutons libellés. Mesuré en production, pour un compte à la
 * fois partenaire ET admin : le groupe réclame 715 px des 768 disponibles, et
 * avec « ← Afroboost / Rencontres » à gauche la barre déborde de 200 px à
 * 768, 148 à 820, 39 à 1024. Elle ne rentre qu'à partir de ~1100.
 *
 * Aucun de ces boutons ne cède : `whitespace-nowrap` sur chacun. Le défaut
 * était donc INVISIBLE pour un compte ordinaire — c'est pour cela qu'il a
 * survécu si longtemps.
 *
 *   A. les trois boutons libellés sont réservés à `xl`
 *   B. rien n'est retiré : le menu déjà présent les porte tous
 *   C. un seul menu par mode — jamais deux hamburgers
 *   D. le nom d'utilisateur se coupe au lieu de pousser
 *   E. l'essentiel reste visible à toutes les largeurs
 *   F. la portée : rien d'autre n'a bougé
 *
 * Aucune action réelle : ce banc ne lit que du texte source.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let _p = 0, _f = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _p++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _f++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie') { if (!c) pass(l); else fail(l, d); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

const racine = join(__dirname, '..', '..', 'src', 'components', 'layout');
const SRC = readFileSync(join(racine, 'header.tsx'), 'utf8');
const ADMIN = readFileSync(join(racine, 'AdminMenuLink.tsx'), 'utf8');

const D = SRC.indexOf('<div className="hidden items-center space-x-2 md:flex">');
const F = D >= 0 ? SRC.indexOf('<Sheet>', D) : -1;
const GROUPE = D >= 0 && F > D ? SRC.slice(D, F) : '';

section('A — les boutons libelles sont reserves au large (xl)');
vrai('A0 le groupe d\'actions est lisible', GROUPE.length > 0);
vrai('A1 Espace Partenaire a partir de xl', /className="hidden xl:flex items-center gap-2 text-accent/.test(GROUPE));
vrai('A2 Console admin a partir de xl', /<span className="hidden xl:flex">[\s\S]{0,60}<AdminMenuLink variant="desktop" \/>/.test(GROUPE));
vrai('A3 Deconnexion a partir de xl', /onClick=\{handleLogout\} className="hidden xl:flex items-center gap-2"/.test(GROUPE));
faux('A4 plus aucun bouton libelle visible des md', /<Button variant="ghost" onClick=\{handleLogout\} className="flex items-center gap-2">/.test(GROUPE));

section('B — rien n\'est retire : le menu porte les trois');
const MI_D = SRC.indexOf('const MenuIntegre = () => (');
const MI_F = MI_D >= 0 ? SRC.indexOf('BUG #115', MI_D) : -1;
const MENU_INTEGRE = MI_D >= 0 && MI_F > MI_D ? SRC.slice(MI_D, MI_F) : '';
const SHEET = F >= 0 ? SRC.slice(F) : '';
vrai('B0 le menu integre est lisible', MENU_INTEGRE.length > 0);
vrai('B1 menu integre → Espace Partenaire', /header_partner_space/.test(MENU_INTEGRE));
vrai('B2 menu integre → Console admin', /<AdminMenuLink variant="mobile" \/>/.test(MENU_INTEGRE));
vrai('B3 menu integre → Deconnexion', /onClick=\{handleLogout\}/.test(MENU_INTEGRE));
vrai('B4 Sheet autonome → Espace Partenaire', /header_partner_space/.test(SHEET));
vrai('B5 Sheet autonome → Console admin', /<AdminMenuLink variant="mobile" \/>/.test(SHEET));
vrai('B6 Sheet autonome → Deconnexion', /onClick=\{handleLogout\}/.test(SHEET));
vrai('B7 Sheet autonome → langue', /settings_section_language/.test(SHEET));
vrai('B8 la variante mobile d\'AdminMenuLink existe toujours', /Console admin/.test(ADMIN));

section('C — un seul menu par mode, jamais deux');
vrai('C1 le Sheet historique ne s\'ouvre qu\'en mode autonome', /\$\{EN_MODE_INTEGRE \? 'hidden' : 'flex xl:hidden'\} items-center/.test(SRC));
faux('C2 il n\'est plus code mort', /<div className="md:hidden flex items-center">/.test(SRC));
vrai('C3 MenuIntegre reste le menu du mode integre', /\{EN_MODE_INTEGRE && isLoggedIn && <MenuIntegre \/>\}/.test(GROUPE));

section('D — un nom long ne pousse plus le header');
vrai('D1 le nom est borne en largeur', /max-w-\[10rem\] truncate/.test(GROUPE));
// MESURE : a `lg` (1024) le groupe d'un compte partenaire+admin fait 861 px et
// debordait encore de 90 px. Le seuil doit etre `xl`.
faux('D4 aucun reste de seuil `lg` sur les boutons libelles', /hidden lg:(flex|inline-block)/.test(GROUPE));
vrai('D2 il reste lisible en entier au survol', /title=\{user\.displayName\}/.test(GROUPE));
faux('D3 l\'ancienne version sans borne a disparu', /className="text-sm text-foreground\/60 hidden lg:inline">/.test(GROUPE));

section('E — l\'essentiel reste visible partout');
vrai('E1 credits', /<CreditsBadge \/>/.test(GROUPE));
vrai('E2 notifications', /<NotificationBadge \/>/.test(GROUPE));
vrai('E3 langue', /Changer de langue/.test(GROUPE));
vrai('E4 retour Afroboost', /<RetourAfroboost \/>/.test(SRC));
vrai('E5 le mini-header mobile garde credits et cloche', /md:hidden sticky top-0 z-40/.test(SRC));

section('F — LA PORTEE : rien d\'autre n\'a bouge');
vrai('F1 le header desktop garde son seuil d\'apparition', /className="hidden md:block sticky top-0 z-50/.test(SRC));
vrai('F2 la nav du mode integre reste masquee', /\$\{EN_MODE_INTEGRE \? 'hidden' : 'hidden md:flex'\}/.test(SRC));
vrai('F3 la deconnexion passe toujours par le meme appel', (SRC.match(/handleLogout/g) || []).length >= 3);
faux('F4 aucun second composant de navigation cree', /function\s+(NouvelleNav|TabletNav|MenuTablette)/.test(SRC));

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
