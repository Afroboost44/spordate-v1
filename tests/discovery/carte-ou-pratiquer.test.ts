/**
 * LOT E — LA CARTE DISAIT LA BONNE CHOSE, ELLE LA DISAIT MAL.
 *
 * Exécution :
 *   npx tsx tests/discovery/carte-ou-pratiquer.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Le contenu de « Où vous retrouver » était juste depuis le LOT D : bon titre,
 * bon lieu, bon prix, bon organisateur, bonne destination. Ce qui n'allait pas
 * était la MISE EN FORME — et une mise en forme fautive coûte aussi cher qu'une
 * donnée fausse quand elle rend l'action principale illisible.
 *
 * La cause exacte, mesurée dans la source d'avant : la carte était
 * `flex items-stretch` avec, à droite, un rail `flex-shrink-0 self-center
 * flex-col` portant les DEUX boutons empilés. Ce rail prenait sa largeur
 * intrinsèque et ne cédait jamais. Sous 400 px il mangeait un tiers de la
 * carte ; le titre et l'adresse se pliaient ; et « Réserver » — l'action
 * PRINCIPALE — finissait en `text-[11px] py-1.5`, soit ~26 px de haut, sous le
 * seuil tactile, en contour discret, pendant que « Proposer » portait le
 * remplissage plein. La hiérarchie était inversée.
 *
 *   A.  le rail vertical a disparu
 *   B.  les CTA occupent leur propre rangée
 *   C.  « Réserver » est l'action principale (remplissage plein)
 *   D.  « Proposer » reste secondaire (contour) et accessible
 *   E.  les deux atteignent le seuil tactile de 44 px
 *   F.  les deux ont un focus clavier visible
 *   G.  colonne sur petit écran, rangée au-delà
 *   H.  la vignette fait 56 px, comme celle d'une activité native
 *   I.  une carte sans image garde une vignette de secours
 *   J.  titre, adresse : lisibles en entier, jamais tronqués
 *   K.  le prix est rendu
 *   L.  l'organisateur est nommé
 *   M.  la règle de colonnes : deux seulement si chaque carte garde 260 px
 *   N.  R4 INCHANGÉ : même appel, même type, même prix
 *   O.  handler « Proposer » INCHANGÉ
 *   P.  aucun deeplink écrit en dur dans la carte
 *   Q.  cohérence avec la carte native (même vignette)
 *   R.  FIX ATTRIBUTION : l'organisateur reste nommé, jamais le profil
 *
 * AUCUNE action réelle : ce banc ne lit que du texte source.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let _p = 0, _f = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _p++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _f++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie') { if (!c) pass(l); else fail(l, d); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

const SRC = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'discovery', 'page.tsx'), 'utf8');

// ─────────────────────── ON N'INSPECTE QUE LA SECTION CONCERNÉE ───────────
// Découper importe : une assertion posée sur le fichier entier passerait grâce
// à une occurrence située dans les activités natives, et ne prouverait rien
// sur la carte Afroboost.
const DEBUT = SRC.indexOf("optionsDeRencontre.length > 0 && (");
const FIN = SRC.indexOf('ÉTAPE 2', DEBUT);
if (DEBUT < 0 || FIN < 0 || FIN <= DEBUT) {
  console.log('FAIL  bornes — impossible de délimiter la section « Où vous retrouver »');
  process.exit(1);
}
const CARTE = SRC.slice(DEBUT, FIN);

// Le bloc de la carte NATIVE, pour comparer les deux listes du même écran.
const DEBUT_NATIF = SRC.indexOf('partnerActivities.map((act)');
const NATIF = DEBUT_NATIF >= 0 ? SRC.slice(DEBUT_NATIF, DEBUT) : '';

section('A/B — le rail vertical qui compressait « Réserver »');
// ⚠️ ON LIT L'ATTRIBUT, PAS LE VOISINAGE. Une première version de cette
// assertion cherchait `items-stretch` dans les 400 caractères suivant le
// `data-testid` : elle a échoué sur le COMMENTAIRE qui explique le défaut
// corrigé. Une assertion de source ne doit jamais pouvoir être satisfaite —
// ni mise en échec — par de la prose.
const RACINE = (CARTE.match(/data-testid=\{`meeting-venue-\$\{o\.afroboostOfferId\}`\}\s*\n\s*className="([^"]*)"/) || [])[1] || '';
vrai('A0 la className de la carte est lisible', RACINE.length > 0);
faux('A1 la carte n\'est plus `items-stretch`', RACINE.includes('items-stretch'));
vrai('A1b la carte empile contenu puis actions', RACINE.includes('flex flex-col'));
faux('A2 plus de rail `flex-shrink-0 … flex-col` portant les CTA', /flex-shrink-0 self-center[^"]*flex flex-col/.test(CARTE));
faux('A3 plus de bouton en `text-[11px]` dans la carte', /px-3 py-2 rounded-full text-\[11px\]/.test(CARTE));
vrai('B1 les CTA sont dans une rangée dédiée', /flex flex-col gap-2 min-\[380px\]:flex-row/.test(CARTE));
vrai('B2 chaque CTA prend sa part de la largeur (`flex-1`)', (CARTE.match(/flex-1 inline-flex items-center justify-center/g) || []).length === 2);

section('C/D — la hiérarchie, remise à l\'endroit');
const RESERVER = CARTE.slice(CARTE.indexOf('href={dest.url}'), CARTE.indexOf("t('discovery_reserve_button')}\n"));
const PROPOSER = CARTE.slice(CARTE.indexOf('onClick={() => handleProposerOffre'), CARTE.indexOf("t('discovery_propose_this_course')}\n"));
vrai('C1 « Réserver » porte le remplissage plein', /bg-accent text-white/.test(RESERVER));
vrai('C2 « Réserver » est en `font-semibold`', /font-semibold/.test(RESERVER));
vrai('C3 « Réserver » est rendu en `text-sm`, plus en 11 px', /text-sm/.test(RESERVER) && !/text-\[11px\]/.test(RESERVER));
vrai('D1 « Proposer » est en contour', /border border-white\/20/.test(PROPOSER));
faux('D2 « Proposer » ne porte plus le remplissage accent', /bg-accent(?!\/)/.test(PROPOSER));
vrai('D3 « Proposer » reste un vrai bouton natif', /<button\s/.test(CARTE) && /type="button"/.test(CARTE));

section('E/F/G — tactile, clavier, responsive');
vrai('E1 « Réserver » atteint 44 px', /min-h-\[44px\]/.test(RESERVER));
vrai('E2 « Proposer » atteint 44 px', /min-h-\[44px\]/.test(PROPOSER));
vrai('F1 « Réserver » a un focus visible', /focus-visible:ring-2/.test(RESERVER));
vrai('F2 « Proposer » a un focus visible', /focus-visible:ring-2/.test(PROPOSER));
vrai('F3 chaque CTA porte un `aria-label` qui nomme le cours', (CARTE.match(/aria-label=\{`\$\{t\('discovery_(reserve_button|propose_this_course)'\)\} — \$\{o\.titre\}`\}/g) || []).length === 2);
vrai('G1 colonne par défaut', /flex flex-col gap-2 min-\[380px\]/.test(CARTE));
vrai('G2 rangée au-delà de 380 px', /min-\[380px\]:flex-row/.test(CARTE));

section('H/I/Q — la vignette');
vrai('H1 la vignette de l\'offre fait 56 px', /className="w-14 h-14 rounded-lg object-cover/.test(CARTE));
faux('H2 plus de vignette 48 px', /w-12 h-12 rounded-lg object-cover/.test(CARTE));
vrai('I1 une carte sans image garde une vignette de secours', /w-14 h-14 rounded-lg bg-zinc-800/.test(CARTE));
vrai('I2 le fallback image d\'origine est conservé (`o.image ?`)', /\{o\.image \? \(/.test(CARTE));
vrai('Q1 la carte NATIVE garde sa vignette 56 px', /w-14 h-14/.test(NATIF));
vrai('Q2 les deux listes utilisent la même forme de vignette', /w-14 h-14 rounded-lg/.test(NATIF) && /w-14 h-14 rounded-lg/.test(CARTE));

section('J/K/L — aucun texte coupé, toute l\'information rendue');
vrai('J1 le titre est en `break-words`', /<h4 className="text-sm text-white font-medium break-words min-w-0">/.test(CARTE));
faux('J2 le titre n\'est pas tronqué', /<h4[^>]*truncate/.test(CARTE));
vrai('J3 l\'adresse est en `break-words`', /<span className="break-words min-w-0">\{o\.lieu \|\| o\.ville\}<\/span>/.test(CARTE));
faux('J4 l\'adresse n\'est pas tronquée', /truncate[^"]*">\{o\.lieu/.test(CARTE));
vrai('K1 le prix est rendu', /\{o\.prix === 0 \? t\('payment_free_label'\)/.test(CARTE));
vrai('K2 le prix ne se coupe pas', /text-accent text-sm font-semibold whitespace-nowrap/.test(CARTE));
vrai('L1 l\'organisateur est nommé', /t\('discovery_meeting_venue_by', \{ owner: o\.organisateur \}\)/.test(CARTE));

section('M — une offre seule ne doit pas être coincée');
vrai('M1 la règle de colonnes est explicite', /repeat\(auto-fit,minmax\(260px,1fr\)\)/.test(CARTE));
// ⚠️ MESURÉ EN PRODUCTION : avec `auto-fill`, les pistes vides sont créées, et
// l'offre unique occupait 307 px sur 672 à 768 px de large — la demi-colonne
// étroite que le lot devait supprimer. `auto-fit` replie les pistes vides.
// On lit l'ATTRIBUT, jamais la prose : le commentaire du code nomme
// volontairement `auto-fill` pour dire de ne pas y revenir.
const GRILLE = (CARTE.match(/className="grid gap-2 \[grid-template-columns:([^\]]*)\]"/) || [])[1] || '';
vrai('M1a la grille est lisible', GRILLE.length > 0);
faux('M1b `auto-fill` interdit : il coince une carte seule', GRILLE.includes('auto-fill'));
faux('M2 aucune colonne fixe imposée', /grid-cols-2/.test(CARTE));

section('N/O/P — LA LOGIQUE MÉTIER N\'A PAS BOUGÉ');
vrai('N1 R4 : même appel `destinationReservationOffre`', /const dest = destinationReservationOffre\(\{/.test(CARTE));
vrai('N2 R4 : même identifiant', /id: o\.afroboostOfferId,/.test(CARTE));
vrai('N3 R4 : même type d\'offre', /typeOffre: 'single_class',/.test(CARTE));
vrai('N4 R4 : même prix, jamais réécrit', /prix: o\.prix,/.test(CARTE));
vrai('N5 R4 : le lien n\'est rendu que si la destination est sûre', /\{dest\.ok && \(/.test(CARTE));
vrai('N6 R4 : l\'URL vient de `dest`, jamais reconstruite', /href=\{dest\.url\}/.test(CARTE));
vrai('N7 R4 : ouverture protégée', /rel="noopener noreferrer"/.test(CARTE));
vrai('O1 handler « Proposer » inchangé', /onClick=\{\(\) => handleProposerOffre\(o\.afroboostOfferId\)\}/.test(CARTE));
vrai('O2 le garde de source est intact', /if \(o\.source !== 'afroboost'\) return null;/.test(CARTE));
faux('P1 aucun domaine Afroboost écrit en dur dans la carte', /afroboost\.com/i.test(CARTE));
faux('P2 aucun paramètre de réservation écrit en dur', /reserver=1|\?offre=/.test(CARTE));

section('R — FIX ATTRIBUTION : l\'offre n\'appartient jamais au profil affiché');
vrai('R1 la section reste séparée et libellée', /t\('discovery_meeting_venues_label'\)/.test(CARTE));
vrai('R2 l\'avertissement est conservé', /t\('discovery_meeting_venues_hint'\)/.test(CARTE));
faux('R3 le profil affiché n\'est jamais présenté comme organisateur', /currentProfile[^\n]*organisateur|owner: currentProfile/.test(CARTE));


// ══════════════════════════════════════════════════════════════════════════
// LE MODAL « OÙ PRATIQUER ? » LUI-MÊME — l'autre carte, et le pire des deux
// rails. Le CTA y était une bande verticale collée au bord droit : `px-2.5`,
// `border-l`, AUCUN padding vertical, `text-[11px]`. « Réserver » y était donc
// le plus petit élément d'une carte dont il est l'action principale, et il
// prenait au titre la largeur qui manquait à celui-ci — d'où le `truncate`.
// ══════════════════════════════════════════════════════════════════════════
const D_MODAL = SRC.indexOf('Modal "Où pratiquer ?"');
const F_MODAL = D_MODAL >= 0 ? SRC.indexOf('</Dialog>', D_MODAL) : -1;
const MODAL = D_MODAL >= 0 && F_MODAL > D_MODAL ? SRC.slice(D_MODAL, F_MODAL) : '';

section('S — le modal « Où pratiquer ? » : le rail latéral');
vrai('S0 la section du modal est lisible', MODAL.length > 0);
const RACINE_M = (MODAL.match(/key=\{navId\} className="([^"]*)"/) || [])[1] || '';
vrai('S1 la className de la carte est lisible', RACINE_M.length > 0);
faux('S2 la carte n\'est plus `items-stretch`', RACINE_M.includes('items-stretch'));
vrai('S3 la carte empile contenu puis action', RACINE_M.includes('flex flex-col'));
faux('S4 plus aucun CTA en bande droite `rounded-r-xl`', /rounded-r-xl/.test(MODAL));
faux('S5 plus aucune séparation verticale `border-l`', /border-l border-white\/10/.test(MODAL));
faux('S6 plus aucun CTA en `text-[11px]` collé au bord', /flex-shrink-0 px-2\.5/.test(MODAL));
vrai('S7 le bouton principal prend toute la largeur', /w-full text-left p-3 transition/.test(MODAL));
vrai('S8 les actions ont leur propre rangée', /<div className="px-3 pb-3">/.test(MODAL));

section('T — hiérarchie et confort dans « Où pratiquer ? »');
const CTA_M = (MODAL.match(/w-full min-h-\[44px\] px-4 py-2\.5 rounded-full[^"]*/g) || []);
vrai('T1 les trois états du CTA sont pleine largeur et à 44 px', CTA_M.length === 3);
vrai('T2 « Réserver » porte le remplissage plein', CTA_M.some((c) => /bg-accent text-white/.test(c)));
vrai('T3 « Découvrir » reste secondaire, en contour', CTA_M.some((c) => /border border-white\/20/.test(c)));
vrai('T4 « bientôt » n\'est ni une action ni une promesse', CTA_M.some((c) => /text-white\/40 border border-white\/10/.test(c)));
vrai('T5 les deux CTA cliquables ont un focus visible', CTA_M.filter((c) => /focus-visible:ring-2/.test(c)).length === 2);

section('U — texte et vignette dans « Où pratiquer ? »');
faux('U1 le titre n\'est plus tronqué', /text-sm text-white font-medium truncate/.test(MODAL));
vrai('U2 le titre est en `break-words`', /text-sm text-white font-medium break-words/.test(MODAL));
faux('U3 le sous-titre n\'est plus tronqué', /text-\[11px\] text-white\/40 truncate/.test(MODAL));
faux('U4 plus de vignette 40 px', /w-10 h-10 rounded-lg/.test(MODAL));
vrai('U5 vignette 56 px, comme partout ailleurs', (MODAL.match(/w-14 h-14 rounded-lg/g) || []).length === 3);
vrai('U6 la règle de colonnes est la même que dans l\'autre liste', /repeat\(auto-fit,minmax\(260px,1fr\)\)/.test(MODAL));
const GRILLE_M = (MODAL.match(/className="grid gap-2 \[grid-template-columns:([^\]]*)\]"/) || [])[1] || '';
vrai('U6a la grille du modal est lisible', GRILLE_M.length > 0);
faux('U6b `auto-fill` interdit ici aussi', GRILLE_M.includes('auto-fill'));
faux('U7 plus de colonnes imposées par la largeur de fenêtre', /sm:grid-cols-2/.test(MODAL));

section('V — « OÙ PRATIQUER ? » : LA LOGIQUE MÉTIER N\'A PAS BOUGÉ');
vrai('V1 R4 : même appel', /destinationReservationOffre\(a\)/.test(MODAL));
vrai('V2 R4 : la destination reste conditionnée', /const reservable = destination !== null && destination\.ok;/.test(MODAL));
vrai('V3 R4 : ouverture protégée', /window\.open\(destination\.url, '_blank', 'noopener,noreferrer'\)/.test(MODAL));
vrai('V4 une offre sans adresse sûre ne reçoit aucun lien', /t\('where_practice_booking_soon'\)/.test(MODAL));
vrai('V5 navigation native inchangée', /router\.push\(buildActivityListUrl\(navId\)\)/.test(MODAL));
vrai('V6 « Découvrir » natif inchangé', /router\.push\(`\/activities\/\$\{navId\}`\)/.test(MODAL));
vrai('V7 le garde `disabled` est conservé', /disabled=\{estAfroboost && !reservable\}/.test(MODAL));
faux('V8 aucun domaine écrit en dur', /afroboost\.com/i.test(MODAL));

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
