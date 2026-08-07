/**
 * Client pawaPay — Mobile Money panafricain.
 *
 * ⚠️ MÊME COMPTE QUE AFROBOOST, ET C'EST VOULU. Spordateur réutilise le compte
 * pawaPay « AFROBOOSTEUR » (12 pays ouverts) déjà en production sur afroboost :
 * une seule relation commerciale, un seul jeu de versements, une seule
 * réconciliation. Le jeton est lu dans l'environnement, jamais écrit ici.
 *
 * ⚠️ LE SCHÉMA v2 N'EST PAS CELUI DES EXEMPLES DE LA DOC (restés en v1). L'API
 * attend `amountDetails: {amount, currency}` — surtout PAS un `amount` en
 * racine, qui renvoie « UNSUPPORTED_PARAMETER » — et `phoneNumber`, pas `msisdn`.
 * `reason` est tronqué à 50 caractères : au-delà, l'appel est refusé.
 * Cette leçon a déjà été payée côté afroboost ; ce fichier en hérite.
 */

const BASE = (process.env.PAWAPAY_BASE_URL || 'https://api.sandbox.pawapay.io').replace(/\/+$/, '');
const TOKEN = process.env.PAWAPAY_API_TOKEN || '';

/** L'intégration est-elle utilisable ? Sans jeton, l'UI masque proprement le moyen. */
export function pawapayConfigured(): boolean {
  return Boolean(TOKEN);
}

export interface PaysPawapay {
  code: string;      // ISO alpha-3, ex. « CIV »
  currency: string;  // ex. « XOF »
  label: string;
}

/** Libellés FR. Un pays absent d'ici retombe sur son code ISO — jamais d'écran vide. */
const NOMS: Record<string, string> = {
  BEN: 'Bénin', BFA: 'Burkina Faso', CIV: "Côte d'Ivoire", CMR: 'Cameroun',
  COD: 'RD Congo', COG: 'Congo-Brazzaville', GAB: 'Gabon', GHA: 'Ghana',
  KEN: 'Kenya', MWI: 'Malawi', MOZ: 'Mozambique', NGA: 'Nigeria',
  RWA: 'Rwanda', SEN: 'Sénégal', SLE: 'Sierra Leone', TZA: 'Tanzanie',
  UGA: 'Ouganda', ZMB: 'Zambie',
};

/**
 * Les pays RÉELLEMENT ouverts sur le compte, lus chez pawaPay.
 *
 * ⚠️ JAMAIS UNE LISTE EN DUR. Le jour où un pays s'ouvre (ou se ferme) sur le
 * compte, l'écran doit suivre sans redéploiement — et surtout ne jamais proposer
 * un pays que le compte ne sert pas : le client paierait pour un refus.
 */
export async function paysDisponibles(): Promise<PaysPawapay[]> {
  if (!TOKEN) return [];
  const r = await fetch(`${BASE}/v2/active-conf`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!r.ok) return [];
  const d = await r.json();
  const out: PaysPawapay[] = [];
  for (const pays of (d?.countries || [])) {
    const code = pays?.country;
    // La devise vit sous le premier « provider » du pays.
    const cur = pays?.providers?.[0]?.currencies?.[0]?.currency;
    if (code && cur) out.push({ code, currency: cur, label: NOMS[code] || code });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/**
 * Taux CHF -> devise locale.
 *
 * ⚠️ APPROXIMATIFS ET ASSUMÉS. pawaPay ne convertit pas : il encaisse un montant
 * DANS la devise locale. Ces taux servent à présenter un prix cohérent ; ils sont
 * volontairement ARRONDIS AU-DESSUS pour que le commerçant ne perde jamais sur la
 * conversion. Les mêmes valeurs que le live, pour ne pas afficher deux prix
 * différents pour un même produit.
 */
const TAUX: Record<string, number> = {
  XOF: 655, XAF: 655, GHS: 16, KES: 145, NGN: 1700,
  RWF: 1450, UGX: 4200, ZMW: 30, CDF: 3200, SLE: 25, MWK: 1900, MZN: 72, TZS: 2900,
};

/** Convertit un montant en CENTIMES CHF vers la devise locale, arrondi à l'entier supérieur. */
export function montantLocal(centimesChf: number, devise: string): number {
  const taux = TAUX[devise];
  if (!taux) throw new Error(`Devise non gérée : ${devise}`);
  return Math.max(1, Math.ceil((centimesChf / 100) * taux));
}

/** Numéro au format international sans « + » ni séparateurs, comme l'attend pawaPay. */
export function normaliserTelephone(brut: string): string {
  return (brut || '').replace(/[^0-9]/g, '');
}

/**
 * Ouvre une session « Payment Page » et renvoie l'URL de redirection.
 *
 * ⚠️ LE `depositId` DOIT ÊTRE UN UUID et être STOCKÉ AVANT cet appel : si le
 * réseau lâche après l'envoi, c'est la seule référence permettant de retrouver le
 * dépôt côté pawaPay. Un autre format est refusé (« INVALID_PARAMETER ») —
 * erreur déjà commise et corrigée côté afroboost.
 */
export async function ouvrirPagePaiement(args: {
  depositId: string;
  montant: number;
  devise: string;
  pays: string;
  motif: string;
  urlRetour: string;
  telephone?: string;
}): Promise<string> {
  if (!TOKEN) throw new Error('pawaPay non configuré');
  const payload: Record<string, unknown> = {
    depositId: args.depositId,
    returnUrl: args.urlRetour,
    language: 'FR',
    country: args.pays,
    amountDetails: { amount: String(Math.trunc(args.montant)), currency: args.devise },
  };
  if (args.motif) payload.reason = args.motif.slice(0, 50);
  const tel = normaliserTelephone(args.telephone || '');
  if (tel) payload.phoneNumber = tel;

  const r = await fetch(`${BASE}/v2/paymentpage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.redirectUrl) {
    const detail = d?.failureReason?.failureMessage || d?.message || `HTTP ${r.status}`;
    throw new Error(`pawaPay: ${detail}`);
  }
  return d.redirectUrl as string;
}

/**
 * Statut RÉEL d'un dépôt, relu chez pawaPay.
 *
 * ⚠️ ON NE CROIT JAMAIS LE CALLBACK SUR PAROLE. Il n'est pas signé : n'importe
 * qui connaissant un `depositId` pourrait prétendre qu'un paiement a réussi. Le
 * callback ne sert qu'à SAVOIR QUAND regarder ; la vérité vient d'ici.
 */
export async function statutDepot(depositId: string): Promise<string> {
  if (!TOKEN) throw new Error('pawaPay non configuré');
  const r = await fetch(`${BASE}/v2/deposits/${encodeURIComponent(depositId)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`pawaPay statut: HTTP ${r.status}`);
  const d = await r.json();
  return (d?.status || d?.data?.status || '') as string;
}
