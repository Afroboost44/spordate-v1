# Phase 8 SC4 — Smoke test manuel Invite Individuel

Tests automated SC4 : 39 (rules + service + API + email + webhook). Ce doc complète avec
les paths UI end-to-end qui ne sont pas couverts par tests automated (UI components
+ Stripe webhook → /sessions redirect + cross-user notifs propagation).

## Pré-requis

- Vercel prod déployé (commit 5/6 SC4 a0xxxxx)
- Firestore rules déployées (`firebase deploy --only firestore:rules --project spordate-prod`)
- 2 comptes test (User A + User B) avec emails distincts
- Au moins 1 activity active dans la base avec session future schedulée

## Flow nominal — happy path A invite B

1. **A se connecte** → /chat (ou /activities/[id])
2. **A possède un chat actif** avec B (match confirmed) — sinon créer match
3. **A déclenche Invite Button** *(quand wired Phase 9 — actuellement via API direct ou page de session)* :
   - Ouvre modal `<InviteButton>`
   - Saisit message optionnel (max 200 chars compteur visible)
   - Clique "Envoyer l'invitation"
4. **Toast UI succès** : "Invitation envoyée — B a reçu ton invitation par email"
5. **B reçoit email Resend** subject "{A.name} t'invite à {activityTitle}" (vérifier inbox spam)
6. **B reçoit notification in-app** type='invite_received' (visible dans `/notifications`)
7. **B clique lien email → /invite/[id]** :
   - Page rendered (server component)
   - Status badge "En attente" (#D91CD2)
   - Activity card (titre + sport·city + sessionDate FR + message? italic)
   - 2 CTAs InviteActionsClient : "Accepter et payer" + "Refuser"
8. **B clique "Accepter et payer"** :
   - Loading "Redirection Stripe…"
   - Redirect Stripe Checkout (B paye sa part)
9. **Webhook Stripe** consume `metadata.mode='invite-accept'` :
   - Booking créé `userId=B.uid` status='confirmed'
   - Invite update `status='accepted'` + `acceptedAt`
   - Bob crédits +50 (chatCreditsBundle)
   - Notification A type='invite_accepted'
   - Notification B type='booking' confirmé
10. **Stripe redirect success** → `/dashboard?status=success&inviteId=...`
11. **A reçoit notif** "B a accepté ton invitation"

## Flow refus — A invite B, B refuse

1-7. *(idem flow nominal)*
8. **B clique "Refuser"** :
   - Loading
   - POST /api/invites/[id]/decline (Bearer auth)
   - Toast "Invitation refusée"
   - `router.refresh()` → page rendered avec status='declined' badge
9. **Invite update** : `status='declined'` + `declinedAt`
10. **A peut inviter quelqu'un d'autre** (doc-id pattern doublon n'empêche pas re-invite vers autre user)

## Flow expiration

1. **Invite created** par A à B avec session J+8 (expiresAt clamp = J+7)
2. **Cron Phase 9** (ou `expireInvitesIfDue()` manuel) → status='expired'
3. **B visite /invite/[id]** → page rendered avec status='expired' badge
4. **InviteActionsClient** ne rend aucun CTA (status≠'pending')

## Edge cases anti-doublon (Q10=B)

1. **A invite B pour session_X** → SUCCESS (doc-id `{A}_{B}_{session_X}`)
2. **A re-tente invite B pour session_X** → 409 doc-id collision
3. **InviteButton catch 409** → toast "Tu as déjà invité B pour cette session"
4. **A peut inviter C pour session_X** → SUCCESS (doc-id différent)
5. **A peut inviter B pour session_Y** → SUCCESS (doc-id différent)

## Self-invite anti-pattern

1. **A clique Inviter sur soi-même** (UI shouldn't allow but defensive) → 400 self-invite-forbidden

## Auth required

1. **User non-connecté visite /invite/[id]** :
   - Page rendered (read-only data publiques)
   - InviteActionsClient affiche "Connecte-toi pour accepter ou refuser"
2. **User non-toUserId connecté** (autre user lambda) :
   - InviteActionsClient affiche "Cette invitation ne t'est pas adressée"
3. **fromUserId visite sa propre invite pending** :
   - InviteActionsClient affiche "En attente de la réponse de {toUserName}"

## Différé Phase 9 (NON couvert SC4)

- ⏭️ SuggestionMessage SC3 commit 5/6 wire `<InviteButton>` secondaire — manque
  `SuggestionCard.nextSessionId` persistence (current : seulement nextSessionAt Timestamp).
  Phase 9 polish : enrich SC3 API route + add InviteButton conditional rendering.
- ⏭️ /activities/[id]/page.tsx invite trigger dropdown matches — server component
  + session selection logic. Phase 9 polish : client island `<ActivityInviteSection>`
  qui charge user.matches + dropdown otherUsers + InviteButton modal pre-rempli.
- ⏭️ Cron `expireInvitesIfDue()` deployment — Phase 9 Cloud Functions Scheduler
  (pattern Phase 6 anti-cheat).
- ⏭️ Refund logic si invité annule après accept — Phase 9 Stripe Connect.
