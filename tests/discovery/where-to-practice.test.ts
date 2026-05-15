/**
 * BUG #10 — Tests purs du helper groupBoostedActivitiesByCity.
 *
 * Le bouton "Où pratiquer ?" sur /discovery doit afficher les activités
 * boostées (= dont le partenaire a un boost actif) groupées par ville.
 *
 * Couverture (WTP1-WTP7) :
 *   WTP1 — Aucun partenaire boosté → résultat vide
 *   WTP2 — Activité isActive=false filtrée out (même si partner boosté)
 *   WTP3 — Activité dont partnerId pas dans boostedPartnerIds filtrée out
 *   WTP4 — Grouping par city (case + trim) — "Genève", "geneve", " Genève " → même groupe
 *   WTP5 — Cap total à `max` items (across toutes villes, ordre stable)
 *   WTP6 — Activité sans city (vide / undefined) skip
 *   WTP7 — Tri alphabétique des villes (cohérent affichage)
 *
 * Exécution : npx tsx tests/discovery/where-to-practice.test.ts
 */

import { groupBoostedActivitiesByCity } from '../../src/lib/discovery/whereToPractice';

let passes = 0;
let failures = 0;

function ok(label: string) {
  passes++;
  console.log(`  ✓ ${label}`);
}
function fail(label: string, info?: unknown) {
  failures++;
  console.error(`  ✗ ${label}`, info ?? '');
}
function section(t: string) {
  console.log(`\n--- ${t} ---`);
}

// =====================================================================
// Helpers de fixture
// =====================================================================

interface ActivityFixture {
  activityId: string;
  partnerId: string;
  city?: string;
  isActive: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function act(
  id: string,
  partnerId: string,
  city: string | undefined,
  isActive = true,
): ActivityFixture {
  return { activityId: id, partnerId, city, isActive, title: id, sport: 'Afroboost' };
}

// =====================================================================
// TESTS
// =====================================================================

async function run() {
  // -----------------------------------------------------------------------
  section('WTP1 — Aucun partenaire boosté → résultat vide');
  {
    const activities = [act('a1', 'p1', 'Genève'), act('a2', 'p2', 'Lausanne')];
    const result = groupBoostedActivitiesByCity(activities, new Set(), {});
    if (result.length === 0) ok('result vide quand aucun boost');
    else fail('result devrait être vide', result);
  }

  // -----------------------------------------------------------------------
  section('WTP2 — isActive=false filtrée out');
  {
    const activities = [
      act('a1', 'p1', 'Genève', false), // inactive
      act('a2', 'p1', 'Genève', true),
    ];
    const result = groupBoostedActivitiesByCity(activities, new Set(['p1']), {});
    if (result.length === 1 && result[0].activities.length === 1 && result[0].activities[0].activityId === 'a2') {
      ok('seule l\'activité active retenue');
    } else fail('attendu seul a2', result);
  }

  // -----------------------------------------------------------------------
  section('WTP3 — partnerId pas dans boostedPartnerIds filtrée out');
  {
    const activities = [
      act('a1', 'p1', 'Genève'), // boosté
      act('a2', 'p2', 'Genève'), // pas boosté
    ];
    const result = groupBoostedActivitiesByCity(activities, new Set(['p1']), {});
    if (result.length === 1 && result[0].activities.length === 1 && result[0].activities[0].activityId === 'a1') {
      ok('seul partenaire boosté retenu');
    } else fail('attendu seul a1', result);
  }

  // -----------------------------------------------------------------------
  section('WTP4 — Grouping case/trim insensible');
  {
    const activities = [
      act('a1', 'p1', 'Genève'),
      act('a2', 'p1', 'geneve'),
      act('a3', 'p1', ' GENÈVE '),
      act('a4', 'p1', 'Lausanne'),
    ];
    const result = groupBoostedActivitiesByCity(activities, new Set(['p1']), {});
    const geneva = result.find(g => g.city === 'Genève');
    const laus = result.find(g => g.city === 'Lausanne');
    if (geneva && geneva.activities.length === 3 && laus && laus.activities.length === 1) {
      ok('3 variantes "Genève" mergées + Lausanne séparée');
    } else fail('grouping incorrect', result);
  }

  // -----------------------------------------------------------------------
  section('WTP5 — Cap total à max');
  {
    const activities = Array.from({ length: 10 }, (_, i) => act(`a${i}`, 'p1', `Ville${i}`));
    const result = groupBoostedActivitiesByCity(activities, new Set(['p1']), { max: 3 });
    const total = result.reduce((sum, g) => sum + g.activities.length, 0);
    if (total === 3) ok('total cappé à 3 (max)');
    else fail('total devrait être 3', total);
  }

  // -----------------------------------------------------------------------
  section('WTP6 — Activité sans city skip');
  {
    const activities = [
      act('a1', 'p1', undefined),
      act('a2', 'p1', ''),
      act('a3', 'p1', '   '),
      act('a4', 'p1', 'Bern'),
    ];
    const result = groupBoostedActivitiesByCity(activities, new Set(['p1']), {});
    if (result.length === 1 && result[0].city === 'Bern' && result[0].activities.length === 1) {
      ok('seules les activités avec city non-vide retenues');
    } else fail('attendu seul Bern', result);
  }

  // -----------------------------------------------------------------------
  section('WTP7 — Tri alphabétique des villes');
  {
    const activities = [
      act('a1', 'p1', 'Zurich'),
      act('a2', 'p1', 'Bern'),
      act('a3', 'p1', 'Lausanne'),
      act('a4', 'p1', 'Aarau'),
    ];
    const result = groupBoostedActivitiesByCity(activities, new Set(['p1']), {});
    const cities = result.map(g => g.city);
    const expected = ['Aarau', 'Bern', 'Lausanne', 'Zurich'];
    if (JSON.stringify(cities) === JSON.stringify(expected)) {
      ok('villes triées alpha A→Z');
    } else fail('tri incorrect', { got: cities, expected });
  }

  console.log(`\n====== Résumé where-to-practice ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
