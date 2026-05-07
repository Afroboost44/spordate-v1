/**
 * Phase 8 sub-chantier 1 commit 2/5 — Anti-leak Layer 1 (regex pure, FR-only).
 *
 * Doctrine §C : architecture hybride regex (rapide, gratuit, déterministe) en
 * première passe + IA Genkit (lent, contextuel) en deuxième passe sur les cas
 * ambigus. Ce module ship la première passe.
 *
 * Doctrine §C.Q3 : FR uniquement Phase 8. DE + IT déférés Phase 10+.
 * Doctrine §B.line567 : L1 = "Aucune (analyse silencieuse, log serveur)".
 *   → SC1 ce module est appelé inline dans sendMessage() (commit 3/5),
 *     écrit un log /aiScanLogs/ server-only (jamais de UX feedback).
 * Latence target : <5ms pure regex (cohérent doctrine line 588 <200ms p95 chat).
 *
 * 5 catégories doctrine §C ligne 600-604 :
 *   - phone-ch       : numéros suisses 0XX-XXX-XX-XX
 *   - phone-intl     : numéros internationaux +41 ...
 *   - email          : emails standard
 *   - handle         : @handle avec heuristique proximité (insta|ig|snap|tiktok|snapchat)
 *   - domain         : domaines TLD courants (.ch|.com|.net|.org|.io|.fr|.app)
 *   - keyword        : mots-clés plateformes (WhatsApp|Telegram|DM moi|MP|Signal|Viber|envoie sur)
 *
 * Anti-faux-positif design (doctrine §B.Q4 cible précision 92-95%) :
 *   - "555 calories"   → pas phone (manque "0" leading)
 *   - "merci@toi"      → pas email (manque TLD)
 *   - "@samedi"        → pas handle (pas de mot-clé plateforme à proximité)
 *   - "telegraph"      → pas keyword (word boundary strict empêche match "telegram")
 */

// =====================================================================
// Patterns
// =====================================================================

/** Numéro suisse format 0XX XXX XX XX (avec ou sans espaces). */
export const PHONE_CH_PATTERN = /\b0[0-9]{2}\s?[0-9]{3}\s?[0-9]{2}\s?[0-9]{2}\b/g;

/** Numéro international Suisse +41 XX XXX XX XX. \b incompatible avec '+' donc omis en début. */
export const PHONE_INTL_PATTERN = /\+41\s?[0-9]{2}\s?[0-9]{3}\s?[0-9]{2}\s?[0-9]{2}\b/g;

/** Email standard local@domain.tld (TLD ≥ 2 lettres, requis pour réduire FP). */
export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Handle social @xxx (3-30 chars). Heuristique : flagged uniquement si proximité keyword. */
export const SOCIAL_HANDLE_PATTERN = /@[A-Za-z0-9_.]{3,30}/g;

/** Mots-clés à proximité (±20 chars) pour activer un handle. */
export const SOCIAL_PROXIMITY_KEYWORDS: readonly string[] = ['insta', 'ig', 'snap', 'tiktok', 'snapchat'];

/** Domaine TLD FR-courant (Phase 8 doctrine §C.Q3). Case-insensitive. */
export const DOMAIN_PATTERN = /\b[a-z0-9-]+\.(ch|com|net|org|io|fr|app)\b/gi;

/** Mots-clés plateformes — word boundaries strictes (telegraph ≠ telegram). Case-insensitive.
 *  Inclut noms standalone (insta, snap, tiktok) en plus des proximity keywords pour
 *  capturer "écris-moi sur insta" sans @handle. Multi-occurrence dans la même cat
 *  donne +0.1 score (cf. scoring multi-occurrence). */
export const PLATFORM_KEYWORD_PATTERN = /\b(whatsapp|telegram|dm\s+moi|mp|signal|viber|envoie\s+sur|insta|instagram|ig|snap|snapchat|tiktok)\b/gi;

// =====================================================================
// Types
// =====================================================================

/** Catégories de motif L1. 'clean' = aucun match. SC2 ajoutera des motifs IA. */
export type L1ScanMotive = 'phone-ch' | 'phone-intl' | 'email' | 'handle' | 'domain' | 'keyword' | 'clean';

/** Détail d'un match individuel — utile pour forensics + tuning prompt SC2. */
export interface L1ScanMatch {
  category: Exclude<L1ScanMotive, 'clean'>;
  match: string;
}

/** Résultat de scan L1. Mappé vers AiScanLog (commit 3/5) côté service. */
export interface L1ScanResult {
  /** true si au moins 1 match — SC1 silent log (pas de blocage UX, doctrine §B.line567). */
  flagged: boolean;
  /** Score ∈ [0,1]. 0=clean, 0.5=1 cat, 0.6=1 cat multi-occurrence, 0.8=2+ cat, 0.9=2+ cat multi. */
  score: number;
  /** Motive principal selon priorité (phone-intl > phone-ch > email > handle > domain > keyword). */
  motive: L1ScanMotive;
  /** Liste des matches (pour audit + tuning ; jamais persistée en clair, hashée côté service). */
  matches: L1ScanMatch[];
}

/** Priorité motive (du plus risqué vers le moins). Phone direct > email > handle indirect. */
const CATEGORY_PRIORITY: Array<Exclude<L1ScanMotive, 'clean'>> = [
  'phone-intl',
  'phone-ch',
  'email',
  'handle',
  'domain',
  'keyword',
];

// =====================================================================
// Scan principal
// =====================================================================

/**
 * Phase 8 SC1 — scan L1 d'un message texte FR. Pure function, idempotente.
 *
 * Dedup inter-catégorie : un email co-contient un domaine (test@example.com → "example.com").
 * Sans dedup, score serait artificiellement gonflé à 0.8 (multi-cat) sur un simple email.
 * Ranges déjà consommés par phone/email sont skippés pour handle/domain.
 *
 * @param message Contenu textuel à scanner (FR uniquement Phase 8).
 * @returns L1ScanResult — flagged / score / motive / matches.
 */
export function scanMessageL1(message: string): L1ScanResult {
  const matches: L1ScanMatch[] = [];
  /** Ranges déjà attribués à une catégorie prioritaire — [start, end) inclusif/exclusif. */
  const consumedRanges: Array<[number, number]> = [];

  const isWithinConsumed = (idx: number): boolean =>
    consumedRanges.some(([s, e]) => idx >= s && idx < e);

  // 1. Phone INTL (+41) — priorité haute
  for (const m of message.matchAll(PHONE_INTL_PATTERN)) {
    const idx = m.index ?? 0;
    matches.push({ category: 'phone-intl', match: m[0] });
    consumedRanges.push([idx, idx + m[0].length]);
  }

  // 2. Phone CH (0XX) — priorité haute, skip si chevauche INTL
  for (const m of message.matchAll(PHONE_CH_PATTERN)) {
    const idx = m.index ?? 0;
    if (isWithinConsumed(idx)) continue;
    matches.push({ category: 'phone-ch', match: m[0] });
    consumedRanges.push([idx, idx + m[0].length]);
  }

  // 3. Email — priorité haute, range consommé
  for (const m of message.matchAll(EMAIL_PATTERN)) {
    const idx = m.index ?? 0;
    matches.push({ category: 'email', match: m[0] });
    consumedRanges.push([idx, idx + m[0].length]);
  }

  // 4. Social handle avec heuristique proximité ±20 chars, skip si chevauche email
  for (const m of message.matchAll(SOCIAL_HANDLE_PATTERN)) {
    const idx = m.index ?? 0;
    if (isWithinConsumed(idx)) continue;
    const window = message
      .slice(Math.max(0, idx - 20), Math.min(message.length, idx + m[0].length + 20))
      .toLowerCase();
    if (SOCIAL_PROXIMITY_KEYWORDS.some((kw) => window.includes(kw))) {
      matches.push({ category: 'handle', match: m[0] });
    }
  }

  // 5. Domaines TLD — skip si chevauche email/phone (dedup principale)
  for (const m of message.matchAll(DOMAIN_PATTERN)) {
    const idx = m.index ?? 0;
    if (isWithinConsumed(idx)) continue;
    matches.push({ category: 'domain', match: m[0] });
    consumedRanges.push([idx, idx + m[0].length]);
  }

  // 6. Keywords plateformes — pas de dedup (mots autonomes)
  for (const m of message.matchAll(PLATFORM_KEYWORD_PATTERN)) {
    matches.push({ category: 'keyword', match: m[0] });
  }

  if (matches.length === 0) {
    return { flagged: false, score: 0, motive: 'clean', matches: [] };
  }

  const distinctCategories = new Set(matches.map((m) => m.category));
  let score = distinctCategories.size >= 2 ? 0.8 : 0.5;
  if (matches.length > distinctCategories.size) {
    // multi-occurrence dans une même catégorie → +0.1 (capped 1.0)
    score = Math.min(1, score + 0.1);
  }

  // Motive principal selon priorité (premier hit dans CATEGORY_PRIORITY)
  const motive = CATEGORY_PRIORITY.find((cat) => distinctCategories.has(cat)) ?? 'clean';

  return { flagged: true, score, motive, matches };
}
