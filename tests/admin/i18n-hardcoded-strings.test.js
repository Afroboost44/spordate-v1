/**
 * Fix #151 — Test anti-régression : détection des textes français hardcodés
 * dans les fichiers UI critiques qui doivent passer par t().
 *
 * Pourquoi ce test :
 *  Un développeur peut ajouter une nouvelle string en français directement
 *  dans un composant (<p>Mon texte</p>) au lieu de passer par t(). Quand
 *  l'utilisateur change la langue, ce texte reste en français → traduction
 *  visible "à moitié cassée".
 *
 *  Ce test scanne les fichiers UI prioritaires (header, settings, footer…)
 *  à la recherche de textes en JSX qui ressemblent à du français :
 *   - <Tag>Phrase ici</Tag>
 *   - title="Phrase"
 *   - label="Phrase"
 *
 *  Si une nouvelle string hardcodée arrive, le test casse → le développeur
 *  doit la convertir en t('key') et l'ajouter à defaultTranslations.
 *
 *  PATTERN BLACKLISTÉ : tout fichier de la WATCH_LIST doit avoir un compteur
 *  de strings FR hardcodées ≤ son seuil baseline. Augmenter le seuil = ajout
 *  d'une régression intentionnelle (refusé en review).
 *
 * Exécution : node tests/admin/i18n-hardcoded-strings.test.js
 */

const fs = require('fs');
const path = require('path');

// ─── Fichiers à surveiller + seuil maximum de strings FR hardcodées ───────
// Fix #156 — Audit global étendu à 30 fichiers UI principaux.
// Seuil = baseline mesuré le 2026-05-25 après les câblages #151 + audit complet.
// RÈGLE DE FER : ces seuils ne peuvent QUE diminuer. Toute augmentation =
// régression à corriger AVANT merge. Pour réduire un seuil, convertis des
// strings en t('key') et mets à jour le baseline ici.
const WATCH_LIST = [
  // Composants layout (priorité maximale — visibles partout)
  { file: 'src/components/layout/header.tsx', maxHardcoded: 0 },
  { file: 'src/components/layout/footer.tsx', maxHardcoded: 3 },
  // Pages user-facing critiques
  { file: 'src/app/settings/page.tsx', maxHardcoded: 4 },
  { file: 'src/app/discovery/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/chat/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/activities/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/profile/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/preferences/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/premium/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/payment/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/share/page.tsx', maxHardcoded: 0 },
  // Pages partner (utilisées par les studios)
  { file: 'src/app/partners/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/boost/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/offers/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/register/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/login/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/wallet/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/dashboard/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/layout.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/sessions/[sessionId]/check-in/page.tsx', maxHardcoded: 0 },
  // Composants profile (édition utilisateur)
  { file: 'src/components/profile/ProfileExtrasEditor.tsx', maxHardcoded: 0 },
  { file: 'src/components/profile/VoicePromptRecorder.tsx', maxHardcoded: 0 },
  { file: 'src/components/profile/DeleteAccountActions.tsx', maxHardcoded: 0 },
  // Notifications widget (#165 i18n)
  { file: 'src/components/notifications/NotificationsList.tsx', maxHardcoded: 0 },
  // Reports + reviews
  { file: 'src/components/reports/ReportUserDialog.tsx', maxHardcoded: 0 },
  { file: 'src/components/reviews/ReviewForm.tsx', maxHardcoded: 0 },
  // Verify selfie + creator
  { file: 'src/app/profile/verify-selfie/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/creator/dashboard/page.tsx', maxHardcoded: 0 },
  // Pages légales — traduction très sensible (CGU, privacy), tolère plus de FR
  // car ces pages ont un contenu juridique long. À convertir avec un docs-lawyer.
  { file: 'src/app/terms/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/privacy/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/legal/page.tsx', maxHardcoded: 0 },
  // Admin (interne, basse priorité de traduction)
  { file: 'src/app/admin/manage/page.tsx', maxHardcoded: 0 },
  { file: 'src/app/admin/revenue/page.tsx', maxHardcoded: 0 },
  // Audit étendu — top 15 composants user-facing convertis en t()
  { file: 'src/components/activities/InvitedActivityBanner.tsx', maxHardcoded: 0 },
  { file: 'src/components/payment/RechargeBanner.tsx', maxHardcoded: 0 },
  { file: 'src/components/layout/CreditsBadge.tsx', maxHardcoded: 0 },
  { file: 'src/components/sessions/EmptyStateSessions.tsx', maxHardcoded: 0 },
  { file: 'src/components/onboarding/StepGrowth.tsx', maxHardcoded: 0 },
  { file: 'src/app/partner/wallet/return/page.tsx', maxHardcoded: 0 },
  { file: 'src/components/reports/NoShowCheckInList.tsx', maxHardcoded: 0 },
  { file: 'src/components/partner/VenueDetailsSection.tsx', maxHardcoded: 0 },
  { file: 'src/components/chat/ActivitySelectorModal.tsx', maxHardcoded: 0 },
  { file: 'src/components/partner/CreateSessionModal.tsx', maxHardcoded: 0 },
  { file: 'src/components/partner/SessionEditModal.tsx', maxHardcoded: 0 },
  { file: 'src/app/profile/[uid]/page.tsx', maxHardcoded: 0 },
  { file: 'src/components/invites/InviteButton.tsx', maxHardcoded: 0 },
  { file: 'src/app/onboard/prompts/page.tsx', maxHardcoded: 0 },
  { file: 'src/components/partner/MediaManager.tsx', maxHardcoded: 0 },
  { file: 'src/components/partner/VideoThumbnailPicker.tsx', maxHardcoded: 0 },
];

// ─── Heuristiques détection texte français hardcodé ──────────────────────
// On match les caractères accentués français + mots courants 100% FR qui
// ne se trouvent pas en anglais ni en allemand.
const FRENCH_MARKERS = /[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ]|\b(les|des|votre|notre|nos|leurs?|déjà|toujours|aussi|aucune?|chez|pour|avec|sans|cette?|ces|que|qui|où|tous|toutes?)\b/i;

function isLikelyFrenchText(s) {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 3) return false;
  if (/^[A-Z0-9_]+$/.test(trimmed)) return false; // constantes
  if (/^[\d.,$€%]+$/.test(trimmed)) return false; // valeurs numériques
  // Fix #162 — noms natifs des langues dans le sélecteur (Français/English/Deutsch)
  // ne doivent PAS être traduits par convention i18n.
  if (['Français', 'English', 'Deutsch'].includes(trimmed)) return false;
  return FRENCH_MARKERS.test(trimmed);
}

function countHardcodedFrenchInFile(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const findings = [];

  // 1. Texte entre balises JSX simples : <Tag>texte</Tag>
  //    On évite de matcher les expressions {var} ou {t('...')}.
  const jsxTextRe = />([^<>{}\n]{3,200})</g;
  let m;
  while ((m = jsxTextRe.exec(src)) !== null) {
    const text = m[1].trim();
    if (text.startsWith('{') || text.startsWith('t(')) continue;
    if (isLikelyFrenchText(text)) {
      findings.push({ kind: 'jsx-text', text });
    }
  }

  // 2. Attributs title="…", label="…", placeholder="…", description="…"
  const attrRe = /\b(title|label|placeholder|description|alt|aria-label)\s*=\s*["']([^"']{3,200})["']/g;
  while ((m = attrRe.exec(src)) !== null) {
    if (isLikelyFrenchText(m[2])) {
      findings.push({ kind: `attr-${m[1]}`, text: m[2] });
    }
  }

  return findings;
}

let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

const projectRoot = path.resolve(__dirname, '..', '..');

for (const entry of WATCH_LIST) {
  const abs = path.join(projectRoot, entry.file);
  if (!fs.existsSync(abs)) {
    fail(`Fichier introuvable : ${entry.file}`);
    continue;
  }
  const findings = countHardcodedFrenchInFile(abs);
  if (findings.length <= entry.maxHardcoded) {
    ok(`${entry.file} — ${findings.length} string(s) FR hardcodée(s) (≤ ${entry.maxHardcoded})`);
  } else {
    fail(
      `${entry.file} — ${findings.length} string(s) FR hardcodée(s) > seuil ${entry.maxHardcoded}`,
      findings.slice(0, 10).map(f => `${f.kind}: "${f.text}"`),
    );
  }
}

// CASE FINAL — Vérification que la page Settings utilise bien t()
//   Critère : on retrouve au moins 5 appels t('...') dans le fichier ET
//   l'ancien anti-pattern `void _t` a disparu.
{
  const settingsSrc = fs.readFileSync(
    path.join(projectRoot, 'src/app/settings/page.tsx'),
    'utf8',
  );
  const tCalls = (settingsSrc.match(/\bt\(\s*['"][a-z_]+/g) || []).length;
  // Strip line comments + block comments avant de chercher l'anti-pattern.
  const stripped = settingsSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
  const hasVoidT = /^\s*void\s+_t\s*;/m.test(stripped);
  if (tCalls >= 5 && !hasVoidT) {
    ok(`Settings page utilise t() (${tCalls} appels, preuve fix #151)`);
  } else {
    fail(`Settings page n'utilise pas t() correctement (regression #151)`,
      { tCalls, hasVoidT });
  }
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
