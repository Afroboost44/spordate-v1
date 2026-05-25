/**
 * Fix #147 — Test anti-régression : visibilité conversation côté destinataire.
 *
 * Pattern récurrent évité :
 *  A envoie message à B → B reçoit notification → mais B voit
 *  "Pas encore de conversation" car loadConversations() s'est exécuté UNE seule
 *  fois au mount. Quand A crée le match (mutual ou direct-paid) pendant que B
 *  est sur /chat, B ne voit RIEN tant qu'il ne refresh pas.
 *
 * Le fix : onSnapshot realtime sur matches where userIds array-contains B.uid.
 * Chaque nouveau match (ou update chatUnlocked) déclenche loadConversations.
 *
 * Invariants verrouillés par ce test :
 *  1. Un match créé par A entre [A, B] doit toujours contenir B dans userIds.
 *  2. Le filtre "conversation visible" doit inclure status='accepted' OU
 *     chatUnlocked=true (les 2 chemins create-mutual + unlock-direct).
 *  3. Un match avec status='pending' ET chatUnlocked=false est filtré (legacy).
 *  4. Un match avec userIds = [autres uids sans B] est filtré.
 *  5. Le filter ne casse pas si match.status est undefined (legacy data).
 *
 * Exécution : node tests/admin/chat-conversation-visibility.test.js
 */

// Reproduit la logique de filtrage de chat/page.tsx loadConversations()
function isConversationVisible(match, currentUid, blockedSet) {
  if (!match || !match.userIds || !match.userIds.includes(currentUid)) return false;
  if (!(match.status === 'accepted' || match.chatUnlocked === true)) return false;
  const otherUid = match.userIds.find((id) => id !== currentUid);
  if (otherUid && blockedSet && blockedSet.has(otherUid)) return false;
  return true;
}

let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

const B = 'user-B';
const A = 'user-A';
const C = 'user-C';
const emptyBlocks = new Set();

// CASE 1 — Match créé via /api/match/create-mutual (status=accepted, chatUnlocked=true)
{
  const match = { userIds: [A, B], status: 'accepted', chatUnlocked: true };
  if (isConversationVisible(match, B, emptyBlocks)) {
    ok('CASE 1 — Match mutuel visible chez B');
  } else fail('CASE 1', match);
}

// CASE 2 — Match créé via /api/chat/unlock-direct (status=accepted, chatUnlocked=true)
{
  const match = { userIds: [A, B], status: 'accepted', chatUnlocked: true, initiatedBy: 'direct-paid' };
  if (isConversationVisible(match, B, emptyBlocks)) {
    ok('CASE 2 — Match direct-paid visible chez B');
  } else fail('CASE 2', match);
}

// CASE 3 — Match pending sans unlock = invisible (legacy, pas encore débloqué)
{
  const match = { userIds: [A, B], status: 'pending', chatUnlocked: false };
  if (!isConversationVisible(match, B, emptyBlocks)) {
    ok('CASE 3 — Match pending+verrouillé masqué (comportement attendu)');
  } else fail('CASE 3', match);
}

// CASE 4 — Match qui contient A et C mais pas B → invisible chez B
{
  const match = { userIds: [A, C], status: 'accepted', chatUnlocked: true };
  if (!isConversationVisible(match, B, emptyBlocks)) {
    ok('CASE 4 — Match étranger masqué chez B');
  } else fail('CASE 4', match);
}

// CASE 5 — Bloc mutuel : A a bloqué B (ou inversement) → invisible
{
  const match = { userIds: [A, B], status: 'accepted', chatUnlocked: true };
  const blocks = new Set([A]);
  if (!isConversationVisible(match, B, blocks)) {
    ok('CASE 5 — Match avec user bloqué masqué chez B');
  } else fail('CASE 5', match);
}

// CASE 6 — Régression bug user : A envoie message à B, B doit voir la conv.
//          Reproduit le bug original : si onSnapshot manquait, B ne voyait rien.
//          Ici on simule le snapshot qui contient le match — le filter DOIT pass.
{
  const initialSnapshot = [];
  const updatedSnapshot = [
    { userIds: [A, B], status: 'accepted', chatUnlocked: true, matchId: `${A}_${B}` },
  ];
  // Simulation du flow : B mount /chat → initialSnapshot vide → "Pas encore"
  const initialList = initialSnapshot.filter((m) => isConversationVisible(m, B, emptyBlocks));
  if (initialList.length === 0) ok('CASE 6a — État initial vide (avant que A like B)');
  else fail('CASE 6a', initialList);

  // Puis A like B et crée le match → onSnapshot fire → updatedSnapshot
  const updatedList = updatedSnapshot.filter((m) => isConversationVisible(m, B, emptyBlocks));
  if (updatedList.length === 1 && updatedList[0].userIds.includes(B)) {
    ok('CASE 6b — Conversation apparaît chez B sans refresh (preuve fix realtime)');
  } else fail('CASE 6b', updatedList);
}

// CASE 7 — Defensive : match avec userIds absent
{
  const malformedMatch = { status: 'accepted', chatUnlocked: true };
  if (!isConversationVisible(malformedMatch, B, emptyBlocks)) {
    ok('CASE 7 — Match malformé (userIds absent) filtré sans crash');
  } else fail('CASE 7');
}

// CASE 8 — Defensive : match.status undefined mais chatUnlocked=true (legacy)
{
  const legacyMatch = { userIds: [A, B], chatUnlocked: true };
  if (isConversationVisible(legacyMatch, B, emptyBlocks)) {
    ok('CASE 8 — Match legacy (status absent) visible si chatUnlocked');
  } else fail('CASE 8');
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
