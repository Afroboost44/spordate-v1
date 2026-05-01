# CLAUDE.md — Guide de commandes Spordate

Ce fichier liste toutes les commandes nécessaires pour installer, lancer, tester et déployer Spordate. Claude doit consulter ce fichier avant toute action sur le projet.

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

## 7. Déploiement Vercel

```bash
# Déploiement preview (branche)
vercel

# Déploiement production (main)
vercel --prod
```

**Variables d'environnement à configurer dans Vercel :**
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
