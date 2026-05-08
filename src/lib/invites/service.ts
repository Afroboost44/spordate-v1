/**
 * Phase 8 sub-chantier 4 commit 2/6 — Service helpers /invites.
 *
 * 4 helpers async :
 *   - createInvite     : crée une nouvelle invitation pending avec expiresAt clamp Min(7j, sessionStart-1h)
 *   - acceptInvite     : transition pending → accepted (toUserId path a rule)
 *   - declineInvite    : transition pending → declined (toUserId path b rule)
 *   - expireInvitesIfDue : batch cleanup status='pending' && expiresAt < now → 'expired' (Admin SDK via cron Phase 9)
 *
 * Doctrine §E.Q1 mode Individuel Phase 8 + Q3=C expiresAt clamping cohérent SC1 cancel policy
 * + Q9=A explicit decline KPI tracking + Q10=B doc-id pattern anti-doublon.
 *
 * DI seam pattern cohérent __setChatDbForTesting (SC1) — utilisé par tests/invites/service.test.ts.
 */

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Invite, InviteMode, Session } from '@/types/firestore';
import { computeSplitAmounts, SplitMathError } from './splitMath';

// =====================================================================
// Constants
// =====================================================================

/** TTL invitation : 7 jours max (Q3=C). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Buffer pré-session : 1h avant sessionStart (cohérent SC1 cancel policy). */
export const PRE_SESSION_BUFFER_MS = 60 * 60 * 1000;

/** Limite message UX nice (Q1=A optional). */
export const INVITE_MESSAGE_MAX_LEN = 200;

// =====================================================================
// DI seam (test injection cohérent __setChatDbForTesting SC1)
// =====================================================================

let _invitesDbOverride: Firestore | null = null;

/**
 * @internal — utilisé UNIQUEMENT par les tests pour injecter un Firestore
 * connecté à l'emulator (cf. tests/invites/service.test.ts).
 */
export function __setInvitesDbForTesting(testDb: Firestore | null): void {
  _invitesDbOverride = testDb;
}

function getInvitesDb(): Firestore {
  const fbDb = _invitesDbOverride ?? db;
  if (!fbDb) throw new Error('Firestore non initialisé');
  return fbDb;
}

// =====================================================================
// Errors
// =====================================================================

export type InviteErrorCode =
  | 'invalid-input'
  | 'self-invite-forbidden'
  | 'session-not-found'
  | 'session-too-soon'
  | 'not-found'
  | 'invalid-status'
  | 'forbidden'
  | 'expired'
  // Phase 9 SC2 c2/6 — modes Split/Gift
  | 'invalid-mode'
  | 'invalid-split-ratio'
  | 'invalid-total-cents';

export class InviteError extends Error {
  public readonly code: InviteErrorCode;
  constructor(code: InviteErrorCode, message: string) {
    super(message);
    this.name = 'InviteError';
    this.code = code;
  }
}

// =====================================================================
// Helpers
// =====================================================================

/** Doc-id pattern Q10=B : `${fromUserId}_${toUserId}_${sessionId}`. */
export function makeInviteDocId(
  fromUserId: string,
  toUserId: string,
  sessionId: string,
): string {
  return `${fromUserId}_${toUserId}_${sessionId}`;
}

// =====================================================================
// createInvite
// =====================================================================

export interface CreateInviteInput {
  fromUserId: string;
  toUserId: string;
  activityId: string;
  sessionId: string;
  message?: string;
  // Phase 9 SC2 c2/6 — modes Split/Gift
  /** Mode invite (default 'individual' si absent — Phase 8 SC4 legacy compat). */
  mode?: InviteMode;
  /** Ratio inviter [0.1, 0.9] (Q5=A) — required pour mode='split'. */
  splitInviterRatio?: number;
  /** Total session price CHF centimes (server-recomputed anti-cheat).
   *  Requis pour mode!='individual' (calcul split amounts).
   *  Caller responsibility : passer la valeur server-computed (cohérent /api/checkout pattern). */
  totalCents?: number;
}

/**
 * Crée une invitation pending. Lit la session pour clamper expiresAt à
 * Min(now+7j, sessionStart-1h) (Q3=C). Anti self-invite + validation inputs.
 *
 * @returns inviteId (= doc-id pattern `${from}_${to}_${session}`)
 * @throws InviteError code = 'invalid-input' | 'self-invite-forbidden' |
 *         'session-not-found' | 'session-too-soon'
 */
export async function createInvite(input: CreateInviteInput): Promise<string> {
  const { fromUserId, toUserId, activityId, sessionId, message } = input;

  if (!fromUserId || !toUserId || !activityId || !sessionId) {
    throw new InviteError(
      'invalid-input',
      'fromUserId, toUserId, activityId, sessionId requis non-vides',
    );
  }
  if (fromUserId === toUserId) {
    throw new InviteError('self-invite-forbidden', 'Cannot invite yourself');
  }

  const fbDb = getInvitesDb();

  // Read session pour clamp expiresAt
  const sessionSnap = await getDoc(doc(fbDb, 'sessions', sessionId));
  if (!sessionSnap.exists()) {
    throw new InviteError('session-not-found', `Session ${sessionId} introuvable`);
  }
  const session = sessionSnap.data() as Session;

  // Q3=C : Min(now+7j, sessionStart-1h)
  const nowMs = Date.now();
  const sessionStartMs = session.startAt.toMillis();
  const sevenDaysMs = nowMs + INVITE_TTL_MS;
  const oneHourBeforeMs = sessionStartMs - PRE_SESSION_BUFFER_MS;
  const expiresAtMs = Math.min(sevenDaysMs, oneHourBeforeMs);

  if (expiresAtMs <= nowMs) {
    throw new InviteError(
      'session-too-soon',
      `Session ${sessionId} démarre dans <1h, invite impossible`,
    );
  }

  const expiresAt = Timestamp.fromMillis(expiresAtMs);
  const inviteId = makeInviteDocId(fromUserId, toUserId, sessionId);

  const payload: Record<string, unknown> = {
    inviteId,
    fromUserId,
    toUserId,
    activityId,
    sessionId,
    status: 'pending',
    expiresAt,
    createdAt: serverTimestamp(),
  };
  if (message) {
    payload.message = message.slice(0, INVITE_MESSAGE_MAX_LEN);
  }

  // Phase 9 SC2 c2/6 — modes Split/Gift : compute amounts + persist
  const mode: InviteMode = input.mode ?? 'individual';
  if (mode !== 'individual') {
    if (!input.totalCents || input.totalCents <= 0) {
      throw new InviteError(
        'invalid-total-cents',
        `totalCents requis et > 0 pour mode=${mode}`,
      );
    }
    try {
      const splitAmounts = computeSplitAmounts({
        totalCents: input.totalCents,
        mode,
        splitInviterRatio: input.splitInviterRatio,
      });
      payload.mode = mode;
      payload.splitInviterAmountCents = splitAmounts.inviterCents;
      payload.splitInviteeAmountCents = splitAmounts.inviteeCents;
    } catch (err) {
      if (err instanceof SplitMathError) {
        if (err.code === 'invalid-ratio' || err.code === 'ratio-required') {
          throw new InviteError('invalid-split-ratio', err.message);
        }
        if (err.code === 'invalid-mode') {
          throw new InviteError('invalid-mode', err.message);
        }
        throw new InviteError('invalid-input', err.message);
      }
      throw err;
    }
  }

  await setDoc(doc(fbDb, 'invites', inviteId), payload);
  return inviteId;
}

// =====================================================================
// acceptInvite
// =====================================================================

/**
 * Transition pending → accepted (rule path a — toUserId only).
 * Verify status='pending', toUserId match, not expired.
 *
 * @throws InviteError code = 'not-found' | 'invalid-status' | 'forbidden' | 'expired'
 */
export async function acceptInvite(inviteId: string, toUserId: string): Promise<void> {
  const fbDb = getInvitesDb();
  const inviteRef = doc(fbDb, 'invites', inviteId);
  const snap = await getDoc(inviteRef);

  if (!snap.exists()) {
    throw new InviteError('not-found', `Invite ${inviteId} introuvable`);
  }
  const invite = snap.data() as Invite;

  if (invite.status !== 'pending') {
    throw new InviteError(
      'invalid-status',
      `Invite ${inviteId} status='${invite.status}', expected 'pending'`,
    );
  }
  if (invite.toUserId !== toUserId) {
    throw new InviteError(
      'forbidden',
      `Only toUserId can accept (caller=${toUserId}, expected=${invite.toUserId})`,
    );
  }
  if (invite.expiresAt.toMillis() <= Date.now()) {
    throw new InviteError('expired', `Invite ${inviteId} expirée`);
  }

  await updateDoc(inviteRef, {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
  });
}

// =====================================================================
// declineInvite
// =====================================================================

/**
 * Transition pending → declined (rule path b — toUserId only).
 * Verify status='pending', toUserId match. Pas de check expired (peut décliner
 * une invite expirée — UX simple).
 *
 * @throws InviteError code = 'not-found' | 'invalid-status' | 'forbidden'
 */
export async function declineInvite(inviteId: string, toUserId: string): Promise<void> {
  const fbDb = getInvitesDb();
  const inviteRef = doc(fbDb, 'invites', inviteId);
  const snap = await getDoc(inviteRef);

  if (!snap.exists()) {
    throw new InviteError('not-found', `Invite ${inviteId} introuvable`);
  }
  const invite = snap.data() as Invite;

  if (invite.status !== 'pending') {
    throw new InviteError(
      'invalid-status',
      `Invite ${inviteId} status='${invite.status}', expected 'pending'`,
    );
  }
  if (invite.toUserId !== toUserId) {
    throw new InviteError(
      'forbidden',
      `Only toUserId can decline (caller=${toUserId}, expected=${invite.toUserId})`,
    );
  }

  await updateDoc(inviteRef, {
    status: 'declined',
    declinedAt: serverTimestamp(),
  });
}

// =====================================================================
// expireInvitesIfDue (Admin SDK / cron Phase 9)
// =====================================================================

/**
 * Batch cleanup : tous les invites status='pending' && expiresAt < now → 'expired'.
 *
 * Note : la rule firestore.rules /invites/{id} update n'a pas de path 'expired' —
 * cette fonction est destinée à être exécutée via Admin SDK (cron Phase 9 ou route
 * server-side qui bypass les rules). En tests, utiliser withSecurityRulesDisabled.
 *
 * @returns count d'invites expirées dans ce batch
 */
export async function expireInvitesIfDue(): Promise<number> {
  const fbDb = getInvitesDb();
  const nowTs = Timestamp.now();
  const q = query(
    collection(fbDb, 'invites'),
    where('status', '==', 'pending'),
    where('expiresAt', '<=', nowTs),
  );
  const snap = await getDocs(q);

  if (snap.empty) return 0;

  const batch = writeBatch(fbDb);
  for (const d of snap.docs) {
    batch.update(d.ref, { status: 'expired' });
  }
  await batch.commit();
  return snap.size;
}
