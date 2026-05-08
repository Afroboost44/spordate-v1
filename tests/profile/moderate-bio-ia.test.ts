/**
 * Tests Phase 9 sub-chantier 4 commit 5/6 — Genkit moderateProfileBio + integration API route.
 *
 * Exécution :
 *   npm run test:profile:moderate-bio
 *
 * Pattern : pure unit PB1-PB3 (mock _generateFn DI seam) + emulator integration PB4
 * (POST /api/users/[id]/moderate-bio Admin SDK seed user).
 *
 * Couverture (PB1-PB4 + bonus) :
 *   PB1  bio civil clean → recommendation='approve' tous scores < 0.3
 *   PB2  bio avec slur/harassment → recommendation='flag' toxicity > 0.7
 *   PB3  bio avec phone/email leak → recommendation='flag' contactLeak > 0.7
 *   PB4  POST /api/users/[id]/moderate-bio → 200 + bioModeration field persisté +
 *        si flag → adminAction profile_bio_flag silent (Q7=A bio reste visible)
 *
 * Bonus : cache hit 24h (mock 1x sur 2 runs identiques) + Gemini error → fallback approve
 *         + empty bio → approve early-return.
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-bio-ia';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-bio-ia';

import {
  runProfileBioModerator,
  __setProfileBioModeratorGenerateFnForTesting,
  __resetProfileBioModeratorCacheForTesting,
  MODEL_VERSION,
} from '../../src/ai/flows/profile-bio-moderator';
import { __resetRateLimitForTesting } from '../../src/ai/genkit';
import { POST as POSTModerateBio } from '../../src/app/api/users/[id]/moderate-bio/route';
import { Timestamp } from 'firebase-admin/firestore';

// =====================================================================
// Mini test runner
// =====================================================================

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

function resetAll(): void {
  __resetProfileBioModeratorCacheForTesting();
  __resetRateLimitForTesting();
}

// =====================================================================
// Helpers
// =====================================================================

async function callModerate(
  uid: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`http://localhost/api/users/${uid}/moderate-bio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTModerateBio(req, {
    params: Promise.resolve({ id: uid }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-bio-ia' });
  }
  const adminDb = getFirestore();

  // ===================================================================
  // PB1 : bio civil clean → recommendation='approve' tous scores < 0.3
  // ===================================================================
  section('PB1 bio civil clean → recommendation=approve scores < 0.3');
  {
    resetAll();
    __setProfileBioModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        toxicity: 0.0,
        profanity: 0.0,
        contactLeak: 0.0,
        recommendation: 'approve',
        motive: 'Bio civile et professionnelle',
      }),
    );
    const result = await runProfileBioModerator({
      bio: 'Coach yoga depuis 5 ans, basée Genève. Passion: bien-être.',
      userHashId: 'pb1hash',
    });
    if (
      result.recommendation === 'approve' &&
      result.toxicity < 0.3 &&
      result.profanity < 0.3 &&
      result.contactLeak < 0.3 &&
      result.modelVersion === MODEL_VERSION
    ) {
      pass('PB1 approve + tous scores < 0.3 + modelVersion');
    } else {
      fail('PB1 unexpected', result);
    }
  }

  // ===================================================================
  // PB2 : bio avec slur/harassment → recommendation='flag' toxicity > 0.7
  // ===================================================================
  section('PB2 bio avec slur/harassment → recommendation=flag toxicity > 0.7');
  {
    resetAll();
    __setProfileBioModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        toxicity: 0.95,
        profanity: 0.5,
        contactLeak: 0.0,
        recommendation: 'flag',
        motive: 'Insulte / slur — non publiable',
      }),
    );
    const result = await runProfileBioModerator({
      bio: '[Insulte raciste], j\'aime le sport.',
      userHashId: 'pb2hash',
    });
    if (
      result.recommendation === 'flag' &&
      result.toxicity > 0.7 &&
      result.motive.includes('Insulte')
    ) {
      pass('PB2 flag + toxicity > 0.7 + motive insulte');
    } else {
      fail('PB2 unexpected', result);
    }
  }

  // ===================================================================
  // PB3 : bio avec phone/email leak → recommendation='flag' contactLeak > 0.7
  // ===================================================================
  section('PB3 bio avec phone/email leak → recommendation=flag contactLeak > 0.7');
  {
    resetAll();
    __setProfileBioModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        toxicity: 0.0,
        profanity: 0.0,
        contactLeak: 0.95,
        recommendation: 'flag',
        motive: 'Coordonnées partagées (téléphone + email)',
      }),
    );
    const result = await runProfileBioModerator({
      bio: 'Sportif passionné. Contactez-moi 079 123 45 67 ou test@gmail.com.',
      userHashId: 'pb3hash',
    });
    if (
      result.recommendation === 'flag' &&
      result.contactLeak > 0.7 &&
      result.toxicity < 0.3
    ) {
      pass('PB3 flag + contactLeak > 0.7 + toxicity < 0.3');
    } else {
      fail('PB3 unexpected', result);
    }
  }

  // ===================================================================
  // PB4 : POST /api/users/[id]/moderate-bio → bioModeration + adminAction si flag
  // ===================================================================
  section('PB4 POST /api/users/[id]/moderate-bio → bioModeration + adminAction si flag');
  {
    resetAll();
    const uid = 'user_pb4';
    // Seed user doc
    await adminDb.collection('users').doc(uid).set({
      uid,
      email: 'pb4@test.local',
      displayName: 'PB4 User',
      bio: 'Old bio test',
      role: 'user',
      createdAt: Timestamp.now(),
    });

    // Mock Gemini → flag (slur)
    __setProfileBioModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        toxicity: 0.85,
        profanity: 0.4,
        contactLeak: 0.0,
        recommendation: 'flag',
        motive: 'Toxicité détectée',
      }),
    );

    const res = await callModerate(uid, {
      bio: '[Slur test bio]',
    });

    if (res.status === 200 && res.body?.ok === true && res.body?.recommendation === 'flag') {
      pass('PB4 POST 200 ok=true recommendation=flag');
    } else {
      fail('PB4 POST should be 200 flag', res);
    }

    // Verify users.{uid}.bioModeration field persisté
    const userSnap = await adminDb.collection('users').doc(uid).get();
    const data = userSnap.data();
    const bm = data?.bioModeration;
    if (
      bm &&
      bm.recommendation === 'flag' &&
      bm.toxicity === 0.85 &&
      bm.contactLeak === 0.0 &&
      bm.modelVersion === MODEL_VERSION &&
      bm.scoredAt
    ) {
      pass('PB4 user.bioModeration field persisté avec tous champs');
    } else {
      fail('PB4 bioModeration missing or invalid', { bm });
    }

    // Verify adminAction profile_bio_flag silent (Q7=A)
    const aaSnap = await adminDb
      .collection('adminActions')
      .where('targetType', '==', 'user')
      .where('targetId', '==', uid)
      .where('actionType', '==', 'profile_bio_flag')
      .get();
    if (!aaSnap.empty) {
      const aa = aaSnap.docs[0].data();
      if (
        aa.adminId === 'system' &&
        aa.metadata?.toxicity === 0.85 &&
        aa.metadata?.modelVersion === MODEL_VERSION
      ) {
        pass('PB4 adminAction profile_bio_flag persisté adminId=system (Q7=A silent)');
      } else {
        fail('PB4 adminAction shape mismatch', aa);
      }
    } else {
      fail('PB4 adminAction profile_bio_flag not found');
    }

    // Verify bio reste visible (Q7=A no UX disruption — pas de mutation bio field)
    if (data?.bio === 'Old bio test') {
      pass('PB4 bio user reste visible (Q7=A no disruption — pas de hide / replace)');
    } else {
      fail('PB4 bio user mutated unexpectedly', { bio: data?.bio });
    }

    // Bonus PB4 : approve case → no adminAction
    const uid2 = 'user_pb4_approve';
    await adminDb.collection('users').doc(uid2).set({
      uid: uid2,
      email: 'pb4approve@test.local',
      displayName: 'PB4 Approve',
      bio: 'Coach pro',
      role: 'user',
      createdAt: Timestamp.now(),
    });
    __setProfileBioModeratorGenerateFnForTesting(async () =>
      JSON.stringify({
        toxicity: 0.05,
        profanity: 0.0,
        contactLeak: 0.0,
        recommendation: 'approve',
        motive: 'Bio civile',
      }),
    );
    const res2 = await callModerate(uid2, { bio: 'Coach pro' });
    if (res2.status === 200 && res2.body?.recommendation === 'approve') {
      pass('PB4 bonus approve case → 200');
    } else {
      fail('PB4 bonus approve should be 200', res2);
    }
    const aa2Snap = await adminDb
      .collection('adminActions')
      .where('targetId', '==', uid2)
      .where('actionType', '==', 'profile_bio_flag')
      .get();
    if (aa2Snap.empty) {
      pass('PB4 bonus approve → no adminAction logged');
    } else {
      fail('PB4 bonus approve should have no adminAction', { count: aa2Snap.size });
    }
  }

  // ===================================================================
  // Bonus : cache hit 24h
  // ===================================================================
  section('Bonus cache hit 24h : mock 1x sur 2 runs identiques');
  {
    resetAll();
    let callCount = 0;
    __setProfileBioModeratorGenerateFnForTesting(async () => {
      callCount++;
      return JSON.stringify({
        toxicity: 0.0,
        profanity: 0.0,
        contactLeak: 0.0,
        recommendation: 'approve',
        motive: 'Cache test',
      });
    });
    const r1 = await runProfileBioModerator({
      bio: 'Bio bench cache test identical text',
      userHashId: 'cachebonus',
    });
    const r2 = await runProfileBioModerator({
      bio: 'Bio bench cache test identical text',
      userHashId: 'cachebonus',
    });
    if (callCount === 1 && r1.recommendation === r2.recommendation) {
      pass('Bonus cache hit — mock 1x sur 2 runs identiques');
    } else {
      fail('Bonus cache should hit', { callCount });
    }
    // Différent bio → cache miss
    const r3 = await runProfileBioModerator({
      bio: 'Bio différente',
      userHashId: 'cachebonus',
    });
    if (callCount === 2 && r3.recommendation === 'approve') {
      pass('Bonus cache miss sur bio différente → 2e call');
    } else {
      fail('Bonus cache miss should trigger 2nd call', { callCount });
    }
  }

  // ===================================================================
  // Bonus : Gemini error → fallback approve (Phase 9 permissif)
  // ===================================================================
  section('Bonus Gemini error → fallback approve (Phase 9 permissif default)');
  {
    resetAll();
    __setProfileBioModeratorGenerateFnForTesting(async () => {
      throw new Error('Gemini 503 Service Unavailable');
    });
    const result = await runProfileBioModerator({
      bio: 'Bio test fallback',
      userHashId: 'fallbackhash',
    });
    if (result.recommendation === 'approve' && result.motive === 'ai-error') {
      pass('Bonus Gemini error → approve + ai-error motive');
    } else {
      fail('Bonus should fallback approve', result);
    }

    // Bonus : empty bio → approve early-return
    resetAll();
    let emptyCallCount = 0;
    __setProfileBioModeratorGenerateFnForTesting(async () => {
      emptyCallCount++;
      return '{}';
    });
    const empty = await runProfileBioModerator({ bio: '', userHashId: 'emptyhash' });
    if (
      empty.recommendation === 'approve' &&
      empty.motive === 'empty-bio' &&
      emptyCallCount === 0
    ) {
      pass('Bonus empty bio → approve early-return + 0 call Gemini');
    } else {
      fail('Bonus empty bio early-return failed', { empty, emptyCallCount });
    }
  }

  // Cleanup
  __setProfileBioModeratorGenerateFnForTesting(null);
  __resetProfileBioModeratorCacheForTesting();
  __resetRateLimitForTesting();

  console.log('');
  console.log('====== Résumé Profile Bio IA (PB1-PB4 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
