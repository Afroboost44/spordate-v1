#!/usr/bin/env node
/**
 * Anti-régression — Bug récurrent "product_data[name] cannot be empty" Stripe.
 *
 * Scanne tous les fichiers src/ (ts/tsx) pour trouver les call sites qui
 * construisent un payload Stripe avec :
 *
 *   product_data: {
 *     name: <something>,
 *     ...
 *   }
 *
 * RÈGLE (CLAUDE.md) : la valeur `name:` doit être SOIT :
 *   - une string littérale non-vide (ex. `name: 'Pack Starter'`)
 *   - une template string qui n'est PAS uniquement une variable nue
 *     potentiellement vide (ex. `name: 'Boost — ${city}'` OK car prefix non-vide)
 *   - le résultat d'un appel à `safeStripeProductName(...)` (cf.
 *     `src/lib/stripe/safeProductName.ts`)
 *
 * INTERDIT (rejet du test) :
 *   - `name: session.title` ou `name: activity.title` ou `name: pkg.label` brut
 *     sans passer par safeStripeProductName, car ces champs peuvent être '' en
 *     Firestore legacy → Stripe rejette le checkout.
 *
 * Si tu DOIS exposer un name dynamique :
 *   import { safeStripeProductName } from '@/lib/stripe/safeProductName';
 *   product_data: {
 *     name: safeStripeProductName({ title: session.title, name: activity.name }),
 *     ...
 *   }
 *
 * Allow-list : noms 100% statiques (string literal entre quotes), template
 * strings dont le premier segment est du texte fixe non-vide (ex. `Boost — ${x}`),
 * et appels à safeStripeProductName(...).
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../../src');
const ROOT = path.resolve(__dirname, '../..');

/**
 * Vérifie qu'à la fin d'une ligne, les parenthèses, accolades et backticks
 * sont équilibrés (mode strict, sans gérer les strings imbriquées). Suffisant
 * pour les cas simples `name: 'literal',` ou `name: someIdent,`.
 */
function balancedAtLineEnd(line) {
  let paren = 0, brace = 0, brack = 0, tick = 0;
  for (const ch of line) {
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '[') brack++;
    else if (ch === ']') brack--;
    else if (ch === '`') tick++;
  }
  return paren === 0 && brace === 0 && brack === 0 && tick % 2 === 0;
}

/** Walk récursif sur src pour récupérer tous les .ts/.tsx. */
function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Détecte les blocs `product_data: { ... }` et capture la valeur du champ
 * `name:` à l'intérieur. Utilise une regex multi-ligne simple, suffisante
 * pour notre codebase (formaté par Prettier).
 *
 * Renvoie un tableau { file, line, nameExpression, blockSnippet }.
 */
function findProductDataNameValues(content, file) {
  const matches = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // Detecte "product_data:" ouvrant un objet
    if (!/product_data\s*:\s*\{/.test(line)) continue;

    // Cas 1 : product_data inline `product_data: { name: ..., description: ... },`
    // → on extrait inline tout de suite.
    const inlineMatch = line.match(/product_data\s*:\s*\{\s*name\s*:\s*([^,}]+)/);
    if (inlineMatch) {
      let expr = inlineMatch[1].trim();
      // Couper avant la prochaine clé si présente (ex. inline ne termine pas
      // par `,` mais par une string littérale avec `description:` plus loin
      // sur la même ligne — déjà géré par [^,}]+ qui s'arrête à `,` ou `}`).
      matches.push({
        file: path.relative(ROOT, file),
        line: i + 1,
        nameExpression: expr,
      });
      continue;
    }

    // Cas 2 : product_data multi-ligne (ouverture sur cette ligne, name: sur ligne suivante)
    // On regarde la ligne courante puis les 20 suivantes à la recherche de `name:`.
    const windowEnd = Math.min(lines.length, i + 40);
    let nameLineIdx = -1;
    let nameExpression = '';
    for (let j = i; j < windowEnd; j++) {
      const candidate = lines[j];
      // On stoppe si on rencontre une fermeture du bloc product_data
      // (heuristique : ligne contenant `},` ou `}` seul après le contexte
      // courant). Mais comme name est généralement la 1ere clé, on cherche
      // simplement `name:` jusqu'à la fin du bloc raisonnable.
      const m = candidate.match(/^\s*name\s*:\s*(.+)$/);
      if (m) {
        nameLineIdx = j;
        // L'expression peut s'étaler sur plusieurs lignes (IIFE, template
        // multi-line). On consomme jusqu'à ce que le compteur de parenthèses
        // / accolades / backticks revienne à 0 ET qu'on trouve `,` ou la fin
        // de l'objet `}`. Heuristique simple : on agglomère jusqu'à 30 lignes
        // ou jusqu'à ce qu'on voie une ligne contenant `description:` ou
        // `images:` (sibling key) ou la fermeture d'objet `},` au top niveau.
        let acc = m[1].trim();
        // Heuristique : si l'expression sur la même ligne se termine par `,`
        // ou si elle est un literal simple (string, identifier, template
        // single-line), on prend cette ligne seule.
        const simpleEnd = /,\s*$/.test(acc) && balancedAtLineEnd(acc);
        if (simpleEnd) {
          nameExpression = acc.replace(/,\s*$/, '').trim();
        } else {
          // Multi-line. On agglomère jusqu'à la prochaine sibling key
          // (description / images / etc.) au même niveau ou la fermeture.
          for (let k = j + 1; k < windowEnd; k++) {
            const nextLine = lines[k];
            // sibling key détecté → on arrête juste avant
            if (/^\s*(description|images|metadata|tax_behavior)\s*:/.test(nextLine)) {
              break;
            }
            // fermeture top-level de product_data
            if (/^\s*\},?\s*$/.test(nextLine)) {
              acc += '\n' + nextLine;
              break;
            }
            acc += '\n' + nextLine;
          }
          // Nettoyer trailing comma + fermeture éventuelle
          nameExpression = acc.replace(/,\s*$/, '').trim();
          // Si on a inclus une `}` finale qui appartient à product_data, la retirer
          // (heuristique : on l'enlève si elle est seule sur la dernière ligne)
          nameExpression = nameExpression.replace(/\n\s*\},?\s*$/, '').trim();
          // Enlever virgule finale après le retrait du }
          nameExpression = nameExpression.replace(/,\s*$/, '').trim();
        }
        break;
      }
      // Si on tombe sur la fermeture du bloc product_data, stop.
      if (j > i && /^\s*\}\s*[,)]?\s*$/.test(candidate)) break;
    }

    if (nameLineIdx === -1) {
      // product_data trouvé mais pas de `name:` (cas exotique, ignoré).
      continue;
    }

    matches.push({
      file: path.relative(ROOT, file),
      line: nameLineIdx + 1,
      nameExpression,
    });
  }
  return matches;
}

/**
 * Décide si une valeur de `name:` est ACCEPTABLE.
 *
 * Acceptable :
 *  - String literal non-vide entre quotes simples/doubles/backticks
 *    SANS interpolation (ex. `'Pack Starter'`, `"Boost"`)
 *  - Template string dont le premier "segment" est du texte fixe non-vide
 *    (ex. `` `${boost.label} — ${locationLabel}` `` est risqué car
 *    `boost.label` pourrait être vide ; mais ici on whitelist car `boost.label`
 *    vient d'un dict statique BOOST_PRICES). Pour rester strict, on accepte
 *    UNIQUEMENT les template strings qui commencent par du texte fixe (au moins
 *    1 char non-whitespace AVANT le premier `${`).
 *  - Appel à safeStripeProductName(...) — peut être wrappé dans un IIFE ou
 *    une template string `${safeStripeProductName(...)} ...`.
 */
function isAcceptableNameExpression(expr) {
  if (!expr) return false;
  const e = expr.trim();

  // Cas 1 : appel direct safeStripeProductName(...) — autorisé.
  // Couvre aussi les IIFE multi-ligne et les template strings interpolées
  // `${safeStripeProductName(...)} ...` (suffisant : la valeur principale
  // passe par le helper, donc jamais '').
  if (/safeStripeProductName\s*\(/.test(e)) return true;

  // Cas 2 : IIFE `(() => { ... safeStripeProductName(...) ... })()`
  // On accepte tout expression contenant safeStripeProductName (couvre ce cas).
  // Déjà couvert par le test ci-dessus.

  // Cas 3 : string literal pure (quotes simples ou doubles), non-vide.
  // Ex. `'Pack Starter'` ou `"Boost 24h"`.
  const singleQuoted = e.match(/^'([^'\\]|\\.)*'$/);
  const doubleQuoted = e.match(/^"([^"\\]|\\.)*"$/);
  if (singleQuoted || doubleQuoted) {
    const inner = e.slice(1, -1);
    return inner.trim().length > 0;
  }

  // Cas 4 : template string. Doit commencer par du texte fixe non-vide.
  // Ex. `` `Boost — ${location}` `` : OK (préfixe "Boost — ").
  // Ex. `` `${session.title}` `` : REFUSÉ (commence direct par ${).
  // Ex. `` `${session.title} (Duo …)` `` : REFUSÉ (commence direct par ${).
  if (e.startsWith('`') && e.endsWith('`')) {
    // Inspecter les premiers chars APRÈS le backtick
    const inner = e.slice(1, -1);
    // Si le premier `${...}` est en position 0, c'est REFUSÉ.
    if (inner.startsWith('${')) return false;
    // Sinon il y a du texte fixe au début → on accepte si ce texte contient
    // au moins 1 char non-whitespace
    const beforeFirstDollar = inner.split('${')[0];
    return beforeFirstDollar.trim().length > 0;
  }

  // Tout le reste (identifier nu comme `session.title`, ternaire, etc.) →
  // REFUSÉ. Doit passer par safeStripeProductName().
  return false;
}

const allMatches = [];
for (const file of walk(SRC_DIR)) {
  // Ignore le helper lui-même + ses tests.
  if (/safeProductName\.ts$/.test(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (!/product_data\s*:/.test(content)) continue;
  const matches = findProductDataNameValues(content, file);
  for (const m of matches) {
    if (!isAcceptableNameExpression(m.nameExpression)) {
      allMatches.push(m);
    }
  }
}

if (allMatches.length > 0) {
  console.error('\n❌ Stripe product_data.name non sécurisé détecté.\n');
  console.error('   RÈGLE : le `name:` doit être SOIT une string littérale non-vide,');
  console.error('   SOIT une template string avec préfixe fixe, SOIT le résultat de');
  console.error('   `safeStripeProductName(...)` (cf. src/lib/stripe/safeProductName.ts).');
  console.error('   Sinon Stripe rejette avec "product_data[name] cannot be empty"\n');
  for (const m of allMatches) {
    console.error(`   ${m.file}:${m.line}`);
    console.error(`     name: ${m.nameExpression}`);
  }
  console.error('\n   Fix : remplacer par safeStripeProductName({ title: ..., name: ... }).');
  console.error('   Voir doc dans src/lib/stripe/safeProductName.ts.\n');
  process.exit(1);
}

console.log('✅ Tous les call sites Stripe product_data.name sont sécurisés.');
process.exit(0);
