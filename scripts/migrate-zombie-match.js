/**
 * Script admin one-shot pour rediriger un match zombie d'un UID supprimé
 * vers un nouvel UID. Réécrit le doc matches + chats + supprime les notifications
 * orphelines de l'ancien UID.
 *
 * Usage:
 *   docker exec -w /app -e OLD_UID=xxx -e NEW_UID=yyy spordateur node migrate-zombie-match.js
 */
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const oldUid = process.env.OLD_UID;
const newUid = process.env.NEW_UID;
if (!oldUid || !newUid) {
  console.error('OLD_UID et NEW_UID requis.');
  process.exit(1);
}

function parseKey(raw) {
  const trimmed = raw.trim();
  try {
    const p = JSON.parse(trimmed);
    if (p.private_key?.includes('\\n')) p.private_key = p.private_key.replace(/\\n/g, '\n');
    return p;
  } catch {
    const d = Buffer.from(trimmed, 'base64').toString('utf-8');
    const p = JSON.parse(d);
    if (p.private_key?.includes('\\n')) p.private_key = p.private_key.replace(/\\n/g, '\n');
    return p;
  }
}

if (!getApps().length) {
  initializeApp({ credential: cert(parseKey(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
}
const db = getFirestore();

(async () => {
  const stats = { matchesUpdated: 0, chatsUpdated: 0, oldDocDeleted: false };

  // 1. Trouve tous les matches contenant oldUid
  const matchesSnap = await db
    .collection('matches')
    .where('userIds', 'array-contains', oldUid)
    .get();

  for (const matchDoc of matchesSnap.docs) {
    const matchId = matchDoc.id;
    const data = matchDoc.data();
    const newUserIds = (data.userIds || []).map((u) => (u === oldUid ? newUid : u)).sort();
    // Recrée doc avec nouvel ID déterministe (sorted uids join '_')
    const newMatchId = `${newUserIds[0]}_${newUserIds[1]}`;

    // Backup old match data + create new
    await db.collection('matches').doc(newMatchId).set(
      {
        ...data,
        matchId: newMatchId,
        userIds: newUserIds,
      },
      { merge: true },
    );

    // Migrate chat doc
    const oldChatSnap = await db.collection('chats').doc(matchId).get();
    if (oldChatSnap.exists) {
      const chatData = oldChatSnap.data();
      const newParticipants = (chatData.participants || []).map((u) =>
        u === oldUid ? newUid : u,
      ).sort();
      // Remap unreadCount keys
      const oldUnread = chatData.unreadCount || {};
      const newUnread = {};
      Object.keys(oldUnread).forEach((k) => {
        newUnread[k === oldUid ? newUid : k] = oldUnread[k];
      });
      await db.collection('chats').doc(newMatchId).set(
        {
          ...chatData,
          chatId: newMatchId,
          participants: newParticipants,
          unreadCount: newUnread,
        },
        { merge: true },
      );
      stats.chatsUpdated++;

      // Migrate messages subcollection
      const msgsSnap = await db
        .collection('chats')
        .doc(matchId)
        .collection('messages')
        .get();
      if (!msgsSnap.empty) {
        for (const m of msgsSnap.docs) {
          const md = m.data();
          const newSenderId = md.senderId === oldUid ? newUid : md.senderId;
          const newReadBy = (md.readBy || []).map((u) => (u === oldUid ? newUid : u));
          await db
            .collection('chats')
            .doc(newMatchId)
            .collection('messages')
            .doc(m.id)
            .set({ ...md, senderId: newSenderId, readBy: newReadBy }, { merge: true });
        }
      }

      // Supprime ancien chat doc + ancien match doc (si différent)
      if (matchId !== newMatchId) {
        // delete messages
        const msgs2 = await db
          .collection('chats')
          .doc(matchId)
          .collection('messages')
          .get();
        for (const m of msgs2.docs) await m.ref.delete();
        await db.collection('chats').doc(matchId).delete();
        await matchDoc.ref.delete();
      }
    } else if (matchId !== newMatchId) {
      await matchDoc.ref.delete();
    }

    stats.matchesUpdated++;
  }

  // 2. Migrate likes from/to oldUid
  const likesFrom = await db.collection('likes').where('fromUid', '==', oldUid).get();
  const likesTo = await db.collection('likes').where('toUid', '==', oldUid).get();
  let likesUpdated = 0;
  for (const l of [...likesFrom.docs, ...likesTo.docs]) {
    const data = l.data();
    const newFrom = data.fromUid === oldUid ? newUid : data.fromUid;
    const newTo = data.toUid === oldUid ? newUid : data.toUid;
    const newLikeId = `${newFrom}_${newTo}`;
    await db.collection('likes').doc(newLikeId).set(
      { ...data, fromUid: newFrom, toUid: newTo },
      { merge: true },
    );
    if (l.id !== newLikeId) await l.ref.delete();
    likesUpdated++;
  }

  // 3. Supprime le doc fantôme users/{oldUid}
  await db.collection('users').doc(oldUid).delete();
  stats.oldDocDeleted = true;

  console.log('Migration terminée:', { ...stats, likesUpdated });
  process.exit(0);
})();
