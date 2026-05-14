/**
 * BUG #4 — Session annulée : countdown + prix progressif doivent disparaître.
 *
 * Quand sessionUnavailable === true (activity supprimée/désactivée OU session
 * annulée), les éléments "actifs/futurs" ne doivent plus rien rendre :
 *  - <CountdownHero>   → null (plus de "01 03 16 43" ni "Le chat ouvre dans")
 *  - <PricingTimeline> → null (plus de "Prix progressif" ni les 3 paliers)
 *
 * Render-test via react-dom/server (zéro dépendance nouvelle) : on rend en
 * markup statique et on vérifie que la sortie est vide.
 *
 * Exécution : `npx tsx tests/components/session-unavailable-ui.test.tsx`
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PricingTimeline } from '../../src/components/sessions/PricingTimeline';
import { CountdownHero } from '../../src/components/sessions/CountdownHero';
import { LanguageContext } from '../../src/context/LanguageContext';
import type { PricingTier } from '../../src/types/firestore';

// Mock minimal du contexte i18n : CountdownHero n'utilise que `t`.
// On injecte LanguageContext directement car <LanguageProvider> masque son
// rendu derrière un effet de mount (loading div en render statique).
const langValue = { t: (key: string) => key };
function withLang(node: React.ReactNode) {
  return <LanguageContext.Provider value={langValue}>{node}</LanguageContext.Provider>;
}

let passes = 0;
let failures = 0;

function assert(cond: boolean, label: string, info?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${info !== undefined ? `\n    ${JSON.stringify(info)}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

const TIERS: PricingTier[] = [
  { kind: 'early', price: 2000, activateMinutesBeforeStart: null, activateAtFillRate: null },
  { kind: 'standard', price: 2500, activateMinutesBeforeStart: 1440, activateAtFillRate: null },
  { kind: 'last_minute', price: 3000, activateMinutesBeforeStart: 120, activateAtFillRate: null },
];

const FUTURE_TARGET = new Date(Date.now() + 3 * 86_400_000); // +3 jours

section('SU1 PricingTimeline — visible par défaut, masqué si sessionUnavailable');
{
  const visible = renderToStaticMarkup(
    <PricingTimeline activeTier="early" tiers={TIERS} />,
  );
  assert(visible.includes('Prix progressif'), 'render normal contient "Prix progressif"');

  const hidden = renderToStaticMarkup(
    <PricingTimeline activeTier="early" tiers={TIERS} sessionUnavailable />,
  );
  assert(hidden === '', 'sessionUnavailable → rend une string vide', { hidden });
}

section('SU2 CountdownHero — visible par défaut, masqué si sessionUnavailable');
{
  const visible = renderToStaticMarkup(
    withLang(<CountdownHero target={FUTURE_TARGET} phase="before" />),
  );
  assert(
    visible.includes('countdown_days') || /\d\d/.test(visible),
    'render normal non vide (countdown affiché)',
    { visible },
  );

  const hidden = renderToStaticMarkup(
    withLang(<CountdownHero target={FUTURE_TARGET} phase="before" sessionUnavailable />),
  );
  assert(hidden === '', 'sessionUnavailable → rend une string vide', { hidden });
}

console.log(`\n====== Résumé Session Unavailable UI ======`);
console.log(`PASS : ${passes}`);
console.log(`FAIL : ${failures}`);
console.log(`Total: ${passes + failures}`);
if (failures > 0) process.exit(1);
