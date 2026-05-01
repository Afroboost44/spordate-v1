# architecture.md — Plan de Spordate

> ⚠️ **Note importante (mai 2026)** : ce document a été créé au démarrage de la mission Sessions sur la base de l'architecture initiale décrite. Il a été enrichi depuis avec les **réalités du repo** (découvertes lors de l'analyse de Phase 1) et le **plan de nettoyage Phase 8**. Voir les sections en bas du document.

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

## 9. Plan de nettoyage — Phase 8 (à faire APRÈS toutes les autres phases)

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
- [x] **Étape 1 (faite en mai 2026, anticipée depuis Phase 8 suite à découverte de divergence 117 commits)** : migration locale du remote :
  ```bash
  git remote remove origin              # déconnecter sambassi
  git remote rename prod origin         # Afroboost44 devient origin
  git reset --hard origin/main          # aligner local sur prod (perd Phase 1 stash, re-créé propre)
  git stash drop stash@{0}              # abandonner ancien stash Phase 1
  ```
  Note : Phase 1 a été redessinée from scratch sur le contexte prod (117 commits plus avancé que l'ancien clone sambassi).
- [ ] **Étape 2 (à faire en Phase 8, APRÈS l'étape 1)** : supprimer `sambassi/spordate-v1` sur GitHub :
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

- [ ] Supprimer (ou laisser mourir) le projet Firebase Studio **`studio-9336829343-59db2`** — sandbox abandonnée, sera coupée le 22 mars 2027 par Google.
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
- [ ] Mentionner Cloud Functions Phase 7 : à implémenter en **Vercel Cron Jobs** OU en **Firebase Functions séparées**, à arbitrer en début de Phase 7.

### Sécurité & monitoring

- [ ] Régler le warning Vercel **`STRIPE_SECRET_KEY` "Needs Attention"** — probablement remplacer par une "restricted key" Stripe au lieu de la clé secrète complète.
- [ ] **Fix Stripe lazy init** dans `src/app/api/checkout/route.ts` (ligne 12) : déplacer `const stripe = new Stripe(...)` du niveau module dans le `POST` handler (lazy init), comme c'est déjà fait dans `webhooks/stripe/route.ts`. Sinon le build local échoue sans `.env.local` (sur Vercel ça passe car env vars définies). Découvert pendant Phase 1 cleanup, hors scope.
- [ ] Auditer les autres env vars Vercel — confirmer que toutes les 11 attendues (cf. `.env.example`) sont présentes.
- [ ] Vérifier que `FIREBASE_SERVICE_ACCOUNT_KEY` est bien configuré côté serveur (utilisé par les API routes Stripe webhook).

### Documentation

- [ ] Mettre à jour `README.md` après Phase 8 pour refléter l'architecture réelle finale.
- [ ] Ajouter dans `CLAUDE.md` une section "Workflow de déploiement réel" avec les commandes exactes (push prod, deploy firestore rules, etc.).
- [ ] Archiver l'ancien `README-original.md` ou le supprimer.

---

## 10. Journal des phases de la mission Sessions

| Phase | Description | Statut | Date |
|---|---|---|---|
| Phase 1 | Types Session/PricingTier + champs optionnels Activity/Match/Booking + rules `/sessions` + 4 indexes + sweep typecheck (rename .ts→.tsx + 6 fixes preexisting) | ✅ **SHIPPÉE** — push Afroboost44/main commit `66d4668`, Vercel auto-deploy. 18 commits dont 17 fixes typecheck préexistants + 1 commit Phase 1 v2. Firestore rules + indexes restent à déployer en début de Phase 2 (`firebase deploy --only firestore:rules,firestore:indexes` après confirmation projet Firebase prod). | mai 2026 |
| Phase 2 | Service Firestore Sessions (createSession, getUpcomingSessions, computePricingTier, bookSession) | À faire | — |
| Phase 3 | Pricing progressif côté serveur (extension `/api/checkout` + `/api/webhooks/stripe`) | À faire | — |
| Phase 4 | Hooks countdown (useCountdown, useSessionWindow, useServerTimeOffset) + composants UI countdown | À faire | — |
| Phase 5 | Pages `/sessions` (liste + détail) + widget UpcomingSessions | À faire | — |
| Phase 6 | Chat temporel (étendre chatUnlocked avec phase before/chat-open/started/ended) | À faire | — |
| Phase 7 | Cloud Functions / Cron Jobs (J-1, H-2 chat opening, T-0 start, T+0 end + emails Resend) | À faire | — |
| Phase 8 | **Cleanup** — voir section 9 ci-dessus | À faire | — |
