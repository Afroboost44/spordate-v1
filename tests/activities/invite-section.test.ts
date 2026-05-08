/**
 * Tests Phase 9 sub-chantier 1 commit 3/5 — GET /api/users/me/matches.
 *
 * Exécution :
 *   npm run test:activities:invite-section
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC4 + SC5 + SC1 c1/5).
 *
 * Couverture (AI1-AI5) :
 *   AI1 user authenticated avec 2 matches accepted → 200 + 2 matches retournés (PII minimal)
 *   AI2 user non auth (Bearer absent) → 401
 *   AI3 user avec 0 matches accepted → 200 + matches=[]
 *   AI4 user avec match accepted MAIS bloqué (block exists) → match exclu
 *   AI5 user avec match accepted où otherUser anonymizedAt set → match exclu
 *   Bonus : matches status='pending' / 'declined' → exclus (filter status='accepted' only)
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-matches';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-matches';

import { GET as GETMatches } from '../../src/app/api/users/me/matches/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';

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

// =====================================================================

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callGet(): Promise<MockResponse> {
  const req = new Request('http://localhost/api/users/me/matches', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await GETMatches(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-matches' });
  }
  const db = getFirestore();

  const ALICE = 'user_alice_ai';
  const BOB = 'user_bob_ai';
  const CHARLIE = 'user_charlie_ai';
  const DAVE = 'user_dave_ai';

  // Helper seeders
  async function seedUser(uid: string, opts: { anonymizedAt?: number } = {}): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      uid,
      email: `${uid}@test.local`,
      displayName: uid,
      photoURL: `https://example.com/${uid}.png`,
    };
    if (opts.anonymizedAt) {
      payload.anonymizedAt = Timestamp.fromMillis(opts.anonymizedAt);
    }
    await db.collection('users').doc(uid).set(payload);
  }

  async function seedMatch(opts: {
    matchId: string;
    userIds: [string, string];
    status: 'pending' | 'accepted' | 'declined' | 'expired';
  }): Promise<void> {
    await db.collection('matches').doc(opts.matchId).set({
      matchId: opts.matchId,
      userIds: opts.userIds.slice().sort(),
      user1: { uid: opts.userIds[0], displayName: opts.userIds[0], photoURL: '' },
      user2: { uid: opts.userIds[1], displayName: opts.userIds[1], photoURL: '' },
      status: opts.status,
      activityId: 'activity_x',
      sport: 'tennis',
      chatUnlocked: true,
      initiatedBy: opts.userIds[0],
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60_000),
    });
  }

  async function seedBlock(blockerId: string, blockedId: string): Promise<void> {
    const blockId = `${blockerId}_${blockedId}`;
    await db.collection('blocks').doc(blockId).set({
      blockId,
      blockerId,
      blockedId,
      createdAt: Timestamp.now(),
    });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['users', 'matches', 'blocks']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  // Default mock auth
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // =================================================================
  // AI1 user auth + 2 matches accepted → 200 + 2 matches
  // =================================================================
  section('AI1 user auth + 2 matches accepted → 200 + 2 matches retournés');
  {
    await clearAll();
    await Promise.all([seedUser(ALICE), seedUser(BOB), seedUser(CHARLIE)]);
    await seedMatch({ matchId: 'match_ai1_ab', userIds: [ALICE, BOB], status: 'accepted' });
    await seedMatch({ matchId: 'match_ai1_ac', userIds: [ALICE, CHARLIE], status: 'accepted' });

    _mockUid = ALICE;
    const res = await callGet();
    if (res.status === 200) {
      pass('AI1 status 200');
    } else {
      fail('AI1 status', res);
    }
    const matches = res.body.matches as Array<{
      matchId: string;
      otherUser: { uid: string; displayName: string; photoURL?: string };
    }>;
    if (Array.isArray(matches) && matches.length === 2) {
      pass('AI1 2 matches retournés');
    } else {
      fail('AI1 matches count', res.body);
    }
    const otherUids = matches.map((m) => m.otherUser.uid).sort();
    if (otherUids[0] === BOB && otherUids[1] === CHARLIE) {
      pass('AI1 otherUser uids = [BOB, CHARLIE]');
    } else {
      fail('AI1 otherUids', otherUids);
    }
    if (matches[0].otherUser.displayName && matches[0].otherUser.photoURL) {
      pass('AI1 PII minimal hydratée (displayName + photoURL)');
    } else {
      fail('AI1 PII missing', matches[0]);
    }
  }

  // =================================================================
  // AI2 user non auth → 401
  // =================================================================
  section('AI2 user non auth → 401 unauthenticated');
  {
    await clearAll();
    _mockUid = null;
    const res = await callGet();
    if (res.status === 401 && res.body.error === 'unauthenticated') {
      pass('AI2 status 401 unauthenticated');
    } else {
      fail('AI2', res);
    }
  }

  // =================================================================
  // AI3 user avec 0 matches accepted → 200 empty
  // =================================================================
  section('AI3 user avec 0 matches accepted → 200 + matches=[]');
  {
    await clearAll();
    await seedUser(ALICE);
    _mockUid = ALICE;
    const res = await callGet();
    if (res.status === 200 && Array.isArray(res.body.matches) && (res.body.matches as unknown[]).length === 0) {
      pass('AI3 status 200 + matches=[]');
    } else {
      fail('AI3', res);
    }
  }

  // =================================================================
  // AI4 match avec block → exclu
  // =================================================================
  section('AI4 match avec block existant → exclu de la liste');
  {
    await clearAll();
    await Promise.all([seedUser(ALICE), seedUser(BOB), seedUser(CHARLIE)]);
    await seedMatch({ matchId: 'match_ai4_ab', userIds: [ALICE, BOB], status: 'accepted' });
    await seedMatch({ matchId: 'match_ai4_ac', userIds: [ALICE, CHARLIE], status: 'accepted' });
    // Alice blocked Bob (Alice = blocker, Bob = blocked)
    await seedBlock(ALICE, BOB);

    _mockUid = ALICE;
    const res = await callGet();
    const matches = res.body.matches as Array<{ matchId: string; otherUser: { uid: string } }>;
    if (matches.length === 1 && matches[0].otherUser.uid === CHARLIE) {
      pass('AI4 match avec block exclu (1 match restant: charlie)');
    } else {
      fail('AI4 expected 1 match charlie', matches);
    }

    // Reverse direction : charlie blocked alice
    await seedBlock(CHARLIE, ALICE);
    const res2 = await callGet();
    const matches2 = res2.body.matches as Array<{ matchId: string }>;
    if (matches2.length === 0) {
      pass('AI4 reverse block (charlie→alice) → match exclu aussi');
    } else {
      fail('AI4 reverse block expected 0 matches', matches2);
    }
  }

  // =================================================================
  // AI5 match avec otherUser anonymizedAt → exclu
  // =================================================================
  section('AI5 match avec otherUser anonymizedAt → exclu (banlist Phase 8 SC5 c3/5)');
  {
    await clearAll();
    await Promise.all([
      seedUser(ALICE),
      seedUser(BOB, { anonymizedAt: Date.now() - 5 * 24 * 60 * 60_000 }), // anonymisé
      seedUser(DAVE),
    ]);
    await seedMatch({ matchId: 'match_ai5_ab', userIds: [ALICE, BOB], status: 'accepted' });
    await seedMatch({ matchId: 'match_ai5_ad', userIds: [ALICE, DAVE], status: 'accepted' });

    _mockUid = ALICE;
    const res = await callGet();
    const matches = res.body.matches as Array<{ otherUser: { uid: string } }>;
    if (matches.length === 1 && matches[0].otherUser.uid === DAVE) {
      pass('AI5 anonymizedAt user exclu (1 match restant: dave)');
    } else {
      fail('AI5 expected 1 match dave', matches);
    }
  }

  // =================================================================
  // Bonus : status pending / declined / expired → exclus
  // =================================================================
  section('Bonus status filter : pending / declined / expired → exclus');
  {
    await clearAll();
    await Promise.all([seedUser(ALICE), seedUser(BOB), seedUser(CHARLIE), seedUser(DAVE)]);
    await seedMatch({ matchId: 'match_bonus_pending', userIds: [ALICE, BOB], status: 'pending' });
    await seedMatch({ matchId: 'match_bonus_declined', userIds: [ALICE, CHARLIE], status: 'declined' });
    await seedMatch({ matchId: 'match_bonus_accepted', userIds: [ALICE, DAVE], status: 'accepted' });

    _mockUid = ALICE;
    const res = await callGet();
    const matches = res.body.matches as Array<{ otherUser: { uid: string } }>;
    if (matches.length === 1 && matches[0].otherUser.uid === DAVE) {
      pass('Bonus status filter : seul match accepted retourné (dave)');
    } else {
      fail('Bonus status', matches);
    }
  }

  // Cleanup
  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Activities Invite Section (AI1-AI5 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
