/**
 * CHARGEMENT DE LA CLÉ DE COMPTE DE SERVICE — SANS JAMAIS L'IMPRIMER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * Le 07/09/2026, la clé privée ACTIVE de `spordate-prod` a été imprimée en
 * entier dans un terminal. La cause : un `JSON.parse(process.env.
 * FIREBASE_SERVICE_ACCOUNT_KEY)` NU, au premier niveau d'un script. Quand le
 * parsing échoue, Node imprime la ligne fautive — et cette ligne EST la clé.
 *
 * Cinq scripts de ce dossier portaient exactement le même appel. Chacun était
 * la même fuite en attente d'une valeur mal formée. Ils passent tous par ici.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE FONCTION GARANTIT
 * ─────────────────────────────────────────────────────────────────────────
 *   • le parsing est fait DANS un try/catch, jamais au premier niveau ;
 *   • l'erreur levée ne contient ni la valeur, ni un fragment, ni sa longueur
 *     au-delà d'un ordre de grandeur ;
 *   • le cas historique — sauts de ligne LITTÉRAUX dans `private_key` — est
 *     réparé comme le fait `parseServiceAccountKeyDefensive` côté application ;
 *   • le cas local — valeur entourée de guillemets par le fichier `.env` —
 *     est retiré avant parsing.
 *
 * ⚠️ NE JAMAIS remettre un `JSON.parse` direct sur cette variable, nulle part.
 * `tests/auth/service-account-parse.test.ts` refuse la livraison si un seul
 * réapparaît dans le dépôt.
 */
function chargerCleServiceAccount() {
  const brut = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!brut || !String(brut).trim()) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY absente de l\'environnement.');
  }
  let v = String(brut).trim();
  // Un fichier `.env` peut entourer la valeur de guillemets. On les retire —
  // et SEULEMENT eux, sans toucher aux guillemets internes du JSON.
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    v = v.slice(1, -1);
  }
  try {
    return JSON.parse(v);
  } catch (e1) {
    try {
      return JSON.parse(v.replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
    } catch (e2) {
      // AUCUNE des deux exceptions n'est recopiée : leurs messages contiennent
      // une position, mais un message futur pourrait contenir davantage, et on
      // ne parie pas la clé sur la sobriété d'une bibliothèque.
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY illisible : ce n\'est pas du JSON valide. ' +
        'La valeur n\'est volontairement pas affichée. Vérifiez qu\'elle est le ' +
        'contenu BRUT du fichier de clé, sur une seule ligne, sans guillemets ' +
        'echappes a la main (`{\\"type\\":…` est la faute la plus frequente).',
      );
    }
  }
}

module.exports = { chargerCleServiceAccount };
