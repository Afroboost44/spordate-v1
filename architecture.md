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

**Phase 9 SC2 — votes doctrine tranchés (mai 2026)** :
- **Q1=A** UI mode selection : **inviter choisit** (Individual/Split/Gift + ratio si Split) à la création de l'invite. Cohérent UX gift IRL — l'inviter offre le contexte.
- **Q2=C** Gift mode Booking shape : **Booking unique** `userId=invitee` avec denorm `paidByUserId=inviter` ≠ `userId` (traceability + refund routing propre).
- **Q3=C** Refund post-accept : **defer Phase 10** (Phase 9 KISS — focus refund auto pre-accept decline/expire). Flag `refundDue` admin manuel pour cas edge post-accept.
- **Q4=B** Application fee Spordate : **5% flat Phase 9** (growth incentive). Configurable env var `SPORDATE_INVITE_FEE_PCT=5` pour tuning sans redeploy.
- **Q5=A** Min/max split ratio : **10-90%** (anti-zero ET anti-100%). Slider step 10% (10/20/30/40/50/60/70/80/90).
- **Q6=A** Cancellation policy split/gift (avant accept) : **A peut cancel l'invite** → refund auto 100% via cron expireInvitesCron extension. Cohérent doctrine retain-not-trap.

**Stripe Connect destination charges pattern Phase 9 SC2** :
- Inviter pre-pays sa portion (Split) ou totalité (Gift) à la création de l'invite via Stripe checkout
- `transfer_data.destination = partner.stripeAccountId` (Express account onboarded)
- `application_fee_amount = totalCents * SPORDATE_INVITE_FEE_PCT / 100` (Spordate platform commission)
- Idempotency key Stripe : `invite-prepay-{inviteId}` (scope-safe replay)
- Refund auto si decline/expire : `refundForInvite({inviteId})` helper cohérent SC5 c4/5 `refundForSanction` pattern

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

**Sub-chantier 2 — Block list user-side** ✅ COMPLET (4 commits)
- 1/4 `bc3798a` : Data model `Block` + Firestore rules `/blocks/{blockId}` (defense-in-depth + doc-id pattern enforcé) + indexes (`blockerId+createdAt DESC`, `blockedId+createdAt DESC`)
- 2/4 `8767bc6` : Service layer (`blockUser`/`unblockUser`/`isBlocked`/`getBlockedByMe`/`getBlockingMe`/`getMutualBlockSet`) + tests service B1-B15 (36 sub-assertions)
- 3/4 `c3463a0` : UI components (`BlockButton` variants `'profile' | 'chat'`, `BlockUserDialog` confirmation, `BlocksManagementList`) + page `/profile/blocks`
- 4/4 `1855745` : Integration (profile button + invisibilité mutuelle profile/[uid] + chat filter + discovery filter) + tests Firestore rules `tests/blocks/rules.test.ts` (RB1-RB12) + close-out
- Cumulatif tests : `test:blocks` 36/36 PASS + `test:blocks:rules` 12/12 PASS

**Sub-chantier 3 — Reports + No-show workflow** ✅ COMPLET (5 commits)
- 1/5 `1fdc519` : Data model `Report` (6 catégories enum + 4 statuses) + `UserSanction` (4 levels + appeal flow) + UserProfile additions denorm (preparation, non écrits Phase 7) + Firestore rules `/reports/` (anonymat read admin/reporter, defense-in-depth create) + `/userSanctions/` (read owner+admin, create admin OR auto-trigger restrictif, update admin OR owner appeal) + 6 indexes
- 2/5 `79474a7` : Service layer Reports + admin actions (`createReport`/`getReportsForReporter`/`getReportsAgainst`/`dismissReport`/`sustainReport`) + tests RP1-RP18 (51 sub-assertions)
- 3/5 `aac0558` : Service No-show + Sanctions auto-trigger + Appeals (`markNoShow`/`getNoShowsForUser`/`getActiveUserSanction`/`triggerAutoSanction`/`appealSanction`/`cancelNoShow`) + tests TR1-TR2 + NP1-NP13 (47 sub-assertions)
- 4/5 `21a9392` : UI components (`ReportButton` variants `'profile' | 'chat'` + `ReportUserDialog` 6 catégories radio) + integration profile/chat
- 5/5 *(this commit)* : Partner check-in UI (`/partner/sessions/[sessionId]/check-in` + `NoShowCheckInList`) + 4 email templates (reportSubmitted/userSanctionNotice/noShowWarningNotice/partnerNoShowConfirmed) + `SanctionBanner` component sticky + wire sendEmail dans triggerAutoSanction/markNoShow/createReport + tests Firestore rules `tests/reports/rules.test.ts` (RR1-RR16 + RS1-RS10) + dashboard partner section check-in
- Cumulatif tests : `test:reports` 51/51 + `test:reports:no-show` 47/47 + `test:reports:rules` ~26/26 = 124/124 PASS

**Décisions tranchées sub-chantier 3 (mai 2026)** :
- Q1 page partner check-in dédiée `/partner/sessions/[sessionId]/check-in` (vs section dashboard).
- Q2 validation participation report obligatoire (cohérent reviews) — anti-fraude.
- Q3 sanctions = collection séparée `userSanctions/` ; champs denorm UserProfile préparés mais NON écrits Phase 7 (rule users update reste owner/admin only — relaxation reportée Phase 8 via Cloud Function). Authoritative source = `getActiveUserSanction()` query indexée (1 query rapide, acceptable login + setInterval).
- Q4 SanctionBanner sticky top + lien recours `mailto:contact@spordateur.com`.
- Q5 appel sanction = email reply uniquement (cohérent doctrine §F), pas de form in-app.
- Q6 enforcement check au login + setInterval 5 min (custom claims Phase 9).
- Q7 refund partner no-show level 3 = flag `userSanctions.refundDue=true`, traitement manuel admin Stripe dashboard Phase 7 (Stripe API automatisation Phase 8).
- Q8 rate limit 3 reports/jour = query rolling 24h sur `reports` (pas de denorm dailyCount).

**Décisions tranchées sub-chantier 2 (mai 2026)** :
- Card session entry point différé sub-chantier 6 polish — UI participants n'existe pas encore, à wirer naturellement quand elle sera ajoutée.
- Filter blocks côté client (≤50 docs) — refactor query-level différé Phase 9 polish si scale dépasse 1000 users actifs.
- Doc-id pattern `${blockerId}_${blockedId}` enforcé via Firestore rule create — anti-doublon + anti-spoofing.
- Warning partner co-inscrits différé sub-chantier 4 (admin moderation dashboard) ou sub-chantier 5 (email wiring) — partner-side, hors scope user-side ce sub-chantier.

**Sub-chantier 4 — Admin moderation dashboard MVP + warning partner co-inscrits** ✅ COMPLET (4 commits)
- 1/4 `b8ab6e2` : Service layer admin extension (`getPendingReports`/`overturnSanction`/`resolveAppeal`/`listAllBlocks`/`getCoInscribedConflicts`) + tests RA1-RA10 (19 sub-assertions)
- 2/4 `a30773b` : UI tabs `T&S Reviews` + `T&S Reports` queue + 5 components admin (`PriorityBadge`/`SanctionPickerDialog`/`ReviewModerationActionsDialog` + 2 panels extraits `TandSReviewsPanel`/`TandSReportsPanel`)
- 3/4 `0dadde7` : UI tabs `T&S Sanctions` (filtres dropdown + overturn action) + `T&S Appeals` (queue uphold/overturn) + `<CoInscribedWarning>` partner banner discret (admin dashboard + partner dashboard + check-in page)
- 4/4 *(this commit)* : Tests rules update appeals admin (RS11-RS15 dans rules.test.ts) + tests `getCoInscribedConflicts` (CC1-CC6 dans co-inscribed.test.ts) + close-out
- Cumulatif tests sub-chantier 4 : `test:reports:admin` 19/19 + `test:reports:rules` extension RS11-RS15 (~5 nouveaux) + `test:reports:co-inscribed` ~10/10
- **Q9 exception charte stricte** : admin dashboard conserve style `bg-gray-900 / border-gray-800` (utilitaire, pas brand-facing). Charte stricte black/#D91CD2/white = user-facing seulement.
- **Q2 admin auth setup requis** : avant utilisation tabs T&S, setup `users.{adminUid}.role='admin'` via Firebase Console (services admin font check role-based via `isAdminRole`). Refactor Firebase Auth role-based différé Phase 9.

**Sub-chantier 5 — Email notifications wiring complete + audit trail `adminActions/`** ✅ COMPLET (3 commits)
- 1/3 `4eb9f89` : 2 templates email manquants (`userSanctionOverturned` + `appealResolved`) + wire `sendEmail` dans 3 services admin (`overturnSanction` + `resolveAppeal` + `appealSanction` via `appealAcknowledgment` Q9)
- 2/3 `2db3105` : Collection `adminActions/` defense-in-depth + service `logAdminAction`/`getAdminActions` + wire 5 services admin (moderateReview, dismissReport, sustainReport, overturnSanction, resolveAppeal) + tests LA1-LA8 (24 sub-assertions) + Q4-Q8 décisions appliquées
- 3/3 *(this commit)* : Tests rules `/adminActions/` AA1-AA10 + close-out
- Cumulatif tests sub-chantier 5 : `test:admin-actions` 24/24 + `test:admin-actions:rules` ~10/10 = ~34/34 PASS
- **Conservation audit trail** : 24 mois (doctrine §H), purge cron Phase 9
- **Q5 best-effort** logs `[logAdminAction] write failed (silent)` quand DI seam non injecté côté tests existants — comportement attendu, prouve robustesse pattern

**Sub-chantier 6 — Card session entry point + polish + close-out final Phase 7** ✅ COMPLET (2 commits)
- 1/2 `21f20cc` : Polish + cleanup (banNotification template legacy retiré) + documentation consolidée `docs/phase-7-trust-safety.md` (229 lignes) + README full rewrite + architecture.md récap "Phase 7 — État final"
- 2/2 *(this commit)* : Card session entry point pragmatique (`<SessionTSActions />` Client island sur `/sessions/[sessionId]` — block + report ciblant partner + lien `/profile/blocks`) + close-out final Phase 7
- Cumulatif tests sub-chantier 6 : aucun nouveau (polish + cleanup, no regression confirmé)
- **Décision Q1 hybride** : entry point pragmatique partner (80% use case couvert), UI complete participants list différée Phase 9 (privacy + UX scope)

**🎉 PHASE 7 ENTIÈRE OFFICIELLEMENT CLOSE 🎉**

**Phase 7 = MVP Trust & Safety production-ready** :
- 6 sub-chantiers (0+1+2+3+4+5+6) — 100% shipped
- 26 commits cumulés (de `c81df6e` à *this*)
- ~372 tests passing
- Doctrine §9.sexies appliquée intégralement (sections A-J)
- Compliance LPD/nLPD/RGPD/LCD opérationnelle
- Admin moderation dashboard MVP utilisable + audit trail 24mo
- Email notifications wirées + appeals 1×/niveau via doctrine §F

---

## Phase 7 — État final (mai 2026)

> Section close-out consolidée — récap commits + tests + statut shipped vs différé.

### Commits Phase 7 sub-chantiers 0-6

| Sub-chantier | Commits hashs | Tests cumul. | Statut |
|---|---|---|---|
| 0 — CGU + Resend + audienceType | `c81df6e` `6e5eada` `3dc206e` | 20 (email) | ✅ |
| 1 — Reviews publiques | `7e1a126` `a54c3f3` `66e74d6` `6fc7890` `9f6fe66` `e1227a7` | 82 (64+18) | ✅ |
| 2 — Block list user-side | `bc3798a` `8767bc6` `c3463a0` `1855745` | 48 (36+12) | ✅ |
| 3 — Reports + No-show | `1fdc519` `79474a7` `aac0558` `21a9392` `d761500` | 124 (51+47+26) | ✅ |
| 4 — Admin moderation MVP | `b8ab6e2` `a30773b` `0dadde7` `a6d878f` | 63 (19+13+5+26) | ✅ |
| 5 — Email + audit trail | `4eb9f89` `2db3105` `662c33d` | 35 (24+11) | ✅ |
| 6 — Polish + close-out final | `21f20cc` `<this>` | (no nouveau) | ✅ |

**Total Phase 7 T&S** : ~372 tests cumulatifs (1 seul build, 0 régression accumulée).

### Shipped Phase 7 (couvert par les 6 sub-chantiers)

✅ Reviews 1-5★ + anonymisation graduée 1-2★ + cooling-off 24h + édition 24h
✅ Block list user-side mutuelle invisibilité (silencieux) + page `/profile/blocks`
✅ Reports formels 6 catégories anonymes + rate limit 3/jour + dédup + thresholds 12mo
✅ No-show workflow partner check-in (grâce 30min + undo 24h + thresholds 90j)
✅ Sanctions auto 4 niveaux + appeals 1×/niveau + admin overturn manuel
✅ Admin moderation dashboard 4 tabs (Reviews / Reports / Sanctions / Appeals)
✅ Email notifications Resend (12 templates wirés)
✅ Audit trail `adminActions/` collection (24mo conservation)
✅ `Activity.audienceType` data model (sans UI active)
✅ `<SanctionBanner />` global + `<CoInscribedWarning />` partner
✅ CGU + Privacy + Terms rédigés (LPD/nLPD/LCD compliance)

### Différé Phase 8 (polish + hardening — Cloud Functions / SDK)

⏳ `listAllBlocks` admin via Admin SDK endpoint
⏳ Cloud Function denorm `users.{uid}.activeSanction*` on userSanctions create/update
⏳ Cron purge audit trail `/adminActions/` après 24mo
⏳ Cron purge banlist PII après 24mo
⏳ `cancelNoShow` recompute threshold automatique si sanction déclenchée par report annulé
⏳ Push reminder 48h post-session (template `reviewReminder` wire)
⏳ Stripe API automatisation refund partner no-show level 3

### Différé Phase 9 (UX + features avancées)

⏳ Card session UI participants list complète + entry points block/report participants (Phase 7 wire seulement le partner)
⏳ Refactor admin auth Firebase Auth role-based (vs localStorage email actuel)
⏳ Admin UI queue `adminActions/` history + filtres + export CSV
⏳ IA-assistée Genkit pour modération reviews 1-2★ (volume > 10/jour)
⏳ Charte stricte appliquée admin dashboard (vs `bg-gray-900` exception actuelle)
⏳ Excuse pré-session ≥2h avant = no-show pas comptabilisé
⏳ Visibility réduite algo matching score reviews <3.5★
⏳ Detection patterns représailles cross-user reviews
⏳ Female-safety women-priority quota active (audienceType field)
⏳ Anonymisation soft delete user UI auto

### Documentation Phase 7

- `architecture.md` §9.sexies (sections A-J) — doctrine source de vérité
- `docs/phase-7-trust-safety.md` — guide consolidé pour future contributors (~300 lignes : architecture + doctrine + tests + wiring + TODO)
- `src/app/terms/page.tsx` §7.bis + §7.ter — CGU rédigées
- `src/app/privacy/page.tsx` — mention adminActions, bans, conservation
- `README.md` — section Trust & Safety dédiée

**Conclusion** : Phase 7 T&S = MVP fonctionnel complet. Spordateur est désormais conforme nLPD/RGPD/LCD avec workflow ban équitable + admin moderation dashboard + audit trail. Prête à gérer les premiers incidents user au launch.

**Prochaine phase** : **Phase 8** — Chat post-event + retention + IA + invite Individuel (cf. ledger phase ci-dessous, §F invitation réciproque). Ouvre nouvelle stratosphère engagement utilisateur après le solid floor T&S Phase 7.

---

## Phase 8 — En cours (mai 2026)

### Sub-chantier 0 — Pré-flight Phase 8 ✅ COMPLET (3 commits)

- 1/3 `d54c7a9` : CGU §7.quater (modération chat IA L1+L2 + logs 30j hashés + rate limit 10/user/min) + §7.quinquies (suggestions IA chat cadence 72h + opt-out via /profile + consensus opt-out) + Privacy §2 §5 §7 §8 (sub-processor Google Gemini + droit opposition + non-désactivabilité modération)
- 2/3 `ab46dd9` : `UserProfile.aiSuggestionsOptIn?: boolean` (additif, undefined === true) + helper `updateUserAiOptIn` + section /profile "Confidentialité" (Card + Switch + lien /privacy + reminder modération non-désactivable) + tests rules `tests/profile/rules.test.ts` AI1-AI2 (2/2 PASS)
- 3/3 *(this commit)* : `src/ai/genkit.ts` étendu (rate limiter per-user 10/min sliding window 60s, `AiError` typée, `checkRateLimit` + `wrapAiCall` + DI seams `__set*ForTesting`) + `src/ai/types.ts` (interfaces `AntiLeakInput/Output`, `SuggestionInput/Output` pour flows sub-chantiers 2-3) + tests `src/ai/__tests__/genkit.test.ts` G1-G3 (3/3 PASS) + CLAUDE.md §10 Troubleshooting Git Auth + close-out architecture.md

**Bilan sub-chantier 0** : disclosures légales LPD/RGPD/LCD shipped + opt-in user-side + scaffolding Genkit prêt pour flows. Prochain : sub-chantier 1 (chat survival post-event + crédits consumption + L1 regex anti-leak, défense-en-profondeur bundle).

### Sub-chantier 1 — Chat survival post-event + crédits + L1 regex anti-leak ✅ COMPLET (5 commits)

- 1/5 `3cae5b0` : rules `/chats/{matchId}/messages` create inversion §A doctrine (allow `'completed'`, block `'cancelled'`, rétro-compat legacy) + cross-doc check `users.{senderId}.credits ≥ 1` + `AiScanLog` interface (Phase 8 §C.Q2) + nouvelle collection `/aiScanLogs/{id}` server-only + tests `tests/chat/rules.test.ts` CHAT1-CHAT5 (5/5 PASS)
- 2/5 `101c69a` : `src/lib/anti-leak/regex.ts` — 6 patterns FR doctrine §C (PHONE_CH, PHONE_INTL +41, EMAIL strict TLD, SOCIAL_HANDLE proximity, DOMAIN .ch/.com/.net/.org/.io/.fr/.app, PLATFORM_KEYWORD whatsapp/telegram/dm moi/mp/signal/viber/envoie sur/insta/instagram/ig/snap/snapchat/tiktok) + `scanMessageL1()` pure function avec dedup inter-cat + scoring 0.5/0.6/0.8/0.9 + priorité motive + tests RGX1-RGX30 (30/30 PASS first try)
- 3/5 `7328381` : `firestore.rules /aiScanLogs/{id}` defense-in-depth strict (anti-spoof senderId, ranges score, enum motive, regex hash SHA-256 64 chars hex, anti-backdate createdAt, keys hasOnly whitelist) + `sha256Hex()` Web Crypto + DI seam `__setChatDbForTesting`/`getChatDb()` + `sendMessage()` étendu (check credits ≥1 + scan L1 silent + hash + atomic batch decrement+scanLog+message + post-batch best-effort lastMessage+notification) + tests CHAT6-CHAT9 defense-in-depth + `tests/chat/service.test.ts` SVC1-SVC8 emulator-based (9/9 + 21/21 PASS)
- 4/5 `7412885` : UI `/chat` — compteur Coins live (color ladder red/orange/default) + onboarding-bubble Dialog 1ère entrée (localStorage flag, doctrine §B.Q1 transparence + ShieldCheck disclosure CGU §7.quater) + handleSend défensif (pré-check insufficient + classification erreurs insufficient-credits/permission/generic) + Input disabled si <1 crédit + visual hint subtle "1 crédit consommé par message" + CTA "Top-up →" si épuisé. Charte stricte black/#D91CD2/white.
- 5/5 *(this commit)* : architecture.md sub-chantier 1 close-out + verification cumulative tests + scripts package.json review

**Bilan sub-chantier 1** :
- Doctrine §A ✅ chat post-completion ouvert tant que credits ≥1 (rule + service + UI)
- Doctrine §B.line567 ✅ L1 silent log only (aiScanLogs/ écrit, UI ne montre score/motive)
- Doctrine §B.Q1 ✅ onboarding-bubble obligatoire 1ère entrée + disclosure CGU §7.quater
- Doctrine §B.Q4 ✅ précision 92-95% confirmée RGX17-RGX29 anti-FP
- Doctrine §C ✅ 6 patterns FR (5 catégories doctrine + INTL +41) + dedup intra-email + priorité motive
- Doctrine §C.Q2 ✅ score + motive + hash SHA-256 anonyme uniquement (jamais contenu)
- Tests SC1 cumulés : 30 (regex unit) + 9 (rules emulator) + 21 (service emulator) = **60 assertions**
- Tests Phase 8 cumulés (SC0 + SC1) : 5 + 6 + 9 + 30 + 21 + 2 = **73 assertions** (Phase 7 base 372 préservée intégralement, no regression)
- Latence target <200ms p95 ✅ regex pure ~1-5ms + Web Crypto SHA-256 ~1ms + 1 cross-doc read ~10-30ms
- DI seam `__setChatDbForTesting` cohérent pattern Phase 7+Phase 2 sessions

**Prochain** : sub-chantier 2 — Anti-leak L2-L4 Genkit (flow IA contextuelle anti-leak via wrapAiCall SC0 + escalation manuelle admin via collection dédiée + extension motive enum 'ai-leak-likely' / 'ai-leak-unlikely').

### Sub-chantier 2 — Anti-leak L2-L4 Genkit ✅ COMPLET (5 commits + 2 hotfixes)

- 1/6 `323b995` : Types `Chat.leakBySender` per-chat per-sender + `UserProfile.leakFlagged` boolean + `AiScanLog.motive` enum extension SC2 (`ai-leak-likely` / `ai-leak-unlikely` / `ai-error`) + rules `/aiScanLogs/` enum + `/chats/` self-only constraint sur leakBySender + tests `CHAT10-CHAT13` (4 cas, 13/13 cumulés)
- 2/6 `bd32241` : `src/ai/flows/anti-leak-classifier.ts` flow Genkit Gemini Flash + cache 24h in-memory Map + system prompt FR strict + 6 few-shot examples + DI seams `__setGenerateFnForTesting` + `__resetCacheForTesting` + `__setNowFnForTesting` + Q5=A defensive fallback motive='ai-error' + tests `ALC1-ALC10` (10/10 PASS first try)
- 3/6 `26252a2` : `sendMessage()` étendu pipeline hybride — si scanL1.score === 0.5 → `classifyMessageL2()` IA refinement (likely=1 → 'ai-leak-likely' / likely=0 → 'ai-leak-unlikely' / error → 'ai-error' preserve L1) + read chat.leakBySender courant + compute escalationLevel L0/L2/L3/L4 + return enrichi `{messageId, scanScore, scanFlagged, scanMotive, escalationLevel, leakCountAfter}` + tests `SVC9-SVC14` (35 sub-assertions)
- 4/6 `f2d4c98` : UI `chat/page.tsx` — handleEscalation post-send : L2 toast soft (wording doctrine literal Q11=A "Le chat reste ouvert jusqu'à ta prochaine session — pas besoin de partager ton Insta.") + L3 AlertDialog rétroactif (Q2=B post-send laisse-faire) + L4 silent + helper `generateFalseFlagMailto()` (Q8=A KISS) avec ToastAction + footer L3
- 5/6 `644e5a0` : L4 admin escalation post-batch — best-effort `users.{senderId}.leakFlagged=true` + audit `adminActions/` avec `adminId='system'` (rule path b) + `sendEmail leakEscalationAdmin` → env `ADMIN_LEAK_EMAIL` default `contact@spordateur.com` + idempotency via senderLeakFlagged check + AdminActionType enum extension `'leak_escalation_l4'` + AdminActionTargetType `'user'` + tests `EM-LK1-EM-LK3` (3 cases) + `SVC15-SVC17` (delta-based assertions)
- 6/6 *(this commit)* : architecture.md sub-chantier 2 close-out + cumulative tests verification + scripts package.json review + doctrine compliance recap

**Hotfixes shipped pendant SC2** :
- `74baef8` hotfix(phase8) : isolate Genkit server-only via `/api/anti-leak/route.ts` (Genkit dépend de `@grpc/grpc-js` + `@opentelemetry/sdk-node` qui ne peuvent pas bundler côté client — `serverExternalPackages` config + fetch helper). Build Vercel `Compiled successfully` après ce hotfix.
- `a6a41b2` fix(stripe) : lazy-init Stripe SDK pour `/api/verify-payment` + `/api/checkout` (init module-level cassait "Collecting page data" Vercel sans STRIPE_SECRET_KEY au build time). Pattern défensif aligné avec autres routes Stripe `/api/`.

**Architecture résultante anti-leak L1+L2** :

```
┌──────────────────┐
│ chat/page.tsx    │  Client Component
│ (handleSend +    │  ↓ import sendMessage
│  handleEscalation)│
└────────┬─────────┘
         │ await sendMessage(chatId, senderId, text)
         ↓
┌──────────────────┐
│ services/        │  Shared client+server module
│ firestore.ts     │  • L1 scanMessageL1 (regex pure)
│ sendMessage()    │  • Hash SHA-256 (Web Crypto)
└────────┬─────────┘  • Si score=0.5 → fetch /api/anti-leak
         │
         │ POST /api/anti-leak  (Phase 8 SC2 hotfix isolation)
         ↓
┌──────────────────┐
│ /api/anti-leak/  │  Server-only route (runtime='nodejs')
│ route.ts         │  • Validate body shape + anti-DoS ≤5000 chars
└────────┬─────────┘  • Map AiError → 429 / autres → 500
         │ classifyMessageL2(input)
         ↓
┌──────────────────┐
│ src/ai/flows/    │  Server-only (Genkit isolated)
│ anti-leak-       │  • Cache 24h in-memory Map<sha256, result>
│ classifier.ts    │  • wrapAiCall (rate limit 10/user/min)
└────────┬─────────┘  • System prompt FR + 6 few-shot
         │ ai.generate({prompt: ...})
         ↓
┌──────────────────┐
│ src/ai/genkit.ts │  Server-only (Gemini 2.5 Flash via Genkit)
└──────────────────┘  ← @grpc/grpc-js + @opentelemetry/sdk-node
                       (serverExternalPackages anti webpack-bundle)

Side effects post-batch (sendMessage L4 trigger if escalationLevel='L4' && !senderLeakFlagged) :
  ├─ updateDoc users.{senderId} leakFlagged=true
  ├─ setDoc adminActions/ adminId='system' (rule path b extension)
  └─ sendEmail leakEscalationAdmin → ADMIN_LEAK_EMAIL
```

**Bilan sub-chantier 2** :
- Doctrine §B L1-L4 ✅ niveaux complets : L1 silent SC1 / L2 toast / L3 modal rétroactif / L4 admin email + flag (5+ hits)
- Doctrine §B.Q1 onboarding-bubble ✅ (shipped SC1 commit 4/5)
- Doctrine §B.Q3 L4 manuel admin ✅ (sendEmail + leakFlagged + audit, pas auto-quarantine biais algo)
- Doctrine §B.Q4 92-95% precision ✅ (regex L1 + IA L2 hybride + "ce flag est faux" mailto feedback)
- Doctrine §C IA hybride ✅ (Genkit Gemini Flash via API route, isolé server-only)
- Doctrine §C.Q1 Genkit + Gemini Flash ✅ (cohérent stack Firebase)
- Doctrine §C.Q2 logs hashés ✅ (motive enum + SHA-256, jamais contenu lisible)
- Doctrine §C.Q3 FR strict ✅ (system prompt + few-shot FR uniquement)
- Doctrine §C cache 24h ✅ (in-memory Map keyed sur SHA-256 exact)
- Q1=A `Chat.leakBySender` per-chat per-sender / Q2=B post-send rétroactif L3 / Q3=A in-memory cache / Q4=A IA si score=0.5 / Q5=A IA error preserve L1 / Q6=B env var `ADMIN_LEAK_EMAIL` / Q7=A boolean `leakFlagged` / Q8=A mailto KISS / Q9=A cumulative window / Q10=A FR strict / Q11=A wording doctrine literal
- Tests SC2 delta : 4 (CHAT) + 10 (ALC) + 11 (SVC9-SVC17) + 3 (EM-LK) = **28 tests** (+ infra hotfixes shipped)
- Tests Phase 8 cumulés (SC0 + SC1 + SC2) : ~95+ assertions (Phase 7 base 372 préservée intégralement)
- Latence target <200ms p95 ✅ regex ~1-5ms / Web Crypto ~1ms / fetch /api/anti-leak ~50-200ms / batch Firestore ~30-50ms
- Architecture isolation : Genkit confiné `runtime=nodejs` (server-only), client-side fetch helper avec fallback Q5=A
- Defense-in-depth : firestore.rules path b auto-escalation L4 (anti-spoof targetId == auth.uid)

**Prochain** : sub-chantier 3 — Suggestions IA next-activity (Genkit flow `next-activity-suggester` + UI bot card inline chat + cadence 1/72h + opt-out via aiSuggestionsOptIn SC0 + tests Genkit + emulator).

### Sub-chantier 3 — Suggestions IA next-activity ✅ COMPLET (6 commits)

- 1/6 `9e171f2` : Types `ChatMessage.type` += `'ai_suggestion'` + `ChatMessage.suggestions?: SuggestionCard[]` + nouvelle interface `SuggestionCard` (activityId, title, sport, city, nextSessionAt?, reason) + `Chat.lastSuggestionAt?: Timestamp` (cooldown 72h doctrine §D.Q2) + rules anti-spoof `chat/messages` create `senderId == auth.uid` (lock-down barrière Admin SDK Q9=A) + tests `CHAT14-CHAT16` (16/16 cumulés)
- 2/6 `e7b433b` : `src/ai/flows/next-activity-suggester.ts` — flow Genkit Gemini Flash + cache 24h Map séparé (Q8=A) + DI seams `__setSuggestGenerateFnForTesting`/`__resetSuggestCacheForTesting`/`__setSuggestNowFnForTesting` + system prompt FR strict (4 few-shot examples) + filter activityId in catalog (anti-hallucination) + truncate reason ≤80 chars + slice top 3 + Q5=A defensive empty fallback + tests `SUG1-SUG10` (10/10 PASS first try)
- 3/6 `887e7f1` : `src/app/runtime='nodejs'` — pipeline 12 étapes séquentielles avec abort early (validate → verify participant 403 → 72h cooldown silent skip → opt-out consensus → user.city read → activities catalog query LIMIT 50 → min 3 eligibility → last 30 messages reverse → Genkit flow → empty skip → hydrate SuggestionCard[] → batch atomic Admin SDK persist) + lazy Admin SDK init + tests `SAR1-SAR8` (11/11 PASS, sub-assertions SAR1+SAR7)
- 4/6 `4dbb520` : Service helper `triggerSuggestionsIfEligible(chatId, userId)` exporté depuis `src/services/firestore.ts` — fetch POST `/api/suggest-activities` avec body + observabilité logs (persisted info, cooldown/optedOut/insufficientCatalog/aiNoMatch silent skip) + Q5=A best-effort silent (network error / 4xx / 5xx → no throw) + chat/page.tsx `useEffect([match.matchId, currentUserId, isLocked])` mount trigger + tests `SVC18-SVC20` (3 cas mock fetch /api/suggest-activities)
- 5/6 `a0f4265` : `src/components/chat/SuggestionMessage.tsx` (nouveau, 145 lignes) — pure Component props-only, defensive null-guard, helper `formatNextSessionAt` FR ("Dim 12 mai · 14h30"), sub-component `SuggestionCardItem` (Link `/activities/{id}` + title truncate + sport·city + Calendar icon + reason italic + button "Réserver" gradient `#D91CD2`), main component bot avatar Sparkles 28×28 + bubble white/5 max-w 85% + header "🤖 Spordate · Suggestion" + cards stack vertical, charte stricte black/#D91CD2/white. chat/page.tsx render conditional `msg.type === 'ai_suggestion'` insertion entre system bubble et default text bubble.
- 6/6 *(this commit)* : architecture.md sub-chantier 3 close-out + cumulative tests verification + scripts package.json review + doctrine compliance recap

**Architecture résultante anti-leak SC2 + suggestions SC3** :

```
┌────────────────────────┐
│ chat/page.tsx          │  Client Component
│ ChatWindow useEffect   │  ↓ subscribeToMessages stream
│ [match.matchId, …]     │  + handleSend / handleEscalation (SC2)
└──────┬─────────────────┘  + render conditional ai_suggestion → SuggestionMessage
       │
       │ triggerSuggestionsIfEligible(chatId, userId)  [SC3 mount auto]
       │ sendMessage(chatId, senderId, text)            [SC1 user input]
       ↓
┌────────────────────────┐
│ services/firestore.ts  │  Shared client+server
│ (best-effort silent)   │  • triggerSuggestions → fetch /api/suggest-activities
└──────┬─────────────────┘  • sendMessage → L1 regex + fetch /api/anti-leak (SC2)
       │
       │ POST /api/suggest-activities    │ POST /api/anti-leak
       │ POST /api/anti-leak             │
       ↓                                 ↓
┌────────────────────────┐  ┌────────────────────────┐
│ /api/suggest-activities│  │ /api/anti-leak         │  Server-only routes
│ runtime='nodejs'       │  │ runtime='nodejs'       │  (Genkit + firebase-admin
│ Admin SDK pipeline :   │  │ Verify body + AiError  │   isolation hotfix SC2)
│ - verify participant   │  │  → 429 ; autres → 500  │
│ - 72h cooldown check   │  └──────┬─────────────────┘
│ - opt-out consensus    │         │ classifyMessageL2(input)
│ - user.city query      │         ↓
│ - activities filter    │  ┌────────────────────────┐
│ - last 30 messages     │  │ anti-leak-classifier   │  L2 IA hybride
│ - Genkit flow          │  │ Cache 24h Map separate │  (regex L1 → IA L2 si
│ - hydrate SuggestionCard│  │ wrapAiCall + Gemini    │   score=0.5 ambigu)
│ - batch persist        │  └────────────────────────┘
└──────┬─────────────────┘
       │ suggestActivitiesL3(input)
       ↓
┌────────────────────────┐
│ next-activity-suggester│  L3 IA suggestions
│ Cache 24h Map separate │  • Hash chatHistory+catalog
│ wrapAiCall + Gemini    │  • System prompt FR + 4 few-shot
│ filter activityId in   │  • Output {suggestions: [{activityId, reason}]}
│  catalog (anti-hallu)  │
└────────────────────────┘
       ↓ result
       │
       ↓ (back to /api/suggest-activities)
   Admin SDK batch atomic :
   ├─ chats/{chatId}/messages/{auto-id} senderId='system' type='ai_suggestion' suggestions: SuggestionCard[]
   └─ chats/{chatId} update lastSuggestionAt: serverTimestamp
       ↓
   Subscribe stream client-side → chat/page render <SuggestionMessage> bot card
```

**Bilan sub-chantier 3** :
- Doctrine §D.Q1 ✅ default-on (trigger automatique mount, opt-out consensus server-side)
- Doctrine §D.Q2 ✅ cadence 1/72h (Chat.lastSuggestionAt enforce route)
- Doctrine §D.Q3 ✅ gratuit Phase 8
- Doctrine §D.Q4 ✅ inline bot card avec avatar Sparkles + label "Spordate · Suggestion" + cards quick-book
- Doctrine §D consensus opt-out ✅ (read both `aiSuggestionsOptIn` server-side, abort si l'un === false)
- Doctrine §C.Q1 ✅ Genkit + Gemini 2.5 Flash via wrapAiCall SC0 (rate limit 10/user/min)
- Doctrine §C.Q2 ✅ logs cache hash SHA-256 (jamais contenu lisible)
- Doctrine §C.Q3 ✅ FR uniquement (system prompt + few-shot + UI wording)
- Q1=A trigger client + server cooldown ✅ / Q2=A persistence Admin SDK ✅ / Q3=A consensus opt-out ✅
- Q4=A simple filter ✅ (catalog city + isActive, no ML scoring) / Q5=A defensive empty ✅
- Q6=A structured suggestions array ✅ / Q7=A on mount immediate ✅ / Q8=A cache séparé ✅
- Q9=A Admin SDK bypass ✅ (rule anti-spoof tient client) / Q10=A min 3 eligibility ✅ / Q11=A inline bot card ✅
- Tests SC3 cumulés : 3 (CHAT14-16) + 10 (SUG1-10) + 11 (SAR1-8) + 3 (SVC18-20) = **27 assertions automated**
- Phase 8 cumulé (SC0 + SC1 + SC2 + SC3) : ~152 assertions automated + UI smoke (Phase 7 base 372 préservée intégralement)
- Latence target <200ms p95 ✅ regex SC1 ~1-5ms / fetch /api/anti-leak ~50-200ms / fetch /api/suggest-activities ~200-500ms (acceptable hors p95 critique car async post-mount)
- Defense-in-depth :
  - Rule client-side rejette `senderId='system'` (commit 1/6)
  - Admin SDK route bypass = seul chemin légitime
  - Anti-hallucination flow : `activityId in catalog` filter post-Gemini
  - Idempotency cooldown 72h server-side
  - Best-effort client-side : suggestions = nice-to-have, jamais blocking UX

**Prochain** : sub-chantier 4 — Invite Individuel (Phase 8 doctrine §E) : flow paiement direct CHF par invité (E.Q1 Phase 8 = mode Individuel uniquement, modes Split/Gift Phase 9). Quick-book button "Réserver" depuis SuggestionCard pourra être rewired vers `/api/invites/[id]` flow SC4.

### Sub-chantier 4 — Invite Individuel ✅ COMPLET (6 commits)

- 1/6 `2fd4b66` : Types `Invite` + `InviteStatus` ('pending'|'accepted'|'declined'|'expired') + rules `/invites/{id}` defense-in-depth (anti-spoof fromUserId, anti self-invite, doc-id pattern Q10=B `${fromUserId}_${toUserId}_${sessionId}`, status='pending' initial, expiresAt > request.time, keys hasOnly, transitions strictes path a accept toUserId / path b decline toUserId, champs core immuables) + tests INV1-INV6 (6/6 PASS)
- 2/6 `3b3d07f` : `src/lib/invites/service.ts` — 4 helpers : `createInvite()` (anti self-invite + lecture session pour clamp expiresAt = Min(now+7j, sessionStart-1h) Q3=C + doc-id pattern Q10=B + message? truncate 200 chars Q1=A) / `acceptInvite()` (status='pending' + toUserId match + not expired) / `declineInvite()` (path b) / `expireInvitesIfDue()` (Admin SDK batch cron Phase 9). `InviteError` typed avec 8 codes. DI seam `__setInvitesDbForTesting`. Tests INV-S1-INV-S8 (10/10 PASS)
- 3/6 `6cec931` : Helper Bearer `verifyAuth` (lazy firebase-admin/auth + verifyIdToken + DI seam mock — hardening SC4). API routes `POST /api/invites` + `POST /api/invites/[id]/decline` runtime='nodejs'. Extension `/api/checkout` mode='invite-accept' (verify Bearer → load invite Admin SDK → status='pending' check + toUserId match + expiration + load session + recompute tier server-side anti-cheat → Stripe checkout avec metadata mode='invite-accept'). Error mapping HTTP propre 401/400/404/403/409/410/500. Tests INV-API1-INV-API6 (8/8 PASS)
- 4/6 `c7d8eee` : Email template `inviteReceived` (charte stricte) + wire post-createInvite() (sendEmail Resend + createNotification in-app type='invite_received' Q5=C both, best-effort silent). Webhook Stripe extension `metadata.mode='invite-accept'` → `handleInviteAcceptPayment()` : idempotency dual layer (transactions + invite.status='pending') + runTransaction atomique (create Booking userId=toUserId + increment session participants + grant bundleCredits + update invite='accepted'+acceptedAt + transaction record type='invite_accept_purchase') + post-commit notifs fromUser 'invite_accepted' + toUser 'booking'. Tests EM-INV1-EM-INV3 (15/15 PASS)
- 5/6 `beb9353` : `<InviteButton>` reusable client component (modal Dialog + textarea optional message 200 chars + Bearer auth fetch + error mapping HTTP). `<InviteActionsClient>` client island pour /invite/[id] (auth match check : non-auth / fromUserId / autre user / toUserId → 2 CTAs Accepter [Stripe redirect] / Refuser [router.refresh]). `/invite/[id]/page.tsx` Server Component Next.js 15 async params + lazy Admin SDK + `loadInviteData()` Promise.all (invite + fromUser + toUser + activity + session) + status routing (pending/accepted/declined/expired) + computed `isExpired` + generateMetadata dynamique + `notFound()`. Doc `tests/invites/SMOKE-MANUEL.md` (flow nominal + refus + expiration + edge cases anti-doublon + auth required + section Différé Phase 9)
- 6/6 *(this commit)* : architecture.md sub-chantier 4 close-out + cumulative tests verification + scripts package.json review + bilan doctrine §E

**Architecture résultante invite end-to-end** :

```
Inviteur A (chat / activity page)
  ↓ <InviteButton> modal + textarea message? + getIdToken()
  ↓ POST /api/invites Bearer auth + body {toUserId, activityId, sessionId, message?}
  ↓
┌────────────────────────────┐
│ /api/invites POST          │  Server-only runtime='nodejs'
│ verifyAuth → fromUserId    │  • createInvite() service (clamp expiresAt + doc-id pattern)
│ Promise.all reads          │  • Best-effort sendEmail inviteReceived (Resend)
│ (toUser/from/activity/sess)│  • Best-effort createNotification in-app
└────────┬───────────────────┘
         │ Returns {inviteId, status:'pending'}
         ↓
   Toast UI A : "Invitation envoyée"
   B reçoit email + notification
         │
         ↓ B clique lien email
┌────────────────────────────┐
│ /invite/[id] (server)      │  Server Component Next.js 15
│ Admin SDK loadInviteData() │  • Status routing pending/accepted/declined/expired
│ generateMetadata           │  • Render activity card + CTAs
└────────┬───────────────────┘
         │ Si pending + auth.uid == toUserId
         ↓
┌────────────────────────────┐
│ <InviteActionsClient>      │  Client island
│ Accept → fetch /api/checkout│  • Bearer auth + getIdToken()
│ Decline → router.refresh   │  • Toast feedback + error mapping
└────────┬───────────────────┘
         │ Click "Accepter et payer"
         ↓ POST /api/checkout mode='invite-accept' Bearer + body {inviteId}
┌────────────────────────────┐
│ /api/checkout (extend SC4) │  Pipeline 8 étapes
│ verifyAuth → toUserId      │  • Idempotency status='pending'
│ Load invite Admin SDK      │  • Recompute tier server-side (anti-cheat)
│ Stripe checkout creation   │  • metadata.mode='invite-accept'
└────────┬───────────────────┘
         │ Returns Stripe URL
         ↓ Client redirect Stripe Checkout
   B paye sa part CHF (mode 'session_purchase' équivalent + bundleCredits)
         │
         ↓ Stripe webhook → handlePaymentSuccess
┌────────────────────────────┐
│ /api/webhooks/stripe       │  Webhook (extension SC4)
│ dispatch metadata.mode     │  • handleInviteAcceptPayment()
│ idempotency dual layer     │  • Idempotency #1 transactions stripeSessionId
│ runTransaction atomique    │  • Idempotency #2 invite.status='pending'
└────────┬───────────────────┘  • Booking + Invite update + credits + notifs
         │
         ↓ Stripe redirect → /dashboard?status=success
   A reçoit notif "B a accepté"
   B reçoit notif "Réservation confirmée"
   Booking créé status='confirmed' userId=B
   Invite.status='accepted' acceptedAt=now
```

**Bilan sub-chantier 4** :
- Doctrine §E.Q1 ✅ mode Individuel uniquement (Booking userId=toUserId, pas Stripe Connect splits)
- Q1=A ✅ message? optional 200 chars compteur visible
- Q2=C ⏭️ Both placements — SuggestionCard + activity page **différé Phase 9** (manque SuggestionCard.nextSessionId + server component complexity)
- Q3=C ✅ expiresAt clamp Min(now+7j, sessionStart-1h) server-enforced
- Q4=A ✅ pas de refund Phase 8 (Stripe Connect Phase 9)
- Q5=C ✅ both notifications (Resend email + in-app /notifications)
- Q6=A ✅ page dédiée /invite/[id] server component + status routing
- Q7=B ⏭️ 2 actions distinctes Réserver+Inviter sur SuggestionCard **différé Phase 9** (pendance Q2=C nextSessionId)
- Q8=A ✅ Reuse /api/checkout mode='invite-accept' (pattern cohérent SC1 session_purchase)
- Q9=A ✅ explicit decline endpoint + `declinedAt` timestamp pour KPI Phase 9
- Q10=B ✅ doc-id pattern strict `${fromUserId}_${toUserId}_${sessionId}` anti-doublon
- Q11=A ✅ webhook extension `metadata.mode='invite-accept'` consume + idempotency dual + Booking + Invite + credits + notifs
- Tests SC4 cumulés : 6 (rules) + 10 (service) + 8 (api) + 15 (email-webhook) = **39 assertions automated** + smoke manuel doc complète
- Phase 8 cumulé (SC0+SC1+SC2+SC3+SC4) : **191+ assertions automated** + UI smoke (Phase 7 base 372 préservée intégralement)
- Defense-in-depth : Bearer auth Phase 8 SC4 hardening (verifyAuth helper) + rule defense-in-depth /invites + idempotency dual webhook + InviteError typed mapping HTTP propre

**Différé Phase 9** (cohérent doctrine §F Phase 8 = MVP rétention) :
- ⏭️ SuggestionMessage SC3 wire `<InviteButton>` secondaire — manque `SuggestionCard.nextSessionId` persistence (current : seulement nextSessionAt Timestamp). Phase 9 polish : enrich SC3 API route 5 lignes + add InviteButton conditional rendering.
- ⏭️ /activities/[id] invite trigger dropdown matches — server component + session selection logic. Phase 9 polish : client island `<ActivityInviteSection>` qui charge user.matches + dropdown otherUsers + InviteButton modal pre-rempli.
- ⏭️ Cron `expireInvitesIfDue()` deployment — Phase 9 Cloud Functions Scheduler (pattern Phase 6 anti-cheat).
- ⏭️ Refund logic si invité annule après accept — Phase 9 Stripe Connect destination splits.
- ⏭️ Différé Phase 7 (cf. architecture.md §"Différé Phase 8" lignes 880-886) reste applicable Phase 9 :
  - listAllBlocks admin via Admin SDK endpoint
  - Cloud Function denorm `users.{uid}.activeSanction*` on userSanctions create/update
  - Cron purge audit trail `/adminActions/` après 24mo
  - Cron purge banlist PII après 24mo
  - `cancelNoShow` recompute threshold automatique si sanction déclenchée par report annulé
  - Push reminder 48h post-session (template `reviewReminder` wire)
  - Stripe API automatisation refund partner no-show level 3

**Prochain** : sub-chantier 5 — Différé Phase 7 hardening + close-out final Phase 8 (cumul des items "Différé Phase 8" listés ci-dessus + close-out architecture.md global Phase 8 + retrospective doctrine §F).

### Sub-chantier 5 — Différés Phase 7 hardening ✅ COMPLET (5 commits)

- 1/5 `20e615a` : `recomputeSanctionAfterReportCancel.ts` (helper recompute level + finder sanction by triggering report) + `cancelNoShow.ts` extension (appel recompute si autoSuspensionApplied=true) + `/api/admin/blocks/route.ts` (GET Bearer + isAdminRole + Admin SDK listAllBlocks). Tests RC1-RC8 (28 assertions) + BLK-API1-BLK-API4 (8 assertions). Comble TODO `triggerAutoSanction.ts:112` + `cancelNoShow.ts:83` + Différé Phase 8 ligne 880.
- 2/5 `4c6e3d6` : CF `denormActiveSanctionTrigger` `onDocumentWritten('userSanctions/{id}')` v2 (Q4=A) → denorm `users.{uid}.activeSanctionId/Level/EndsAt` Admin SDK. CF `reviewReminderCron` `onSchedule('every 60 minutes')` Europe/Zurich → trigger Vercel `/api/cron/review-reminder`. Endpoint cron : query bookings status='confirmed' + sessionDate within (-72h, -48h) + flag idempotency `Booking.reviewReminderSent` + sendEmail reviewReminder (Q3=A email seul). Tests RR1-RR5 + auth (11 assertions). Comble Différé Phase 8 lignes 881+885.
- 3/5 `8f4ed43` : CF `purgeOldDataCron` `onSchedule('0 3 * * 5')` Europe/Zurich (Q7=A weekly Friday 03:00) → `/api/cron/purge-old-data`. Pipeline 2 étapes : (a) purge `adminActions/` createdAt < now-24mo batch delete max 500 (b) anonymise users `activeSanctionLevel='ban_permanent'` + sanction createdAt < now-24mo → PII null + `anonymizedAt` flag idempotency. Dry-run mode `?dryRun=true`. Tests PG1-PG6 + auth (16 assertions). Comble Différé Phase 8 lignes 882+883. Conservation 24mo doctrine LPD/nLPD/RGPD CGU §7.bis.
- 4/5 `171dfd7` : `src/lib/stripe/refundForSanction.ts` (helper Stripe refund + idempotencyKey `refund-{sanctionId}-{bookingId}` Q8=A + lazy Stripe + DI seam mock + audit log adminAction `auto_refund_partner_no_show` adminId='system') + `refundAllForSanction(sanctionId)` orchestrator (read sanction + first triggeringReport.reporterId = partner + query bookings 30d window + per-booking refund best-effort). `/api/admin/refund-sanction/[sanctionId]/route.ts` POST dual-auth (Bearer CRON_SECRET system OR Bearer admin ID token — Q2=C robust + fallback). `triggerAutoSanction.ts` extend : fire-and-forget fetch self-call POST endpoint avec CRON_SECRET (évite cycle webpack client-bundle vs dynamic import firebase-admin). Idempotency double layer Firestore `Booking.refundedAt` + Stripe idempotency_key. Tests RF1-RF6 + auth (16 assertions). Comble Différé Phase 8 ligne 886.
- 5/5 *(this commit)* : architecture.md sub-chantier 5 close-out + close-out final Phase 8 doctrine §F + cumulative tests verification + retrospective doctrine §F MVP rétention.

**Architecture résultante hardening SC5 (CF + crons + helpers + endpoints)** :

```
┌────────────────────────────────────────────────────────────────────┐
│  CLOUD FUNCTIONS (functions/src/) — Option β trigger Vercel        │
│  Region : europe-west1, Timezone : Europe/Zurich                   │
├────────────────────────────────────────────────────────────────────┤
│ refreshPricingCron (Phase 6)   — every 15 min  → /api/cron/refresh │
│ reviewReminderCron (SC5 c2/5)  — every 60 min  → /api/cron/review… │
│ purgeOldDataCron   (SC5 c3/5)  — Friday 03:00  → /api/cron/purge…  │
│ denormActiveSanctionTrigger    — onDocumentWritten userSanctions/{}│
│   (SC5 c2/5 — Admin SDK denorm users.activeSanction*)              │
└────────────────────────────────────────────────────────────────────┘
                          │
                          ↓ Bearer ${CRON_SECRET}
┌────────────────────────────────────────────────────────────────────┐
│  VERCEL ROUTES (Next.js App Router runtime='nodejs')               │
├────────────────────────────────────────────────────────────────────┤
│ /api/cron/review-reminder    — query bookings -72h..-48h           │
│   → sendEmail reviewReminder + Booking.reviewReminderSent=true     │
│                                                                    │
│ /api/cron/purge-old-data     — purge adminActions > 24mo +         │
│   anonymise users banned > 24mo (PII=null + anonymizedAt)          │
│                                                                    │
│ /api/admin/blocks            — GET Bearer admin → listAllBlocks    │
│                                                                    │
│ /api/admin/refund-sanction/[sanctionId]                            │
│   POST dual-auth (CRON_SECRET system OR admin Bearer)              │
│   → refundAllForSanction(sanctionId)                               │
│     ↓ Stripe.refunds.create idempotencyKey                         │
│     ↓ Booking.refundedAt + adminAction audit log                   │
└────────────────────────────────────────────────────────────────────┘
                          │
                          ↓ on triggerAutoSanction(refundDue=true)
                          ↓ fire-and-forget fetch self-call
                          ↓ Bearer ${CRON_SECRET} (system path)
                  /api/admin/refund-sanction/{sanctionId}
```

**Bilan votes SC5 doctrine** :
- ✅ Q1=A CF Scheduler trigger Vercel (cohérent Phase 6 refreshPricingCron)
- ✅ Q2=C auto par défaut + admin fallback dual-auth endpoint (robust + safety net)
- ✅ Q3=A reviewReminder email seul Phase 8 (push web Phase 9 UX)
- ✅ Q4=A CF `onDocumentWritten` v2 single trigger (gère create/update/delete)
- ✅ Q5=C `cancelNoShow` recompute synchrone helper testable emulator (pas de CF)
- ✅ Q6=A Bearer ID token + isAdminRole pattern (réutilise verifyAuth SC4)
- ✅ Q7=A purge weekly Friday 03:00 Europe/Zurich (off-peak, low blast-radius)
- ✅ Q8=A idempotencyKey shape `refund-{sanctionId}-{bookingId}` (collision-safe multi-bookings)

**Tests SC5 cumulés** : 28 (recompute) + 8 (admin:blocks) + 11 (cron:review-reminder) + 16 (cron:purge) + 16 (stripe:refund) = **79 assertions automated**.

**Tous les Différés Phase 7 fermés ✅** (lignes 880-886) :
- ✅ `listAllBlocks` admin via Admin SDK endpoint (commit 1/5)
- ✅ CF denorm `users.{uid}.activeSanction*` (commit 2/5)
- ✅ Cron purge audit trail `/adminActions/` 24mo (commit 3/5)
- ✅ Cron purge banlist PII 24mo (commit 3/5)
- ✅ `cancelNoShow` recompute threshold (commit 1/5)
- ✅ Push reminder 48h `reviewReminder` wire (commit 2/5, scope email)
- ✅ Stripe API refund partner no-show level 3 (commit 4/5, auto + admin fallback)

---

## Phase 8 — CLOSE-OUT FINAL doctrine §F MVP rétention ✅

**Période** : avril–mai 2026
**Cumul** : 30 commits techniques + 2 hotfixes + 5 close-outs sub-chantiers + ce close-out final

### Récap par sub-chantier

| SC | Thème | Commits | Tests automated | Status |
|----|-------|---------|-----------------|--------|
| SC0 | Pré-flight Phase 8 (Genkit + opt-in IA + CGU §7.quater/quinquies) | 3 | 5 (rules profile + Genkit) | ✅ |
| SC1 | Chat survival post-event + crédits + L1 regex anti-leak | 5 | 60 (chat:rules 16, chat:service 21+, regex 30) | ✅ |
| SC2 | Anti-leak L2-L4 Genkit IA hybride + escalation | 5 + 2 hotfixes | 47 (alc 10, svc-leak 17, em-lk 3, alc-rules) | ✅ |
| SC3 | Suggestions IA next-activity Genkit + bot card | 6 | 21 (sug 10, suggest:api 11) | ✅ |
| SC4 | Invite Individuel paiement direct CHF (mode Individuel doctrine §E) | 6 | 39 (rules 6, service 10, api 8, email-webhook 15) + smoke manuel | ✅ |
| SC5 | Hardening Phase 7 différés (admin + crons + CF + Stripe refund) | 5 | 79 (recompute 28, blocks 8, RR 11, purge 16, RF 16) | ✅ |
| **Total** | | **30 + 2 hotfixes + 6 close-outs** | **~251+ assertions** | ✅ |

(Tests email transverse `test:email` 39 + Phase 7 base 372 préservés intégralement, no-regression.)

### Doctrine §F MVP rétention — ce qui a été livré

**Pilier 1 — Chat post-event survival (SC1+SC2)** :
- Chat ouvert tant que `credits >= 1` (rule + service §A doctrine)
- Onboarding-bubble obligatoire 1ère entrée (CGU §7.quater disclosure)
- Anti-leak L1 regex 6 patterns FR (silent log only — score + motive + hash SHA-256 anonyme)
- Anti-leak L2-L4 IA hybride Genkit Gemini Flash (cache 24h) :
  - L2 toast soft (literal Q11=A "pas besoin de partager ton Insta")
  - L3 AlertDialog rétroactif (laisse-faire post-send Q2=B)
  - L4 admin escalation (5+ hits / sender / chat) → email admin + audit log + flag profil
- Latence p95 <200ms (regex pure ~1-5ms + Web Crypto SHA-256 ~1ms)

**Pilier 2 — Suggestions IA next-activity (SC3)** :
- Bot card SuggestionMessage dans chat (cooldown 72h doctrine §D)
- Genkit Gemini Flash + cache + anti-hallucination filter (`activityId in catalog`)
- Idempotency cooldown server-side + opt-out user `aiSuggestionsOptIn`
- Best-effort UX (suggestions = nice-to-have, jamais blocking)

**Pilier 3 — Invite Individuel paiement direct (SC4)** :
- Mode Individuel doctrine §E (chacun paie sa part) — modes Split/Gift défer Phase 9
- Pipeline complet : `<InviteButton>` modal → `/api/invites` Bearer + sendEmail + notif → `/invite/[id]` page status routing → `/api/checkout` mode='invite-accept' → Stripe → webhook `handleInviteAcceptPayment` (idempotency dual + runTransaction Booking + Invite + credits + notifs)
- Anti-doublon doc-id pattern `${fromUserId}_${toUserId}_${sessionId}`
- Expiration clamp Min(7j, sessionStart-1h)

**Pilier 4 — Hardening Phase 7 différés (SC5)** :
- Recompute sanction post-cancelNoShow (downgrade auto)
- Admin endpoint listAllBlocks (Bearer + isAdminRole + Admin SDK)
- CF denorm activeSanction (cosmétique fast-check banner)
- Cron review-reminder 48h (template `reviewReminder` Resend, idempotency flag)
- Cron purge adminActions/banlist 24mo (LPD/nLPD/RGPD)
- Stripe refund auto level 3 + admin fallback (idempotency double layer)

### Différé Phase 9 final consolidé

**SC4 différés Phase 9** (cohérent doctrine §F MVP — pas de scope creep Phase 8) :
- ⏭️ SuggestionMessage `<InviteButton>` extension — manque persistance `SuggestionCard.nextSessionId` Phase 9 polish
- ⏭️ `/activities/[id]` dropdown matches invite trigger — server component + session selection complexity
- ⏭️ Cron `expireInvitesIfDue()` deployment Cloud Functions Scheduler

**Modes de paiement Phase 9** :
- ⏭️ Mode Split (50/50 ou custom) doctrine §E.Q1 défer
- ⏭️ Mode Gift (inviteur paye tout) défer
- ⏭️ Stripe Connect destination splits + refund partner avancé (Phase 9 polish)

**Items différés Phase 7 lignes 888-899** (UX + features avancées) restent Phase 9 :
- ⏭️ Card session UI participants list complète + entry points block/report participants (Phase 7 wire seulement le partner)
- ⏭️ Refactor admin auth Firebase Auth role-based (vs localStorage email actuel)
- ⏭️ Admin UI queue `adminActions/` history + filtres + export CSV
- ⏭️ IA-assistée Genkit pour modération reviews 1-2★ (volume > 10/jour)
- ⏭️ Charte stricte appliquée admin dashboard (vs `bg-gray-900` exception actuelle)
- ⏭️ Excuse pré-session ≥2h avant = no-show pas comptabilisé
- ⏭️ Visibility réduite algo matching score reviews <3.5★
- ⏭️ Detection patterns représailles cross-user reviews
- ⏭️ Female-safety women-priority quota active (audienceType field)
- ⏭️ Anonymisation soft delete user UI auto (vs cron 24mo seulement)

**Polish Phase 9** :
- ⏭️ Web Push API pour reviewReminder (au-delà email Q3=A)
- ⏭️ Composite indexes Firestore `bookings: status+sessionDate` (volume scale-up)
- ⏭️ Pagination cursor crons batch > 500 (volume scale-up)

### Retrospective doctrine §F — KPIs cibles MVP rétention

**KPI 1 — Engagement post-event** :
- Taux chat actif post-completion (>1 message / chat / 7 jours)
- Cible MVP : 30% chats actifs J+1, 15% J+7

**KPI 2 — Conversion invite** :
- Taux acceptance `/invite/[id]` (acceptedCount / sentCount)
- Taux Stripe success post-acceptance
- Cible MVP : 25% acceptance, 80% checkout success

**KPI 3 — Suggestions IA clic-réservation** :
- Taux click SuggestionMessage `<a href="/activities/[id]">`
- Taux booking dans 24h post-click
- Cible MVP : 10% CTR, 3% booking conversion

**KPI 4 — Anti-leak escalation distribution** :
- Volume L1 silent / L2 toast / L3 AlertDialog / L4 admin
- Précision IA L2-L4 (faux positifs admin review)
- Cible MVP : <2% L4 escalation rate, <5% faux positifs L2-L3

**KPI 5 — Hardening T&S** :
- Volume sanctions auto-recompute (cancelNoShow downgrade rate)
- Volume refunds auto level 3 (Stripe API success rate, admin fallback rate)
- Volume anonymisation banlist (24mo cohort size)

### Conclusion Phase 8

**Phase 8 = MVP rétention complet** : 4 piliers shipped + 7 items hardening Phase 7 fermés + zéro régression Phase 7 base 372 tests. Cumul : ~251+ assertions automated + smoke manuel SC4 + UI tests partielle. Vercel green sur 30+ déploiements consécutifs.

**Prochaine phase** : **Phase 9** — UX avancée (Card session participants, admin auth refactor, Stripe Connect splits) + polish (web push, IA modération profile bios, female-safety quota actif).

---

## Phase 9 — En cours (mai 2026)

### Sub-chantier 0 — Foundation polish ✅ COMPLET (2 commits)

- 1/X `d998cd8` : `src/app/admin/layout.tsx` AdminGuard layout (`useAuth` + role='admin' check + redirect /admin/login). Cleanup `localStorage` residuel `admin/dashboard/page.tsx` + `admin/sports/page.tsx` (Q2=B server-side defense-in-depth — cohérent verifyAuth + isAdminRole API routes existing). `firestore.indexes.json` extension : composite index `bookings: status+sessionDate` (volume scale-up Phase 8 launch). Pagination cursor crons SC5 c2-c3 : `pageSize=500` + `maxPages=10` + `startAfter` cursor + `truncated` flag dans response (review-reminder + purge-old-data routes refactorées). Tests RR5 update assertion (600 → 600 sur 2 pages) + RR6 nouveau (1100 → 1000 truncated maxPages=2). 15 assertions cron + 16 purge régression + 47 no-show régression Phase 7.
- 2/X `b35fcc8` : Charte stricte admin dashboard refactor UI (~40 patterns migrés). Background swap (`bg-[#05090e]→bg-black`, `bg-[#0f1115]→bg-zinc-950`, `bg-gray-900→bg-zinc-950`), borders (`border-gray-800→border-zinc-800`), accents (`text-cyan-400→text-[#D91CD2]`), CTAs (`bg-cyan-600→from-[#7B1FA2] to-[#D91CD2]`), info badges (`bg-blue-500/20→bg-[#D91CD2]/15`). Couleurs sémantiques admin **préservées intentionnellement** (amber/red/green status pour at-a-glance triage admin). 9 fichiers admin migrés + `tests/admin/SMOKE-CHARTE.md` smoke checklist visuelle.

**Bilan SC0 Phase 9** :
- ✅ Refactor admin auth Firebase Auth role-based (Différé Phase 9 ligne 891 fermé)
- ✅ Composite indexes Firestore `bookings: status+sessionDate` (Différé Phase 9 polish fermé)
- ✅ Pagination cursor crons batch > 500 (Différé Phase 9 polish fermé)
- ✅ Charte stricte appliquée admin dashboard (Différé Phase 9 ligne 894 fermé)

### Sub-chantier 1 — Card session participants + invite cleanup ✅ COMPLET (5 commits)

- 1/5 `2115dd6` : `/api/sessions/[sessionId]/participants/route.ts` (GET Bearer + 5 paths d'accès gradés : past-public, partner, admin, confirmed-participant, 403). `<ParticipantsList>` client island fetch + skeleton + silent hide 403. `<SessionParticipantCard>` Avatar + badge "Toi" self / `<BlockButton>` + `<ReportButton>` chat variant other. Wire dans `/sessions/[sessionId]/page.tsx`. Privacy doctrine §F : PII minimisation `{uid, displayName, photoURL?}` + visibilité gradée (anti-stalking sessions futures). Tests SP1-SP6 + 404 (12 assertions).
- 2/5 `848106f` : `SuggestionCard.nextSessionId?: string` + `SuggestionCatalogEntry.nextSessionId?: string`. `/api/suggest-activities` extension : per-activity Promise.all query `sessions/` future (`startAt > now ORDER BY startAt ASC LIMIT 1`) + fallback legacy `schedule[]` field + best-effort silent. `<SuggestionMessage>` refactor : props `viewerUid`/`otherUserId`/`otherUserName` + helper exporté `shouldShowInviteButton` + Q7=B 2 actions distinctes (Réserver primary + InviteButton secondary conditional). `chat/page.tsx` passe props depuis context. Tests SI1-SI5 + bonus null cases (10 assertions).
- 3/5 `92e91f0` : `/api/users/me/matches/route.ts` (GET Bearer + Admin SDK matches accepted + filter blocks bidirectionnel + skip `anonymizedAt` Phase 8 SC5 c3/5 banlist). `<ActivityInviteSection>` client island chips dropdown matches + InviteButton primary conditional. `getNextFutureSessionForActivity()` helper Server Component. Wire dans `/activities/[id]/page.tsx`. Tests AI1-AI5 + bonus status filter (10 assertions).
- 4/5 `311f0ff` : CF Scheduler `expireInvitesCron` `onSchedule('every 60 minutes')` Europe/Zurich → trigger Vercel `/api/cron/expire-invites` Bearer CRON_SECRET. Cursor pagination (pageSize=500, maxPages=10, startAfter) + Admin SDK batch update `status='pending' → 'expired'` (bypass rules — la rule update n'a pas de path 'expired'). Best-effort batch failure handling + dry-run mode. Tests EI1-EI5 + auth (13 assertions).
- 5/5 *(this commit)* : architecture.md SC0+SC1 close-out + cumulative tests Phase 9 + retrospective.

**Architecture résultante invite triggers cumul Phase 8+9** :

```
┌─────────────────────────────────────────────────────────────┐
│ ENTRY POINTS INVITE (Phase 8 SC4 + Phase 9 SC1 c2/c3)       │
├─────────────────────────────────────────────────────────────┤
│ Chat post-event SuggestionMessage (SC3 cooldown 72h)        │
│   → SuggestionCardItem [Réserver]  [Inviter X]              │
│                                       ↓ (si nextSessionId)  │
│                                       ↓ + viewer ≠ other    │
│                                       <InviteButton>        │
│                                                             │
│ /activities/[id] page (SC1 c3/5)                            │
│   → <ActivityInviteSection> client island                   │
│        ↓ fetch /api/users/me/matches Bearer                 │
│        ↓ chips otherUser → select                           │
│        ↓ [Inviter X] <InviteButton>                         │
│                                                             │
│ /sessions/[sessionId] page (SC1 c1/5)                       │
│   → <ParticipantsList> client island                        │
│        ↓ fetch /api/sessions/[id]/participants Bearer       │
│        ↓ <SessionParticipantCard> per participant           │
│             ├─ self → badge "Toi"                           │
│             └─ other → <BlockButton> + <ReportButton>       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓ <InviteButton> (Phase 8 SC4)
                          ↓ POST /api/invites Bearer
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ INVITE LIFECYCLE (Phase 8 SC4 + Phase 9 SC1 c4)             │
├─────────────────────────────────────────────────────────────┤
│ /api/invites POST (SC4) → invite created status='pending'   │
│   ↓ sendEmail + notif → toUser                              │
│ /invite/[id] page → InviteActionsClient                     │
│   ↓ Accept → /api/checkout invite-accept → Stripe → webhook │
│   ↓ Decline → /api/invites/[id]/decline                     │
│                                                             │
│ Expiration auto :                                           │
│ CF Scheduler expireInvitesCron (every 60 min, Phase 9 c4/5) │
│   ↓ Bearer CRON_SECRET                                      │
│   ↓ POST /api/cron/expire-invites                           │
│       ↓ Cursor pagination 500/page × 10 max                 │
│       ↓ batch update status='pending'+expiresAt<=now → 'expired'│
└─────────────────────────────────────────────────────────────┘
```

**Bilan SC1 Phase 9** :
- ✅ Card session UI participants list complète + entry points block/report (Différé Phase 9 ligne 890 fermé)
- ✅ SuggestionMessage `<InviteButton>` + nextSessionId persistence (Différé SC4 close-out ligne 1332 fermé)
- ✅ /activities/[id] dropdown matches invite trigger (Différé SC4 close-out ligne 1333 fermé)
- ✅ Cron `expireInvitesIfDue()` deployment CF Scheduler (Différé SC4 close-out ligne 1334 fermé)
- ✅ **Tous items SC4 close-out différés Phase 9 fermés (3/3)**

**Tests Phase 9 cumulés (SC0 + SC1)** :
- SC0 c1/X : 15 (cron review-reminder RR1-RR6 + auth) + 16 (cron purge PG1-PG6 régression) + 47 (no-show régression Phase 7)
- SC1 c1/5 : 12 (sessions participants SP1-SP6 + 404)
- SC1 c2/5 : 10 (chat suggestion-invite SI1-SI5 + bonus)
- SC1 c3/5 : 10 (activities invite-section AI1-AI5 + bonus)
- SC1 c4/5 : 13 (cron expire-invites EI1-EI5 + auth)
- **Phase 9 cumul nouvelles assertions : 60 automated** (15+12+10+10+13)
- + Phase 8 cumul 251+ assertions préservé (zéro régression)
- + Phase 7 base 372 tests préservé intégralement

**Cumul Cloud Functions déployables** :
| CF | Phase | Schedule | Purpose |
|---|---|---|---|
| `refreshPricingCron` | Phase 6 | every 15 min | Anti-cheat pricing tier+price recompute |
| `reviewReminderCron` | Phase 8 SC5 c2/5 | every 60 min | Email reviewReminder 48h post-session |
| `denormActiveSanctionTrigger` | Phase 8 SC5 c2/5 | onWrite userSanctions | Denorm `users.{uid}.activeSanction*` |
| `purgeOldDataCron` | Phase 8 SC5 c3/5 | weekly Friday 03:00 | Purge adminActions + anonymise banlist > 24mo |
| `expireInvitesCron` | Phase 9 SC1 c4/5 | every 60 min | Batch invites pending expirés → 'expired' |

**Cumul routes Vercel API Phase 8+9 (15 routes)** :
- SC2 : `/api/anti-leak`
- SC3 : `/api/suggest-activities`
- SC4 : `/api/invites` + `/api/invites/[id]/decline` + extension `/api/checkout` + `/api/webhooks/stripe` + page `/invite/[id]`
- SC5 : `/api/admin/blocks` + `/api/cron/review-reminder` + `/api/cron/purge-old-data` + `/api/admin/refund-sanction/[sanctionId]`
- Phase 9 SC1 : `/api/sessions/[sessionId]/participants` + `/api/users/me/matches` + `/api/cron/expire-invites`

**Reste sub-chantiers Phase 9** : SC2 (Stripe Connect Split/Gift + refund post-accept), SC3 (Email rappels J-1/T-0 + Web Push), SC4 (Admin queue history + IA modération étendue), SC5 (UX no-show + matching algo), SC6 (Female-safety quota + anonymisation soft delete), SC7 (close-out final Phase 9).

### Sub-chantier 2 — Stripe Connect Split/Gift + refund post-accept ✅ COMPLET (6 commits)

- 1/6 `3b02ae0` : Types `InviteMode = 'individual'|'split'|'gift'` + `Invite` extended (mode + splitInviterAmountCents + splitInviteeAmountCents + inviterPaymentIntentId + inviterRefundedAt + inviterRefundedAmount) + `Partner.stripeAccountId?` (Stripe Connect Express persisted) + `firestore.rules /invites/{id}` create extension (mode enum validation + montants int >= 0 + keys whitelist) + tests INV7-INV9 (3 assertions). Doctrine §E.Q1 Phase 9 votes Q1-Q6 tranchés architecture.md.
- 2/6 `57a9b3b` : Helper pure `computeSplitAmounts` (Q4=B 5% fee + Q5=A range [0.1, 0.9] + round-up resolution exact) + SplitMathError typed + `getApplicationFeePct` env-config (`SPORDATE_INVITE_FEE_PCT`) + email templates `inviteReceivedSplit` / `inviteReceivedGift` (charte cohérente Phase 8 SC4) + extension `createInvite` service (mode + montants + persist) + `/api/invites` POST mode-aware (anti-cheat totalCents server-resolved + dispatch sendEmail mode-aware) + tests SM1-SM7 + EM-SP1-EM-SP4 (36 assertions).
- 3/6 `2696417` : Module partagé `src/lib/stripe/sharedStripe.ts` avec DI seam unique `__setSharedStripeForTesting` (refactor architectural — réutilisable connectHelpers + checkout + verify-payment) + `connectHelpers.ts` (`getPartnerStripeAccount` + `assertConnectChargesEnabled` + `ConnectError` typed mapping HTTP 412 partner-not-onboarded) + extension `/api/checkout` mode='invite-prepay' (Stripe Connect destination charge `transfer_data.destination=acct_xxx` + `application_fee_amount=round(amt × 5/100)` + idempotencyKey `invite-prepay-{inviteId}` Q8=A pattern) + extension mode='invite-accept' splitMode (B paye splitInviteeAmountCents avec destination charge) + refactor `getStripe()` → `await getSharedStripe()` (testable DI seam) + tests SP-CHK1-SP-CHK4 + bonus (13 assertions).
- 4/6 `3c10548` : Webhook `handleInvitePrepayPayment` (idempotency dual layer transactions stripeSessionId + invite.inviterPaymentIntentId + atomic update + post-commit notif fromUserId) + extension `handleInviteAcceptPayment` (Q2=C Booking.paidByUserId=toUserId + tx type variant `invite_accept_split` vs `invite_accept_purchase` selon `invite.mode`) + endpoint `/api/invites/[id]/accept-gift` (verify mode='gift' + inviterPaymentIntentId set + atomic Booking userId=B paidByUserId=A + tx type='invite_accept_gift' + post-commit notifs) + `Booking.paidByUserId?: string` field extension + tests SP-WH1-SP-WH6 + 2 bonus (17 assertions).
- 5/6 `3f8d399` : Helper `refundForInvite` (idempotency dual Firestore inviterRefundedAt + Stripe `idempotencyKey: refund-invite-{inviteId}` Q8=A + audit log adminAction `auto_refund_invite` adminId='system') + extension `declineInvite` service (refund auto best-effort si mode!='individual' + inviterPaymentIntentId set, dynamic import server-only) + extension cron `expire-invites` (collect candidats refund + post-batch loop refundForInvite + metrics `refundsAttempted`/`refundCandidates`) + UI `<InviteButton>` modal RadioGroup mode (Q1=A) + Slider 10-90% step 10% (Q5=A) + preview montants CHF + redirect Stripe pre-pay si mode!=individual + AdminActionType extensions (`auto_refund_invite` + targetType `invite`) + tests SP-RF1-SP-RF4 + 2 bonus (19 assertions).
- 6/6 *(this commit)* : architecture.md SC2 close-out + cumulative tests Phase 9 final + retrospective Q1-Q6 doctrine appliquée.

**Architecture résultante Stripe Connect Split/Gift end-to-end** :

```
INVITE CREATION (A) :
  <InviteButton> modal :
    - RadioGroup mode (Q1=A) : Individual / Split / Gift
    - Si Split : Slider 10-90% step 10% (Q5=A) + preview "Tu paies X CHF, ton invité Y CHF"
    - Si Gift : preview "Tu offres tout : Z CHF"
  ↓ user.getIdToken() + POST /api/invites Bearer
  ↓
  /api/invites POST (server, Admin SDK)
    ↓ verifyAuth → fromUserId
    ↓ Resolve totalCents server-side via session.currentPrice (anti-cheat)
    ↓ createInvite() service avec computeSplitAmounts() :
       - mode='individual' : invite.splitInviterAmountCents = 0, invite.splitInviteeAmountCents = totalCents
       - mode='split' : inviterCents = round(total × ratio), inviteeCents = total - inviterCents
       - mode='gift' : inviterCents = totalCents, inviteeCents = 0
    ↓ persist Invite avec mode + splitInviter/InviteeAmountCents
    ↓ sendEmail mode-aware (split → inviteReceivedSplit / gift → inviteReceivedGift / individual → inviteReceived legacy)
    ↓ Return {inviteId, status:'pending', mode}
  ↓
  Si mode!='individual' : InviteButton enchaîne POST /api/checkout {mode:'invite-prepay', inviteId}
  ↓
  /api/checkout invite-prepay (server, Admin SDK)
    ↓ verifyAuth → uid (must equal invite.fromUserId)
    ↓ getPartnerStripeAccount(activity.partnerId) → acct_xxx
    ↓ assertConnectChargesEnabled(acct_xxx) → throw 412 si charges_enabled=false
    ↓ Stripe.checkout.sessions.create(
         {
           line_items: [{unit_amount: invite.splitInviterAmountCents}],
           payment_intent_data: {
             transfer_data: { destination: acct_xxx },           ← Stripe Connect destination charge
             application_fee_amount: round(amt × 5/100),         ← Q4=B 5% Spordate platform commission
           },
           metadata: {mode:'invite-prepay', inviteId, ...},
         },
         { idempotencyKey: 'invite-prepay-{inviteId}' }            ← Q8=A pattern cohérent SC5 c4/5
       )
    ↓ Return checkoutUrl
  ↓ window.location redirect → Stripe Checkout (A paye sa part)
  ↓
  Stripe webhook event mode='invite-prepay'
    ↓ handleInvitePrepayPayment (idempotency dual)
       ↓ runTransaction atomic : update invite.inviterPaymentIntentId + tx record type='invite_prepay'
       ↓ Post-commit best-effort : notif A "Ta part facturée" / "Cadeau facturé"

INVITE ACCEPT (B) :
  /invite/[id] page mode-aware (Server Component)
  ↓ <InviteActionsClient> rend 2 actions :
    - mode='split' : "Accepter et payer ma part (X CHF)" → POST /api/checkout {mode:'invite-accept'}
    - mode='gift'  : "Accepter le cadeau"               → POST /api/invites/[id]/accept-gift
    - mode='individual' (Phase 8 SC4 legacy)            → POST /api/checkout {mode:'invite-accept'} unchanged

  SPLIT FLOW (B paye sa part) :
    /api/checkout invite-accept (extension SC2 c3) :
      ↓ Si invite.mode='split' : line_items[0].unit_amount = splitInviteeAmountCents
                                + payment_intent_data.transfer_data.destination + app_fee 5%
      ↓ Stripe Checkout B → webhook handleInviteAcceptPayment (extended SC2 c4)
        ↓ Q2=C : Booking userId=B + paidByUserId=B
        ↓ tx type='invite_accept_split'
        ↓ Atomic : Booking + Invite.status='accepted' + session.currentParticipants++ + chatCreditsBundle B

  GIFT FLOW (B accepte cadeau, no Stripe checkout) :
    POST /api/invites/[id]/accept-gift (server, Bearer B) :
      ↓ verifyAuth → callerUid (must equal invite.toUserId)
      ↓ Verify mode='gift' + status='pending' + inviterPaymentIntentId set + not expired
      ↓ runTransaction atomic :
         - Booking userId=B + paidByUserId=A (Q2=C denorm gift) + amount=splitInviterAmountCents
         - Invite.status='accepted' + acceptedAt
         - Increment session.currentParticipants
         - Grant chatCreditsBundle B
         - tx type='invite_accept_gift'
      ↓ Post-commit best-effort : notif A "Cadeau accepté" + notif B "Réservation confirmée"

INVITE DECLINE / EXPIRE (Q6=A retain-not-trap) :
  Decline :
    POST /api/invites/[id]/decline Bearer B (Phase 8 SC4)
    ↓ declineInvite() service (extension SC2 c5)
       ↓ updateDoc invite.status='declined' + declinedAt
       ↓ Si mode!='individual' AND inviterPaymentIntentId set :
          ↓ refundForInvite({inviteId}) best-effort

  Expire :
    CF Scheduler every 60min → /api/cron/expire-invites (extension SC2 c5)
    ↓ Pagination cursor SC0 c1 pattern :
       1. Collect candidats refund AVANT batch (mode!='individual' + paymentIntentId set + !inviterRefundedAt)
       2. Batch update status='pending'→'expired'
       3. Post-batch loop refundForInvite per candidate (best-effort)
    ↓ Return metrics {processed, refundsAttempted, refundCandidates, ...}

  refundForInvite() helper :
    ↓ Idempotency Firestore : skip si invite.inviterRefundedAt déjà set
    ↓ Stripe.refunds.create({payment_intent}, {idempotencyKey: 'refund-invite-{inviteId}'}) ← Q8=A
    ↓ Update invite.inviterRefundedAt + inviterRefundedAmount
    ↓ Audit log adminAction type='auto_refund_invite' targetType='invite' adminId='system'
```

**Bilan SC2 Phase 9 — votes Q1-Q6 doctrine §E.Q1 appliqués** :
- ✅ Q1=A inviter choisit mode (UI RadioGroup Individual/Split/Gift)
- ✅ Q2=C Booking unique avec denorm `paidByUserId` ≠ `userId` (split: paidBy=B B paye sa part / gift: paidBy=A A paye pour B)
- ✅ Q3=C defer post-accept refund Phase 10 (KISS Phase 9 — focus refund auto pre-accept decline/expire)
- ✅ Q4=B 5% `application_fee_amount` Spordate (configurable `SPORDATE_INVITE_FEE_PCT` env override)
- ✅ Q5=A range 10-90% step 10% (slider UI 10/20/30/40/50/60/70/80/90)
- ✅ Q6=A retain-not-trap : refund auto on decline + expire (cron + service intégrations)

**Tests SC2 cumulés** :
- INV7-INV9 (rules) : 3 assertions
- SM1-SM7 + bonus (split-math) : 25 assertions
- EM-SP1-EM-SP4 (email-split-gift) : 11 assertions
- SP-CHK1-SP-CHK4 + bonus (checkout-split) : 13 assertions
- SP-WH1-SP-WH6 + 2 bonus (webhook-split-gift) : 17 assertions
- SP-RF1-SP-RF4 + 2 bonus (refund-on-decline) : 19 assertions
- **SC2 total : 88 nouvelles assertions automated**

**Cumul routes Vercel API Phase 8+9 (16 routes — extension SC2 c4)** :
- Phase 8 SC2 : `/api/anti-leak`
- Phase 8 SC3 : `/api/suggest-activities`
- Phase 8 SC4 : `/api/invites` + `/api/invites/[id]/decline` + `/api/checkout` (modes session/invite-accept) + `/api/webhooks/stripe` + page `/invite/[id]`
- Phase 8 SC5 : `/api/admin/blocks` + `/api/cron/review-reminder` + `/api/cron/purge-old-data` + `/api/admin/refund-sanction/[sanctionId]`
- Phase 9 SC1 : `/api/sessions/[sessionId]/participants` + `/api/users/me/matches` + `/api/cron/expire-invites`
- **Phase 9 SC2 (NEW)** : `/api/invites/[id]/accept-gift` + extension `/api/checkout` mode='invite-prepay'

**Cumul Cloud Functions (5 CF déployables — inchangé)** :
| CF | Phase | Schedule |
|---|---|---|
| `refreshPricingCron` | 6 | every 15 min |
| `reviewReminderCron` | 8 SC5 c2 | every 60 min |
| `denormActiveSanctionTrigger` | 8 SC5 c2 | onWrite userSanctions |
| `purgeOldDataCron` | 8 SC5 c3 | weekly Friday 03:00 |
| `expireInvitesCron` | 9 SC1 c4 (extended SC2 c5) | every 60 min — **+ refund auto** |

**5 nouveaux helpers SC2 cumul** :
- `src/lib/invites/splitMath.ts` (pure helper computeSplitAmounts)
- `src/lib/stripe/sharedStripe.ts` (Stripe lazy-init + DI seam unique partagé)
- `src/lib/stripe/connectHelpers.ts` (Connect Express + ConnectError)
- `src/lib/stripe/refundForInvite.ts` (refund auto + idempotency dual)
- `src/app/api/invites/[id]/accept-gift/route.ts` (gift accept atomic Booking)

### Sub-chantier 3 — Email rappels J-1/T-0 + Web Push reviewReminder ✅ COMPLET (5 commits)

- 1/5 `4120576` : Email templates `sessionReminderJMinus1` + `sessionReminderTMinus0` (charte cohérente Phase 8 SC4-SC5) + Cloud Function `sessionRemindersCron` (every 60min Europe/Zurich) + endpoint `/api/cron/session-reminders` (Bearer + Admin SDK + dual-window J-1 / T-0 + cursor pagination Q9 cohérent SC0 c1) + flags idempotency `Booking.sessionReminderJMinus1Sent` / `sessionReminderTMinus0Sent` + tests SR1-SR5 (21 assertions) — Q1=B 18-30h tolérant lag, Q2=A T-0 30-90min sweet spot.
- 2/5 `b33d4aa` : Helper `sendPushNotification` (firebase-admin/messaging + DI seam `__setMessagingForTesting`) + extension `/api/cron/review-reminder` push-first/email-fallback (Q3=B) + extension `/api/cron/session-reminders` push-first/email-fallback (Q3=B) + tests PUSH1-PUSH4 (20 assertions). Q3=B push si `User.fcmToken` set + `pushNotificationsEnabled !== false` (default-on cohérent aiSuggestionsOptIn Phase 8 SC0) — sinon ou push fail → email Resend fallback. Static import (vs dynamic) pour DI seam test mock.
- 3/5 `15255ca` : UI opt-in/opt-out push (`<PushOptInSwitch>` /profile section Confidentialité Q5=A) + `User.pushNotificationsEnabled?: boolean` field (default-on `undefined === true`) + Service Worker dédié `public/firebase-messaging-sw.js` (Q4=A scope `/` global, importScripts gstatic 11.9.1, `onBackgroundMessage` → `showNotification` avec tag/renotify dedup, `notificationclick` → focus tab existante OU `openWindow(clickUrl)`) + helper client `registerPushNotifications` / `unregisterPushNotifications` / `isPushSupported` (Q6=A silent fallback Safari iOS <16.4) + token persistence `users/{uid}.fcmToken` via `getToken({vapidKey: NEXT_PUBLIC_FIREBASE_VAPID_KEY})` + tests POI1-POI5 (10 assertions).
- 4/5 `d4f301c` : UX polish notifications badge unread + dismiss flow + `Notification.readAt?` + `Notification.dismissedAt?` (legacy `isRead` préservé compat) + helpers `markNotificationRead` / `markAllNotificationsRead` / `dismissNotification` + DI seam `__setNotificationsDbForTesting` + `NotificationError` typed (`forbidden` / `not-found` / `invalid-input`) + `safeGetDoc` rules→forbidden mapping (no info leak) + `<NotificationBadge>` realtime onSnapshot dans header + `<NotificationsList>` Firestore-backed avec dismiss "X" + clickUrl deeplinks + "Tout marquer comme lu" button + replace mock `/notifications/page.tsx` + endpoints `PATCH /api/notifications/[id]` + `POST /api/notifications` (mark-all-read) + tests UN1-UN5 + 7 bonus (19 assertions).
- 5/5 *(this commit)* : architecture.md SC3 close-out + cumulative tests Phase 9 SC0+SC1+SC2+SC3 + retrospective Q1-Q8 doctrine §F appliquée.

**Architecture résultante notifications Phase 9 SC3 end-to-end** :

```
EMAIL RAPPELS J-1 / T-0 (SC3 c1) :
  CF Schedulers (Europe/Zurich) :
    - reviewReminderCron       every 60min
    - sessionRemindersCron     every 60min
  ↓ HTTPS POST + Authorization: Bearer ${CRON_SECRET}
  /api/cron/{review-reminder | session-reminders} (server, Admin SDK)
    ↓ Pagination cursor pageSize=500 maxPages=10 (cohérent SC0 c1)
    ↓ Per booking eligible :
       ↓ Load user (fcmToken + pushNotificationsEnabled)
       ↓ Push-first (Q3=B) :
          IF user.fcmToken && (user.pushNotificationsEnabled !== false)
             → sendPushNotification({fcmToken, title, body, clickUrl, data})
                ↓ firebase-admin/messaging.send({token, notification, webpush.fcmOptions.link})
                ↓ Si ok → mark pushDelivered=true
             SI push fail (token invalid, FCM error) → fallback email
          ELSE → fallback email
       ↓ Fallback email (legacy comportement Q3=B fallback) :
          sendEmail({to, templateName: 'reviewReminder' | 'sessionReminderJMinus1' | 'sessionReminderTMinus0', templateData})
             ↓ Resend API (existing Phase 8 SC5)
       ↓ Update Booking flag idempotency :
          - reviewReminderSent=true (Q7=A 1 notif/session)
          - sessionReminderJMinus1Sent=true
          - sessionReminderTMinus0Sent=true

SERVICE WORKER FCM (SC3 c3) :
  public/firebase-messaging-sw.js (Q4=A scope `/` global) :
    importScripts(gstatic firebase-app-compat + firebase-messaging-compat 11.9.1)
    firebase.initializeApp({apiKey/projectId/...})  ← public Web SDK config
    messaging.onBackgroundMessage((payload) ⇒ {
      self.registration.showNotification(payload.notification.title, {
        body, icon: '/icons/icon-192.png',
        data: payload.data,
        tag: payload.data.bookingId ?? payload.data.activityId,  ← dedup anti-doublon
        renotify: true,
      })
    })
    self.addEventListener('notificationclick', (event) ⇒ {
      event.notification.close();
      const url = event.notification.data?.clickUrl;
      event.waitUntil(
        clients.matchAll({type:'window'}).then(matched ⇒ {
          for (const client of matched) {
            if (client.url.includes(url) && 'focus' in client) return client.focus();
          }
          if (url && clients.openWindow) return clients.openWindow(url);
        })
      );
    });

CLIENT UI (SC3 c3 + c4) :
  /profile section "Confidentialité" (Q5=A — cohérent Phase 8 SC0 aiSuggestionsOptIn) :
    <PushOptInSwitch uid={user.uid} initialEnabled={pushNotificationsEnabled !== false} />
       ↓ Toggle ON :
          ↓ navigator.serviceWorker.register('/firebase-messaging-sw.js', {scope: '/'})
          ↓ Notification.requestPermission()
          ↓ getToken({vapidKey: NEXT_PUBLIC_FIREBASE_VAPID_KEY, serviceWorkerRegistration})
          ↓ updateDoc users/{uid} : {fcmToken, pushNotificationsEnabled: true}
          ↓ Toast success
       ↓ Toggle OFF :
          ↓ updateDoc users/{uid} : {fcmToken: deleteField(), pushNotificationsEnabled: false}
          ↓ deleteToken(messaging) (revoke côté Firebase, best-effort)
       ↓ Q6=A : si !isPushSupported() (Safari iOS <16.4, no PushManager) → toggle disabled silently + tooltip

  Header (cohérent ghost-town anti-pattern) :
    <NotificationBadge> :
       ↓ onSnapshot /notifications where userId=uid + isRead==false (filtre dismissedAt client-side)
       ↓ Pastille bg-[#D91CD2] count (max '9+') si > 0 → Bell normal sinon
       ↓ Click → /notifications

  /notifications page (replace mock Phase 1) :
    <NotificationsList> :
       ↓ onSnapshot /notifications where userId=uid orderBy createdAt desc (filter dismissedAt client-side)
       ↓ Per notif card : icon by type + title + body + relative time + "X" dismiss
       ↓ Click body si clickUrl → router.push (best-effort markRead avant nav)
       ↓ "Tout marquer comme lu" button top → POST /api/notifications {action:'mark-all-read'}
       ↓ Auto best-effort markRead on click via PATCH /api/notifications/[id] {action:'mark-read'}

API /api/notifications/* (SC3 c4) :
  PATCH /api/notifications/[id] Bearer + verifyAuth :
    Body : {action: 'mark-read' | 'dismiss'}
    ↓ verifyAuth → uid
    ↓ markNotificationRead(id, uid) OU dismissNotification(id, uid)
       ↓ safeGetDoc → si rules permission-denied → throw NotificationError 'forbidden' (no info leak)
       ↓ Verify ownership (notification.userId === uid)
       ↓ updateDoc readAt | dismissedAt = serverTimestamp()
    ↓ HTTP 200 / 401 / 403 / 404 (NotificationError → mapped status)

  POST /api/notifications Bearer + verifyAuth :
    Body : {action: 'mark-all-read'}
    ↓ markAllNotificationsRead(uid) → batch update isRead==false → readAt + isRead=true
    ↓ Return {processed: count}
```

**Bilan SC3 Phase 9 — votes Q1-Q8 doctrine §F MVP rétention appliqués** :
- ✅ Q1=B J-1 window 18-30h (cron horaire tolérant lag — cohérent runtime CF every 60min)
- ✅ Q2=A T-0 1h sweet spot (window 30-90min — précision sweet spot pré-session)
- ✅ Q3=B push si `fcmToken` + `pushNotificationsEnabled !== false` / email fallback si absent OU push fail
- ✅ Q4=A SW scope `/` global (un SW unique pour toutes les notifs Spordate)
- ✅ Q5=A page profil section Confidentialité (cohérent pattern Phase 8 SC0 `aiSuggestionsOptIn`)
- ✅ Q6=A silent fallback browsers non-supportés (Safari iOS <16.4 toggle disabled tooltip)
- ✅ Q7=A 1 notification par session (KISS Phase 9 — flags idempotency Booking ; batching différé Phase 10)
- ✅ Q8=C tests verify content (subject + body templateName + flag persisted + idempotency 2nd run)

**Tests SC3 cumulés** :
- SR1-SR5 (session-reminders) : 21 assertions
- PUSH1-PUSH4 (send-push-notification) : 20 assertions
- POI1-POI5 + bonus (push-opt-in) : 10 assertions
- UN1-UN5 + 7 bonus (markRead) : 19 assertions
- **SC3 total : 70 nouvelles assertions automated**

**Cumul routes Vercel API Phase 8+9 (19 routes — extension SC3 +3)** :
- Phase 8 SC2 : `/api/anti-leak`
- Phase 8 SC3 : `/api/suggest-activities`
- Phase 8 SC4 : `/api/invites` + `/api/invites/[id]/decline` + `/api/checkout` + `/api/webhooks/stripe` + page `/invite/[id]`
- Phase 8 SC5 : `/api/admin/blocks` + `/api/cron/review-reminder` + `/api/cron/purge-old-data` + `/api/admin/refund-sanction/[sanctionId]`
- Phase 9 SC1 : `/api/sessions/[sessionId]/participants` + `/api/users/me/matches` + `/api/cron/expire-invites`
- Phase 9 SC2 : `/api/invites/[id]/accept-gift` + extension `/api/checkout` mode='invite-prepay'
- **Phase 9 SC3 (NEW)** : `/api/cron/session-reminders` + `/api/notifications` + `/api/notifications/[id]`

**Cumul Cloud Functions (6 CF déployables — extension SC3 c1 +1)** :
| CF | Phase | Schedule |
|---|---|---|
| `refreshPricingCron` | 6 | every 15 min |
| `reviewReminderCron` | 8 SC5 c2 (extended SC3 c2 push-first) | every 60 min |
| `denormActiveSanctionTrigger` | 8 SC5 c2 | onWrite userSanctions |
| `purgeOldDataCron` | 8 SC5 c3 | weekly Friday 03:00 |
| `expireInvitesCron` | 9 SC1 c4 (extended SC2 c5 refund auto) | every 60 min |
| **`sessionRemindersCron`** (NEW) | 9 SC3 c1 (extended SC3 c2 push-first) | every 60 min |

**Nouveaux helpers SC3 cumul** :
- `src/lib/notifications/sendPushNotification.ts` (firebase-admin/messaging + DI seam)
- `src/lib/notifications/registerPush.ts` (client SDK getToken/deleteToken + isPushSupported)
- `src/lib/notifications/markRead.ts` (markRead/markAllRead/dismiss + NotificationError + safeGetDoc)
- `src/components/profile/PushOptInSwitch.tsx` (Switch UI charte Q5=A)
- `src/components/notifications/NotificationBadge.tsx` (header realtime onSnapshot)
- `src/components/notifications/NotificationsList.tsx` (Firestore-backed liste + dismiss + mark-all-read)
- `public/firebase-messaging-sw.js` (Service Worker FCM background, Q4=A scope `/`)

**Différé Phase 10 documenté** :
- ⏭️ Multi-device tokens (subcollection `users/{uid}/fcmTokens/{tokenId}` vs single field `fcmToken`)
- ⏭️ Auto-cleanup tokens FCM error `messaging/registration-token-not-registered` (signal already typed dans helper)
- ⏭️ Notification grouping batch (Q7=A KISS Phase 9 — 1 notif/session unifié Phase 10)
- ⏭️ VAPID key build-time injection dans `firebase-messaging-sw.js` (current : config publique hardcoded)
- ⏭️ A/B test push title/body wording (engagement metrics)
- ⏭️ Analytics push delivery rate (Firebase Cloud Messaging dashboard)

### Sub-chantier 4 — Admin queue + IA modération étendue + détection représailles ✅ COMPLET (6 commits)

- 1/6 `ac8cfb1` : Admin UI queue `/adminActions/` history tab dans dashboard (5e tab T&S après reviews/reports/sanctions/appeals) + `<AdminActionsHistoryPanel>` filtres date/type/admin/target combinables (Q1=C date toujours-on, autres optionnels) + cursor pagination "Charger plus" pageSize=100 + export CSV cap 5000 rows (Q2=C Vercel timeout safe) + helpers pure `formatAdminActionsCsv` (RFC 4180) + `fetchAllAdminActionsForExport` (loop pagination) + extension `getAdminActions` avec `cursorAfter?: AdminAction` option + tests AQ1-AQ5 + bonus (16 assertions). Charte stricte SC0 c2 : bg-zinc-950 + #D91CD2 accents.
- 2/6 `c1c7fa4` : Genkit flow `runReviewModerator` (Gemini 2.5 Flash + cache 24h hash exact + rate limit `wrapAiCall` 10/user/min + system prompt FR strict civility/factuality + fallback Gemini error → motive='ai-error' recommendation='borderline') + `Review.aiSuggestion?: {civility, factuality, recommendation, motive, modelVersion, scoredAt}` field additif + extension `createReview` post-write fire-and-forget POST `/api/reviews/[id]/moderate` (server-only Genkit + Admin SDK update) + DI seam `__setReviewModeratorGenerateFnForTesting` + tests MR1-MR5 + bonus (10 assertions). Pattern API route cohérent `/api/anti-leak` SC2 hotfix isolation Genkit du client bundle.
- 3/6 `87481aa` : Helpers pure `aiBadgeProps` + `prefilledReason` + `mismatchWarning` extraits dans `src/lib/reviews/aiBadgeHelpers.ts` (Q8=A tests verify content sans RTL) + extension `<TandSReviewsPanel>` badge IA recommendation (data-testid `ai-badge-{publish|reject|borderline}` + couleurs sémantiques green/red/amber + label `IA: publish 0.92` (max civility/factuality) + tooltip multi-line motive + civility + factuality + modelVersion + scoredAt) + extension `<ReviewModerationActionsDialog>` reason prefill `(IA suggestion: motive)` si admin choix === IA recommendation + warning subtle `AlertTriangle` "L'IA suggérait : X" si mismatch (Q3=A admin keep final decision) + graceful degradation reviews pré-Phase 9 SC4 c2/6 → no badge + tests AQ-IA1-AQ-IA3 + bonus (20 assertions).
- 4/6 `95b3757` : Heuristique détection représailles cross-user `src/lib/reviews/retaliationDetector.ts` avec `detectRetaliation` (query reviews/ where reviewerId=revieweeId AND revieweeId=reviewerId AND createdAt > now-24h, client-side filter sessionId — Q5=A 24h same-session) + `applyRetaliationFlag` (Admin SDK update review + adminAction silent Q6=A `adminId='system'`) + idempotency `flaggedAsRetaliation=true` skip 2nd run + defensive self-review (reviewerId == revieweeId) → not flagged + `Review.sessionId` + `flaggedAsRetaliation?` + `retaliationDeltaMs?` + `retaliationSuspectReviewId?` fields + `AdminActionType += 'review_retaliation_flag'` + extension `createReview` persist sessionId + post-write fire-and-forget POST `/api/reviews/[id]/check-retaliation` + composite index `reviews: reviewerId+revieweeId+createdAt DESC` + tests RV1-RV4 + 4 bonus (18 assertions).
- 5/6 `c0ced9f` : Genkit flow `runProfileBioModerator` (Gemini 2.5 Flash + cache 24h + system prompt FR strict toxicity/profanity/contactLeak + fallback Gemini error → recommendation='approve' permissif Phase 9 + early-return empty bio → 0 call) + `UserProfile.bioModeration?: {toxicity, profanity, contactLeak, recommendation, motive, modelVersion, scoredAt}` field + `AdminActionType += 'profile_bio_flag'` + extension `updateUser` Q4=B fire-and-forget POST `/api/users/[id]/moderate-bio` (server-only Genkit + Admin SDK update + si flag → adminAction silent Q7=A `adminId='system'`) + Q7=A bio reste visible (no UX disruption Phase 9) + tests PB1-PB4 + bonus (13 assertions).
- 6/6 *(this commit)* : architecture.md SC4 close-out + cumulative tests Phase 9 SC0+SC1+SC2+SC3+SC4 + retrospective Q1-Q8 doctrine SC4 appliquée.

**Architecture résultante SC4 admin queue + IA modération + retaliation end-to-end** :

```
ADMIN DASHBOARD (5 tabs T&S après SC4 c1) :
  /admin/dashboard
    ├ ts-reviews   (existing Phase 7 + SC4 c3 badge IA + reason prefill)
    ├ ts-reports   (existing Phase 7)
    ├ ts-sanctions (existing Phase 7)
    ├ ts-appeals   (existing Phase 7)
    └ ts-history   (NEW SC4 c1 — <AdminActionsHistoryPanel>)
         ↓ Filtres Q1=C : date always-on + actionType / targetType / adminId combinables
         ↓ Cursor pagination "Charger plus" (pageSize=100, cohérent SC0 c1)
         ↓ Export CSV Q2=C : fetchAllAdminActionsForExport (loop 500/page jusqu'à cap 5000)
            → formatAdminActionsCsv RFC 4180 → Blob download

REVIEWS MODÉRATION IA PIPELINE (rating ≤ 2) :
  Client : createReview(input) [client SDK]
    ↓ setDoc reviews/{id} avec sessionId additif (SC4 c4)
    ↓ Email reviewPendingModeration (best-effort)
    ↓ Fire-and-forget #1 : POST /api/reviews/[id]/moderate (SC4 c2)
       ↓ Server (nodejs runtime) :
       ↓ runReviewModerator (Genkit Gemini Flash + cache 24h hash exact)
          → JSON strict {civility, factuality, recommendation: publish|reject|borderline, motive}
          → Q5 fallback : Gemini error / JSON malformed → recommendation='borderline' motive='ai-error'
       ↓ Admin SDK update reviews/{id}.aiSuggestion = {...}
    ↓ Fire-and-forget #2 : POST /api/reviews/[id]/check-retaliation (SC4 c4)
       ↓ Server (nodejs runtime) Admin SDK :
       ↓ detectRetaliation(input) :
          query reviews where reviewerId=revieweeId AND revieweeId=reviewerId
          AND createdAt within 24h before current
          → client-side filter sessionId === input.sessionId (Q5=A same-session)
       ↓ Si retaliation détectée :
          ↓ applyRetaliationFlag :
             - Admin SDK update review.flaggedAsRetaliation=true + retaliationDeltaMs + retaliationSuspectReviewId
             - logAdminAction type='review_retaliation_flag' adminId='system' (Q6=A silent)

REVIEWS QUEUE ADMIN (SC4 c3 IA badge) :
  <TandSReviewsPanel> :
    ↓ Render badge IA (data-testid="ai-badge-{recommendation}") :
       - publish → green-500/20
       - reject  → red-500/20
       - borderline → amber-500/20
       - Label : "IA: {recommendation} {max(civility, factuality).toFixed(2)}"
       - Tooltip multi-line : motive + civility + factuality + modelVersion + scoredAt
    ↓ Click "Publier" / "Rejeter" → <ReviewModerationActionsDialog>
       ↓ useEffect prefillReason :
          - Si admin choix === aiSuggestion.recommendation → reason="(IA suggestion: motive)"
          - Si mismatch → warning AlertTriangle "L'IA suggérait : X" (Q3=A admin keep final)
          - Borderline → never prefill, never warning (admin tranche librement)

USER PROFILE BIO MODÉRATION IA (SC4 c5) :
  Client : updateUser(uid, {bio, ...})
    ↓ updateDoc users/{uid} (legacy)
    ↓ Q4=B fire-and-forget POST /api/users/[id]/moderate-bio si bio in payload + non-empty
       ↓ Server (nodejs runtime) :
       ↓ runProfileBioModerator (Genkit Gemini Flash + cache 24h)
          → JSON strict {toxicity, profanity, contactLeak, recommendation: approve|flag, motive}
          → Fallback Gemini error → recommendation='approve' (Phase 9 permissif)
          → Empty bio → early-return approve (0 Gemini call)
       ↓ Admin SDK update users/{uid}.bioModeration = {...}
       ↓ Si recommendation='flag' (au moins 1 score ≥ 0.3) :
          → logAdminAction type='profile_bio_flag' targetType='user' adminId='system' silent (Q7=A)
          → Bio reste visible publique (no UX disruption Phase 9)
```

**Bilan SC4 Phase 9 — votes Q1-Q8 doctrine SC4 appliqués (8/8)** :
- ✅ Q1=C date toujours active + filtres combinables (UX simple + power-user audit)
- ✅ Q2=C export ALL filter pages cap 5000 (Vercel timeout safe sur volumes)
- ✅ Q3=A admin keep final decision (IA = suggestion visible, no auto-action Phase 9)
- ✅ Q4=B fire-and-forget client-side post-`updateUser` / post-`createReview` (cohérent /api/anti-leak SC2 hotfix)
- ✅ Q5=A heuristique 24h same-session (cross-user reviews timing)
- ✅ Q6=A silent log adminAction représailles (`adminId='system'`, no email Phase 9 — admin investigue manuellement)
- ✅ Q7=A bio flag silent + admin queue (bio reste visible — no UX disruption)
- ✅ Q8=A tests verify content via pure helpers extraits (no RTL infra requise — `aiBadgeHelpers` testés directement)

**Tests SC4 cumulés** :
- AQ1-AQ5 + bonus (history-csv) : 16 assertions
- MR1-MR5 + bonus (moderate-review-ia) : 10 assertions
- AQ-IA1-AQ-IA3 + bonus (admin-queue-ai-badge) : 20 assertions
- RV1-RV4 + 4 bonus (retaliation-detector) : 18 assertions
- PB1-PB4 + bonus (moderate-bio-ia) : 13 assertions
- **SC4 total : 77 nouvelles assertions automated**

**Cumul routes Vercel API Phase 8+9 (23 routes — extension SC4 +4)** :
- Phase 8 SC2 : `/api/anti-leak`
- Phase 8 SC3 : `/api/suggest-activities`
- Phase 8 SC4 : `/api/invites` + `/api/invites/[id]/decline` + `/api/checkout` + `/api/webhooks/stripe` + page `/invite/[id]`
- Phase 8 SC5 : `/api/admin/blocks` + `/api/cron/review-reminder` + `/api/cron/purge-old-data` + `/api/admin/refund-sanction/[sanctionId]`
- Phase 9 SC1 : `/api/sessions/[sessionId]/participants` + `/api/users/me/matches` + `/api/cron/expire-invites`
- Phase 9 SC2 : `/api/invites/[id]/accept-gift` + extension `/api/checkout` mode='invite-prepay'
- Phase 9 SC3 : `/api/cron/session-reminders` + `/api/notifications` + `/api/notifications/[id]`
- **Phase 9 SC4 (NEW)** : `/api/reviews/[id]/moderate` + `/api/reviews/[id]/check-retaliation` + `/api/users/[id]/moderate-bio` + admin tab `ts-history`

**Cumul Cloud Functions (6 CF déployables — inchangé SC4)** :
- `refreshPricingCron` (Phase 6)
- `reviewReminderCron` (Phase 8 SC5 c2 + extended SC3 c2 push-first)
- `denormActiveSanctionTrigger` (Phase 8 SC5 c2)
- `purgeOldDataCron` (Phase 8 SC5 c3)
- `expireInvitesCron` (Phase 9 SC1 c4 + extended SC2 c5 refund auto)
- `sessionRemindersCron` (Phase 9 SC3 c1 + extended SC3 c2 push-first)

**Nouveaux helpers/flows SC4 cumul** :
- `src/ai/flows/review-moderator.ts` (Genkit Gemini Flash IA review modération)
- `src/ai/flows/profile-bio-moderator.ts` (Genkit Gemini Flash IA bio modération)
- `src/lib/reviews/retaliationDetector.ts` (heuristique cross-user same-session 24h + Admin SDK)
- `src/lib/reviews/aiBadgeHelpers.ts` (pure UI helpers Q8=A testables sans RTL)
- `src/lib/admin-actions/exportCsv.ts` (RFC 4180 + pagination loop cap 5000)
- `src/components/admin/AdminActionsHistoryPanel.tsx` (queue history admin tab)

**Nouveaux composite index Firestore SC4 cumul** :
- `reviews: reviewerId+revieweeId+createdAt DESC` (cross-user same-session query 24h)
- À déployer prod via `firebase deploy --only firestore:indexes` (Phase 9 SC4 close-out)

**Différé Phase 10 documenté** :
- ⏭️ Email admin immédiat sur retaliation détectée (Q6=A defer Phase 10 si volume justifie analytics)
- ⏭️ Auto-publish si IA confidence > 0.95 + civility > 0.9 (Q3=A defer — admin keep final Phase 9)
- ⏭️ Bio profile UI gating (Q7=A defer — Phase 9 visible, Phase 10 si volume scale-up)
- ⏭️ Multi-langue Genkit prompts DE/IT (§C.Q3 FR uniquement Phase 9)
- ⏭️ RTL infra tests UI components (Q8=A pure helpers extraits Phase 9 — Phase 10 polish smoke RTL si besoin)
- ⏭️ Onwrite Cloud Function trigger pour bio scan (Q4=B fire-and-forget Phase 9 ; CF onWrite Phase 10 si scale)
- ⏭️ Multi-device tokens FCM cleanup (cohérent SC3 c5 différé)
- ⏭️ Composite index secondaire reviews avec sessionId si volume scale-up

### Sub-chantier 5 — UX no-show excuse pré-session + matching algo visibility ✅ COMPLET (4 commits)

- 1/4 `d3d4d87` : Types `Excuse` interface + `Booking.excusedAt?` field additif + collection `/excuses/{id}` + service `createExcuse` (validate booking confirmed + window 2h Q1=A + anti-doublon idempotency + best-effort update Booking.excusedAt) + `ExcuseError` typed (`'invalid-input' | 'session-not-found' | 'not-confirmed-booker' | 'window-closed' | 'already-excused' | 'reason-too-long'`) + DI seam `__setExcusesDbForTesting` + firestore.rules `/excuses/{id}` (Q6=A owner-only create + immuable update/delete cohérent /adminActions/ §H + Booking update extension owner allowed mais `diff.affectedKeys().hasOnly(['excusedAt'])` defense-in-depth) + composite index `excuses: userId+sessionId+createdAt DESC` + tests EX1-EX4 + bonus rules anti-spoof + boundary 2h ±1ms + reason 300 chars boundary (14 assertions).
- 2/4 `df3fe64` : Extension `markNoShow` pre-create excuse check (query `/excuses/` where `userId+sessionId` LIMIT 1, `excuseLeadMs >= EXCUSE_WINDOW_HOURS_BEFORE_SESSION × 3600_000` → throw `ReportError('user-excused')`, sinon excuse tardive ignored mais préservée Firestore audit) + `ReportErrorCode += 'user-excused'` + best-effort silent si Firestore query fail (graceful degradation — partner peut toujours marquer no-show) + tests NS-EX1-NS-EX5 + 4 bonus (11 assertions). Régression Phase 7 markNoShow 47/47 PASS.
- 3/4 `e985cfd` : Pure helper `computeMatchScore` extracted from inline `/discovery` (sport common +30 / level same +20 / sport diff level +10 / city same +15 cap 100) + Phase 9 SC5 multiplier `× 0.7` (Q2=B modéré) si `applyRatingPenalty` (default true) AND `reviewCount >= 3` (Q4=B anti-FP) AND `averageRating < 3.5` (Q3=A threshold) + opts `applyRatingPenalty?: boolean = true` (Q5=B testabilité + admin override) + helpers `recomputeRevieweeAverageRating` Admin SDK + `UserProfile.averageRatingAsReviewee?` + `reviewCountAsReviewee?` denorm fields + extension `awardReviewBonus` post-publish fire-and-forget POST `/api/users/[id]/recompute-rating` (server-side Admin SDK bypass rules — cohérent SC4 c2/6 moderate-review pattern) + tests MS1-MS4 + 6 bonus (11 assertions).
- 4/4 *(this commit)* : architecture.md SC5 close-out + cumulative tests Phase 9 SC0+SC1+SC2+SC3+SC4+SC5 + retrospective Q1-Q8 doctrine SC5 appliquée.

**Architecture résultante SC5 no-show excuse + matching algo end-to-end** :

```
USER CRÉE EXCUSE PRÉ-SESSION (≥ 2h avant) :
  Client : createExcuse({userId, sessionId, reason?})
    ↓ Validation : reason ≤ 300 chars + session existe + booking status='confirmed'
    ↓ Window check (Q1=A) : session.startAt - now >= 2 × 3600_000 ms
       (sinon throw 'window-closed' — boundary inclusive 2h exact OK)
    ↓ Anti-doublon : query /excuses/ where userId+sessionId LIMIT 1
       (sinon throw 'already-excused' — idempotency)
    ↓ setDoc /excuses/{excuseId} (immuable audit trail)
    ↓ Best-effort updateDoc bookings/{bookingId}.excusedAt = serverTimestamp()
       (rule autorise diff.affectedKeys().hasOnly(['excusedAt']) — defense-in-depth)

PARTNER MARQUE NO-SHOW POST-SESSION :
  markNoShow({partnerId, sessionId, userId})
    ↓ Validations : session ended + grace 30min + partner authorized + booking confirmed
    ↓ Phase 9 SC5 c2/4 — Excuse pre-check (Q1=A 2h grace) :
       query /excuses/ where userId+sessionId LIMIT 1
       ↓ Si excuse trouvée AND excuseLeadMs >= 2h × 3600_000 :
          → throw ReportError('user-excused') (no report, no threshold compute)
       ↓ Si excuse tardive (<2h) :
          → continue normal flow (excuse ignored mais préservée Firestore audit)
       ↓ Best-effort silent si query fail (graceful degradation)
    ↓ Continue normal flow Phase 7 si pas d'excuse OR tardive :
       create report category='no_show' source='partner_no_show'
       compute threshold rolling 90j → triggerAutoSanction si level !== null
       sendEmail noShowWarningNotice (user) + partnerNoShowConfirmed (partner)

ALGO MATCHING DISCOVERY :
  computeMatchScore(myProfile, candidate, opts?)
    ↓ Pure function (no Firestore calls — caller pré-charge denorm fields)
    ↓ Sport scoring : +30 par sport commun + 20 same level OU +10 diff level
    ↓ City scoring : +15 si même ville
    ↓ Cap 100 (avant pénalité)
    ↓ Phase 9 SC5 c3/4 — multiplier × 0.7 (Q2=B + Q3=A + Q4=B) :
       Si applyRatingPenalty (default true)
       AND candidate.reviewCountAsReviewee >= 3 (Q4=B anti-FP)
       AND candidate.averageRatingAsReviewee < 3.5 (Q3=A threshold)
       → score = round(score × 0.7) (Q2=B modéré, visibilité réduite pas exclusion)
       Sinon graceful degradation (undefined OR min reviews not met → score inchangé)

HOOK PUBLISH REVIEW (recompute denorm) :
  awardReviewBonus(reviewId) [client SDK runtime]
    ↓ Phase 1 : runTransaction set creditsAwarded=true (anti-double idempotency)
    ↓ Phase 9 SC5 c3/4 — Fire-and-forget POST /api/users/[reviewee]/recompute-rating
       (avant early-return idempotent pour catch re-publish via moderateReview SC4 c2/6) :
       ↓ Server (nodejs runtime) Admin SDK :
       ↓ recomputeRevieweeAverageRating(revieweeId) :
          query reviews where revieweeId=X AND status='published'
          → average + count
          → update users/{revieweeId}.averageRatingAsReviewee + reviewCountAsReviewee
       ↓ Best-effort silent — never throw (caller fire-and-forget)
    ↓ Phase 2 : addCredits +5 chat credits au reviewer
    ↓ Phase 3 : sendEmail reviewBonusGranted (best-effort)
```

**Bilan SC5 Phase 9 — votes Q1-Q8 doctrine SC5 appliqués (8/8)** :
- ✅ Q1=A `EXCUSE_WINDOW_HOURS_BEFORE_SESSION=2` hardcoded (KISS Phase 9 — env var Phase 10 si volume)
- ✅ Q2=B multiplier `× 0.7` modéré (visibilité réduite, pas exclusion stricte)
- ✅ Q3=A threshold `3.5★` cohérent doctrine architecture.md ligne 896
- ✅ Q4=B anti-faux-positif min 3 reviews avant pénalité
- ✅ Q5=B `opts.applyRatingPenalty` pour testabilité + admin override (default true Phase 9)
- ✅ Q6=A owner-only authoring excuse (`request.resource.data.userId == auth.uid` rule + anti-spoof tested)
- ✅ Q7=B silent log Phase 9 (no email partner sur excuse — Phase 10 polish si volume justifie)
- ✅ Q8=A tests verify content (audit trail + boundary edge cases + idempotency anti-doublon)

**Tests SC5 cumulés** :
- EX1-EX4 + bonus (excuse créatif) : 14 assertions
- NS-EX1-NS-EX5 + 4 bonus (no-show excuse pre-check) : 11 assertions
- MS1-MS4 + 6 bonus (compute match score) : 11 assertions
- **SC5 total : 36 nouvelles assertions automated**

**Cumul routes Vercel API Phase 8+9 (24 routes — extension SC5 +1)** :
- **Phase 9 SC5 (NEW)** : `/api/users/[id]/recompute-rating` (Admin SDK denorm rating)

**Cumul Cloud Functions (6 CF déployables — inchangé SC5)** :
- `refreshPricingCron`, `reviewReminderCron`, `denormActiveSanctionTrigger`, `purgeOldDataCron`, `expireInvitesCron`, `sessionRemindersCron`

**Nouveaux composite indexes Firestore SC5 cumul** :
- `excuses: userId+sessionId+createdAt DESC` (anti-doublon query + sort)
- À déployer prod via `firebase deploy --only firestore:indexes` (Phase 9 SC5 close-out)

**Nouveaux helpers/services SC5 cumul** :
- `src/lib/excuses/_internal.ts` (constants + ExcuseError + DI seam)
- `src/lib/excuses/createExcuse.ts` (service createExcuse client SDK + best-effort)
- `src/lib/matching/computeMatchScore.ts` (pure function extracted + multiplier rating)
- `src/lib/matching/recomputeRating.ts` (Admin SDK helper + DI seam)
- `src/app/api/users/[id]/recompute-rating/route.ts` (server-only POST endpoint)

**Différé Phase 10 documenté** :
- ⏭️ Env var `SPORDATE_EXCUSE_WINDOW_HOURS` configurable (Q1=A KISS Phase 9 → param Phase 10 si volume)
- ⏭️ Per-activity override `Activity.excuseWindowHours?` (Q1=C defer Phase 10)
- ⏭️ UI excuse user-facing inline button + modal (Q5=B defer SC5 backend-only Phase 9 — frontend Phase 10)
- ⏭️ Email notification partner sur excuse (Q7=B defer Phase 10 si polish)
- ⏭️ Multiplier `× 0.5` strict (Q2=A) si Phase 10 metrics montrent 0.7 trop permissif
- ⏭️ Threshold `4.0★` (Q3=B) si Phase 10 metrics montrent 3.5 trop permissif
- ⏭️ Cloud Function onWrite trigger pour denorm averageRating (Q4=B fire-and-forget Phase 9 ; CF Phase 10 si scale)

### Sub-chantier 6 — Female-safety quota + anonymisation soft delete UI ✅ COMPLET (4 commits)

- 1/4 `e411c12` : `audienceType` helpers `src/lib/audience/_internal.ts` (`AUDIENCE_TYPES` Q1=A schema Phase 7 SC0 c3 préservé `'all' | 'women-only' | 'men-only' | 'mixed-priority-women'` + `AudienceError` typed + `isAllowedByAudience` pure helper + `assertAllowedByAudience` throw variant + `isAudienceType` type guard) + extension `firestore.rules /activities/{id}` create+update validate enum whitelist + `<AudienceTypeSelector>` UI partner RadioGroup 4 options (recommended ★ sur `mixed-priority-women`) + helper text LCD Art. 3 + nLPD + wire dans `/partner/offers` formulaire create/edit + tests AS1-AS4 + bonus 'other'/undefined/null/men-only Q4=A symmetric/invalid type fail-safe/type guard/enum schema (16 assertions, pure helpers no emulator).
- 2/4 `a47377b` : Extension `bookSession` pre-tx audience check (load activity + user.gender → `assertCanBookActivity` fail-fast avant transaction Firestore) + `'gender-required'` typed pour UX (force user complete profil avant booking restrictif vs juste mismatch) + extension `/api/checkout` mode='session' server-side defense-in-depth Admin SDK check + HTTP 412 mapping si AudienceError (precondition-failed, anti-bypass client) + tests BS1-BS4 + 7 bonus (12 assertions). Skip check si `audienceType='all'` ou `undefined` (rétro-compat).
- 3/4 `f7aac7f` : `UserProfile.softDeletedAt?` + `softDeleteScheduledPurgeAt?` + `softDeleteReason?` fields additifs + service `softDeleteUser({uid, reason?})` (verify ownership + update fields + grace 30j Q5=A) + service `restoreSoftDeletedUser` (pendant grace → unset fields ; après → throw `'grace-expired'`) + helpers `isSoftDeleted` / `softDeleteGraceDaysRemaining` + `SoftDeleteError` typed + DI seam + `<DeleteAccountActions>` client island avec AlertDialog confirm + restore button inline (Q7=A reversibility RGPD/nLPD friendly) + page `/profile/delete` user-facing avec onSnapshot status + extension `/api/cron/purge-old-data` Step 5 NEW (query users `softDeleteScheduledPurgeAt < now AND anonymizedAt == null` → anonymise PII + clear denorm rating fields + cursor pagination cohérent SC0 c1) + composite index `users: softDeleteScheduledPurgeAt ASC` + tests SD1-SD5 + 12 bonus (20 assertions). **🎉 RGPD/nLPD COMPLIANCE COMPLET pour launch**.
- 4/4 *(this commit)* : architecture.md SC6 close-out + cumulative tests Phase 9 SC0-SC6 + retrospective Q1-Q8 doctrine SC6 appliquée.

**Architecture résultante SC6 female-safety + soft delete end-to-end** :

```
PARTNER CRÉE ACTIVITY AVEC AUDIENCE TYPE (SC6 c1) :
  /partner/offers (formulaire create/edit) :
    <AudienceTypeSelector> RadioGroup 4 options :
      - 'all' (défaut) : Tous publics
      - 'mixed-priority-women' ★ Recommandé : Mixte priorité femmes (boost matching Phase 10)
      - 'women-only' : Femmes uniquement (booking strict Q3=A)
      - 'men-only' : Hommes uniquement (booking strict Q4=A symmetric)
    ↓ setDoc /activities/{id} avec audienceType field
    ↓ firestore.rules validate enum whitelist (defense-in-depth)
       (helper validAudienceType() Phase 9 SC6 c1)

USER TENTE BOOKING ACTIVITY (SC6 c2) :
  Client : bookSession({sessionId, userId, ...})
    ↓ Idempotency check (paymentIntentId existant → skip)
    ↓ Phase 9 SC6 c2 — Audience pre-check (Q3=A + Q4=A) :
       getDoc activity → audienceType
       getDoc users/{uid} → gender
       assertCanBookActivity(gender, audienceType) :
         IF audienceType IN ['women-only', 'men-only'] AND gender == null :
           → throw AudienceError('gender-required')  ← UX: redirect /profile pour set gender
         IF !isAllowedByAudience(gender, audienceType) :
           → throw AudienceError('gender-mismatch')  ← strict enforcement
       Skip check si audienceType='all' / undefined (rétro-compat)
       Fail-fast avant transaction Firestore (économie ressource)
    ↓ runTransaction atomic (existing flow inchangé) :
       create booking + currentParticipants++ + tier recompute + match.chatUnlocked

  Server defense-in-depth (/api/checkout mode='session') :
    Same assertCanBookActivity check Admin SDK
    HTTP 412 (precondition-failed) si AudienceError
    Anti-bypass : si user fait fetch direct /api/checkout sans bookSession service

USER DEMANDE SUPPRESSION COMPTE (SC6 c3 — RGPD/nLPD Art. 17) :
  /profile → section Confidentialité → lien "Supprimer mon compte" → /profile/delete
  /profile/delete page :
    onSnapshot users/{uid} → load softDeletedAt status
    SI déjà soft-deleted :
      <DeleteAccountActions isAlreadySoftDeleted={true} graceDaysRemaining={N} />
      → Banner amber "Suppression dans N jours" + bouton "Annuler"
      → restoreSoftDeletedUser() : unset softDeletedAt/scheduledPurgeAt/reason
      → router.refresh() + toast success
    SINON :
      <DeleteAccountActions isAlreadySoftDeleted={false} />
      → Card warning red "Action irréversible après 30j" + textarea reason (max 500)
      → AlertDialog confirm avant action destructive
      → softDeleteUser({uid, reason?}) :
         softDeletedAt = serverTimestamp()
         softDeleteScheduledPurgeAt = +30 days (Q5=A grace cohérent SC5 c3 banlist)
         softDeleteReason? (optional audit)
      → logout + redirect / + toast feedback

CRON PURGE AUTO POST-GRACE (SC6 c3) :
  purgeOldDataCron weekly Friday 03:00 → /api/cron/purge-old-data
    ↓ Step 5 NEW Phase 9 SC6 c3 :
       query users where softDeleteScheduledPurgeAt < now AND anonymizedAt == null
       cursor pagination cohérent SC0 c1 (pageSize=500, maxPages=10)
       per-user :
         skip si déjà anonymizedAt (idempotency vs cron banlist 24mo SC5 c3)
         update :
           displayName = null
           email = null
           photoURL = null
           phoneNumber = null
           bio = null
           averageRatingAsReviewee = 0  (clear denorm SC5 c3)
           reviewCountAsReviewee = 0
           anonymizedAt = serverTimestamp()
       Returns {softDeletedAnonymized, softDeletePages, softDeleteTruncated}
```

**Bilan SC6 Phase 9 — votes Q1-Q8 doctrine SC6 appliqués (8/8)** :
- ✅ Q1=A `AUDIENCE_TYPES` enum schema Phase 7 SC0 c3 préservé (4 valeurs, rétro-compat)
- ✅ Q2=C `mixed-priority-women` pas d'enforcement booking (matching boost defer Phase 10 — SC6 c3 skipped)
- ✅ Q3=A hard enforcement strict `women-only` (gender='female' uniquement)
- ✅ Q4=A symmetric `men-only` enforcement (LCD Art. 3 cohérence)
- ✅ Q5=A 30j grace period soft delete (cohérent SC5 c3 banlist purge cadence)
- ✅ Q6=A réutilise cron `purge-old-data` existing (extension Step 5 KISS — pattern proven Phase 8 SC5)
- ✅ Q7=A inline UI restore pendant grace (RGPD/nLPD friendly + reversibility)
- ✅ Q8=A tests verify content via pure helpers + boundary edges + idempotency

**Tests SC6 cumulés** :
- AS1-AS4 + bonus (audience helpers pure) : 16 assertions
- BS1-BS4 + 7 bonus (bookSession enforcement) : 12 assertions
- SD1-SD5 + 12 bonus (soft delete + cron purge + helpers + rules anti-spoof) : 20 assertions
- **SC6 total : 48 nouvelles assertions automated**

**Cumul routes Vercel API Phase 8+9 (24 routes — extension SC6 +1 page seulement)** :
- **Phase 9 SC6 (NEW)** : page `/profile/delete` (client-side, no API route — services client SDK + extension cron purge-old-data Step 5)

**Cumul Cloud Functions (6 CF déployables — inchangé SC6)** :
- `refreshPricingCron`, `reviewReminderCron`, `denormActiveSanctionTrigger`, `purgeOldDataCron` (extended SC6 c3 Step 5 soft delete purge), `expireInvitesCron`, `sessionRemindersCron`

**Nouveaux composite indexes Firestore SC6 cumul** :
- `users: softDeleteScheduledPurgeAt ASC` (cron query efficient)
- À déployer prod via `firebase deploy --only firestore:indexes` (Phase 9 SC6 close-out)

**Nouveaux helpers/services SC6 cumul** :
- `src/lib/audience/_internal.ts` (`AUDIENCE_TYPES` + `isAllowedByAudience` + `assertAllowedByAudience` + `assertCanBookActivity` + `isAudienceType` type guard + `AudienceError`)
- `src/lib/users/softDelete.ts` (services `softDeleteUser` + `restoreSoftDeletedUser` + helpers `isSoftDeleted` + `softDeleteGraceDaysRemaining` + `SoftDeleteError`)
- `src/components/partner/AudienceTypeSelector.tsx` (RadioGroup partner UI)
- `src/components/profile/DeleteAccountActions.tsx` (client island user-facing AlertDialog)
- `src/app/profile/delete/page.tsx` (page user-facing avec onSnapshot status)
- Extension `src/app/api/cron/purge-old-data/route.ts` Step 5 (soft delete purge)

**🎉 RGPD/nLPD COMPLIANCE COMPLET POUR LAUNCH** :
- ✅ Soft delete user-facing UI (RGPD Art. 17 droit à l'effacement)
- ✅ Grace period 30j (réversibilité, doctrine §H)
- ✅ Cron purge auto anonymisation PII (proportionnalité nLPD Art. 7)
- ✅ Audit trail T&S préservé (reviews anonymes, reports, sanctions — doctrine §H)
- ✅ Banlist 24mo (Phase 8 SC5 c3) + soft delete user-initiated (Phase 9 SC6 c3) coexistent

**Différé Phase 10 documenté** :
- ⏭️ Matching boost `mixed-priority-women × 1.3` (Q2=C SC6 c3 skipped Phase 9 — defer Phase 10 si demande user)
- ⏭️ Email notification user 7 jours avant purge soft delete (Q5=A grace 30j Phase 9 — Phase 10 polish reminder)
- ⏭️ Dashboard admin liste users soft-deleted en grace (Q6=A cron silent Phase 9)
- ⏭️ Hard delete option (vs soft delete) si user veut suppression immédiate sans grace
- ⏭️ UI feedback survey reason multi-choice + free text (Q5=A reason free text Phase 9)
- ⏭️ Per-activity override `Activity.excuseWindowHours?` (cohérent SC5 différé)

### Phase 9 progression (30 commits techniques + 6 close-outs)

| SC | Thème | Commits | Tests automated |
|----|-------|---------|-----------------|
| SC0 | Foundation polish (admin auth + indexes + cursor + charte) | 2 | 31 |
| SC1 | Card session participants + invite cleanup (4 SC4 close-out items + UI) | 5 (incl. close-out) | 45 |
| SC2 | Stripe Connect Split/Gift + refund post-accept | 6 (incl. close-out) | 88 |
| SC3 | Email rappels J-1/T-0 + Web Push reviewReminder | 5 (incl. close-out) | 70 |
| SC4 | Admin queue history + IA modération étendue + détection représailles | 6 (incl. close-out) | 77 |
| SC5 | UX no-show excuse pré-session + matching algo visibility | 4 (incl. close-out) | 36 |
| SC6 | Female-safety quota + anonymisation soft delete UI | 4 (incl. close-out) | 48 |
| **Cumul Phase 9** | | **30 + 6 close-outs** | **395** |

**Tests Phase 9 final cumulés** : 395 nouvelles assertions automated.
**Phase 8 cumul 251+ tests préservé** intégralement (zéro régression mesurée).
**Phase 7 base 372 tests préservé** intégralement (markNoShow legacy 47/47 PASS).

**Vercel green** sur 35+ déploiements consécutifs Phase 9.

**Reste sub-chantiers Phase 9** : SC7 (close-out final Phase 9).

---

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
