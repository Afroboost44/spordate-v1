/**
 * Tests Phase 7 sub-chantier 3 commit 5/5 — Firestore rules /reports/ + /userSanctions/
 * defense-in-depth (cohérent rules commit 1/5).
 *
 * Exécution :
 *   npm run test:reports:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/reports/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4.
 *
 * Couverture (~26 cas RR1-RR16 + RS1-RS10) :
 *
 * /reports/{reportId} CREATE rules :
 *   RR1 : create reporterId == auth.uid happy → SUCCESS
 *   RR2 : create reporterId spoofé → REJET (anti-spoofing)
 *   RR3 : create self-report → REJET
 *   RR4 : create category invalide → REJET
 *   RR5 : create category='autre' sans freeTextReason → REJET
 *   RR6 : create category='autre' freeText <10 chars → REJET
 *   RR7 : create source invalide → REJET
 *   RR8 : create createdAt != server time → REJET (anti-backdate)
 *   RR9 : create avec reviewedBy/reviewedAt → REJET (server-managed)
 *
 * /reports/ UPDATE + DELETE :
 *   RR10 : update par non-admin → REJET
 *   RR11 : update par admin → SUCCESS
 *   RR12 : delete toujours → REJET (audit trail)
 *
 * /reports/ READ :
 *   RR13 : read par admin → SUCCESS
 *   RR14 : read par reporter → SUCCESS (sa propre history)
 *   RR15 : read par reported (anonymat strict) → REJET
 *   RR16 : read par tiers → REJET
 *
 * /userSanctions/{sanctionId} :
 *   RS1 : create par admin → SUCCESS
 *   RS2 : create auto-trigger valide → SUCCESS
 *   RS3 : create self-sanction → REJET
 *   RS4 : create reason='manual_admin' par non-admin → REJET
 *   RS5 : create avec triggeringReportIds vide → REJET
 *   RS6 : update appeal par owner (hasOnly appealUsed+appealNote) → SUCCESS
 *   RS7 : update appeal par owner avec autre champ → REJET
 *   RS8 : update par non-owner non-admin → REJET
 *   RS9 : update appeal sur sanction non-appealable → REJET
 *   RS10 : delete toujours → REJET
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

let _passes = 0;
let _failures = 0;

function passManually(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function failManually(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Constantes
// =====================================================================

const REPORTER_UID = 'user_reporter_rprules';
const REPORTED_UID = 'user_reported_rprules';
const ADMIN_UID = 'user_admin_rprules';
const OTHER_UID = 'user_other_rprules';

function validReportPayload(opts: {
  reporterId: string;
  reportedId: string;
  category?: string;
  freeTextReason?: string;
  source?: 'user' | 'partner_no_show';
}) {
  return {
    reportId: 'will-be-overridden',
    reporterId: opts.reporterId,
    reportedId: opts.reportedId,
    category: opts.category ?? 'comportement_agressif',
    status: 'pending' as const,
    source: opts.source ?? ('user' as const),
    createdAt: serverTimestamp(),
    ...(opts.freeTextReason ? { freeTextReason: opts.freeTextReason } : {}),
  };
}

function validSanctionPayload(opts: {
  userId: string;
  level?: 'warning' | 'suspension_7d' | 'suspension_30d' | 'ban_permanent';
  reason?: 'reports_threshold' | 'no_show_threshold' | 'manual_admin';
  triggeringReportIds?: string[];
}) {
  return {
    sanctionId: 'will-be-overridden',
    userId: opts.userId,
    level: opts.level ?? 'suspension_7d',
    reason: opts.reason ?? 'reports_threshold',
    triggeringReportIds: opts.triggeringReportIds ?? ['rp_dummy'],
    startsAt: serverTimestamp(),
    appealable: true,
    appealUsed: false,
    isActive: true,
    createdAt: serverTimestamp(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-reports-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // -------------------------------------------------------------------
  // SETUP : users (admin role)
  // -------------------------------------------------------------------
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin@test.local',
      displayName: 'Admin',
      role: 'admin',
    });
    await setDoc(doc(fbDb, 'users', REPORTER_UID), {
      uid: REPORTER_UID,
      email: 'reporter@test.local',
      displayName: 'Reporter',
      role: 'user',
    });
    await setDoc(doc(fbDb, 'users', REPORTED_UID), {
      uid: REPORTED_UID,
      email: 'reported@test.local',
      displayName: 'Reported',
      role: 'user',
    });
    await setDoc(doc(fbDb, 'users', OTHER_UID), {
      uid: OTHER_UID,
      email: 'other@test.local',
      displayName: 'Other',
      role: 'user',
    });
  });

  // ===================================================================
  // /reports/ CREATE rules (RR1-RR9)
  // ===================================================================
  section('/reports/ CREATE rules : defense-in-depth (RR1-RR9)');

  // RR1 : create happy
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validReportPayload({ reporterId: REPORTER_UID, reportedId: REPORTED_UID });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'reports', 'rr1-happy'), payload));
      passManually('RR1 create reporterId == auth.uid + payload valide → SUCCESS');
    } catch (e) {
      failManually('RR1 (expected success)', e);
    }
  }

  // RR2 : reporterId spoofé
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validReportPayload({
      reporterId: 'someone_else',
      reportedId: REPORTED_UID,
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr2-spoof'), payload));
      passManually('RR2 reporterId spoofé (≠ auth.uid) → REJET');
    } catch (e) {
      failManually('RR2 (expected fail)', e);
    }
  }

  // RR3 : self-report
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validReportPayload({
      reporterId: REPORTER_UID,
      reportedId: REPORTER_UID,
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr3-self'), payload));
      passManually('RR3 self-report → REJET');
    } catch (e) {
      failManually('RR3 (expected fail)', e);
    }
  }

  // RR4 : category invalide
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validReportPayload({
      reporterId: REPORTER_UID,
      reportedId: REPORTED_UID,
      category: 'fake_invalid_cat',
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr4-cat'), payload));
      passManually('RR4 category invalide → REJET');
    } catch (e) {
      failManually('RR4 (expected fail)', e);
    }
  }

  // RR5 : autre sans freeText
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validReportPayload({
      reporterId: REPORTER_UID,
      reportedId: REPORTED_UID,
      category: 'autre',
      // pas de freeTextReason
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr5-autre-noft'), payload));
      passManually('RR5 category=autre sans freeTextReason → REJET');
    } catch (e) {
      failManually('RR5 (expected fail)', e);
    }
  }

  // RR6 : autre freeText <10 chars
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validReportPayload({
      reporterId: REPORTER_UID,
      reportedId: REPORTED_UID,
      category: 'autre',
      freeTextReason: 'short',
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr6-autre-short'), payload));
      passManually('RR6 category=autre freeText <10 chars → REJET');
    } catch (e) {
      failManually('RR6 (expected fail)', e);
    }
  }

  // RR7 : source invalide
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = {
      ...validReportPayload({ reporterId: REPORTER_UID, reportedId: REPORTED_UID }),
      source: 'invalid_source' as 'user',
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr7-source'), payload));
      passManually('RR7 source invalide → REJET');
    } catch (e) {
      failManually('RR7 (expected fail)', e);
    }
  }

  // RR8 : createdAt != server time (backdate)
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = {
      ...validReportPayload({ reporterId: REPORTER_UID, reportedId: REPORTED_UID }),
      createdAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr8-backdate'), payload));
      passManually('RR8 createdAt != server time → REJET');
    } catch (e) {
      failManually('RR8 (expected fail)', e);
    }
  }

  // RR9 : avec reviewedBy/reviewedAt (server-managed)
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = {
      ...validReportPayload({ reporterId: REPORTER_UID, reportedId: REPORTED_UID }),
      reviewedBy: 'someone',
      reviewedAt: serverTimestamp(),
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'reports', 'rr9-admin-fields'), payload));
      passManually('RR9 reviewedBy/reviewedAt présents au create → REJET');
    } catch (e) {
      failManually('RR9 (expected fail)', e);
    }
  }

  // ===================================================================
  // /reports/ UPDATE + DELETE (RR10-RR12)
  // ===================================================================
  section('/reports/ UPDATE + DELETE (RR10-RR12)');

  // Setup : create un report pour les tests update/delete (rr1-happy déjà créé)
  const REPORT_FOR_UPDATE = 'rr1-happy';

  // RR10 : update par non-admin
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE), {
          status: 'dismissed',
        }),
      );
      passManually('RR10 update par non-admin → REJET');
    } catch (e) {
      failManually('RR10 (expected fail)', e);
    }
  }

  // RR11 : update par admin
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE), {
          status: 'dismissed',
          reviewedBy: ADMIN_UID,
          decision: 'dismiss',
        }),
      );
      passManually('RR11 update par admin → SUCCESS');
    } catch (e) {
      failManually('RR11 (expected success)', e);
    }
  }

  // RR12 : delete toujours rejeté
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE)));
      passManually('RR12 delete par admin → REJET (audit trail)');
    } catch (e) {
      failManually('RR12 (expected fail)', e);
    }
  }

  // ===================================================================
  // /reports/ READ (RR13-RR16)
  // ===================================================================
  section('/reports/ READ : anonymat strict (RR13-RR16)');

  // RR13 : read par admin
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE)));
      passManually('RR13 read par admin → SUCCESS');
    } catch (e) {
      failManually('RR13 (expected success)', e);
    }
  }

  // RR14 : read par reporter (sa propre history)
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE)));
      passManually('RR14 read par reporter (sa history) → SUCCESS');
    } catch (e) {
      failManually('RR14 (expected success)', e);
    }
  }

  // RR15 : read par reported (anonymat strict — IMPOSSIBLE doctrine §D.1)
  {
    const reportedCtx = env.authenticatedContext(REPORTED_UID);
    const fbDb = asFirestore(reportedCtx.firestore());
    try {
      await assertFails(getDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE)));
      passManually('RR15 read par reported → REJET (anonymat strict §D.1)');
    } catch (e) {
      failManually('RR15 (expected fail)', e);
    }
  }

  // RR16 : read par tiers (ni reporter ni admin)
  {
    const otherCtx = env.authenticatedContext(OTHER_UID);
    const fbDb = asFirestore(otherCtx.firestore());
    try {
      await assertFails(getDoc(doc(fbDb, 'reports', REPORT_FOR_UPDATE)));
      passManually('RR16 read par tiers → REJET');
    } catch (e) {
      failManually('RR16 (expected fail)', e);
    }
  }

  // ===================================================================
  // /userSanctions/ CREATE (RS1-RS5)
  // ===================================================================
  section('/userSanctions/ CREATE rules (RS1-RS5)');

  // RS1 : create par admin
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = validSanctionPayload({ userId: REPORTED_UID });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'userSanctions', 'rs1-admin'), payload));
      passManually('RS1 create par admin → SUCCESS');
    } catch (e) {
      failManually('RS1 (expected success)', e);
    }
  }

  // RS2 : create auto-trigger valide (non-admin user, reason allowed, userId != self)
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validSanctionPayload({
      userId: REPORTED_UID,
      reason: 'reports_threshold',
    });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'userSanctions', 'rs2-auto'), payload));
      passManually('RS2 create auto-trigger valide (reason=reports_threshold) → SUCCESS');
    } catch (e) {
      failManually('RS2 (expected success)', e);
    }
  }

  // RS3 : self-sanction
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validSanctionPayload({ userId: REPORTER_UID });
    try {
      await assertFails(setDoc(doc(fbDb, 'userSanctions', 'rs3-self'), payload));
      passManually('RS3 self-sanction (userId == auth.uid) → REJET');
    } catch (e) {
      failManually('RS3 (expected fail)', e);
    }
  }

  // RS4 : reason='manual_admin' par non-admin
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validSanctionPayload({
      userId: REPORTED_UID,
      reason: 'manual_admin',
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'userSanctions', 'rs4-manual-nonadmin'), payload));
      passManually('RS4 reason=manual_admin par non-admin → REJET');
    } catch (e) {
      failManually('RS4 (expected fail)', e);
    }
  }

  // RS5 : triggeringReportIds vide
  {
    const reporterCtx = env.authenticatedContext(REPORTER_UID);
    const fbDb = asFirestore(reporterCtx.firestore());
    const payload = validSanctionPayload({
      userId: REPORTED_UID,
      triggeringReportIds: [],
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'userSanctions', 'rs5-empty'), payload));
      passManually('RS5 triggeringReportIds vide → REJET');
    } catch (e) {
      failManually('RS5 (expected fail)', e);
    }
  }

  // ===================================================================
  // /userSanctions/ UPDATE + DELETE (RS6-RS10)
  // ===================================================================
  section('/userSanctions/ UPDATE + DELETE (RS6-RS10)');

  // Setup : crée une sanction appealable + une non-appealable pour les tests
  const SANCTION_APPEALABLE = 'rs-appealable';
  const SANCTION_WARNING = 'rs-warning';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'userSanctions', SANCTION_APPEALABLE), {
      sanctionId: SANCTION_APPEALABLE,
      userId: REPORTED_UID,
      level: 'suspension_7d',
      reason: 'reports_threshold',
      triggeringReportIds: ['rp_x'],
      startsAt: Timestamp.now(),
      appealable: true,
      appealUsed: false,
      isActive: true,
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(fbDb, 'userSanctions', SANCTION_WARNING), {
      sanctionId: SANCTION_WARNING,
      userId: REPORTED_UID,
      level: 'warning',
      reason: 'reports_threshold',
      triggeringReportIds: ['rp_y'],
      startsAt: Timestamp.now(),
      appealable: false,
      appealUsed: false,
      isActive: true,
      createdAt: Timestamp.now(),
    });
  });

  // RS6 : update appeal par owner (hasOnly appealUsed+appealNote)
  {
    const ownerCtx = env.authenticatedContext(REPORTED_UID);
    const fbDb = asFirestore(ownerCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_APPEALABLE), {
          appealUsed: true,
          appealNote: 'Je conteste cette sanction pour les raisons suivantes très claires.',
        }),
      );
      passManually('RS6 update appeal par owner (appealUsed+appealNote) → SUCCESS');
    } catch (e) {
      failManually('RS6 (expected success)', e);
    }
  }

  // RS7 : update appeal par owner avec autre champ (hasOnly viole)
  {
    const ownerCtx = env.authenticatedContext(REPORTED_UID);
    const fbDb = asFirestore(ownerCtx.firestore());
    // Reset state via security disabled
    await env.withSecurityRulesDisabled(async (ctx2) => {
      const fbDb2 = asFirestore(ctx2.firestore());
      await updateDoc(doc(fbDb2, 'userSanctions', SANCTION_APPEALABLE), {
        appealUsed: false,
        appealNote: '',
      });
    });
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_APPEALABLE), {
          appealUsed: true,
          appealNote: 'Tentative avec un champ extra non autorisé sanction-wise.',
          isActive: false, // ✗ champ non autorisé
        }),
      );
      passManually('RS7 update owner avec autre champ (hasOnly viole) → REJET');
    } catch (e) {
      failManually('RS7 (expected fail)', e);
    }
  }

  // RS8 : update par non-owner non-admin
  {
    const otherCtx = env.authenticatedContext(OTHER_UID);
    const fbDb = asFirestore(otherCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_APPEALABLE), {
          appealUsed: true,
          appealNote: 'Tentative depuis un user qui n\'est pas le owner.',
        }),
      );
      passManually('RS8 update par non-owner non-admin → REJET');
    } catch (e) {
      failManually('RS8 (expected fail)', e);
    }
  }

  // RS9 : update appeal sur sanction non-appealable (warning)
  {
    const ownerCtx = env.authenticatedContext(REPORTED_UID);
    const fbDb = asFirestore(ownerCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_WARNING), {
          appealUsed: true,
          appealNote: 'Tentative sur warning qui n\'est pas appealable.',
        }),
      );
      passManually('RS9 update appeal sur sanction non-appealable → REJET');
    } catch (e) {
      failManually('RS9 (expected fail)', e);
    }
  }

  // RS10 : delete toujours
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'userSanctions', SANCTION_APPEALABLE)));
      passManually('RS10 delete par admin → REJET (audit trail)');
    } catch (e) {
      failManually('RS10 (expected fail)', e);
    }
  }

  // ===================================================================
  // /userSanctions/ ADMIN APPEAL RESOLUTION + OVERTURN (RS11-RS15)
  // Phase 7 sub-chantier 4 commit 4/4 — admin update flows.
  // ===================================================================
  section('/userSanctions/ admin appeal resolution + overturn (RS11-RS15)');

  // Setup : sanction avec appealUsed=true pour tests RS11/RS12
  const SANCTION_APPEAL_FILED = 'rs-appeal-filed';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'userSanctions', SANCTION_APPEAL_FILED), {
      sanctionId: SANCTION_APPEAL_FILED,
      userId: REPORTED_UID,
      level: 'suspension_7d',
      reason: 'reports_threshold',
      triggeringReportIds: ['rp_z'],
      startsAt: Timestamp.now(),
      appealable: true,
      appealUsed: true,
      appealNote: 'Note appel filé par owner — long enough to pass rule.',
      isActive: true,
      createdAt: Timestamp.now(),
    });
  });

  // RS11 : admin update appealResolvedBy + appealResolvedAt + appealDecision → SUCCESS
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_APPEAL_FILED), {
          appealResolvedBy: ADMIN_UID,
          appealResolvedAt: serverTimestamp(),
          appealDecision: 'upheld',
        }),
      );
      passManually('RS11 admin update appealResolvedBy/At/Decision=upheld → SUCCESS');
    } catch (e) {
      failManually('RS11 (expected success)', e);
    }
  }

  // RS12 : non-admin (other user, ni owner ni admin) update appealResolved* → REJET
  {
    // Reset sanction state via security disabled
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setDoc(doc(fbDb, 'userSanctions', SANCTION_APPEAL_FILED), {
        sanctionId: SANCTION_APPEAL_FILED,
        userId: REPORTED_UID,
        level: 'suspension_7d',
        reason: 'reports_threshold',
        triggeringReportIds: ['rp_z'],
        startsAt: Timestamp.now(),
        appealable: true,
        appealUsed: true,
        appealNote: 'Note appel filé par owner — long enough to pass rule.',
        isActive: true,
        createdAt: Timestamp.now(),
      });
    });
    const otherCtx = env.authenticatedContext(OTHER_UID);
    const fbDb = asFirestore(otherCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_APPEAL_FILED), {
          appealResolvedBy: OTHER_UID,
          appealResolvedAt: serverTimestamp(),
          appealDecision: 'upheld',
        }),
      );
      passManually('RS12 non-admin update appealResolved* → REJET');
    } catch (e) {
      failManually('RS12 (expected fail)', e);
    }
  }

  // Setup : sanction active distincte pour tests RS13/RS14/RS15
  const SANCTION_OVERTURN = 'rs-overturn';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'userSanctions', SANCTION_OVERTURN), {
      sanctionId: SANCTION_OVERTURN,
      userId: REPORTED_UID,
      level: 'suspension_30d',
      reason: 'manual_admin',
      triggeringReportIds: ['rp_w'],
      startsAt: Timestamp.now(),
      appealable: true,
      appealUsed: false,
      isActive: true,
      createdAt: Timestamp.now(),
    });
  });

  // RS13 : admin update isActive=false (overturn manuel) → SUCCESS
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_OVERTURN), {
          isActive: false,
        }),
      );
      passManually('RS13 admin update isActive=false (overturn manuel) → SUCCESS');
    } catch (e) {
      failManually('RS13 (expected success)', e);
    }
  }

  // RS14 : admin update plusieurs champs simultanés (overturn complet) → SUCCESS
  {
    // Reset state
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await updateDoc(doc(fbDb, 'userSanctions', SANCTION_OVERTURN), {
        isActive: true,
      });
    });
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_OVERTURN), {
          isActive: false,
          appealResolvedBy: ADMIN_UID,
          appealResolvedAt: serverTimestamp(),
          appealDecision: 'overturned',
        }),
      );
      passManually('RS14 admin update plusieurs champs simultanés → SUCCESS');
    } catch (e) {
      failManually('RS14 (expected success)', e);
    }
  }

  // RS15 : non-admin (other user, ni owner ni admin) tente isActive mutation → REJET
  // Cohérent rule update : owner peut SEULEMENT muter appealUsed+appealNote (hasOnly).
  // isActive mutation interdite à non-admin.
  {
    const ownerCtx = env.authenticatedContext(REPORTED_UID); // owner mais pas admin
    const fbDb = asFirestore(ownerCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'userSanctions', SANCTION_OVERTURN), {
          isActive: true, // tentative ré-activer
        }),
      );
      passManually('RS15 owner tente isActive mutation → REJET (hasOnly viole)');
    } catch (e) {
      failManually('RS15 (expected fail)', e);
    }
  }

  await env.cleanup();

  console.log('');
  console.log('====== Résumé Reports + UserSanctions rules (RR1-RR16 + RS1-RS15) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
