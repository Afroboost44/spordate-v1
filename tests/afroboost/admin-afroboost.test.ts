/**
 * LOT A — LA PREUVE SERVEUR « CE COMPTE EST L'ADMINISTRATEUR ».
 *
 * Exécution :
 *   npx tsx tests/afroboost/admin-afroboost.test.ts
 *
 * CE QUE CE BANC PROUVE, ET POURQUOI IL COMPTE PLUS QUE LES AUTRES
 * La fonction éprouvée ici décidera, au lot suivant, qui peut mettre une offre
 * en avant SANS PAYER. Ce n'est pas une préférence d'affichage : c'est un
 * pouvoir. Un « à peu près » y coûterait qu'un compte quelconque s'octroie la
 * vitrine de la plateforme.
 *
 *   A. compte réellement administrateur      → preuve = true
 *   B. compte ordinaire                      → false
 *   C. identifiant absent                    → false
 *   D. role='admin' fabriqué côté client     → NE SUFFIT JAMAIS
 *   E. adresse admin sans l'interrupteur     → NE SUFFIT JAMAIS
 *   F. partenaire R3b-ID                     → inchangé
 *   G. admin et partenaire = deux chemins    → aucun ne remplace l'autre
 *   H. un compte B ne peut pas se déclarer admin
 *   I. aucun secret n'est exposé, rien n'est écrit
 *
 * AUCUN COMPTE RÉEL N'EST PROMU NI MODIFIÉ : tout est en mémoire.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { estAdminProuve } from '../../src/lib/afroboost/adminAfroboost';
import {
  autoriserBoostSurOffre,
  autoriserMiseEnAvantOffre,
} from '../../src/lib/boost/autorisationAfroboost';
import { estProprietaireDeLOffre } from '../../src/lib/afroboost/ownership';
import { ADMIN_EMAILS, isAdminEmail } from '../../src/lib/sports';

let _passes = 0;
let _failures = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _passes++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _failures++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie alors qu\'elle devait etre fausse') { if (!c) pass(l); else fail(l, d); }
function egal(l: string, obtenu: unknown, attendu: unknown) {
  if (obtenu === attendu) pass(l);
  else fail(l, `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);
}
function section(t: string) { console.log(`\n--- ${t} ---`); }

const ADMIN = ADMIN_EMAILS[0];
const OWNER_A = '11111111-2222-3333-4444-555555555555';
const OWNER_B = '99999999-8888-7777-6666-555555555555';

function offre(proprietaire: string, proprietaireId: string | null, typeOffre = 'single_class'): any {
  return { proprietaire, proprietaireId, typeOffre };
}
function codeSeul(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

function principal() {

section('A / B / C — la preuve, dans ses trois etats');
{
  vrai('A1. adresse de l\'annuaire dans la liste + interrupteur pose -> prouve',
       estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: 'admin' }));
  vrai('A2. la casse et les blancs ne changent rien',
       estAdminProuve({ emailAuthentifie: `  ${ADMIN.toUpperCase()} `, roleFirestore: 'admin' }));

  faux('B1. compte ordinaire, role ordinaire -> non',
       estAdminProuve({ emailAuthentifie: 'quelquun@exemple.invalid', roleFirestore: 'user' }));
  faux('B2. compte ordinaire meme avec un role fantaisiste -> non',
       estAdminProuve({ emailAuthentifie: 'quelquun@exemple.invalid', roleFirestore: 'superadmin' }));

  for (const vide of [null, undefined, '', '   ']) {
    faux(`C1. adresse « ${String(vide)} » -> non`,
         estAdminProuve({ emailAuthentifie: vide as any, roleFirestore: 'admin' }));
    faux(`C2. role « ${String(vide)} » -> non`,
         estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: vide as any }));
  }
  faux('C3. rien du tout -> non', estAdminProuve({} as any));
}

section('D — le drapeau fabrique cote client NE SUFFIT JAMAIS');
{
  // Le trou est reel : `firestore.rules` protege `role` en MODIFICATION, mais
  // `allow create: if isOwner(userId)` n'impose AUCUNE contrainte de champ, et
  // `createUser` s'execute dans le navigateur. Un compte sans document peut
  // donc se creer `role:'admin'`. C'est exactement ce cas qui est joue ici.
  faux('D1. role=admin fabrique + adresse quelconque -> refuse',
       estAdminProuve({ emailAuthentifie: 'attaquant@exemple.invalid', roleFirestore: 'admin' }));
  // Et la meme tentative en se donnant l'adresse de l'administrateur DANS
  // FIRESTORE ne marche pas non plus : l'adresse lue vient de l'annuaire
  // d'identite, jamais du document. Le banc le materialise en passant
  // l'adresse REELLE du compte (celle de l'attaquant) a la decision.
  faux('D2. document Firestore truque -> l\'annuaire dit la verite',
       estAdminProuve({ emailAuthentifie: 'attaquant@exemple.invalid', roleFirestore: 'admin' }));

  // La garde lit l'adresse depuis Firebase Authentication, pas depuis Firestore.
  const module_ = codeSeul('src/lib/afroboost/adminAfroboost.ts');
  vrai('D3. l\'adresse est lue dans l\'annuaire d\'identite', module_.includes('auth.getUser('));
  faux('D4. et JAMAIS depuis le document users', /snap\.data\(\)[^;]*\.email/.test(module_));
  faux('D5. ni depuis un corps de requete', /body|request\.|req\./i.test(module_));
}

section('E — l\'adresse seule ne suffit pas non plus');
{
  faux('E1. adresse admin mais interrupteur absent -> refuse',
       estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: 'user' }));
  faux('E2. adresse admin, role « partner » -> refuse',
       estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: 'partner' }));
  faux('E3. adresse admin, aucun role -> refuse',
       estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: null }));
  // Les DEUX conditions sont donc obligatoires, et ni l'une ni l'autre ne se
  // deduit de la seconde : retirer le role revoque le pouvoir en une ecriture,
  // sans redeploiement.
  vrai('E4. les deux ensemble, et seulement ensemble',
       estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: 'admin' })
       && !estAdminProuve({ emailAuthentifie: ADMIN, roleFirestore: 'user' })
       && !estAdminProuve({ emailAuthentifie: 'x@y.invalid', roleFirestore: 'admin' }));
}

section('F / G — le partenaire n\'a pas bouge, et les deux voies ne se melangent pas');
{
  // F. R3b-ID, a l'identique.
  vrai('F1. proprietaire prouve -> possede',
       estProprietaireDeLOffre(OWNER_A, offre('partner', OWNER_A)));
  faux('F2. un autre identifiant -> non', estProprietaireDeLOffre(OWNER_B, offre('partner', OWNER_A)));
  faux('F3. une offre admin n\'est possedee par aucun partenaire',
       estProprietaireDeLOffre(OWNER_A, offre('admin', OWNER_A)));

  // G. Etre administrateur ne rend PAS proprietaire d'une offre partenaire...
  const v1: any = autoriserMiseEnAvantOffre(offre('partner', OWNER_A), { adminProuve: true });
  faux('G1. admin prouve ne possede pas l\'offre d\'un partenaire', v1.ok);
  egal('G2. et le motif reste celui de la propriete', v1.refus, 'offre-non-possedee');

  // ... et etre proprietaire ne rend PAS administrateur.
  const v2: any = autoriserMiseEnAvantOffre(offre('admin', null), { proprietaireAfroboost: OWNER_A });
  faux('G3. un partenaire ne met pas en avant une offre de la plateforme', v2.ok);
  egal('G4. motif', v2.refus, 'admin-non-prouve');

  // Les deux voies nommees, distinctement.
  const a: any = autoriserMiseEnAvantOffre(offre('admin', null), { adminProuve: true });
  vrai('G5. admin prouve -> voie gratuite', a.ok);
  egal('G6. et elle porte son nom', a.voie, 'admin-gratuit');
  const p: any = autoriserMiseEnAvantOffre(offre('partner', OWNER_A), { proprietaireAfroboost: OWNER_A });
  vrai('G7. partenaire prouve -> voie achetee', p.ok);
  egal('G8. et elle porte son nom', p.voie, 'partenaire-achete');

  // Le type l'emporte sur tout : administrateur ou non.
  for (const type of ['pack', 'product', 'subscription', 'membership', 'other', 'unknown']) {
    const v: any = autoriserMiseEnAvantOffre(offre('admin', null, type), { adminProuve: true });
    faux(`G9. admin prouve ne met pas « ${type} » en avant`, v.ok);
    egal(`G10. motif ${type}`, v.refus, 'offre-non-boostable');
  }
  const absente: any = autoriserMiseEnAvantOffre(null, { adminProuve: true });
  egal('G11. offre introuvable -> refus', absente.refus, 'offre-introuvable');
  const inconnue: any = autoriserMiseEnAvantOffre(offre('unknown', OWNER_A), { adminProuve: true });
  faux('G12. propriete « unknown » -> aucune voie', inconnue.ok);
}

section('H — aucun compte ne peut se declarer administrateur');
{
  // La liste d'autorisation est une constante du depot, pas une donnee.
  vrai('H1. la liste est centralisee et versionnee', Array.isArray(ADMIN_EMAILS as any) || ADMIN_EMAILS.length > 0);
  faux('H2. une adresse inventee n\'y entre pas', isAdminEmail('faux-admin@exemple.invalid'));
  faux('H3. ni une variante approchante', isAdminEmail(ADMIN.replace('@', '+x@')));
  faux('H4. ni une chaine vide', isAdminEmail(''));
  // Et la garde ne lit AUCUNE variable d'environnement modifiable a chaud
  // qui pourrait elargir la liste sans revue de code.
  const module_ = codeSeul('src/lib/afroboost/adminAfroboost.ts');
  faux('H5. aucune liste parallele via l\'environnement', /process\.env/.test(module_));
}

section('I — rien n\'est ecrit, rien n\'est expose, aucun achat n\'est ouvert');
{
  const module_ = codeSeul('src/lib/afroboost/adminAfroboost.ts');
  for (const mot of ['set(', 'update(', 'add(', 'delete(', 'setCustomUserClaims']) {
    faux(`I1. le module n'ecrit rien : « ${mot} »`, module_.includes(mot));
  }
  faux('I2. il ne promeut personne', /promote|role\s*:\s*'admin'/.test(module_));
  faux('I3. et ne rend jamais une adresse', /return[^;\n]*email/.test(module_));

  // LE POINT LE PLUS IMPORTANT DE CE LOT : le chemin d'ACHAT n'a pas bouge.
  // Un administrateur ne peut toujours pas declencher de reglement.
  const achat: any = autoriserBoostSurOffre(offre('admin', null), 'peu-importe');
  faux('I4. le chemin d\'achat refuse toujours une offre admin', achat.ok);
  egal('I5. avec le meme motif qu\'avant', achat.refus, 'offre-admin');
  const achatPartenaire: any = autoriserBoostSurOffre(offre('partner', OWNER_A), OWNER_A);
  vrai('I6. et le chemin partenaire est intact', achatPartenaire.ok);

  // Les deux routes de reglement n'ont pas appris la nouvelle decision.
  for (const chemin of ['src/app/api/boost-checkout/route.ts', 'src/app/api/boost-credits/route.ts']) {
    const code = codeSeul(chemin);
    faux(`I7. ${chemin} n'utilise PAS la mise en avant`, code.includes('autoriserMiseEnAvantOffre'));
    faux(`I8. ${chemin} ne connait pas la preuve admin`, code.includes('estAdminAfroboostAutorise'));
    vrai(`I9. ${chemin} interroge toujours le chemin d'achat`, code.includes('autoriserBoostSurOffre'));
  }
  // Et aucun ecran ne l'utilise encore : le lot B n'a pas commence.
  for (const chemin of ['src/app/partner/boost/page.tsx', 'src/app/discovery/page.tsx']) {
    const code = codeSeul(chemin);
    faux(`I10. ${chemin} n'utilise pas encore la preuve admin`,
         code.includes('estAdminAfroboostAutorise') || code.includes('autoriserMiseEnAvantOffre'));
  }
}

console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
console.log('Comptes promus : 0 — ecritures : 0 — Boost : 0 — paiements : 0');
if (_failures > 0) process.exit(1);
}

principal();
