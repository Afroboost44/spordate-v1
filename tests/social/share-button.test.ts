/**
 * Tests Phase 9.5 c10.B — ShareButton helpers (Web Share API + clipboard fallback).
 *
 * Exécution :
 *   npm run test:social:share-button
 *
 * Pattern : pure unit (no DOM). Tests les helpers extraits dans
 * `src/lib/share/shareHelper.ts` (buildShareUrl, buildSharePayload, performShare)
 * en injectant un mock navigator.
 *
 * Couverture (3+ cas SB1-SB4) :
 *   SB1. buildShareUrl : compose origin + /activities/{id} (ssr fallback)
 *   SB2. buildSharePayload : title + text + url corrects (fallback name si pas title)
 *   SB3. performShare : Web Share API supportée → navigator.share appelé avec payload
 *   SB4. performShare : Web Share absent → fallback clipboard.writeText + return 'copied'
 */

import {
  buildShareUrl,
  buildSharePayload,
  performShare,
  type SharePayload,
} from '../../src/lib/share/shareHelper';

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

async function main(): Promise<void> {
  // ===================================================================
  // SB1 — buildShareUrl
  // ===================================================================
  section('SB1 buildShareUrl construit origin + /activities/{id}');
  {
    // SSR fallback : pas de window → utilise NEXT_PUBLIC_APP_URL ou hardcoded prod
    const url = buildShareUrl('abc123');
    if (
      url.endsWith('/activities/abc123') &&
      (url.startsWith('https://') || url.startsWith('http://'))
    ) {
      pass(`SB1.a SSR fallback url = "${url}"`);
    } else {
      fail('SB1.a', url);
    }

    // SSR fallback avec NEXT_PUBLIC_APP_URL
    const prevApp = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    const url2 = buildShareUrl('xyz789');
    if (url2 === 'https://example.test/activities/xyz789') {
      pass('SB1.b NEXT_PUBLIC_APP_URL utilisé');
    } else {
      fail('SB1.b', url2);
    }
    // Trailing slash strip
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test/';
    const url3 = buildShareUrl('xyz789');
    if (url3 === 'https://example.test/activities/xyz789') {
      pass('SB1.c trailing slash stripped');
    } else {
      fail('SB1.c', url3);
    }
    process.env.NEXT_PUBLIC_APP_URL = prevApp;
  }

  // ===================================================================
  // SB2 — buildSharePayload
  // ===================================================================
  section('SB2 buildSharePayload shape : title + text + url + fallback');
  {
    const p1 = buildSharePayload(
      { activityId: 'a1', title: 'Afroboost' },
      'https://spordateur.com/activities/a1',
    );
    if (
      p1.title === 'Spordateur — Afroboost' &&
      p1.text === 'Découvre cette activité : Afroboost' &&
      p1.url === 'https://spordateur.com/activities/a1'
    ) {
      pass('SB2.a payload shape avec title');
    } else {
      fail('SB2.a', p1);
    }

    // Fallback : pas de title, name → utilise name
    const p2 = buildSharePayload({ activityId: 'a2', name: 'Cours Salsa' }, 'https://x/activities/a2');
    if (p2.title === 'Spordateur — Cours Salsa') {
      pass('SB2.b fallback name si pas title');
    } else {
      fail('SB2.b', p2);
    }

    // Fallback ultime : ni title ni name → générique
    const p3 = buildSharePayload({ activityId: 'a3' }, 'https://x/activities/a3');
    if (p3.title === 'Spordateur — Activité Spordateur') {
      pass('SB2.c fallback ultime "Activité Spordateur"');
    } else {
      fail('SB2.c', p3);
    }
  }

  // ===================================================================
  // SB3 — performShare avec Web Share API supportée
  // ===================================================================
  section('SB3 performShare : navigator.share appelé avec payload exact');
  {
    const payload: SharePayload = {
      title: 'Spordateur — Tennis',
      text: 'Découvre cette activité : Tennis',
      url: 'https://x/activities/abc',
    };

    let shareCalls: SharePayload[] = [];
    let clipboardCalls: string[] = [];
    const mockNav = {
      share: async (p: SharePayload) => {
        shareCalls.push(p);
      },
      clipboard: {
        writeText: async (s: string) => {
          clipboardCalls.push(s);
        },
      },
    };
    const result = await performShare({ navigatorObj: mockNav, payload });
    if (
      result === 'shared' &&
      shareCalls.length === 1 &&
      shareCalls[0].title === payload.title &&
      shareCalls[0].url === payload.url &&
      clipboardCalls.length === 0
    ) {
      pass('SB3.a Web Share API supportée → navigator.share appelé, clipboard skipped');
    } else {
      fail('SB3.a', { result, shareCalls, clipboardCalls });
    }

    // SB3.b — user cancel (AbortError) → return 'cancelled' silent (pas de fallback)
    shareCalls = [];
    clipboardCalls = [];
    const mockNavCancel = {
      share: async () => {
        const e = new Error('user aborted');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as any).name = 'AbortError';
        throw e;
      },
      clipboard: {
        writeText: async (s: string) => {
          clipboardCalls.push(s);
        },
      },
    };
    const result2 = await performShare({ navigatorObj: mockNavCancel, payload });
    if (result2 === 'cancelled' && clipboardCalls.length === 0) {
      pass('SB3.b user cancel (AbortError) → return cancelled (no clipboard fallback)');
    } else {
      fail('SB3.b', { result: result2, clipboardCalls });
    }
  }

  // ===================================================================
  // SB4 — performShare fallback clipboard
  // ===================================================================
  section('SB4 performShare : Web Share absent → fallback clipboard.writeText');
  {
    const payload: SharePayload = {
      title: 'X',
      text: 'Y',
      url: 'https://example.com/activities/abc',
    };

    const clipboardCalls: string[] = [];
    const mockNavClip = {
      // pas de share function
      clipboard: {
        writeText: async (s: string) => {
          clipboardCalls.push(s);
        },
      },
    };
    const result = await performShare({ navigatorObj: mockNavClip, payload });
    if (
      result === 'copied' &&
      clipboardCalls.length === 1 &&
      clipboardCalls[0] === payload.url
    ) {
      pass('SB4.a Web Share absent + clipboard supportée → copied + writeText(url)');
    } else {
      fail('SB4.a', { result, clipboardCalls });
    }

    // SB4.b — ni share ni clipboard → unsupported
    const mockNavBare = {};
    const result2 = await performShare({ navigatorObj: mockNavBare, payload });
    if (result2 === 'unsupported') {
      pass('SB4.b ni share ni clipboard → unsupported');
    } else {
      fail('SB4.b', result2);
    }

    // SB4.c — Web Share fail (non-AbortError) → fallthrough clipboard
    const clipboardFB: string[] = [];
    const mockNavFallthrough = {
      share: async () => {
        throw new Error('NotAllowedError'); // pas AbortError, pas user-cancel
      },
      clipboard: {
        writeText: async (s: string) => {
          clipboardFB.push(s);
        },
      },
    };
    const result3 = await performShare({ navigatorObj: mockNavFallthrough, payload });
    if (result3 === 'copied' && clipboardFB.length === 1) {
      pass('SB4.c Web Share fail (NotAllowedError) → fallthrough clipboard');
    } else {
      fail('SB4.c', { result: result3, clipboardFB });
    }
  }

  console.log('');
  console.log('====== Résumé Share Button (SB1-SB4) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
