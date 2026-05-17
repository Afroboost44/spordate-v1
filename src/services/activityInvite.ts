/**
 * BUG #36 COMMIT 1 — Services activity_invite (client SDK).
 *
 * 3 fonctions :
 *  - sendActivityInvite : create message type='activity_invite' dans
 *    chats/{matchId}/messages/. Anti-doublon : si invite pending entre
 *    sender↔receiver pour MÊME activityId existe déjà, la met à jour au
 *    lieu d'en créer une nouvelle (cohérent décision Bassi Q-F).
 *  - acceptActivityInvite : update inviteStatus 'pending' → 'accepted'.
 *  - declineActivityInvite : update inviteStatus 'pending' → 'declined'.
 *
 * Toutes les opérations côté client via Firebase Web SDK — les rules
 * messages create/update validées par BUG #36 commit rules autorisent
 * ces writes (gratuit pour activity_invite, update par receiver only).
 *
 * @module
 */

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit as firestoreLimit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  buildActivityInvitePayload,
  type BuildInviteInput,
} from '@/lib/chat/activityInvite';

// =====================================================================
// DI seam pour tests
// =====================================================================

let _dbOverride: Firestore | null = null;

/** @internal — utilisé UNIQUEMENT par tests pour injecter Firestore emulator. */
export function __setActivityInviteDbForTesting(testDb: Firestore | null): void {
  _dbOverride = testDb;
}

function getDb(): Firestore {
  const fsdb = _dbOverride ?? db;
  if (!fsdb) throw new Error('Firestore non initialisé');
  return fsdb;
}

// =====================================================================
// sendActivityInvite
// =====================================================================

export interface SendActivityInviteInput extends BuildInviteInput {
  /** matchId = deterministic id `${sortedUids[0]}_${sortedUids[1]}` (cohérent fix #14). */
  matchId: string;
}

export interface SendActivityInviteResult {
  messageId: string;
  /** True si on a update un invite existant pending (anti-doublon Q-F). */
  replaced: boolean;
}

/**
 * Envoie un activity_invite dans le chat. Si un invite pending existe déjà
 * pour la même paire (sender → receiver) et la même activityId, met à jour
 * cet invite (anti-doublon décision Q-F Bassi).
 *
 * @throws Si auth perdue / rules denied / activityId invalide
 */
export async function sendActivityInvite(
  input: SendActivityInviteInput,
): Promise<SendActivityInviteResult> {
  if (!input.matchId || !input.senderId || !input.activityId) {
    throw new Error('sendActivityInvite: matchId, senderId, activityId requis');
  }
  const fsdb = getDb();
  const messagesRef = collection(fsdb, 'chats', input.matchId, 'messages');

  // Check anti-doublon : invite pending même paire + même activityId
  const existingQuery = query(
    messagesRef,
    where('type', '==', 'activity_invite'),
    where('senderId', '==', input.senderId),
    where('invite.activityId', '==', input.activityId),
    where('inviteStatus', '==', 'pending'),
    firestoreLimit(1),
  );
  const existingSnap = await getDocs(existingQuery);
  if (!existingSnap.empty) {
    // Update au lieu de create
    const existingDoc = existingSnap.docs[0];
    const payload = buildActivityInvitePayload(input);
    await setDoc(existingDoc.ref, {
      ...payload,
      messageId: existingDoc.id,
      createdAt: existingDoc.data().createdAt ?? serverTimestamp(),
    });
    return { messageId: existingDoc.id, replaced: true };
  }

  // Sinon create nouveau
  const payload = buildActivityInvitePayload(input);
  const docRef = await addDoc(messagesRef, {
    ...payload,
    createdAt: serverTimestamp(),
  });
  // Update le messageId avec l'id auto-généré (cohérent SugCard.SC4 pattern)
  await updateDoc(docRef, { messageId: docRef.id });
  return { messageId: docRef.id, replaced: false };
}

// =====================================================================
// acceptActivityInvite + declineActivityInvite
// =====================================================================

export interface FinalizeInviteInput {
  matchId: string;
  messageId: string;
}

export async function acceptActivityInvite(input: FinalizeInviteInput): Promise<void> {
  if (!input.matchId || !input.messageId) {
    throw new Error('acceptActivityInvite: matchId + messageId requis');
  }
  const fsdb = getDb();
  const msgRef = doc(fsdb, 'chats', input.matchId, 'messages', input.messageId);
  await updateDoc(msgRef, {
    inviteStatus: 'accepted',
    inviteAcceptedAt: serverTimestamp(),
  });
}

export async function declineActivityInvite(input: FinalizeInviteInput): Promise<void> {
  if (!input.matchId || !input.messageId) {
    throw new Error('declineActivityInvite: matchId + messageId requis');
  }
  const fsdb = getDb();
  const msgRef = doc(fsdb, 'chats', input.matchId, 'messages', input.messageId);
  await updateDoc(msgRef, {
    inviteStatus: 'declined',
    inviteDeclinedAt: serverTimestamp(),
  });
}
