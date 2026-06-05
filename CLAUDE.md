# CLAUDE.md — Guide de commandes Spordate

Ce fichier liste toutes les commandes nécessaires pour installer, lancer, tester et déployer Spordate. Claude doit consulter ce fichier avant toute action sur le projet.

## 0. RÈGLE STRICTE — Couleur de marque Spordateur

**Couleur officielle Spordateur** : `#D91CD2` (RGB 217, 28, 210).

C'est la couleur unique de la marque. Elle est définie dans `src/app/globals.css`
sous `--accent-color: #D91CD2`, utilisée dans tous les fallbacks (icon.tsx, PWA,
emails contacts/invite, etc.), et c'est la SEULE couleur d'accent autorisée.

**INTERDIT — toutes ces couleurs sont des erreurs récurrentes** :
- ❌ `#EC4899` (hot pink) — trop pâle, c'est un rose Tailwind, pas la marque
- ❌ `#C026D3` (Tailwind fuchsia-600) — magenta moins saturé
- ❌ `#7E22CE` (Tailwind violet-700) — c'est du VIOLET, jamais utilisé
- ❌ `#A21CAF` (Tailwind fuchsia-700) — autre dérive
- ❌ Tout dégradé "rose → violet" ou "rose → magenta"

**Pour TOUT visuel marketing, Story Instagram, cover Highlight, illustration,
prompt IA (Gemini/Midjourney/Imagen), email, PDF, présentation** :
- Couleur unique = `#D91CD2`
- Fond noir profond = `#000000` ou `#0A0204` (presque noir)
- Texte principal = blanc `#FFFFFF`
- Aucune autre teinte d'accent

**Anti-pattern récurrent** : Claude propose un dégradé "rose-magenta-violet" pour
"un effet néon plus riche". NON. La marque Spordateur = un seul accent, point.
Le néon vient du glow halo `#D91CD2` sur fond noir, pas de plusieurs couleurs.

**Quand le user dit "ce n'est pas du violet"** : il parle de la perception.
`#D91CD2` est techniquement du magenta-fuchsia mais le user le voit comme "rose
vif". Ne pas réinterpréter sa demande pour ajouter du violet, du magenta, ou du
"plus rose pâle". Juste utiliser `#D91CD2` exactement.

## 1. Installation initiale

```bash
# Cloner le repo
git clone https://github.com/sambassi/spordate-v1.git
cd spordate-v1

# Installer les dépendances
npm install

# Copier les variables d'environnement
cp .env.example .env.local
# → Remplir les clés Firebase dans .env.local
```

## 2. Lancer le projet en local

```bash
# Mode développement (hot reload sur http://localhost:3000)
npm run dev

# Mode développement avec port custom
npm run dev -- -p 3001
```

## 3. Build et test local du build

```bash
# Build production
npm run build

# Lancer le build localement (pour tester avant Vercel)
npm run start
```

## 4. Qualité de code

```bash
# Linter
npm run lint

# Formatter
npm run format

# Type-check TypeScript
npm run type-check
```

## 5. Tests

```bash
# Tests unitaires (Jest)
npm run test

# Tests en mode watch
npm run test:watch

# Couverture
npm run test:coverage
```

## 6. Firebase — émulateurs locaux

```bash
# Démarrer les émulateurs (Firestore, Auth, Functions)
firebase emulators:start

# Déployer les règles Firestore
firebase deploy --only firestore:rules

# Déployer les Cloud Functions
firebase deploy --only functions
```

## 7. Déploiement Hetzner (workflow actuel — ne PAS utiliser Vercel)

**RÈGLE DURE** : Spordateur est déployé sur Hetzner via Docker Compose direct, PAS sur Coolify ni Vercel. Le `git push origin main` NE DÉCLENCHE AUCUN DEPLOY AUTO — il sert uniquement de backup GitHub. Pour mettre à jour le site en prod, il faut TOUJOURS lancer :

```bash
./deploy.sh                               # full : typecheck + rsync + docker rebuild
./deploy.sh "message commit"              # idem + commit & push GitHub (backup)
./deploy.sh --check                       # typecheck only (pas de deploy)
./deploy.sh --no-build                    # rsync + restart (sans rebuild Docker)
./deploy.sh --no-typecheck                # skip typecheck (urgence)
```

**Sous le capot** : le script SSH sur Hetzner (`178.105.201.62`), rsync les sources vers `/opt/spordateur/`, puis `docker compose up -d --force-recreate --build`. Build natif amd64 ≈ 2-3 min. Logs container : `docker logs --tail 30 spordateur`.

**Variables d'env** : configurées dans `/opt/spordateur/.env` côté serveur (pas dans le repo, exclues du rsync). Pour modifier : `ssh -i ~/.ssh/hetzner_afroboost root@178.105.201.62 'nano /opt/spordateur/.env'` puis `docker compose restart`.

**Pourquoi pas Coolify** : la migration tâches #40-#43 n'a jamais finalisé le setup Coolify projet Spordateur. Tout passe par le rsync direct. Ne pas perdre du temps à chercher un projet Coolify, il n'existe pas.

**Variables d'environnement Firebase (rappel, déjà sur le serveur)** :
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `FIREBASE_ADMIN_PRIVATE_KEY` (côté serveur uniquement)

## 8. Workflow Git

```bash
# Créer une branche feature
git checkout -b feat/nom-de-la-feature

# Avant chaque commit
npm run lint && npm run type-check && npm run test

# Pousser
git push origin feat/nom-de-la-feature
```

## 9. Commandes utiles pour Claude

Avant toute modification, Claude doit :
1. Lire `.clauderules` pour respecter les règles de design et de code.
2. Lire `architecture.md` pour comprendre la structure.
3. Faire un `npm run type-check` après chaque modification.
4. Ne jamais lancer `git push` sans validation explicite de l'utilisateur.

## 9.bis Règle i18n (Fix #156/#157)

**RÈGLE DURE** : à chaque fois que Claude modifie un fichier .tsx pour quelque
raison que ce soit (fix bug, ajout feature, refactor, restyle), il DOIT
convertir 100% des strings FR hardcodées du fichier en `t('key')` avant de
fermer le fix.

Procédure :
1. Avant la 1ère édition, exécuter `node tests/admin/i18n-hardcoded-strings.test.js`
   pour voir le seuil baseline du fichier.
2. Faire le fix demandé.
3. Lister TOUTES les strings FR encore hardcodées dans le fichier touché.
4. Pour chacune :
    - Ajouter une clé `t('...')` dans les 3 langues (FR/EN/DE) de
      `src/context/LanguageContext.tsx`.
    - Remplacer la string par `{t('key')}`.
5. Baisser le seuil baseline correspondant dans
   `tests/admin/i18n-hardcoded-strings.test.js` au nouveau compte exact.
6. Vérifier que tous les tests passent (`npm run typecheck` + scanner i18n).

Le baseline ne peut **QUE descendre**. Si une modif augmente le compteur,
le test casse → la modif est refusée tant que les nouvelles strings ne sont
pas converties en t().

**Anti-pattern** : laisser une nouvelle string FR hardcodée "pour faire vite".
Le test scanner casse, le déploiement est bloqué.

## 9.ter Règle miniature activité (Fix #203 — anti-régression durable)

**RÈGLE DURE** : pour résoudre la miniature d'une activité **N'IMPORTE OÙ** dans
le code (card listing, modal sélecteur, invite chat, "Où pratiquer", reservation,
session, partner offers preview…), on utilise **TOUJOURS** :

```ts
import { getActivityThumbnail, getActivityThumbnailChain } from '@/lib/activities/getActivityThumbnail';

// ✅ BON — passe l'activité COMPLÈTE
const thumb = getActivityThumbnail(activity);
const chain = getActivityThumbnailChain(activity);  // pour <img onError> walk
```

**INTERDIT** : cherry-pick de champs au moment de l'appel :

```ts
// ❌ MAUVAIS — bug récurrent #146, #155, #186, #203
getActivityThumbnail({ thumbnailUrl: a.thumbnailUrl, mediaItems: a.mediaUrls, ... })
```

Le helper scan **TOUS** les champs possibles de l'objet (thumbnailUrl, images[],
mediaItems[] image/video, mediaUrls[] legacy, imageUrl, posterUrl, coverImage,
scan exhaustif hosts connus). Cherry-pick = perte de données = bug visuel.

**Test anti-régression** : `tests/admin/activity-thumbnail-call-sites.test.js`
scanne tous les fichiers et casse le build si quelqu'un réintroduit un
cherry-pick `getActivityThumbnail({...})` avec littéral d'objet.

**Anti-pattern à ne jamais faire** : « je vais juste extraire les 3 champs dont
j'ai besoin parce que je connais le type ». **Non**. Tu passes l'activité, point.

## 10. Troubleshooting Git Auth

**Pattern récurrent** : sur cette machine, le compte gh actif drift régulièrement vers
`sambassi` entre les sessions, alors que le repo `Afroboost44/spordate-v1` exige les
credentials du compte `Afroboost44`. Symptôme : `git push` retourne `403 Permission to
Afroboost44/spordate-v1.git denied to sambassi`.

**Fix préventif avant chaque push** :

```bash
# 1. Vérifier l'état actuel
gh auth status
# → si "Active account: true" est sur sambassi, switch :

# 2. Switcher vers Afroboost44
gh auth switch -u Afroboost44

# 3. Confirmer
gh auth status   # doit lister Afroboost44 en "Active account: true"
git push origin main
```

**Pourquoi ça drift** : les deux comptes `sambassi` et `Afroboost44` sont stockés dans
le keyring gh. `gh auth git-credential` retourne les creds du compte actif — si c'est
`sambassi`, git envoie le mauvais token. Le credential helper local pointe correctement
sur `gh` (`~/.gitconfig` : `credential.https://github.com.helper=!gh auth git-credential`),
le bug est uniquement au niveau de l'active account.

**Anti-pattern à éviter** : ne PAS supprimer `sambassi` du keyring (il sert pour
d'autres repos). Ne PAS clear l'osxkeychain GitHub (impact transverse). Le `gh auth
switch -u Afroboost44` préventif avant push est la solution propre.
