/**
 * Tests Phase 9.5 c11 — formatScheduledLabel + hasUpcomingSchedule pure helpers.
 *
 * Exécution :
 *   npm run test:components:activity-card-scheduled
 *
 * Pattern : pure unit (no DOM, no emulator). Tests focus sur l'affichage
 * de la date "Prochaine séance" sur ActivityCard listing.
 *
 * Couverture (3 cas SCH1-SCH3 + sub-cases) :
 *   SCH1. scheduledAt défini futur → label "Day {dayNum} {month} · HHhmm"
 *   SCH2. scheduledAt absent → "Date à venir"
 *   SCH3. scheduledAt passé → "Date passée — voir prochaines"
 */

export {}; // module scope (sinon globals collide tsc)

import { formatScheduledLabel, hasUpcomingSchedule } from '../../src/lib/activities/scheduled';

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

function main(): void {
  // ===================================================================
  // SCH1 — scheduledAt futur
  // ===================================================================
  section('SCH1 scheduledAt futur (Date) → label "Day N month · HHhmm"');
  {
    // 12 mai 2026 19h30 (mardi en 2026 — verifié)
    const future = new Date(2026, 4, 12, 19, 30); // mois 0-indexed (4 = mai)
    const now = new Date(2026, 4, 1, 12, 0).getTime();
    const label = formatScheduledLabel({ scheduledAt: future }, now);
    if (label === 'Mar 12 mai · 19h30') {
      pass(`SCH1.a Date → "${label}"`);
    } else {
      fail('SCH1.a', label);
    }

    // Avec Firestore Timestamp-like { toMillis }
    const tsLike = { toMillis: () => future.getTime() };
    const label2 = formatScheduledLabel({ scheduledAt: tsLike }, now);
    if (label2 === 'Mar 12 mai · 19h30') {
      pass('SCH1.b Timestamp-like (toMillis)');
    } else {
      fail('SCH1.b', label2);
    }

    // Avec Firestore JSON ré-hydraté { seconds, nanoseconds }
    const jsonLike = {
      seconds: Math.floor(future.getTime() / 1000),
      nanoseconds: 0,
    };
    const label3 = formatScheduledLabel({ scheduledAt: jsonLike }, now);
    if (label3 === 'Mar 12 mai · 19h30') {
      pass('SCH1.c Firestore JSON { seconds, nanoseconds }');
    } else {
      fail('SCH1.c', label3);
    }

    // Avec ms epoch number
    const label4 = formatScheduledLabel({ scheduledAt: future.getTime() }, now);
    if (label4 === 'Mar 12 mai · 19h30') {
      pass('SCH1.d ms epoch number');
    } else {
      fail('SCH1.d', label4);
    }

    // hasUpcomingSchedule
    if (hasUpcomingSchedule({ scheduledAt: future }, now) === true) {
      pass('SCH1.e hasUpcomingSchedule futur → true');
    } else {
      fail('SCH1.e');
    }
  }

  // ===================================================================
  // SCH2 — scheduledAt absent
  // ===================================================================
  section('SCH2 scheduledAt absent OU null → "Date à venir"');
  {
    const now = Date.now();
    if (formatScheduledLabel({}, now) === 'Date à venir') {
      pass('SCH2.a undefined scheduledAt');
    } else {
      fail('SCH2.a');
    }
    if (formatScheduledLabel({ scheduledAt: null }, now) === 'Date à venir') {
      pass('SCH2.b null scheduledAt');
    } else {
      fail('SCH2.b');
    }
    if (hasUpcomingSchedule({}, now) === false) {
      pass('SCH2.c hasUpcomingSchedule undefined → false');
    } else {
      fail('SCH2.c');
    }
  }

  // ===================================================================
  // SCH3 — scheduledAt passé
  // ===================================================================
  section('SCH3 scheduledAt passé → "Date passée — voir prochaines"');
  {
    const now = new Date(2026, 4, 15, 12, 0).getTime();
    const past = new Date(2026, 4, 10, 19, 30); // 5 jours plus tôt
    const label = formatScheduledLabel({ scheduledAt: past }, now);
    if (label === 'Date passée — voir prochaines') {
      pass(`SCH3.a Date passée → "${label}"`);
    } else {
      fail('SCH3.a', label);
    }

    if (hasUpcomingSchedule({ scheduledAt: past }, now) === false) {
      pass('SCH3.b hasUpcomingSchedule passé → false');
    } else {
      fail('SCH3.b');
    }
  }

  console.log('');
  console.log('====== Résumé ActivityCard Scheduled (SCH1-SCH3) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main();
