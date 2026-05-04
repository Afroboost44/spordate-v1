# Phase 7 — Trust & Safety (T&S) — Guide consolidé

> **Audience** : développeurs/contributors qui découvrent ou maintiennent la couche T&S Spordateur.
> **Doctrine source de vérité** : `architecture.md` §9.sexies (sections A-J).
> **Statut** : Phase 7 ✅ COMPLET (mai 2026) — sub-chantiers 0-6.

Ce document consolide en un seul endroit l'architecture, les services, les tests et les TODO différés Phase 8/9 produits par les 6 sub-chantiers Phase 7.

---

## 1. Architecture overview

5 modules indépendants + 2 collections de données :

| Module | Path | Rôle | Sub-chantier source |
|---|---|---|---|
| Reviews | `src/lib/reviews/` | Reviews publiques 1-5★ avec anonymisation graduée 1-2★ | 1 |
| Blocks | `src/lib/blocks/` | Block list user-side (mutuelle invisibilité) | 2 |
| Reports | `src/lib/reports/` | Reports formels anonymes + No-show partner check-in + sanctions auto/admin + appeals | 3 + 4 |
| Email | `src/lib/email/` | Resend wrapper + 12 templates transactional | 0 + wires divers |
| Admin actions | `src/lib/admin-actions/` | Audit trail décisions admin (24mo conservation) | 5 |
| Sessions (T&S) | `src/lib/sessions/` | `getCoInscribedConflicts` détection conflits blocks ↔ sessions futures | 4 |

**UI surfaces** :
- `/profile/blocks` — gestion blocks user-side
- `/profile/[uid]` — boutons Block + Report sur header
- `/chat` — bouton Report dans header conversation + filter mutual blocks
- `/discovery` — filter mutual blocks
- `/sessions/[sessionId]` — boutons Block + Report partner (sub-chantier 6)
- `/partner/sessions/[sessionId]/check-in` — partner mark no-show + cancel 24h
- `/admin/dashboard` — 4 tabs T&S : Reviews queue / Reports queue / Sanctions actives / Appeals queue
- `<SanctionBanner />` global — sticky top app si user a active sanction
- `<CoInscribedWarning />` partner — banner orange si conflits blocks détectés

**Email templates Phase 7** (12 actifs) :
- `bookingConfirmation` (legacy Stripe webhook)
- `reviewReminder` (Phase 8 push 48h post-session, non wiré)
- `appealAcknowledgment` (✅ wiré sub-chantier 5)
- `reviewBonusGranted`, `reviewPendingModeration`, `reviewModerationDecision` (✅ sub-chantier 1)
- `reportSubmitted`, `userSanctionNotice`, `noShowWarningNotice`, `partnerNoShowConfirmed` (✅ sub-chantier 3)
- `userSanctionOverturned`, `appealResolved` (✅ sub-chantier 5)

---

## 2. Doctrine highlights (§9.sexies)

**§A** : T&S = pré-requis rétention (femmes ~50% users cibles, sans T&S → spirale word-of-mouth négatif).

**§B** : 2 systèmes séparés :
- **Reports formels** (sec, anonyme, admin-only, ban escalation auto)
- **Reviews qualitatives** (doux, public, gradué selon note, pas de ban auto)

**§C — Reviews** :
- Note 5/4/3★ → publication auto nominative, +5 crédits chat bonus
- Note 2/1★ → status='pending' anonymisé jusqu'à modération admin
- Cooling-off 24h post-session, fenêtre 7j
- Édition 24h post-publication, cross-tier rating change interdit

**§D — Reports** :
- Anonymat **TOTAL** côté reported (jamais nom du reporter)
- 6 catégories enum (priorités URGENT/HAUTE/MOYENNE/BASSE)
- Validation participation : reporter + reported partagent ≥1 session passée
- Window : 30j post-session
- Rate limit : 3/jour/reporter, dédup 2 reports même paire = compté 1
- Thresholds rolling 12mo : 1=review / 2=AUTO 7j / 3+=AUTO 30j

**§D.5 — No-show** :
- Partner marque via UI mobile post-session (grâce 30 min)
- Cancel 24h undo window
- Thresholds 90j : 1/2=warning / 3=suspension 30j+refund partner / 4+=ban permanent

**§E — Block list** :
- Invisibilité mutuelle (sessions/profils/chats)
- AUCUNE notification au bloqué (anti-confrontation)
- Réversible `/profile/blocks`
- Warning partner co-inscrits via `<CoInscribedWarning />`

**§F — Workflow ban** :
- 4 niveaux : warning / suspension_7d / suspension_30d / ban_permanent
- Appel 1×/niveau via email reply à `contact@spordateur.com`, SLA admin 7j
- Revue annuelle ban_permanent

**§G — Female-safety** : `Activity.audienceType` data model préparé Phase 7, UI activation Phase 9.

**§H — Légal** :
- nLPD Art. 5/6/7/19 + RGPD Art. 13/17 + LCD Art. 3
- Conservation : reviews indéfini / reports actifs 12mo rolling / résolus 12mo post-résolution / banlist record indéfini / banlist PII 24mo / **audit trail admin 24mo**
- Anonymisation soft delete user : Phase 7 manuel admin, Phase 9 UI auto

---

## 3. Test inventory (~372 cumulés)

| Commande | Tests | Couverture |
|---|---|---|
| `npm run test:email` | 20 | Resend wrapper + templates rendering (E1-E4) |
| `npm run test:reviews` | 64 | createReview/edit/moderate/award/softDelete (R1-R28) |
| `npm run test:reviews:rules` | 18 | Defense-in-depth `/reviews/` (RR1-RR18) |
| `npm run test:blocks` | 36 | blockUser/unblock/isBlocked/mutualSet (B1-B15) |
| `npm run test:blocks:rules` | 12 | Defense-in-depth `/blocks/` (RB1-RB12) |
| `npm run test:reports` | 51 | createReport + admin actions (RP1-RP18) |
| `npm run test:reports:no-show` | 47 | markNoShow + sanctions trigger + appeals (TR1-TR2 + NP1-NP13) |
| `npm run test:reports:rules` | 31 | Defense-in-depth `/reports/` + `/userSanctions/` (RR1-RR16 + RS1-RS15) |
| `npm run test:reports:admin` | 19 | Admin actions service (RA1-RA10) |
| `npm run test:reports:co-inscribed` | 13 | `getCoInscribedConflicts` cross-module DI (CC1-CC6) |
| `npm run test:admin-actions` | 24 | logAdminAction + getAdminActions + wires (LA1-LA8) |
| `npm run test:admin-actions:rules` | 11 | Defense-in-depth `/adminActions/` (AA1-AA10) |
| `npm run test:anti-cheat:b/c/d` | (Phase 6) | Phase 6 — pas T&S |

**Total Phase 7 T&S** : ~372 sub-assertions PASS.

---

## 4. Wiring map (services → emails → audit trail)

```
createReview (1-2★)
  ↓ sendEmail reviewPendingModeration (reviewer)

awardReviewBonus (3-5★)
  ↓ sendEmail reviewBonusGranted (reviewer)

moderateReview (admin)
  ↓ sendEmail reviewModerationDecision (reviewer)
  ↓ if publish → awardReviewBonus (cascade)
  ↓ logAdminAction (review_publish | review_reject)

createReport (user)
  ↓ sendEmail reportSubmitted (reporter)
  ↓ if threshold → triggerAutoSanction
        ↓ sendEmail userSanctionNotice (reported)

markNoShow (partner)
  ↓ sendEmail noShowWarningNotice (user)
  ↓ sendEmail partnerNoShowConfirmed (partner)
  ↓ if threshold → triggerAutoSanction (cascade)

dismissReport (admin)
  ↓ logAdminAction (report_dismiss)
  (pas d'email — anonymat doctrine §D.1)

sustainReport (admin)
  ↓ logAdminAction (report_sustain)
  ↓ if manualSanctionLevel → triggerAutoSanction
        ↓ sendEmail userSanctionNotice (target)
        ↓ logAdminAction (sanction_manual_create)

overturnSanction (admin)
  ↓ logAdminAction (sanction_overturn)
  ↓ sendEmail userSanctionOverturned (user)

appealSanction (user)
  ↓ sendEmail appealAcknowledgment (user)

resolveAppeal (admin)
  ↓ logAdminAction (appeal_resolve_upheld | appeal_resolve_overturned)
  ↓ sendEmail appealResolved (user)
```

**Pattern best-effort partout** : emails et logAdminAction try/catch + log warn, jamais throw. L'action principale (write Firestore) prime sur les side-effects.

---

## 5. TODO consolidé Phase 8/9

### Phase 8 (polish + hardening)

**Cloud Functions / Admin SDK** :
- `listAllBlocks` admin endpoint via Admin SDK (rule actuelle `/blocks/` ne permet pas read all)
- Trigger denorm `users.{uid}.activeSanction*` via Cloud Function on `userSanctions/` create/update (rule users update reste owner+admin only Phase 7)
- Cron purge audit trail `/adminActions/` après 24mo (doctrine §H)
- Cron purge banlist PII après 24mo (record hash conservé indéfini)

**Service layer** :
- `cancelNoShow` recompute threshold quand sanction auto-déclenchée par report annulé (Phase 7 = log warn admin manuel)
- `moderateReview` accepter `decisionNote` input (admin UI dialog l'envoie déjà)
- `triggerAutoSanction` enrichir email metadata (level/duration formatted FR plus complet)

**UI** :
- Push reminder 48h post-session (template `reviewReminder` existe, pas wiré)
- Stripe API automatisation refund partner pour no-show level 3 (Phase 7 = flag `refundDue`, traitement manuel admin Stripe dashboard)

### Phase 9 (UX + features avancées)

**Admin** :
- Refactor admin auth Firebase Auth role-based (vs localStorage email check actuel)
- Admin UI queue `adminActions/` history + filtres + export CSV
- IA-assistée Genkit pour modération reviews 1-2★ (volume > 10/jour)
- Charte stricte appliquée admin dashboard (vs `bg-gray-900` actuel exception)

**User** :
- Card session UI participants list complète + entry points block/report participants (Phase 7 ne wire que le partner)
- Excuse pré-session ≥2h avant = no-show pas comptabilisé
- Visibility réduite algo matching score reviews <3.5★
- Detection patterns représailles cross-user reviews
- Female-safety women-priority quota active (audienceType field activé)
- Anonymisation soft delete user UI auto (Phase 7 = manuel admin)

**Partner** :
- Cancel no-show banner notif user "marquage retiré"
- UI participants list session + warning paires conflictuelles détaillé

---

## 6. Onboarding admin

Pour utiliser les tabs T&S admin (`/admin/dashboard` → T&S Reviews / Reports / Sanctions / Appeals) :

1. **Auth dashboard** : login email `contact.artboost@gmail.com` (localStorage check Phase 7)
2. **Setup admin role Firestore** :
   - Ouvrir Firebase Console → Firestore → collection `users`
   - Trouver le document de l'admin (email == `contact.artboost@gmail.com`)
   - Ajouter le champ `role: 'admin'` (string)
   - Save
3. **Vérification** : tabs T&S devraient afficher leurs queues. Si message *"Setup admin requis"* → recheck step 2.

**Pourquoi** : les services admin (`moderateReview`, `dismissReport`, `sustainReport`, `overturnSanction`, `resolveAppeal`, `logAdminAction`) check `users.{uid}.role === 'admin'` via `isAdminRole()`. Le localStorage admin login dashboard est une couche UI séparée — refactor Firebase Auth role-based différé Phase 9.

---

## 7. Références

- `architecture.md` §9.sexies (doctrine source de vérité, sections A-J)
- `src/app/terms/page.tsx` §7.bis et §7.ter (CGU rédigées Phase 7 sub-chantier 0)
- `src/app/privacy/page.tsx` (mention adminActions, bans, conservation)

---

*Document maintenu à jour avec Phase 7 close-out. Dernière révision : sub-chantier 6 mai 2026.*
