/**
 * F3 — LE PONT NE DEVIENT PAS UN TREMPLIN DE REDIRECTION OUVERTE.
 *
 * `?next=` permet à afroboost d'entrer directement sur une page (ex. /profile).
 * Mais un `next` est fourni par le navigateur : ce banc prouve qu'AUCUNE URL
 * externe ne peut être atteinte à travers lui.
 */
import { cheminNextSur } from '../../src/lib/bridge/destinationNext';

let _p = 0, _f = 0;
function egal(l: string, o: unknown, a: unknown) { if (o === a) { console.log(`PASS  ${l}`); _p++; } else { console.log(`FAIL  ${l} — obtenu ${JSON.stringify(o)}, attendu ${JSON.stringify(a)}`); _f++; } }
function section(t: string) { console.log(`\n--- ${t} ---`); }

const BP = '/rencontre';

section('A — un chemin interne est accepté et préfixé');
egal('A1 /profile → /rencontre/profile', cheminNextSur('/profile', BP), '/rencontre/profile');
egal('A2 déjà préfixé → conservé', cheminNextSur('/rencontre/profile', BP), '/rencontre/profile');
egal('A3 sans basePath → tel quel', cheminNextSur('/profile', ''), '/profile');
egal('A4 sous-chemin', cheminNextSur('/profile/blocks', BP), '/rencontre/profile/blocks');

section('B — TOUTE tentative d\'échappement est refusée (open redirect)');
egal('B1 URL absolue http', cheminNextSur('http://mechant.test', BP), null);
egal('B2 URL absolue https', cheminNextSur('https://mechant.test/x', BP), null);
egal('B3 protocole-relatif //host', cheminNextSur('//mechant.test', BP), null);
egal('B4 backslash //\\host', cheminNextSur('/\\mechant.test', BP), null);
egal('B5 javascript:', cheminNextSur('javascript:alert(1)', BP), null);
egal('B6 schéma dans le chemin', cheminNextSur('/x?u=http://y', BP), null);
egal('B7 caractère de contrôle', cheminNextSur('/x\ny', BP), null);
egal('B8 chemin relatif sans slash', cheminNextSur('profile', BP), null);
egal('B9 vide → null', cheminNextSur('', BP), null);
egal('B10 null → null', cheminNextSur(null, BP), null);

console.log(`\n${_p} PASS · ${_f} FAIL`);
process.exit(_f === 0 ? 0 : 1);
