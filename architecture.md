# architecture.md — Plan de Spordate

> ⚠️ **Note importante (mai 2026)** : ce document a été créé au démarrage de la mission Sessions sur la base de l'architecture initiale décrite. Il a été enrichi depuis avec les **réalités du repo** (découvertes lors de l'analyse de Phase 1) et le **plan de nettoyage Phase 9**. Voir les sections en bas du document.

---

## 1. Arborescence des pages (Next.js App Router)

```
app/
├── (auth)/                      # Routes publiques sans layout principal
│   ├── login/page.tsx           # Connexion (email + Google + Apple)
│   ├── signup/page.tsx          # Inscription
│   └── onboarding/
│       ├── profile/page.tsx     # Photo, prénom, âge, bio
│       ├── sports/page.tsx      # Sélection des sports + niveaux
│       └── location/page.tsx    # Géoloc + rayon de recherche
│
├── (app)/                       # Routes protégées (utilisateur connecté)
│   ├── layout.tsx               # Nav bottom mobile + header
│   ├── discover/page.tsx        # Page de swipe principale
│   ├── matches/
│   │   ├── page.tsx             # Liste des matchs
│   │   └── [matchId]/page.tsx   # Chat 1-1
│   ├── events/
│   │   ├── page.tsx             # Événements proches
│   │   ├── create/page.tsx      # Créer un événement sportif
│   │   └── [eventId]/page.tsx   # Détail + participants
│   ├── profile/
│   │   ├── page.tsx             # Mon profil
│   │   └── edit/page.tsx        # Édition
│   └── settings/page.tsx        # Préférences, notifications, déconnexion
│
├── api/                         # Routes API Next.js (server-side)
│   ├── match/route.ts           # Logique de match (server-side)
│   └── notifications/route.ts   # Envoi de push via FCM
│
├── layout.tsx                   # Layout racine (fond noir, fonts)
└── page.tsx                     # Landing publique → redirige vers /discover si connecté
```

## 2. Flow utilisateur principal

```
Inscription → Onboarding (profil → sports → localisation)
   → Discover (swipe sur profils filtrés par sport/distance)
   → Match (notification mutuelle)
   → Chat (proposer un créneau + lieu)
   → Événement créé (calendrier partagé)
   → Après l'activité : feedback et réputation
```

## 3. Structure Firestore

### Collection `users/{userId}`

```
{
  uid: string,                  # = doc id, = Firebase Auth uid
  email: string,
  displayName: string,
  age: number,
  bio: string,
  photoURL: string,             # Storage: /users/{uid}/photos/main.jpg
  photos: string[],             # URLs additionnelles (max 6)
  gender: "male" | "female" | "other",
  location: {
    geopoint: GeoPoint,         # { latitude, longitude }
    geohash: string,            # pour les requêtes de proximité
    city: string,
    country: string
  },
  searchRadiusKm: number,       # 5, 10, 25, 50
  sports: [
    {
      id: string,               # ref → sports/{sportId}
      level: "debutant" | "intermediaire" | "avance" | "expert",
      lookingFor: ("partenaire" | "groupe" | "competition")[]
    }
  ],
  preferences: {
    ageMin: number,
    ageMax: number,
    genders: string[]           # qui je veux voir
  },
  reputation: {
    score: number,              # 0–100
    eventsCompleted: number,
    noShows: number
  },
  createdAt: Timestamp,
  lastActiveAt: Timestamp
}
```

### Collection `sports/{sportId}` (référentiel statique)

```
{
  id: string,                   # "running", "tennis", "basket"...
  name: string,                 # "Course à pied"
  emoji: string,                # "🏃"
  category: "individuel" | "duo" | "equipe",
  levels: ["debutant", "intermediaire", "avance", "expert"]
}
```

### Collection `swipes/{swipeId}`

```
{
  fromUserId: string,
  toUserId: string,
  direction: "like" | "pass",
  sportContext: string,         # sportId qui a déclenché le swipe
  createdAt: Timestamp
}
# Index : (fromUserId, toUserId), (toUserId, direction)
```

### Collection `matches/{matchId}`

```
{
  users: [userIdA, userIdB],    # toujours triés alphabétiquement
  sportInCommon: string[],
  lastMessage: {
    text: string,
    senderId: string,
    sentAt: Timestamp
  } | null,
  createdAt: Timestamp,
  status: "active" | "archived" | "blocked"
}
```

### Sous-collection `matches/{matchId}/messages/{messageId}`

```
{
  senderId: string,
  text: string,
  type: "text" | "event-invite" | "image",
  eventRef?: string,            # si invite à un événement
  sentAt: Timestamp,
  readBy: string[]
}
```

### Collection `events/{eventId}`

```
{
  creatorId: string,
  sport: string,                # sportId
  title: string,
  description: string,
  location: {
    geopoint: GeoPoint,
    geohash: string,
    address: string,
    name: string                # "Parc de la Villette"
  },
  startAt: Timestamp,
  durationMinutes: number,
  maxParticipants: number,
  level: "debutant" | "intermediaire" | "avance" | "tous",
  participants: string[],       # uids
  status: "open" | "full" | "completed" | "cancelled",
  createdAt: Timestamp
}
# Index : (sport, startAt), (geohash, startAt)
```

### Collection `feedbacks/{feedbackId}`

```
{
  eventId: string,
  fromUserId: string,
  toUserId: string,
  rating: 1 | 2 | 3 | 4 | 5,
  showedUp: boolean,
  comment: string,
  createdAt: Timestamp
}
```

## 4. Storage (Firebase Storage)

```
/users/{uid}/photos/{photoId}.jpg     # Photos de profil
/events/{eventId}/cover.jpg           # Image d'événement
/chats/{matchId}/{messageId}.jpg      # Pièces jointes chat
```

## 5. Cloud Functions (déclencheurs)

| Fonction | Déclencheur | Action |
|---|---|---|
| `onSwipeCreate` | Firestore: `swipes/{id}` create | Si like mutuel → créer un `match` |
| `onMatchCreate` | Firestore: `matches/{id}` create | Notif push aux deux users |
| `onMessageCreate` | Firestore: `matches/{id}/messages/{id}` create | Notif push au destinataire + maj `lastMessage` |
| `onEventStart` | Scheduler (chaque heure) | Notif rappel aux participants 1h avant |
| `onFeedbackCreate` | Firestore: `feedbacks/{id}` create | Recalculer `reputation.score` |

## 6. Règles Firestore (esquisse)

- `users/{uid}` : lecture publique limitée (champs profil), écriture par le propriétaire uniquement.
- `swipes/{id}` : créer uniquement si `fromUserId == auth.uid`. Lecture interdite côté client (logique serveur).
- `matches/{id}` : lecture/écriture si `auth.uid in resource.data.users`.
- `events/{id}` : lecture publique, écriture par le créateur, jointure via Cloud Function transactionnelle.

## 7. Stratégie de proximité géographique

Utiliser **geohash** + Firestore range queries pour trouver les utilisateurs/événements dans un rayon donné. Bibliothèque : `geofire-common`.

```ts
// Pseudo-code
const bounds = geohashQueryBounds([lat, lng], radiusInM);
// → exécuter une query par bound, dédupliquer côté client
```

---

## 8. Réalité technique du repo (mai 2026)

Découvertes faites pendant la mission Sessions Phase 1, qui contredisent partiellement les sections ci-dessus rédigées au démarrage. Cette section est la **source de vérité opérationnelle**.

### Stack réelle vs stack documentée

| Couche | Documenté initialement | Réalité |
|---|---|---|
| Frontend host | Firebase App Hosting | **Vercel** (plan Pro) |
| Domaine prod | spordateur.com | spordateur.com → projet Vercel `spordateur-premium` |
| Repo prod (Vercel watch) | sambassi/spordate-v1 | **Afroboost44/spordate-v1** branche `main` |
| Repo développement | sambassi/spordate-v1 | sambassi/spordate-v1 (clone local) |
| Database | Firestore | Firestore + **Prisma/Postgres** (legacy hybride) |
| Auth | Firebase Auth | Firebase Auth ✅ |
| Paiements | Stripe | Stripe (mode LIVE) + **TWINT** (paiement suisse) |
| Emails | Non mentionné | **Resend** |
| AI | Non mentionné | **Genkit** (Google AI) dans `src/ai/` |
| UI Library | Tailwind seul | Tailwind + **shadcn/ui** (Radix UI) |
| Localisation | EUR + FR | **CHF + villes suisses + droit suisse** |

### Architecture réelle de déploiement

```
┌─────────────────┐
│  spordateur.com │  ← domaine custom mappé
└────────┬────────┘
         │
┌────────▼──────────────────────┐
│  Vercel project               │
│  spordateur-premium (Pro)     │
└────────┬──────────────────────┘
         │ auto-deploy on push
         │
┌────────▼──────────────────────┐
│  GitHub: Afroboost44/         │
│         spordate-v1 (main)    │
└───────────────────────────────┘

Backend services (utilisés par le Next.js sur Vercel) :
- Firestore (project: spordateur-claude — à confirmer)
- Firebase Auth (même project)
- Stripe API (clés en env vars Vercel)
- Resend (emails transactionnels)
- TWINT (via Stripe Switzerland)
```

### Workflow de déploiement effectif

1. Code modifié localement (clone sambassi/spordate-v1)
2. Réconciliation merge prod/main → local main (récupérer les commits manquants)
3. `git push prod main` → déclenche build Vercel
4. Vercel build + deploy en 2-5 min → spordateur.com mis à jour
5. Pour `firestore.rules` et `firestore.indexes.json` : `firebase deploy --only firestore:rules,firestore:indexes` séparément (sur le bon projet Firebase, **pas** le projet Studio)

### Pages réelles (src/app/) vs pages documentées

L'arborescence section 1 ci-dessus décrit la cible v1.0. La **réalité du repo** au moment de Phase 1 :

| Documenté | Réel | Note |
|---|---|---|
| `/discover` | `/discovery` | Renommé |
| `/events`, `/events/create`, `/events/[id]` | `/activities` | Pivot conceptuel : "événements" → "activités" |
| `/matches`, `/matches/[id]` | `/chat` | Consolidé |
| `/onboarding/*` | Absent en page dédiée | Probablement intégré ailleurs |
| ❌ Non mentionné | `/admin/{dashboard,login,sports}` | Console admin |
| ❌ Non mentionné | `/partner/{boost,dashboard,login,offers,register,wallet}` | Espace partenaires |
| ❌ Non mentionné | `/payment`, `/premium`, `/dashboard`, `/notifications` | Pages user |
| ❌ Non mentionné | `/legal`, `/privacy`, `/terms` | Conformité juridique suisse |
| ❌ Non mentionné | `/api/{bookings,checkout,webhooks}` | API Stripe |

### Collections Firestore réelles

Documentées en section 3 (à titre de cible) — les collections **réellement présentes** dans `firestore.rules`/`firestore.indexes.json` :

- `users` + sous-collection `users/{uid}/preferences`
- `matches` (avec champs `userIds`, `chatUnlocked`)
- `activities` (avec `partnerId`, `sport`, `city`, `isActive`)
- `bookings` (Stripe, ticket types `solo`/`duo`)
- `credits`, `transactions` (système monétaire interne)
- `creators` (créateurs Afroboost — profs)
- `partners` (lieux/marques partenaires)
- `referrals` (parrainage)
- `payouts` (versements créateurs)
- `chats` + `chats/{id}/messages` (avec gate `chatUnlocked`)
- `notifications`, `analytics`, `errorLogs`

**Phase 1 (mission Sessions)** ajoute :
- Collection `sessions/{sessionId}` (occurrences datées d'une `activity` avec compte à rebours et tarification progressive)
- Champ optionnel `sessionId?: string` sur `Match` et `Booking`
- Champs optionnels `defaultPricingTiers?: PricingTier[]` et `chatOpenOffsetMinutes?: number` sur `Activity`
- Règles Firestore additives sur `/sessions/{id}` + extension du verrouillage temporel sur `chats/messages`
- 4 indexes sur `sessions` (status+startAt, activityId+startAt, partnerId+startAt, creatorId+startAt)

---

## 9. Plan de nettoyage — Phase 9 (à faire APRÈS toutes les autres phases)

Liste exhaustive des dettes et incohérences identifiées au moment de Phase 1. À traiter en bloc en fin de mission Sessions, **pas avant**, pour ne pas introduire de risque dans la livraison incrémentale.

### Identité git locale

- [ ] **Mettre à jour le `git config` global** pour que les futurs commits soient attribués à Afroboost44 (et non sambassi). Découverte : commit `66d4668` (Phase 1 v2) est attribué à sambassi sur Vercel parce que `git config --global user.name` = sambassi en local. Le push a marché grâce à `gh auth` mais l'auteur reste sambassi. À corriger :
  ```bash
  git config --global user.name "Afroboost44"
  git config --global user.email "ton-email-afroboost44@exemple.com"
  ```
- Note : ne pas réécrire les commits passés (trop intrusif). Juste configurer pour les futurs.

### Repos GitHub

- [x] **Stratégie de canonicité décidée (mai 2026)** :
  - `Afroboost44/spordate-v1` reste le canonique (= ce que Vercel watch).
  - `sambassi/spordate-v1` : **SUPPRESSION** (option B choisie par Bassi).
- [x] **Étape 1 (faite en mai 2026, anticipée depuis Phase 9 suite à découverte de divergence 117 commits)** : migration locale du remote :
  ```bash
  git remote remove origin              # déconnecter sambassi
  git remote rename prod origin         # Afroboost44 devient origin
  git reset --hard origin/main          # aligner local sur prod (perd Phase 1 stash, re-créé propre)
  git stash drop stash@{0}              # abandonner ancien stash Phase 1
  ```
  Note : Phase 1 a été redessinée from scratch sur le contexte prod (117 commits plus avancé que l'ancien clone sambassi).
- [ ] **Étape 2 (à faire en Phase 9, APRÈS l'étape 1)** : supprimer `sambassi/spordate-v1` sur GitHub :
  - Aller sur https://github.com/sambassi/spordate-v1/settings
  - Section "Danger Zone" en bas
  - Cliquer "Delete this repository"
  - Confirmer en tapant le nom du repo
  - ⚠️ Action quasi-irréversible (90 jours de période de grâce)
- [ ] **Étape 3 (vérification post-suppression)** : `git fetch origin && git pull` doit fonctionner sans erreur (origin = Afroboost44 désormais).

### Vercel projects

- [ ] Supprimer le projet **`spordate-v1`** (Vercel) — doublon de `spordateur-premium` connecté au même repo.
- [ ] Supprimer le projet **`spordateur-v2`** (Vercel) — vide, sans repo connecté.
- [ ] Vérifier les autres projets potentiellement obsolètes dans le dashboard Vercel.

### Firebase

- [x] ✅ **MIGRATION FIREBASE FAITE** (mai 2026, anticipée depuis Phase 9 vers Phase 2.5)
  - Ancien projet : `studio-9336829343-59db2` (Firebase Studio, deadline shutdown 22 mars 2027)
  - Nouveau projet : `spordate-prod` (Firebase classique, compte `bassicustomshoes@gmail.com`, région eur3)
  - Pas de migration de données nécessaire (0 utilisateur réel au moment de la migration)
  - 8 env vars Vercel mises à jour, Firestore rules + 4 indexes déployés, Vercel redeploy `4YeH1VLDX` Ready
- [ ] **Cleanup post-migration (à faire après 30j de vérification)** :
  - Supprimer le projet Firebase `studio-9336829343-59db2` (ancien)
  - Vérifier qu'aucun service tiers (Stripe webhook, Analytics, etc.) ne pointe encore sur l'ancien projet
  - Activer Storage sur `spordate-prod` quand on en aura besoin (Phase 8 chat avec photos/vidéos)
  - Activer Google Auth sur `spordate-prod` (skipped pendant migration, à faire dans Phase 5+ si nécessaire)
  - Mettre à jour `.env.example` pour refléter `spordate-prod` au lieu du placeholder `spordateur-claude`
- [ ] **`.env.example`** mentionne `spordateur-claude` qui n'existe pas — c'est un placeholder qui prête à confusion. Le vrai project ID est `studio-9336829343-59db2`. À mettre à jour ou à génériciser.
- [ ] Confirmer le projet Firebase de prod réel (probablement `spordateur-claude` selon `.env.example`, à vérifier avec les variables d'env Vercel).
- [ ] Créer un fichier `.firebaserc` à la racine du repo avec le bon project ID pour simplifier les commandes CLI (`firebase deploy --only firestore:rules`).

### Repo cleanup

- [ ] Supprimer **`apphosting.yaml`** à la racine du repo — artefact d'une tentative de migration Firebase App Hosting non aboutie. Spordateur.com est sur Vercel.
- [ ] Nettoyer **`.gitignore`** — il contient des dizaines de doublons `.env*`, `*.env`, `*.env.*` (probablement créés par un script qui a bouclé). Garder une seule occurrence de chaque pattern.
- [ ] Supprimer les fichiers orphelins à la racine :
  - `[Provide the ABSOLUTE, FULL path to the file being modified]` (165 octets, créé par erreur lors d'une session AI)
  - `=13.0.0` (1045 octets, vraisemblablement un `npm install` mal tapé)
  - `.modified` (vide, possible marker)
- [ ] Supprimer **`README-original.md`** une fois que `README.md` est validé (c'est juste un backup de notre setup initial).

### `.clauderules` à updater (avant Phase 2)

- [ ] Remplacer "Firebase App Hosting" par "Vercel" dans la règle 3.
- [ ] Mettre à jour la règle 6 pour refléter le workflow réel : `git push prod main` (Afroboost44) déclenche le déploiement spordateur.com via Vercel.
- [ ] Documenter que `firestore.rules` et `firestore.indexes.json` doivent être déployés séparément avec `firebase deploy --only firestore:rules,firestore:indexes` sur le projet Firebase de prod (pas le projet Studio).
- [ ] Mentionner Cloud Functions Phase 6 (cron pricing recompute anti-cheat) + Phase 8 (chat lifecycle + crons chat opening/closing) : à implémenter en **Vercel Cron Jobs** OU en **Firebase Functions séparées**, à arbitrer en début de chaque phase. Re-ordering mai 2026 : ces crons sont scindés entre Phase 6 (anti-cheat) et Phase 8 (chat retention).

### Storage rules à versionner dans le repo (Phase 9 cleanup)

- [ ] **Créer `storage.rules`** à la racine du repo avec les règles déployées manuellement le mai 2026 (cf. Firebase Console). Permissions actuelles :
  - `users/{userId}/...` : owner-only writes, images <10 MB
  - `activities/{activityId}/...` : auth required, images/vidéos <10 MB (TODO: check partnerId)
  - `chats/{chatId}/...` : auth required, files <25 MB (TODO: check participants)
  - Default: deny
- [ ] **Ajouter section `storage` dans `firebase.json`** :
  ```json
  "storage": {
    "rules": "storage.rules"
  }
  ```
- [ ] **Déployer via CLI** : `firebase deploy --only storage:rules --project spordate-prod --account bassicustomshoes@gmail.com`
- [ ] **Affiner les rules en Phase 9** : vérification partnerId pour `activities/`, vérification participants pour `chats/`

### Sécurité & monitoring

- [ ] Régler le warning Vercel **`STRIPE_SECRET_KEY` "Needs Attention"** — probablement remplacer par une "restricted key" Stripe au lieu de la clé secrète complète.
- [ ] **Fix Stripe lazy init** dans les 4 routes API qui instancient `new Stripe(...)` au niveau module (confirmé Phase 5 lors du `npm run build` local) : `src/app/api/checkout/route.ts`, `src/app/api/boost-checkout/route.ts`, `src/app/api/stripe-connect/route.ts`, `src/app/api/verify-payment/route.ts`. Déplacer chaque `const stripe = new Stripe(...)` du niveau module dans le `POST` handler (lazy init), comme c'est déjà fait dans `webhooks/stripe/route.ts`. Sinon le build local échoue sans `.env.local` avec "Neither apiKey nor config.authenticator provided" au moment du `Collecting page data`. Sur Vercel ça passe car env vars définies. Découvert pendant Phase 1 cleanup, reconfirmé Phase 5, hors scope Phase 5.
- [ ] Auditer les autres env vars Vercel — confirmer que toutes les 11 attendues (cf. `.env.example`) sont présentes.
- [ ] Vérifier que `FIREBASE_SERVICE_ACCOUNT_KEY` est bien configuré côté serveur (utilisé par les API routes Stripe webhook).

### Documentation

- [ ] Mettre à jour `README.md` après Phase 9 pour refléter l'architecture réelle finale.
- [ ] Ajouter dans `CLAUDE.md` une section "Workflow de déploiement réel" avec les commandes exactes (push prod, deploy firestore rules, etc.).
- [ ] Archiver l'ancien `README-original.md` ou le supprimer.

---

## 9.ter — Stratégie UX du LANCEMENT (anti-ghost-town)

**Contexte** : au lancement (Phase 5+), Afroboost est le **premier et unique partenaire**. Risque majeur : que le site **paraisse vide / mort** → les premiers visiteurs partent → spirale négative.

**8 tactiques à implémenter en Phase 5** pour donner l'impression d'un site vivant et établi :

1. **Pre-créer 8+ sessions Afroboost** sur 4-6 semaines (même cours à dates différentes = sessions différentes). Faire ça AVANT le lancement public.

2. **Ne jamais afficher "0 X"** dans l'UI. Remplacer par :
   - "Réservation ouverte" / "Sois le premier"
   - "Places limitées · 20 max"
   - Le compteur participants ne s'affiche QUE quand ≥ 3-4 inscrits.

3. **Section "Ils l'ont vécu"** en haut de la home : 6-8 photos d'anciens cours Afroboost **réels** + 2-3 testimonials courts. Pas de prix ni de countdown — juste de l'aspirational pour donner le vibe "on existe depuis longtemps". **Doctrine no-fake-content stricte** : si <3 vraies photos disponibles au launch, masquer la section plutôt que de mocker (LCD Suisse Art. 3 publicité trompeuse + risque réputationnel sur plateforme dating-adjacent). Photos stockées dans `/public/past-sessions/`, indexées dans `/src/data/past-afroboost-sessions.ts` (`PAST_AFROBOOST_SESSIONS`). Le composant `PastSessionsGallery` applique cette règle automatiquement (`return null` si `sessions.length < minToShow`). Migration Firestore + admin UI prévue Phase 9.

4. **Pre-fill villes avec "Bientôt"** : afficher Lausanne / Zürich / Bern même sans session active. Bouton "Me notifier de la première session". Donne l'impression d'expansion en cours.

5. **Compteur d'intérêt cumulatif** : "47 membres intéressés" basé sur les clics sur sessions (signal soft, pas une réservation). Jamais de "0 réservations". Pas de fenêtre temporelle dans le wording (rolling-7d / ISO-week sera tranché en Phase 9 analytics) pour rester future-proof.

6. **Notifications "future session"** : tout visiteur peut s'inscrire à une liste d'attente par activité ou par ville. Capture l'engagement.

7. **Hero story / mini-blog "Notre histoire"** : 3 paragraphes sur Afroboost + photos + vidéo intro 30s. Construit la confiance avant la transaction.

8. **Scarcity intelligente** : mix réel — certaines sessions à 87% remplies (last min) + d'autres à 20% (early bird). Pas tout à "1 place restante".

**Importance** : ces tactiques sont **autant** importantes que le code lui-même. Sans elles, même un site techniquement parfait paraîtra mort. Elles doivent être intégrées **dès Phase 5** (et pas reportées à Phase 9).

---

## 9.quater — Modèle économique Sessions (validé mai 2026)

### Logique business

```
┌──────────────────────────────────────────────────────────┐
│ SESSION PURCHASE (paiement direct CHF, → partenaire)    │
│                                                          │
│ User réserve session → Stripe checkout (35 CHF)         │
│        ↓                                                 │
│ Webhook Stripe → bookSession() Phase 2                  │
│        ↓                                                 │
│ User reçoit AUSSI un BUNDLE de crédits chat             │
│ (configurable par activity, défaut 50)                  │
└──────────────────────────────────────────────────────────┘
                ↓
   L'activité physique se déroule
                ↓
┌──────────────────────────────────────────────────────────┐
│ CHAT POST-ACTIVITÉ (avec personnes rencontrées)         │
│                                                          │
│ Coût par message selon type :                           │
│   - Texte : 1 crédit                                    │
│   - Photo : 5 crédits                                   │
│   - Vidéo : 10 crédits                                  │
│                                                          │
│ Crédits épuisés → top-up via /payment classique         │
└──────────────────────────────────────────────────────────┘
```

### Décisions techniques

**Phase 3 — extension `/api/checkout`** :
- Nouveau mode `'session'` en plus du mode `'package'` existant
- Webhook étendu : sur paiement session → `bookSession()` (Phase 2) + grant `Activity.chatCreditsBundle ?? 50` au user via le système crédits existant
- Activity.chatCreditsBundle? : champ optionnel, défaut 50

**Phase 8 — chat avec coût variable** :
- Helper `computeMessageCost(type: 'text' | 'image' | 'video'): number`
  - text → 1
  - image → 5
  - video → 10
- À l'envoi d'un message : déduit le coût des crédits du user
- Si crédits insuffisants : modal "Top up"

### Répartition du revenu

- **Money de la session** : va au partenaire (= flux Stripe Connect classique, ou à voir avec partner.stripeAccountId)
- **Money du top-up crédits** : reste à Spordate (= flux Stripe direct, déjà en place)

→ Cohérent avec le système Stripe Connect partner déjà identifié dans le code (`/api/partner-request`, `partner.stripeAccountId`, etc.)

---

## 9.quinquies — Modèle de rétention post-event Phase 8 (validé mai 2026)

> **Contexte** : Phase 8 ship le chat post-event + détection anti-leak + suggestions IA + invite Individuel. Doctrine validée mai 2026 par Bassi en 2 batchs de décisions (26 questions tranchées).
>
> **Re-ordering** : la roadmap mai 2026 a re-priorisé l'**anti-cheat (Phase 6)** avant la **rétention (Phase 8)**. Cf. §10 mis à jour.

### Vue d'ensemble

Phase 8 = transformer chaque session bookée en **plusieurs sessions bookées sur 6 mois** via 4 mécanismes :
1. **Chat post-event payant** (bundle 50 crédits) — boucle session → chat → crédits → re-booking
2. **Anti-contact-exchange** (4 niveaux L1-L4) — défend la rétention sans aliéner les users
3. **Suggestions IA** dans le chat — transforme conversation en re-booking quick-tap
4. **Invite Individuel** — réduit la friction de booking groupé (Split + Gift = Phase 9)

---

### A. Doctrine économique — in-platform retention vs match-and-leak

**Règle** : Spordate génère du revenue **par session bookée + crédits chat consommés**, pas par mise en relation. La rétention est l'enjeu N°1 post-event : un user qui rencontre quelqu'un sur Spordate doit avoir plus à gagner à rester sur la plateforme qu'à passer en off-platform.

**Modèle économique consolidé** (cohérent §9.quater) :

```
Session bookée (CHF) → bundle 50 crédits chat
                              ↓
              Chat post-event consume crédits :
                  texte = 1 / photo = 5 / vidéo = 10
                              ↓
              Crédits épuisés → top-up via /payment
                              ↓
              Top-up motive next session booking
                              ↓
                     [Boucle vertueuse]
```

**Pas de subscription "Spordate+" Phase 8** — modèle crédits suffit, KISS. Subscription envisagée Phase 10+ si data Phase 8 le justifie.

**Décisions tranchées** :

- **A.Q1 (✅)** : on accepte ~40% de leak off-platform comme inévitable. La défense se concentre sur les 60% qui hésitent — ceux que la friction L1-L3 fait basculer côté on-platform.
- **A.Q2 (✅ batch 1)** : modèle crédits chat (pas de subscription Phase 8).
- **A.Q3 (✅)** : KPIs rétention reformulés en **stretch goals à mesurer**, pas conditions de succès. **Le succès Phase 8 = avoir la machinerie qui mesure + optimise progressivement.** Industrie dating-adjacent au launch est plutôt 10-20% à 30j initialement.
  - Cibles à mesurer (stretch, pas minima) :
    - Rétention 60j : 35% à 6 mois (stretch), 25% à 3 mois (réaliste), 15% à 1 mois (baseline industrie)

**Justification** :
- Économique : crédits = revenue récurrent sans dating-app churn
- Cultural CH : régularité + structure → re-booking naturel
- Différenciation : positionne Spordate comme **plateforme sport avec dimension sociale**, pas dating-app-with-sport-hooks

---

### B. Anti-contact-exchange — 4 niveaux de défense

**Règle** : défense progressive 4 niveaux dans le chat post-session uniquement.

| Niveau | Mécanique | Trigger | UX |
|---|---|---|---|
| **L1** | Detection passive (regex + IA) | Chaque message envoyé | Aucune (analyse silencieuse, log serveur) |
| **L2** | Soft warning UI | 1er hit L1 dans la conv | Toast non-bloquant : *"Le chat reste ouvert jusqu'à ta prochaine session — pas besoin de partager ton Insta."* Message envoyé quand même. |
| **L3** | Friction modal | 3ème hit L1 dans la même conv | Modal pré-envoi : *"Cet échange enfreint la doctrine Spordate. Continue → message envoyé / Annule → message gardé en brouillon."* Message envoyé si user continue (laisse-faire). |
| **L4** | Account flag (admin review **manuelle**) | 5ème hit + escalade conv | Pas d'action user-visible. Admin reçoit alerte email, peut limiter compte hors-band. |

**Décisions tranchées (batch 2)** :

- **B.Q1 (✅)** : **transparence totale**. CGU explicite + 1 onboarding-bubble la 1ère fois qu'un user entre dans un chat post-session : *"Tes messages sont scannés pour détection des partages de contact — tu peux nous appeler si flag à tort"*. Réduit la perception "surveillance" → "protection rétention".
- **B.Q2 (✅)** : **L3 modal laisse-faire** — message envoyé quand même après le warning. Bloquer = revolt user.
- **B.Q3 (✅)** : **L4 escalation manuelle** Phase 8 (admin humain). Volume faible attendu, biais algorithmique = risque LCD si erreur. Phase 9+ peut ajouter auto-quarantine après 10+ flags.
- **B.Q4 (✅)** : **précision cible 92-95%**. Au-dessus = lent/coûteux. En-dessous = trop de UX-noise. Mesurer via taux d'appels users ("ce flag est faux") < 5%.

**Justification** :
- Économique : chaque off-platform exchange = revenue futur perdu
- Légale :
  - **LPD Art. 6** (transparence) : CGU explicite + onboarding-bubble obligatoires
  - **LPD Art. 7** (proportionnalité) : pas de stockage durable du contenu, juste extraction pattern + délétion message
  - **LCD Art. 3** : pas de pratiques trompeuses
- UX : graduation = pas de surprise, pas de censure abrupte

**Contraintes techniques implicites** :
- Latence detection < 200ms (chat temps réel)
- Faux positifs = UX killer (e.g. "555 calories brûlées" ne doit pas flag comme téléphone)
- **Disclosure CGU obligatoire avant ship Phase 8** (`src/app/terms/page.tsx` + `src/app/privacy/page.tsx` à patcher)
- Mécanisme d'**appel** (user signale faux flag → admin review)

---

### C. Patterns détection — Regex + IA Genkit

**Règle** : architecture **hybride** — regex (rapide, gratuit, déterministe) en première passe + IA Genkit (lent, payant, contextuel) en deuxième passe sur les cas ambigus.

**Layer 1 — Regex (synchrone, ~5ms)** :
- Téléphones CH : `\b0[0-9]{2}\s?[0-9]{3}\s?[0-9]{2}\s?[0-9]{2}\b` + variantes `+41 ...`
- Emails : `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`
- Handles Instagram/Snapchat/TikTok : `@[a-zA-Z0-9_.]{3,30}` (avec heuristique : précédé de "insta", "ig", "snap", "tiktok")
- Domaines : `\b[a-zA-Z0-9.-]+\.(ch|com|net|org|io)\b`
- Mots-clés explicites : "WhatsApp", "Telegram", "DM moi", "MP", etc.

**Layer 2 — IA Genkit (asynchrone, ~150-500ms)** :
- Trigger : appel **uniquement** si regex L1 ambigu (e.g. "j'ai 555 calories" — possible faux positif tel)
- Prompt : *"Ce message contient-il une tentative de partage de contact ou intention de quitter la plateforme ? Score 0-1."*
- Modèle : **Gemini Flash via Genkit** (Firebase stack, quotas généreux)
- Cache : 24h sur hash exact du message uniquement. Si 1 char change → re-scorer

**Décisions tranchées** :

- **C.Q1 (✅ batch 1)** : **Genkit + Gemini Flash**. Cohérent stack Firebase, quotas gratuits Google généreux. Switch Phase 9+ si quality bar pas atteinte (Anthropic, etc.). No self-hosted Phase 8.
- **C.Q2 (✅)** : logs IA = **scores + hash anonyme du message** Phase 8. Pas de contenu lisible. Permet tuning sans risque LPD. Logs purgés à 30j.
- **C.Q3 (✅)** : **FR uniquement Phase 8**. DE + IT en Phase 10+ quand on aura une base utilisateurs DE/IT validée.
- **C.Q4 (✅)** : **cache 24h sur hash exact** uniquement. Si 1 char change → re-scorer. Évite false-cache-hit + reste safe pour patterns créatifs.

**Justification** :
- Économique : regex couvre 80% des cas pour 0 coût. IA monte la précision à 95%+ avec coût marginal (uniquement les ambigus)
- Technique : combo respecte budget latence (<200ms p95) + budget coût (<$0.001 / message)
- Évolutif : regex maintenu côté code, IA s'améliore via prompt-tuning sans déployer

**Contraintes techniques implicites** :
- Genkit dans le stack : vérifier que `@genkit-ai/*` est installé (sinon ajout Phase 8-pre)
- Multilingue Phase 8 : FR uniquement (DE + IT déférés Phase 10+)
- Privacy : message envoyé à l'API IA = donnée traitée par tiers → CGU doivent l'indiquer
- Rate limiting : max N appels IA / user / minute pour éviter abus

---

### D. Suggestions next-activity dans chat post-event (IA-driven)

**Règle** : après la fin d'une session, le chat reste ouvert avec les crédits restants. **L'IA suggère 1-3 activities suivantes** dans le chat, sous forme de message bot avec boutons quick-book.

**Mécanique** :
- **Trigger** : conjonction de :
  - Session terminée depuis >24h
  - Aucune mention de "next time" / "on remet ça" dans les dernières 48h (ne pas devancer l'organique)
  - OU mention détectée par IA (intent-classification "next-event-mention")
- **IA fait** : lit les 30 derniers messages + profile groupe (sports passés, villes) → propose 3 activities upcoming dans la base Spordate (filtre par city + sport-affinity)
- **Output** : message **bot inline** dans le chat avec avatar Spordate distinct + label "Suggestion" :
  ```
  🤖 Spordate · Suggestion
  Si vous voulez remettre ça :
  [Card 1: Afroboost Lausanne — sam 18 mai]  [Réserver →]
  [Card 2: Yoga Genève — dim 19 mai]         [Réserver →]
  [Card 3: Padel Bern — sam 25 mai]          [Réserver →]
  ```
- **Quick-book** : tap → ouvre flow d'invite Individuel (cf. section E)

**Décisions tranchées** :

- **D.Q1 (✅ batch 1)** : **default-on** + disclosure CGU explicite + toggle off 1-tap dans `/profile`. Justification : opt-in tue la rétention (most users won't activate proactively). LPD respect via toggle facile + transparence.
- **D.Q2 (✅)** : **1 suggestion par 72h max** + ne pas relancer avant 24h après dernier message user. Évite spam, respecte rythme organique.
- **D.Q3 (✅)** : **gratuites pour tous Phase 8** (cohérent A.Q2 : pas de subscription Phase 8). Phase 10+ peut introduire Spordate+ avec quotas illimités, suggestions raffinées.
- **D.Q4 (✅)** : **affichage inline** comme message bot avec avatar Spordate distinct + label "Suggestion". Plus naturel mobile, plus engageant que sidebar.

**Justification** :
- Économique : chaque suggestion bookée = revenue session + nouveau bundle crédits = effet de roue
- UX : friction-free re-engagement, valorise l'effort fait pour booker la 1ère session
- Différenciation : pas juste un chat, c'est un assistant social → moat vs WhatsApp

**Contraintes techniques implicites** :
- Coût IA : ~$0.01/groupe par 72h → estimable Phase 8 OK avec ~1000 groupes actifs
- Privacy : chat content envoyé à l'IA → opt-out facile dans `/profile` (D.Q1)
- Quality bar : suggestions hors-cible = bot perçu comme spam → pénalise rétention au lieu de l'aider
- Feature flag : ship gradué (10% → 50% → 100% des chats) avec metrics

---

### E. Invitation réciproque (Phase 8 : Individuel uniquement)

**Règle Phase 8** : invite Individuel uniquement. Chacun paye sa part en acceptant. Modes Split + Gift = Phase 9.

**Mode Individuel** :
- User A invite User B à une session via tap sur SessionCard ou "Invite à cette suggestion"
- B reçoit notification + lien d'invite
- B accepte → checkout Stripe à son nom (paye sa place, flux Stripe direct existant)
- B refuse → A peut inviter quelqu'un d'autre

**Décision tranchée** :

- **E.Q1 (✅ batch 1)** : **Phase 8 = Individuel uniquement**. Évite couplage Stripe Connect destination splits + refund logic complexe dans MVP.

**Modes différés Phase 9** :
- **Split** : organisateur paye X%, invités le reste (default mode probable Phase 9)
- **Gift** : organisateur paye 100% (use-case anniversaire, gratitude — viralisation potentielle)
- Les 4 questions design (default mode Phase 9, min/max split, cancellation policy, UI) → tranchées en pré-Phase 9 sur la base de la donnée Phase 8 (taux d'invite Individuel, abandons, demandes user).

**Justification** :
- Économique : Individuel = -friction modeste vs Split mais ship-able en ~3-4 jours vs ~2 semaines
- Risque : Stripe Connect destination splits = surface bug + fraud potentielle. À mûrir Phase 9 sur du code Phase 8 stable.

---

### F. Scope Phase 8 vs Phase 9+

**Règle** :
- **Phase 8 = MVP rétention** (~3-4 semaines) : ship value rapide, learn from real data
- **Phase 9 = sophistication** : modes Split/Gift, admin UI, analytics dashboard, polish + cleanup
- **Phase 10+ = subscription** : Spordate+ avec quotas premium, multilingue DE/IT

**Découpage final** :

| Item | Phase 8 (MVP rétention) | Phase 9 (Polish) | Phase 10+ (Premium) |
|---|---|---|---|
| Detection L1 regex | ✅ ship | maintenance | maintenance |
| Detection L2 soft warning UI | ✅ ship | maintenance | maintenance |
| Detection L3 modal friction | ✅ ship (3+ hits, laisse-faire) | tuning | maintenance |
| Detection L4 admin flag | ⚠️ basic (count + alert email manuel) | full review UI + auto-quarantine | maintenance |
| IA Genkit detection layer | ✅ ship (Gemini Flash) | tuning prompts | switch model si nécessaire |
| Multilingue patterns regex/IA | FR uniquement | FR | + DE + IT |
| Suggestions next-activity | ✅ ship (IA-driven, default-on) | analytics + tuning | quotas premium Spordate+ |
| Suggestions data source | matrice JSON `src/data/activity-suggestions.ts` (admin maintient) | UI activity-creator self-service | + perso ML |
| Invite Individuel | ✅ ship | maintenance | maintenance |
| Invite Split + Gift | ❌ | ✅ ship (Stripe Connect destination) | maintenance |
| Analytics rétention dashboard | ❌ (collecte data uniquement) | ✅ ship admin | + cohort analytics |
| Subscription Spordate+ | ❌ | ❌ | ✅ ship |

**Décisions tranchées (batch 2)** :

- **F.Q1 (✅)** : **Phase 6 anti-cheat AVANT Phase 8 rétention**. Re-ordering acté §10. Sans anti-cheat, attaquant peut manipuler les prix → revenue loss > rétention gain. Phase 6 doit rester focused (~1 semaine).
- **F.Q2 (✅)** : **admin Spordate Phase 8** maintient les recommandations cross-activity dans `src/data/activity-suggestions.ts` (matrice JSON). Activity creator self-service = Phase 9 avec UI dédiée.
- **F.Q3 (✅)** : **Subscription Spordate+ = Phase 10+**. Ship rétention basique gratuite Phase 8, monétise sophistication Phase 10+ quand on aura la donnée pour pricer.
- **F.Q4 (✅)** : **4 KPIs Phase 8** à mesurer (stretch goals — cf. A.Q3 — pas conditions strictes de succès) :
  1. **Rétention 60j** : % users qui font une 2ème session dans les 60j (cible 25% à 3 mois post-launch, 35% à 6 mois)
  2. **% bookings via suggestion** : % de re-bookings depuis suggestion-quick-book (cible 15%+)
  3. **% messages flagged** : ratio L1 hits / total messages (mesure baseline, ajuste regex)
  4. **% appels users sur flags** : % flagged-messages contestés ("faux flag") — mesure faux positifs (cible <5%)

---

### G. Disclosure CGU à patcher (pré-Phase 8)

Les pages légales doivent être patchées **avant ship Phase 8** (LPD Art. 6 transparence, LCD Art. 3 honnêteté pratiques) :

- `src/app/terms/page.tsx` :
  - Mention explicite : *"Les messages échangés dans le chat post-session sont scannés (regex + IA) pour détecter les tentatives de partage de contact, dans le but de préserver la rétention de la plateforme."*
  - Mécanisme d'appel utilisateur en cas de flag erroné
- `src/app/privacy/page.tsx` :
  - Mention LPD Art. 6 (transparence) + Art. 7 (proportionnalité, pas de stockage contenu)
  - Données traitées par tiers (Google Gemini via Genkit) avec finalité claire
  - Toggle opt-out facile dans `/profile` (suggestions IA + scanning)
- `src/app/profile/...` :
  - Toggle 1-tap "Recevoir des suggestions IA" (default-on per D.Q1)
  - Toggle 1-tap "Scanning de mes messages chat" (default-on, mais opt-out clair)

Cette étape Phase 8-pre est **non-optionnelle**.

---

## 9.sexies — Doctrine Trust & Safety Phase 7 (validé mai 2026)

> **Contexte** : sans T&S système, la rétention femmes est compromise. Décision Bassi mai 2026 :
> T&S est la fondation de la plateforme dating-adjacent. Phase 7 ship T&S avant tout chat retention.
>
> **Re-ordering acté §10** :
> - Phase 7 = T&S (NEW — cette doctrine §9.sexies)
> - Phase 8 = Chat post-event + retention (ancien Phase 7, cf. §9.quinquies renommé)
> - Phase 9 = Polish + cleanup (ancien Phase 8)
> - Phase 10+ = Subscription Spordate+ + multilingue (ancien Phase 9+)

### Status implémentation (mise à jour mai 2026)

**Sub-chantier 0 (BLOQUANT pré-ship)** ✅ COMPLET
- CGU update + Resend setup + `Activity.audienceType` data model
- Commits : `c81df6e` (CGU), `6e5eada` (Resend helper + 4 templates + 20 tests), `3dc206e` (audienceType)

**Sub-chantier 1 — Reviews publiques** ✅ COMPLET (6 commits)
- 1/6 `7e1a126` : Reviews data model + Firestore rules (defense-in-depth create + update cross-tier guard)
- 2/6 `a54c3f3` : Service layer (createReview/edit/moderate/award/softDelete + 35 tests)
- 3/6 `66e74d6` : UI components (StarRating + StarRatingInput + ReviewForm + ReviewsList + EmptyReviewsState) + getReviewsByUser + activity page + profile integration
- 4/6 `6fc7890` : isEligibleToReview helper + ReviewTrigger Client island + reviewerProfiles fetch
- 5/6 `9f6fe66` : Wire sendEmail dans 3 services (reviewBonusGranted + reviewPendingModeration + reviewModerationDecision) + 3 templates
- 6/6 `e1227a7` : Tests Firestore rules `tests/reviews/rules.test.ts` (RR1-RR18, defense-in-depth validation)
- Cumulatif tests : `test:reviews` 64/64 PASS + `test:reviews:rules` 18/18 PASS

**Sub-chantier 2 — Block list user-side** 🚧 EN COURS (4 commits planifiés)
- 1/4 *(this commit)* : Data model `Block` + Firestore rules `/blocks/{blockId}` (defense-in-depth + doc-id pattern enforcé) + indexes (`blockerId+createdAt DESC`, `blockedId+createdAt DESC`)
- 2/4 : Service layer (`blockUser`/`unblockUser`/`isBlocked`/`getBlockedByMe`/`getBlockingMe`/`getMutualBlockSet`) + tests service
- 3/4 : UI components (`BlockButton` variants `'profile' | 'chat'`, `BlockUserDialog` confirmation, `BlocksManagementList`) + page `/profile/blocks`
- 4/4 : Integration (profile button + chat filter + discovery filter) + tests Firestore rules + close-out

**Décisions tranchées sub-chantier 2 (mai 2026)** :
- Card session entry point différé sub-chantier 6 polish — UI participants n'existe pas encore, à wirer naturellement quand elle sera ajoutée.
- Filter blocks côté client (≤50 docs) — refactor query-level différé Phase 9 polish si scale dépasse 1000 users actifs.
- Doc-id pattern `${blockerId}_${blockedId}` enforcé via Firestore rule create — anti-doublon + anti-spoofing.
- Warning partner co-inscrits différé sub-chantier 4 (admin moderation dashboard) ou sub-chantier 5 (email wiring) — partner-side, hors scope user-side ce sub-chantier.

**Sub-chantiers prochains** ⏳ À démarrer après 2
- Sub-chantier 3 — Reports + No-show workflow (~6-8h)
- Sub-chantier 4 — Admin moderation dashboard MVP + warning partner co-inscrits (~8-10h)
- Sub-chantier 5 — Email notifications wiring + audit trail (`adminActions/`) (~3-5h)
- Sub-chantier 6 — Card session entry point block + tests + polish (~3-4h)

### A. Doctrine économique — T&S = pré-requis rétention

**Règle** : sans T&S structurée, la rétention femmes est compromise. Femmes ≈ 50% des users cibles. Une mauvaise expérience non gérée → quitte la plateforme + word-of-mouth négatif → spirale.

**Sport-dating-adjacent** = risque accru vs dating classique (intimité physique du sport partagé, espace public partiel, alcool post-cours possible).

**Industrie dating** : rétention 60j femmes <10% sans T&S, 25-35% avec.

**Phase 7 ship T&S AVANT chat retention** parce qu'un incident T&S non géré sur les premières users casse la confiance launch et est irrattrapable.

---

### B. Architecture — 2 systèmes séparés (décision fondatrice Bassi)

La plateforme expose **2 boutons distincts** avec intent + ton + workflow différents.

| Système | Bouton (ton) | Visibilité | Anonymat | Modération | Workflow |
|---|---|---|---|---|---|
| **Reports formels** | *"Signaler un comportement inapproprié"* (sec, clair) | Admin-only, jamais public | TOTAL (lanceur d'alerte protégé) | Manuelle admin | Ban escalation auto |
| **Reviews qualitatives** | *"Comment s'est passée ta session ?"* (doux, engageant) | Public sur profil | Gradué selon note (cf. §C) | Pré-publication 1-2★ obligatoire | Aucun ban auto |

**Pourquoi 2 systèmes** :
- User en colère choisit "Signaler" (action sérieuse, anonyme)
- User satisfait choisit "Reviewer" (engagement positif, nominatif si bonne note)
- Évite la confusion d'un système unique qui mélangerait sanctions et feedback constructif

---

### C. Reviews publiques

#### C.1 Anonymisation graduée (note 1-5 étoiles + commentaire optionnel)

| Note | Visibilité auteur | Modération pré-publication |
|---|---|---|
| 5★ / 4★ / 3★ | Nominative (avatar + prénom) | Auto-publish |
| 2★ / 1★ | **Anonymisée** : *"Un·e participant·e"* | **Modération admin obligatoire avant publication** |

**Justification anonymisation 1-2★** :
- Protège l'auteur du backlash (un user reviewé négativement pourrait faire pression via son réseau)
- Évite que les reviews négatives deviennent une arme
- Modération pré-pub = filtre les insultes et attaques personnelles avant publication
- Phase 7 = modération **manuelle** par Bassi (volume bas attendu) ; Phase 9+ = IA-assistée Genkit quand volume > 10/jour

#### C.2 Délais — cooling-off + fenêtre limitée

- **Démarrage** : 24h post-session (cooling-off anti-impulsion à chaud)
- **Fermeture** : 7j post-session
- Fenêtre review = **6 jours actifs** (J+1 → J+7)

**Justif cooling-off** : un participant énervé sur le coup peut écrire une review qu'il regretterait. 24h de recul = qualité reviews accrue.

#### C.3 Optionnelles + 4 incitations (pas de blocage coercitif)

- ❌ **Pas de blocage du booking suivant** sans review (trop coercitif, anti-UX)
- ✅ **Reminder push 48h post-session** : *"Comment s'est passé ? 30 sec"*
- ✅ **Bonus 5 crédits chat** si review écrite (cohérent système 50/bundle Phase 8)
- ✅ **Badge profil "Reviewer actif"** si >5 reviews postées
- ✅ Mécanisme d'engagement positif progressif (gamification douce)

#### C.4 Affichage profil

- **Note moyenne en grand** (ex: ★ 4.6 / 5)
- **3 dernières reviews** affichées par défaut
- **Bouton "Voir toutes"** vers liste paginée
- **Cas spéciaux** :
  - Profil neuf (0 reviews) → *"Nouveau membre"* (cohérent §9.ter Tactique 2 anti-ghost-town : jamais "0 reviews")
  - Score <3.5/5 → flag interne + **visibility réduite dans algo matching Phase 9** (pas Phase 7)
  - Reviews 1-2★ affichées comme *"Un·e participant·e + date + commentaire"* (cohérent C.1)

#### C.5 Edition / suppression

- User peut éditer/supprimer **ses propres reviews** dans 24h post-publication
- Au-delà = figé (anti-revanche, intégrité historique)

#### C.6 Pas de review-revanche

- Une review négative reçue n'autorise PAS à reviewer en représailles
- Workflow détecte les patterns représailles cross-user (Phase 9 polish algo)

---

### D. Reports formels

#### D.1 Anonymat TOTAL

Le reporté ne sait JAMAIS qui l'a signalé. Notification ban mentionne uniquement la **catégorie**, pas le reporter.

**Protection lanceur d'alerte** : décision fondatrice — un user qui hésite à reporter par crainte de représailles ne reportera pas. L'anonymat total est non-négociable.

#### D.2 6 catégories structurées avec priorités admin

| # | Catégorie (enum) | Priorité admin |
|---|---|---|
| 1 | `harassment_sexuel` (sexuel, comportement inapproprié sexuel) | 🔴 **URGENTE** |
| 2 | `comportement_agressif` (verbal, intimidation, irrespect, hors-sexuel) | 🟠 Haute |
| 3 | `fake_profile` (photo trompeuse, fausse identité) | 🟡 Moyenne |
| 4 | `substance_etat_problematique` (ivresse, drogue, danger) | 🔴 **URGENTE** |
| 5 | `no_show` (réservation payée, absent sans excuse) | 🟢 Basse (auto-handled, cf. D.5) |
| 6 | `autre` (texte libre **obligatoire**) | 🟡 Moyenne |

**Priorité admin** = ordre de la queue moderation dashboard. Urgentes affichées en premier avec badge rouge.

#### D.3 Thresholds auto-action (rolling 12 mois, reports indépendants)

| Reports cumulés (différents reporters) | Action automatique |
|---|---|
| 1 | Review humaine uniquement, **pas d'action auto** |
| 2 (indépendants) | **Suspension AUTO 7j** + review humaine pendant ce délai |
| 3+ | **Suspension AUTO 30j** + review prioritaire admin |

**Rate limit anti-abus** : max **3 reports émis par user/jour** (cumul tous reportés). Au-delà = blocage UI + log admin.

**Dédup** : 2 reports du même reporter sur le même reporté = comptés comme **1** (anti-inflation par revanche).

**SLA admin review initiale** : **72h Phase 7** (Bassi solo, réaliste) ; 48h Phase 9+ avec admin team. Documenté CGU.

#### D.4 Délais — fenêtre étendue (urgents)

- **Démarrage** : dès le début de la session (pas d'attente cooling-off — un incident sérieux mérite signalement immédiat)
- **Fermeture** : **30j post-session** (laisse temps de prendre conscience d'incidents non immédiats)

**Justif délai différent vs reviews** : reports = sérieux/urgent, reviews = qualitatif/réflexion. Workflows distincts assumés.

#### D.5 No-show workflow spécifique (catégorie 5)

**Mécanisme** :
1. **Partner marque les no-shows** en fin de session via UI mobile simple
2. **Auto-création report** catégorie `no_show` (pas besoin participant signale manuellement)
3. **Délai grâce 30 min retard** avant marquage no-show
4. **Excuse pré-session ≥2h avant** = **PAS comptabilisé** (Phase 9 polish — Phase 7 ship sans cette feature, no-show comptabilisé même avec excuse <2h Phase 7)

**Thresholds rolling 90j** (différent des autres reports car spécifique no-show) :

| No-shows cumulés (90j rolling) | Action |
|---|---|
| 1er | Warning email |
| 2ème | Warning + flag profil interne |
| 3ème | **Suspension 30j + refund automatique au partner** lésé |
| 4+ | **Ban permanent** |

**Appel** : 1× par no-show possible (cohérent règle générale ban appel).

---

### E. Block list user-side

**UI** : bouton "Bloquer cet utilisateur" sur 3 entry points (profil, card session, chat).

**Effet** :
- Bloqueur et bloqué ne se voient plus mutuellement (sessions, profils, chat)
- Si déjà inscrits à une même session : warning au partner pour gestion physique séparée
- Persistant cross-sessions

**Notification** : **AUCUNE au bloqué** (anti-confrontation).

**Réversibilité** : oui, dans `/profile/blocks`.

**Pas de notification au bloqueur** que le bloqué a essayé d'interagir (non-information vs surveillance).

**Pas de limite max** sur le nombre de blocks par user (UX > optimisation prematurée DB).

---

### F. Workflow ban + appel

| Niveau | Action | Notification | Droit d'appel | Cible appel |
|---|---|---|---|---|
| 1 | Warning interne (flag profil) | Email warning + explication | Non (pas une sanction) | — |
| 2 | Suspension 7j | Email + date fin + recours | **Oui (1×)** | `contact@spordateur.com` |
| 3 | Suspension 30j | Idem + interdiction re-création même email | **Oui (1×)** | `contact@spordateur.com` |
| 4 | Ban permanent | Email + recours humain dédié | **Oui (1×)** | `contact@spordateur.com` |

**Règles appel** :
- **1 seul appel possible par niveau** (pas de re-appel sur le même)
- **Format** : reply email avec motif détaillé + éléments contradictoires
- **Délai admin réponse** : 7 jours calendaires
- **Email contact** : `contact@spordateur.com` (pro domain, cohérent pages légales `/terms`, `/privacy`, `/legal`)

**Revue annuelle ban permanent** : tout ban permanent fait l'objet d'une **review automatique annuelle** (pas trimestrielle, choisi pour **protéger les victimes** vs réinsertion prématurée du banni). Admin décide reconduction OU levée.

**Notification user banni** : email avec **catégorie** (jamais nom du reporter) + **durée** + **mécanisme appel** + **date fin** (si suspension).

**Fair process LPD** : décision motivée + droit d'appel limité + SLA + escalade humaine.

---

### G. Female-safety — préparation Phase 7, activation Phase 9

**Phase 7** : **préparation data model SANS UI active**.

Ajout du champ optionnel sur `Activity` :
```ts
audienceType?: 'all' | 'women-only' | 'men-only' | 'mixed-priority-women';
// Défaut undefined = 'all' (rétro-compatible activities existantes)
```

**Pas d'UI Phase 7** — modifiable via Admin SDK / Firebase Console / test seed uniquement. Cela permet :
- Migration future sans data refactor
- Tests A/B silencieux Phase 7 (Bassi peut activer manuellement quelques activities pour observer)
- Activation Phase 9 = juste un toggle UI ajouté

**Phase 9** : UI activation + booking flow filtre par genre déclaré profil + women-priority quota.

**Justification flag mixed-priority-women préféré à women-only stricte** :
- Moins de risque légal LCD Art. 3 (discrimination)
- Plus inclusif (femmes ont quota mais hommes peuvent toujours booker)
- Facilite onboarding partenaires (moins d'obstacles)

**Women-only stricte** : Phase 10+ uniquement si demande user forte observée.

---

### H. Légal — RGPD/LPD/nLPD

**Références légales clés** :
- **nLPD Art. 5-6** (transparence) : CGU explicite sur reports/bans/conservation
- **nLPD Art. 7** (proportionnalité) : reports stockés temps limité, pas indéfiniment
- **nLPD Art. 19** (devoir d'information) : email banni avec catégorie + durée + recours
- **RGPD/nLPD Art. 17** (droit à l'effacement) : suppression compte → données reports anonymisées (PII removed, reports relationnels gardés pour intégrité système)
- **LCD Art. 3** : pas de pratiques trompeuses sur sanctions

**Conservation données** :

| Type | Durée | Justif |
|---|---|---|
| Reviews publiques | Indéfini sauf demande user (RGPD Art. 17) | UX product (historique pertinent) |
| Reports actifs | 12 mois rolling depuis le report | Threshold auto-suspension fonctionnel |
| Reports résolus (warning/ban exécuté) | **12 mois post-résolution** | Audit + récidive |
| Bans permanents — Banlist record (userIdHash + banReason + banDate + neverAllowReregister) | **INDÉFINI** | Anti-bypass via nouveau compte ; signal sécurité |
| Bans permanents — PII associée (email original, profile data) | **24 mois** | nLPD Art. 17 effacement ; après 24 mois anonymisation auto |
| Audit trail admin (review, ban, unban) | 24 mois | Conformité + traçabilité décisions |

**Implémentation Banlist double régime** : après 24 mois, anonymisation auto de la PII. Banlist record (hash + raison + date + flag neverAllowReregister) reste fonctionnelle indéfiniment pour empêcher bypass via nouveau compte avec même identité (email rechecked à signup).

**Anonymisation soft delete user (RGPD/nLPD Art. 17)** : Phase 7 = manuel admin. Phase 9 = UI auto avec délais légaux respectés.

**Audit trail admin actions** : collection séparée `adminActions/{actionId}` (vs sub-collection users) — query plus simple, filtres temporels propres, pas de cross-collection.

---

### I. Scope Phase 7 vs Phase 8/9/10+

| Item | Phase 7 (MVP T&S) | Phase 9 (Polish) | Phase 10+ |
|---|---|---|---|
| Reviews 1-5★ + anonymisation graduée + cooling-off 24h | ✅ ship | maintenance | maintenance |
| Modération pré-pub 1-2★ manuelle | ✅ ship Bassi solo | optimisation IA-assistée Genkit (volume > 10/jour) | maintenance |
| Reports 6 catégories + anonymat total | ✅ ship | maintenance | maintenance |
| Auto-suspension 1/2/3+ + rate limit 3/jour | ✅ ship | tuning | maintenance |
| No-show workflow (90j thresholds, partner check-in UI) | ✅ ship | + excuse 2h+ avant = pas comptabilisé | maintenance |
| Block list user-side (illimité, silencieux) | ✅ ship | maintenance | maintenance |
| Workflow ban + appels (1×/niveau, 7j SLA, revue annuelle perm) | ✅ ship | UI appel polish | maintenance |
| Reminder push 48h + bonus 5 crédits + badge "Reviewer actif" | ✅ ship | optimisation | maintenance |
| Affichage profil (moyenne + 3 dernières + flag <3.5) | ✅ ship | + visibility réduite algo matching | maintenance |
| Admin moderation dashboard MVP (queue + actions) | ✅ ship basique | full UI + analytics + export CSV | maintenance |
| Email notifications via Resend (RESEND_API_KEY env + helper) | ✅ ship | templates polish | maintenance |
| Audit trail admin (collection séparée `adminActions/`) | ✅ ship basique | full UI + export | maintenance |
| `Activity.audienceType` data model | ✅ ship (sans UI) | UI + booking flow + women-priority quota | maintenance |
| Anonymisation soft delete user (PII removed) | ⚠️ manuel admin | UI auto délais légaux | maintenance |
| Banlist double régime (record indéfini, PII 24 mois) | ✅ ship | optimisation purge auto 24 mois | maintenance |
| Detection patterns représailles reviews | ❌ | ✅ ship | maintenance |
| Visibility réduite algo matching score <3.5 | ❌ | ✅ ship | maintenance |
| Excuse pré-session ≥2h avant (no-show grace) | ❌ | ✅ ship | maintenance |
| Female-safety women-priority quota active | ❌ | ✅ ship | maintenance |
| Women-only stricte | ❌ | ❌ | ✅ ship si demande forte |

---

### J. Estimation effort + ordre d'exécution

**Total Phase 7 T&S** : ~30-40h ≈ 4-5 semaines (Bassi solo).

**Sub-chantier order ship-blocks (validé Bassi)** — CGU au DÉBUT (pas à la fin) :

| # | Sub-chantier | Effort | Justif |
|---|---|---|---|
| **0** | **Pré-requis bloquant** : CGU update (mention T&S, conservation, appel, RGPD/nLPD) + Setup Resend env + helper sendEmail + `audienceType` data model (champ Activity, sans UI) | ~3-4h | Sans CGU updaté en premier, chaque feature T&S activée violerait nLPD Art. 6 (transparence). Doctrine "no-fake-content" cohérente. |
| 1 | Reviews (anonymisation graduée, cooling-off 24h, optionnelles + incitations) | ~6-8h | Quick win UX |
| 2 | Block list user-side (UI 3 entry points, silencieux) | ~4-6h | Quick win UX, déblocage motivation |
| 3 | Reports + No-show (6 catégories, thresholds, partner check-in) | ~6-8h | Système sanctions complet |
| 4 | Admin dashboard MVP (queue + actions ban/appeal) | ~8-10h | Bassi opère |
| 5 | Email notifications + audit trail (`adminActions/` collection) | ~3-5h | Notifications structurées |
| 6 | Tests + polish | ~3-4h | Validation finale |

---

### K. Disclosure CGU à patcher (pré-Phase 7, BLOQUANT)

Les pages légales doivent être patchées **avant ship Phase 7** (LPD Art. 6 transparence, LCD Art. 3 honnêteté, nLPD Art. 19 devoir d'information) :

- `src/app/terms/page.tsx` :
  - Mention explicite système Reports formels (anonymes) + workflow ban escalation (1/2/3+)
  - Mention Reviews publiques (anonymisation graduée 1-2★)
  - Mécanisme d'appel `contact@spordateur.com` + délai 7j SLA
  - Conservation données (12 mois reports actifs, 24 mois bans PII, indéfini Banlist record)
- `src/app/privacy/page.tsx` :
  - nLPD Art. 5-7 (transparence + proportionnalité)
  - RGPD Art. 17 (droit effacement + anonymisation soft delete)
  - Audit trail admin actions (collection `adminActions/`)
- `src/app/legal/page.tsx` :
  - Référence email `contact@spordateur.com` pour T&S
  - Mention LCD Art. 3 (pas de pratiques trompeuses sur sanctions)

Cette étape Phase 7-pre est **non-optionnelle** (LPD/nLPD/LCD).

---

## 9.bis — Décisions UX/UI (à garder en mémoire pour Phase 4-5)

### Médias des sessions/activités (image ou vidéo au choix du partenaire)

Le partenaire (créateur Afroboost, ou autre partenaire) doit pouvoir choisir **soit une photo, soit une vidéo** comme miniature de chaque activité/session. C'est l'élément visuel qui drive l'engagement.

**Modèle de données à étendre en Phase 2** (additif sur `Activity`) :
```typescript
interface Activity {
  // ... champs existants
  
  /** Phase 2 (additif). Miniature affichée sur les cards de session. */
  thumbnailMedia?: {
    type: 'image' | 'video';
    url: string;
    posterUrl?: string;  // Pour les vidéos = frame de preview
  };
}
```

**Partner dashboard (à coder en Phase 5)** :
- Toggle radio "Image" / "Vidéo" dans le formulaire de création/édition d'activité
- Upload zone adaptée au choix
- Preview avant validation
- Pour vidéo : choix manuel du frame de poster OU auto-extraction
- Recommandations affichées : ratio 4:5 ou 16:9, taille max, durée max ~10s

**Session card UI (à coder en Phase 5)** :
- Image → `background-image` avec `object-fit: cover`
- Vidéo → `<video autoplay muted loop playsInline poster={posterUrl}>` avec fallback image statique
- Mobile : autoplay conditionnel via Intersection Observer (économie batterie/data)
- Hors viewport → pause vidéo
- Respecter `prefers-reduced-motion` (vidéo statique sur poster si user le préfère)

**Skill UI/UX à utiliser** : `ui-ux-pro-max-skill` (déjà installé dans `.claude/skills/`) pour suivre les patterns de média responsive + accessibilité.

---

## 10. Journal des phases de la mission Sessions

| Phase | Description | Statut | Date |
|---|---|---|---|
| Phase 1 | Types Session/PricingTier + champs optionnels Activity/Match/Booking + rules `/sessions` + 4 indexes + sweep typecheck (rename .ts→.tsx + 6 fixes preexisting) | ✅ **SHIPPÉE** — push Afroboost44/main commit `66d4668`, Vercel auto-deploy. 18 commits dont 17 fixes typecheck préexistants + 1 commit Phase 1 v2. Firestore rules + indexes restent à déployer en début de Phase 2 (`firebase deploy --only firestore:rules,firestore:indexes` après confirmation projet Firebase prod). | mai 2026 |
| Phase 2 | Service Firestore Sessions (createSession, getUpcomingSessions, computePricingTier, bookSession) | ✅ **SHIPPÉE** — push Afroboost44/main commit `375742b`, Vercel rebuild auto-deploy. 7 fichiers, +1430/-2 lignes, 23 tests purs + 42 sub-assertions emulator PASS, build 35 routes OK. Java 21 + emulator Firestore opérationnels en local pour les futures phases. | mai 2026 |
| Phase 2.5 | **MIGRATION FIREBASE** : `studio-9336829343-59db2` → `spordate-prod`. Nouveau projet Firebase classique (compte `bassicustomshoes@gmail.com`), Firestore eur3 mode prod, Auth Email/Password, Storage à activer plus tard, Web App config + Service Account créés, 8 env vars Vercel updatées, Firestore rules + 4 indexes Phase 1 déployés sur `spordate-prod`, Vercel `vercel --prod` redeploy commit `4YeH1VLDX` Ready 37s. | ✅ **SHIPPÉE** — spordateur.com tourne maintenant sur `spordate-prod`. Backend `studio-9336829343-59db2` reste en standby 30j pour rollback éventuel, à supprimer en Phase 9. **Firebase Studio shutdown 22 mars 2027 = plus un risque**. | mai 2026 |
| Phase 3 | Pricing progressif côté serveur (extension `/api/checkout` + `/api/webhooks/stripe`) | ✅ **SHIPPÉE** — push Afroboost44/main commit `930e090`, Vercel auto-deploy. Extension mode 'session' avec recompute server-side anti-cheat, refactor route.ts → handler.ts (Next.js constraint), idempotency #1 hors-tx, transaction Admin SDK atomique (booking + currentParticipants++ + tier recompute + chatUnlock + grant 50 credits), Activity.chatCreditsBundle? + TransactionType+'session_purchase' + Transaction.bookingId?+sessionId?. Tests 23+42+37 = 102 sub-assertions PASS. Build 35 pages OK. | mai 2026 |
| Phase 4 | Hooks countdown (useCountdown, useSessionWindow, useServerTimeOffset) + composants UI countdown (CountdownBadge, CountdownHero, PricingTierIndicator, ChatStatusBadge) | ✅ **SHIPPÉE** — push Afroboost44/main commit `0984f92`, Vercel auto-deploy. | mai 2026 |
| Phase 5 | Pages `/sessions` (liste + détail) + 14 composants UI + 8 tactiques anti-ghost-town + doctrine no-fake-content | ✅ **SHIPPÉE** — push Afroboost44/main commit `db8b888` (squash 3 WIPs), polish #1 commit `ad46a18` (galerie 7/7 photos Afroboost Silent Neuchâtel). 31 fichiers, +2534/-5 lignes. ISR 60s/30s, WCAG 2.1 AA, prefers-reduced-motion. Doctrine LCD Suisse Art. 3 + LPD Art. 31 documentée §9.ter Tactique 3. | mai 2026 |
| Phase 6 | **Anti-cheat server-recompute pricing** : crons recompute `currentTier`/`currentPrice` toutes les N minutes selon temps écoulé + fill rate (extension Phase 3 anti-cheat checkout vers anti-cheat continu). Hardening additionnel checkout flow (idempotency edge cases, race conditions concurrentes). Re-priorisé mai 2026 AVANT Phase 8 rétention (defensive depth d'abord). | À faire — **~1 semaine** | — |
| Phase 7 | **Trust & Safety** (NEW, re-prioritisé mai 2026 AVANT chat retention) : Reviews publiques avec anonymisation graduée 1-2★ (modération pré-pub manuelle), Reports formels anonymes (6 catégories : harassment_sexuel/comportement_agressif/fake_profile/substance/no_show/autre), Block list user-side (illimité, silencieux), Workflow ban 4 niveaux (warning/7j/30j/permanent) avec appel 1×/niveau via `contact@spordateur.com` (SLA 7j), Admin moderation dashboard MVP, No-show workflow (90j thresholds + partner check-in), Email notifications via Resend, Audit trail admin (collection `adminActions/`), `Activity.audienceType` data model (sans UI active, activation Phase 9 women-priority quota). Sub-chantier 0 BLOQUANT pré-ship : CGU update (LPD/nLPD/LCD compliance) + Resend env + audienceType field. Cf. §9.sexies pour la doctrine complète. | À faire — **~4-5 semaines** | — |
| Phase 8 | **Chat post-event + rétention + suggestions IA + invite Individuel** : chat persistant avec crédits 50/bundle (texte=1, photo=5, vidéo=10), détection anti-leak L1-L4 (regex + Gemini Flash via Genkit, FR uniquement Phase 8), suggestions IA next-activity default-on (cadence 1/72h, inline avec avatar bot), invite Individuel via Stripe direct, disclosure CGU pré-ship. Cibles KPIs en stretch goals (rétention 60j, % bookings via suggestion, % flagged, % appels). Cf. §9.quinquies pour la doctrine complète. | À faire — **~3-4 semaines** | — |
| Phase 9 | **Polish (Split/Gift invites, admin UI, analytics) + cleanup** : modes Invite Split + Gift via Stripe Connect destination splits, admin UI past-sessions photos + activity-suggestions JSON, analytics retention dashboard (cohort 30/60/90j), email notifications J-1/T-0/T+0 via Resend, cleanup hérité (cf. §9 — Stripe lazy-init 4 routes, etc.). | À faire | — |
| Phase 10+ | **Subscription Spordate+ + multilingue DE/IT** : abonnement premium (quotas IA illimités, suggestions raffinées, cohort analytics persos), patterns regex DE/IT pour anti-leak, prompts IA multilingues. | À faire | — |
