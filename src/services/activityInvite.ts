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
  collection,
  doc,
  getDoc,
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
  buildInvitationAfroboostPayload,
  type BuildInviteInput,
} from '@/lib/chat/activityInvite';
import { checkInviteRateLimit } from '@/lib/chat/inviteExtras';
import type { ActivityInviteMode } from '@/types/firestore';
import { createNotification } from '@/services/firestore';

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
  /** UID du receiver (autre user dans le chat) — pour notif push. */
  receiverUid?: string;
  /** displayName sender pour body notification (fallback "Quelqu'un"). */
  senderName?: string;
}

export interface SendActivityInviteResult {
  messageId: string;
  /** True si on a update un invite existant pending (anti-doublon Q-F). */
  replaced: boolean;
  /** Soft warning si rate limit dépassé (caller toast). */
  rateLimitMessage?: string;
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

  // BUG #36 C3 — Soft limit invites/jour (toast warning, pas hard block).
  // BUG hotfix : retiré where('createdAt', '>=', ...) qui demandait un index
  // composite (senderId + type + createdAt). On query juste sur type + senderId
  // (auto-indexable Firestore) puis filter aujourd'hui côté code.
  let rateLimitMessage: string | undefined;
  try {
    const todayQuery = query(
      messagesRef,
      where('type', '==', 'activity_invite'),
      where('senderId', '==', input.senderId),
    );
    const todaySnap = await getDocs(todayQuery);
    const startOfDayMs = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    let countToday = 0;
    todaySnap.docs.forEach((d) => {
      const created = d.data().createdAt as { toMillis?: () => number } | undefined;
      if (created?.toMillis && created.toMillis() >= startOfDayMs) countToday++;
    });
    const limit = checkInviteRateLimit(countToday);
    if (!limit.allowed) {
      throw new Error(limit.message ?? 'Rate limit exceeded');
    }
    rateLimitMessage = limit.message;
  } catch (err) {
    console.warn('[sendActivityInvite] rate limit check failed (non-bloquant)', err);
  }

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

  let messageId: string;
  let replaced = false;
  if (!existingSnap.empty) {
    // Anti-doublon : invite pending existante détectée → on NE re-écrit PAS
    // (les rules Firestore bloquent l'update sender-side : seul le receiver
    // peut update inviteStatus pending → accepted/declined).
    // On retourne replaced=true + l'ID existant. L'invitation originale
    // reste visible dans le chat ; caller toast "déjà envoyée" (Bug B).
    const existingDoc = existingSnap.docs[0];
    messageId = existingDoc.id;
    replaced = true;
  } else {
    // Create avec ID pré-généré, messageId inclus dans payload → 1 seul write.
    // Avant : addDoc + updateDoc(messageId) qui échouait sur les rules
    // (update sender-side restreint aux transitions pending→accepted/declined).
    const newRef = doc(messagesRef);
    const payload = buildActivityInvitePayload(input);
    await setDoc(newRef, {
      ...payload,
      messageId: newRef.id,
      createdAt: serverTimestamp(),
    });
    messageId = newRef.id;
  }

  // BUG #36 C3 — Notification push receiver (best-effort, non-bloquant)
  if (input.receiverUid) {
    try {
      const senderName = input.senderName || 'Un utilisateur';
      const title = replaced ? 'Invitation mise à jour' : 'Nouvelle invitation';
      const body = `${senderName} t'invite à ${input.activityTitle}`;
      await createNotification(input.receiverUid, 'activity_invite', title, body, {
        matchId: input.matchId,
        messageId,
        activityId: input.activityId,
        clickUrl: `/chat?match=${input.matchId}`,
      });
    } catch (err) {
      console.warn('[sendActivityInvite] notification create failed (non-bloquant)', err);
    }
  }

  return { messageId, replaced, rateLimitMessage };
}

// =====================================================================
// acceptActivityInvite + declineActivityInvite
// =====================================================================

export interface FinalizeInviteInput {
  matchId: string;
  messageId: string;
  /** displayName du user qui finalise (pour notif body). Fallback "Ton ami". */
  finalizerName?: string;
}

/**
 * Update inviteStatus + notif sender best-effort.
 * Fetch le message AVANT update pour récupérer senderId/activityTitle (utile notif),
 * puis update, puis notif.
 */
async function finalizeInvite(
  input: FinalizeInviteInput,
  finalStatus: 'accepted' | 'declined',
): Promise<void> {
  if (!input.matchId || !input.messageId) {
    throw new Error(`${finalStatus === 'accepted' ? 'acceptActivityInvite' : 'declineActivityInvite'}: matchId + messageId requis`);
  }
  const fsdb = getDb();
  const msgRef = doc(fsdb, 'chats', input.matchId, 'messages', input.messageId);

  // Lecture pré-update pour récup senderId + activityTitle (notif)
  let senderId: string | undefined;
  let activityTitle: string | undefined;
  try {
    const snap = await getDoc(msgRef);
    if (snap.exists()) {
      const data = snap.data();
      senderId = data?.senderId as string | undefined;
      activityTitle = data?.invite?.activityTitle as string | undefined;
    }
  } catch (err) {
    console.warn(`[${finalStatus === 'accepted' ? 'accept' : 'decline'}ActivityInvite] pre-read failed (notif skip)`, err);
  }

  // Update
  await updateDoc(msgRef, {
    inviteStatus: finalStatus,
    [finalStatus === 'accepted' ? 'inviteAcceptedAt' : 'inviteDeclinedAt']: serverTimestamp(),
  });

  // BUG #36 C3 — Notif sender (best-effort, non-bloquant)
  if (senderId) {
    try {
      const finalizerName = input.finalizerName || 'Ton ami';
      const isAccepted = finalStatus === 'accepted';
      const title = isAccepted ? 'Invitation acceptée 🎉' : 'Invitation refusée';
      const body = isAccepted
        ? `${finalizerName} a accepté ton invitation${activityTitle ? ' à ' + activityTitle : ''}.`
        : `${finalizerName} a refusé ton invitation${activityTitle ? ' à ' + activityTitle : ''}.`;
      await createNotification(senderId, 'activity_invite_reply', title, body, {
        matchId: input.matchId,
        messageId: input.messageId,
        clickUrl: `/chat?match=${input.matchId}`,
      });
    } catch (err) {
      console.warn('[finalizeInvite] notif sender failed (non-bloquant)', err);
    }
  }
}

export async function acceptActivityInvite(input: FinalizeInviteInput): Promise<void> {
  return finalizeInvite(input, 'accepted');
}

export async function declineActivityInvite(input: FinalizeInviteInput): Promise<void> {
  return finalizeInvite(input, 'declined');
}

// =====================================================================
// LOT D2 — INVITATION VERS UNE OFFRE AFROBOOST
// =====================================================================

/**
 * Envoie une invitation qui vise une OFFRE du catalogue Afroboost.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE FONCTION SÉPARÉE
 * ─────────────────────────────────────────────────────────────────────────
 * `sendActivityInvite` n'a pas bougé. Elle exige un `activityId`, résout des
 * sessions et alimente un parcours de réservation Spordate — trois choses
 * qu'une offre Afroboost n'a pas et ne doit pas avoir. Les fondre aurait
 * demandé d'assouplir la première, alors qu'elle sert tout le produit depuis
 * des mois.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'ARRIVE PAS ICI
 * ─────────────────────────────────────────────────────────────────────────
 * Aucune session Firestore n'est créée ni résolue. Aucun booking. Aucun
 * paiement, ni Spordate ni Afroboost. Aucun crédit débité — les règles
 * exemptent explicitement `activity_invite` du coût d'un message. L'invitation
 * est un MESSAGE : elle dit « ça te dit ? », elle n'achète rien.
 *
 * Le chat doit déjà être déverrouillé : c'est `firestore.rules` qui l'exige
 * (`matches/{id}.chatUnlocked == true`), et ce lot ne touche pas à cette règle.
 * Le déverrouillage passe par le mécanisme existant, inchangé, à son tarif
 * existant — sans aucun rapport avec le prix de l'offre.
 */
export interface SendInvitationAfroboostInput {
  matchId: string;
  senderId: string;
  afroboostOfferId: string;
  titre: string;
  inviteMode: ActivityInviteMode;
  ville?: string;
  lieu?: string;
  imageUrl?: string;
  /** INFORMATIF. N'est jamais utilisé pour facturer quoi que ce soit. */
  prix?: number | null;
  receiverUid?: string;
  senderName?: string;
}

export async function sendInvitationAfroboost(
  input: SendInvitationAfroboostInput,
): Promise<SendActivityInviteResult> {
  if (!input.matchId || !input.senderId || !input.afroboostOfferId) {
    throw new Error('sendInvitationAfroboost: matchId, senderId, afroboostOfferId requis');
  }
  const fsdb = getDb();
  const messagesRef = collection(fsdb, 'chats', input.matchId, 'messages');

  // Anti-doublon : une invitation en attente pour LA MÊME offre, du même
  // expéditeur, ne se re-écrit pas. Même règle que le chemin natif, appliquée
  // au champ de CE référentiel — jamais à `invite.activityId`, qui n'existe pas.
  const existantes = await getDocs(
    query(
      messagesRef,
      where('type', '==', 'activity_invite'),
      where('senderId', '==', input.senderId),
      where('invite.afroboostOfferId', '==', input.afroboostOfferId),
      where('inviteStatus', '==', 'pending'),
      firestoreLimit(1),
    ),
  );
  if (!existantes.empty) {
    return { messageId: existantes.docs[0].id, replaced: true };
  }

  const nouveau = doc(messagesRef);
  await setDoc(nouveau, {
    ...buildInvitationAfroboostPayload({
      senderId: input.senderId,
      afroboostOfferId: input.afroboostOfferId,
      titre: input.titre,
      inviteMode: input.inviteMode,
      ville: input.ville,
      lieu: input.lieu,
      imageUrl: input.imageUrl,
      prix: input.prix,
    }),
    messageId: nouveau.id,
    createdAt: serverTimestamp(),
  });

  // Notification : le mécanisme existant, tel quel. Best-effort, non bloquant.
  if (input.receiverUid) {
    try {
      const nom = input.senderName || 'Un utilisateur';
      await createNotification(
        input.receiverUid,
        'activity_invite',
        'Nouvelle invitation',
        `${nom} te propose ${input.titre}`,
        {
          matchId: input.matchId,
          messageId: nouveau.id,
          // La cible sous SON champ. Jamais `activityId`.
          afroboostOfferId: input.afroboostOfferId,
          clickUrl: `/chat?match=${input.matchId}`,
        },
      );
    } catch (err) {
      console.warn('[sendInvitationAfroboost] notification create failed (non-bloquant)', err);
    }
  }

  return { messageId: nouveau.id, replaced: false };
}
