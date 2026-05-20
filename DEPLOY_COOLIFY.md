# DEPLOY_COOLIFY.md — Migration Spordateur vers Coolify (Hetzner)

> **Cible** : Coolify auto-hébergé sur Hetzner (4 Go RAM partagés avec Afroboost).
> **Statut** : Phase 1 (préparation code) — Dockerfile + Next.js standalone prêts.
> **Coexistence** : Vercel reste actif en parallèle jusqu'au cutover validé.

---

## 1. Fichiers de cette phase

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Multi-stage Node 20-alpine (deps → builder → runner), user non-root, healthcheck wget |
| `.dockerignore` | Exclusions standards (node_modules, .next, .env*, tests, scripts, .vercel) |
| `next.config.ts` | `output: 'standalone'` ajouté (sauf mode `NEXT_OUTPUT=export`) |
| `DEPLOY_COOLIFY.md` | Ce fichier — runbook complet |

---

## 2. Tester le build localement

### 2.1 Build de l'image

```bash
docker build -t spordateur:test \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="$(grep ^NEXT_PUBLIC_FIREBASE_API_KEY .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$(grep ^NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="$(grep ^NEXT_PUBLIC_FIREBASE_PROJECT_ID .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="$(grep ^NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="$(grep ^NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID="$(grep ^NEXT_PUBLIC_FIREBASE_APP_ID .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="$(grep ^NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY .env.local | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_APP_URL="http://localhost:3000" \
  .
```

> **Pourquoi `--build-arg` ?** Les `NEXT_PUBLIC_*` sont inlinés dans le bundle
> client par Next.js *au moment du build*. Elles doivent donc être disponibles
> à `docker build`, pas seulement à `docker run`.

### 2.2 Vérifier la taille de l'image

```bash
docker images spordateur:test
# Attendu : ~300-400 Mo (vs ~1.2 Go sans standalone)
```

### 2.3 Lancer le container

```bash
docker run --rm -p 3000:3000 --env-file .env.local spordateur:test
```

Ouvrir http://localhost:3000 — la home doit charger en <5s, login Firebase fonctionnel.

### 2.4 Diagnostic en cas d'échec build

| Symptôme | Cause probable | Fix |
|---|---|---|
| `JavaScript heap out of memory` | `NODE_OPTIONS=--max-old-space-size=3072` trop bas | Augmenter à 4096 si machine de build a plus de RAM |
| `Module not found: 'fs'` | Import client-side de package serveur | Vérifier `serverExternalPackages` dans `next.config.ts` |
| `Error loading shared library` | Native binding manquant sur Alpine | Ajouter `libc6-compat` (déjà présent) ou switch sur `node:20-bookworm-slim` |
| `prisma generate` fail | `DATABASE_URL` absent | Inoffensif — Prisma legacy non utilisé, ignorer |

---

## 3. Variables d'environnement à transférer dans Coolify

Toutes ces variables existent déjà dans le scope **Production** Vercel (projet
`spordate-v1`). Procédure : Vercel Dashboard → Settings → Environment Variables
→ copier la valeur production (decrypt pour les sensitive) → coller dans Coolify.

### 3.1 Build-time (déclarées en `ARG` dans Dockerfile, requises au build)

Ces vars sont inlinées dans le bundle JS client par Next.js. Dans Coolify :
Settings → Build Variables (séparées des runtime variables).

| Variable | Source Vercel | Notes |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Prod | Format `AIzaSy...` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Prod | `spordate-prod.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Prod | `spordate-prod` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Prod | `spordate-prod.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Prod | Numérique |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Prod | Format `1:xxx:web:xxx` |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Prod | Web Push (notifications) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Prod | `pk_live_...` |
| `NEXT_PUBLIC_APP_URL` | Prod | URL Coolify finale (ex: `https://app.spordateur.com`) |

### 3.2 Runtime (déclarées dans Coolify → Environment Variables)

| Variable | Source Vercel | ⚠️ Spécificités |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Prod | **Voir §4 ci-dessous — JSON sur une ligne, sans newlines** |
| `STRIPE_SECRET_KEY` | Prod | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Prod | `whsec_...` — repointer webhook Stripe sur la nouvelle URL |
| `RESEND_API_KEY` | Prod | `re_...` |
| `SENDER_EMAIL` | Prod | `Spordateur <noreply@spordateur.com>` |
| `CRON_SECRET` | Prod | Hex 64 chars — utilisé par les routes `/api/cron/*` |
| `ADMIN_LEAK_EMAIL` | Prod | `contact@spordateur.com` |
| `SPORDATE_INVITE_FEE_PCT` | Prod (si défini) | Sinon défaut hardcodé |
| `FIREBASE_PROJECT_ID` | Prod | Fallback admin (peut être omis si `NEXT_PUBLIC_FIREBASE_PROJECT_ID` set) |

### 3.3 Variables Vercel à NE PAS transférer

| Variable | Pourquoi pas |
|---|---|
| `VERCEL_URL` | Auto-set par Vercel uniquement. Coolify utilise `NEXT_PUBLIC_APP_URL` à la place. |
| `REACT_APP_STRIPE_PUBLIC_KEY` | Legacy (Create React App), remplacé par `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |

---

## 4. ⚠️ FIREBASE_SERVICE_ACCOUNT_KEY — Format critique

**Historique** : on a perdu plusieurs heures en mai 2026 sur le parsing du
service account JSON parce que Vercel CLI corrompait les newlines littéraux
de la `private_key`. Le fix défensif (`parseServiceAccountKeyDefensive` dans
`src/lib/auth/verifyAuth.ts`) gère le cas, mais **autant éviter le bug** en
collant la valeur correctement.

### ✅ Bon format pour Coolify

Sur **une seule ligne**, sans retours à la ligne littéraux, avec `\n` (deux
caractères : backslash + n) dans `private_key` :

```
{"type":"service_account","project_id":"spordate-prod","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-...@spordate-prod.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v3..."}
```

### ❌ Mauvais formats

```
# Newline littéral dans la valeur (multiline) — casse selon le parser
{"private_key":"-----BEGIN PRIVATE KEY-----
MIIE...
-----END PRIVATE KEY-----"}
```

```
# Newline échappé deux fois (\\n) — parseServiceAccountKeyDefensive le rattrape mais évite
{"private_key":"-----BEGIN PRIVATE KEY-----\\nMIIE..."}
```

### Récupérer la valeur depuis Vercel

```bash
vercel env pull .env.production --environment=production
grep ^FIREBASE_SERVICE_ACCOUNT_KEY .env.production
# Copier la valeur (tout ce qui suit le `=`, généralement entre quotes)
# Coller telle quelle dans Coolify (Coolify gère bien les valeurs longues)
```

---

## 5. Configuration Coolify (côté serveur)

À transmettre à Bassi pour la création du projet :

### 5.1 Type de ressource

- **Type** : `Application`
- **Source** : `Git Repository` (privé GitHub `Afroboost44/spordate-v1`)
- **Branch** : `main`
- **Build Pack** : `Dockerfile` (Coolify détecte automatiquement le `Dockerfile` à la racine)

### 5.2 Build settings

- **Dockerfile location** : `./Dockerfile` (défaut)
- **Build context** : `.` (défaut)
- **Build arguments** : voir §3.1 (variables `NEXT_PUBLIC_*`)
- **Build memory limit** : 3.5 Go (laisser ~500 Mo OS + Afroboost)
- **Build time estimate** : 4-7 min première fois, 2-3 min ensuite (cache layers)

### 5.3 Runtime settings

- **Port exposé** : `3000`
- **Healthcheck** : géré par Dockerfile (`HEALTHCHECK` instruction)
- **Restart policy** : `unless-stopped`
- **Resource limits** :
  - Memory : 1.5 Go (Next.js standalone runtime est léger)
  - CPU : 1.5 (sur 2 vCPU Hetzner)

### 5.4 Domain & TLS

- **Custom domain** : à définir (ex : `app.spordateur.com`)
- **TLS** : Coolify gère Let's Encrypt automatiquement
- **Force HTTPS** : ON
- **Repointer après mise en service** :
  - DNS A record du domaine principal vers IP Hetzner
  - Stripe webhook URL : Dashboard Stripe → Webhooks → mettre à jour endpoint
  - Firebase Auth authorized domains : ajouter le nouveau domaine
  - Resend sender domain : déjà vérifié (`spordateur.com`), pas de changement

### 5.5 Persistent storage

**Aucun** — Spordateur est stateless (toutes les données dans Firestore +
Firebase Storage). Pas de volume Docker à monter.

---

## 6. Procédure de cutover (Vercel → Coolify)

> ⚠️ **Ne PAS faire avant validation complète** du déploiement Coolify avec le
> domaine de test (ex : `coolify-test.spordateur.com`).

1. **Validation parallèle** (1-2 semaines) : Coolify sert un sous-domaine de test,
   Vercel reste sur le domaine principal. Tests : auth, paiements Stripe (carte
   test), Resend, cron jobs, push notifications, Discovery, partner dashboard.
2. **Webhook Stripe** : créer un second endpoint sur Stripe pointant vers Coolify,
   garder l'endpoint Vercel actif. Les deux recevront les events en parallèle —
   safe car webhook handler est idempotent (`stripe-signature` check + Firestore
   transaction).
3. **DNS cutover** : changer le A record du domaine principal vers Hetzner. TTL
   préalablement abaissé à 300s (24h avant le switch).
4. **Surveillance H+24** : logs Coolify, Firestore writes, Stripe webhook delivery,
   error rate (logs Resend, Firebase Auth events).
5. **Rollback** : si problème, revert DNS vers Vercel (TTL 300s = propagation 5-10min).
6. **Décommissionnement Vercel** : après 7 jours de stabilité Coolify, supprimer
   le projet Vercel et l'endpoint webhook Stripe associé.

---

## 7. Étapes suivantes (Phase 2 et au-delà)

- [ ] **Phase 1 — VALIDATION LOCALE** (cette étape) : Bassi teste `docker build` +
      `docker run` sur sa machine, confirme que le container démarre et sert la home.
- [ ] **Phase 2 — Coolify setup** : Bassi crée le projet sur Coolify, colle les
      env vars (§3), build initial sur sous-domaine de test.
- [ ] **Phase 3 — Tests fonctionnels** : checklist Spordateur sur env Coolify
      (auth, paiement, chat, Discovery, cron, push).
- [ ] **Phase 4 — Cutover DNS** : voir §6.
- [ ] **Phase 5 — Décom Vercel** : voir §6, point 6.

---

## 8. Contacts & ressources

- **Coolify docs** : https://coolify.io/docs
- **Next.js standalone output** : https://nextjs.org/docs/app/api-reference/config/next-config-js/output#automatically-copying-traced-files
- **Hetzner Cloud Console** : pour vérifier RAM/CPU disponible avant build
- **Firebase Console** : `spordate-prod` (compte `bassicustomshoes@gmail.com`)
