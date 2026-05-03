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

- [x] ✅ **MIGRATION FIREBASE FAITE** (mai 2026, anticipée depuis Phase 8 vers Phase 2.5)
  - Ancien projet : `studio-9336829343-59db2` (Firebase Studio, deadline shutdown 22 mars 2027)
  - Nouveau projet : `spordate-prod` (Firebase classique, compte `bassicustomshoes@gmail.com`, région eur3)
  - Pas de migration de données nécessaire (0 utilisateur réel au moment de la migration)
  - 8 env vars Vercel mises à jour, Firestore rules + 4 indexes déployés, Vercel redeploy `4YeH1VLDX` Ready
- [ ] **Cleanup post-migration (à faire après 30j de vérification)** :
  - Supprimer le projet Firebase `studio-9336829343-59db2` (ancien)
  - Vérifier qu'aucun service tiers (Stripe webhook, Analytics, etc.) ne pointe encore sur l'ancien projet
  - Activer Storage sur `spordate-prod` quand on en aura besoin (Phase 6 chat avec photos/vidéos)
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
- [ ] Mentionner Cloud Functions Phase 7 : à implémenter en **Vercel Cron Jobs** OU en **Firebase Functions séparées**, à arbitrer en début de Phase 7.

### Storage rules à versionner dans le repo (Phase 8 cleanup)

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
- [ ] **Affiner les rules en Phase 8** : vérification partnerId pour `activities/`, vérification participants pour `chats/`

### Sécurité & monitoring

- [ ] Régler le warning Vercel **`STRIPE_SECRET_KEY` "Needs Attention"** — probablement remplacer par une "restricted key" Stripe au lieu de la clé secrète complète.
- [ ] **Fix Stripe lazy init** dans les 4 routes API qui instancient `new Stripe(...)` au niveau module (confirmé Phase 5 lors du `npm run build` local) : `src/app/api/checkout/route.ts`, `src/app/api/boost-checkout/route.ts`, `src/app/api/stripe-connect/route.ts`, `src/app/api/verify-payment/route.ts`. Déplacer chaque `const stripe = new Stripe(...)` du niveau module dans le `POST` handler (lazy init), comme c'est déjà fait dans `webhooks/stripe/route.ts`. Sinon le build local échoue sans `.env.local` avec "Neither apiKey nor config.authenticator provided" au moment du `Collecting page data`. Sur Vercel ça passe car env vars définies. Découvert pendant Phase 1 cleanup, reconfirmé Phase 5, hors scope Phase 5.
- [ ] Auditer les autres env vars Vercel — confirmer que toutes les 11 attendues (cf. `.env.example`) sont présentes.
- [ ] Vérifier que `FIREBASE_SERVICE_ACCOUNT_KEY` est bien configuré côté serveur (utilisé par les API routes Stripe webhook).

### Documentation

- [ ] Mettre à jour `README.md` après Phase 8 pour refléter l'architecture réelle finale.
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

3. **Section "Ils l'ont vécu"** en haut de la home : 6-8 photos d'anciens cours Afroboost **réels** + 2-3 testimonials courts. Pas de prix ni de countdown — juste de l'aspirational pour donner le vibe "on existe depuis longtemps". **Doctrine no-fake-content stricte** : si <3 vraies photos disponibles au launch, masquer la section plutôt que de mocker (LCD Suisse Art. 3 publicité trompeuse + risque réputationnel sur plateforme dating-adjacent). Photos stockées dans `/public/past-sessions/`, indexées dans `/src/data/past-afroboost-sessions.ts` (`PAST_AFROBOOST_SESSIONS`). Le composant `PastSessionsGallery` applique cette règle automatiquement (`return null` si `sessions.length < minToShow`). Migration Firestore + admin UI prévue Phase 7.

4. **Pre-fill villes avec "Bientôt"** : afficher Lausanne / Zürich / Bern même sans session active. Bouton "Me notifier de la première session". Donne l'impression d'expansion en cours.

5. **Compteur d'intérêt cumulatif** : "47 membres intéressés" basé sur les clics sur sessions (signal soft, pas une réservation). Jamais de "0 réservations". Pas de fenêtre temporelle dans le wording (rolling-7d / ISO-week sera tranché en Phase 7) pour rester future-proof.

6. **Notifications "future session"** : tout visiteur peut s'inscrire à une liste d'attente par activité ou par ville. Capture l'engagement.

7. **Hero story / mini-blog "Notre histoire"** : 3 paragraphes sur Afroboost + photos + vidéo intro 30s. Construit la confiance avant la transaction.

8. **Scarcity intelligente** : mix réel — certaines sessions à 87% remplies (last min) + d'autres à 20% (early bird). Pas tout à "1 place restante".

**Importance** : ces tactiques sont **autant** importantes que le code lui-même. Sans elles, même un site techniquement parfait paraîtra mort. Elles doivent être intégrées **dès Phase 5** (et pas reportées à Phase 8).

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

**Phase 6 — chat avec coût variable** :
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
| Phase 2.5 | **MIGRATION FIREBASE** : `studio-9336829343-59db2` → `spordate-prod`. Nouveau projet Firebase classique (compte `bassicustomshoes@gmail.com`), Firestore eur3 mode prod, Auth Email/Password, Storage à activer plus tard, Web App config + Service Account créés, 8 env vars Vercel updatées, Firestore rules + 4 indexes Phase 1 déployés sur `spordate-prod`, Vercel `vercel --prod` redeploy commit `4YeH1VLDX` Ready 37s. | ✅ **SHIPPÉE** — spordateur.com tourne maintenant sur `spordate-prod`. Backend `studio-9336829343-59db2` reste en standby 30j pour rollback éventuel, à supprimer en Phase 8. **Firebase Studio shutdown 22 mars 2027 = plus un risque**. | mai 2026 |
| Phase 3 | Pricing progressif côté serveur (extension `/api/checkout` + `/api/webhooks/stripe`) | ✅ **SHIPPÉE** — push Afroboost44/main commit `930e090`, Vercel auto-deploy. Extension mode 'session' avec recompute server-side anti-cheat, refactor route.ts → handler.ts (Next.js constraint), idempotency #1 hors-tx, transaction Admin SDK atomique (booking + currentParticipants++ + tier recompute + chatUnlock + grant 50 credits), Activity.chatCreditsBundle? + TransactionType+'session_purchase' + Transaction.bookingId?+sessionId?. Tests 23+42+37 = 102 sub-assertions PASS. Build 35 pages OK. | mai 2026 |
| Phase 4 | Hooks countdown (useCountdown, useSessionWindow, useServerTimeOffset) + composants UI countdown | À faire | — |
| Phase 5 | Pages `/sessions` (liste + détail) + widget UpcomingSessions | À faire | — |
| Phase 6 | Chat temporel (étendre chatUnlocked avec phase before/chat-open/started/ended) | À faire | — |
| Phase 7 | Cloud Functions / Cron Jobs (J-1, H-2 chat opening, T-0 start, T+0 end + emails Resend) | À faire | — |
| Phase 8 | **Cleanup** — voir section 9 ci-dessus | À faire | — |
