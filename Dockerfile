# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Spordateur — Dockerfile multi-stage pour Coolify (Hetzner 4 Go RAM)
#
# Cible : produire une image Node.js minimale (~200 Mo) qui exécute le serveur
# Next.js standalone. Trois stages séparés pour optimiser le cache de build :
#   1. deps    → installe les dépendances (npm ci)
#   2. builder → build Next.js (génère .next/standalone + .next/static)
#   3. runner  → image finale minimaliste, user non-root, port 3000
#
# Build local :
#   docker build -t spordateur:test .
#   docker run --rm -p 3000:3000 --env-file .env.local spordateur:test
#
# Optimisation RAM (Hetzner 4 Go partagés avec Afroboost) :
#   - `NODE_OPTIONS=--max_old_space_size=3072` injecté au stage builder
#   - `node:20-alpine` (~50 Mo base vs ~900 Mo node:20)
#   - Stage runner ne copie QUE le strict nécessaire
# ---------------------------------------------------------------------------

ARG NODE_VERSION=20-alpine

# ---------------------------------------------------------------------------
# Stage 1 : install dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# libc6-compat : requis par certaines deps natives (sharp, satori, resvg-js,
# Prisma engines) compilées contre glibc. Alpine utilise musl, ce compat layer
# évite "Error loading shared library ld-linux-x86-64.so.2".
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
# `--prefer-offline` : utilise le cache npm local quand dispo (gain Docker layer)
# `--no-audit` / `--no-fund` : skip étapes inutiles dans CI/build
# `--ignore-scripts` : on évite les postinstall scripts ici, on les déclenche
# explicitement au stage builder (prisma generate notamment, idempotent).
RUN npm ci --prefer-offline --no-audit --no-fund --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 2 : build Next.js (standalone output)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

# Copie node_modules pré-installées du stage deps (gain : 30-60s)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variables d'env de BUILD time uniquement (placeholders côté Firebase :
# valeurs réelles fournies à l'exécution par Coolify). Les NEXT_PUBLIC_* sont
# inlinés dans le bundle côté client par Next.js au moment du build, donc
# DOIVENT être présents — Coolify les passe via --build-arg ou variables UI.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL

ENV NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}
ENV NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}
ENV NEXT_PUBLIC_FIREBASE_VAPID_KEY=${NEXT_PUBLIC_FIREBASE_VAPID_KEY}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Hetzner 4 Go partagés → cap V8 heap à 3 Go pour laisser de la marge OS/Afroboost
ENV NODE_OPTIONS=--max-old-space-size=3072

# Prisma client (legacy, src/lib/prisma.ts) — generate pour éviter
# "@prisma/client did not initialize yet" si jamais chargé au runtime.
RUN npx prisma generate

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 : runner (image finale minimaliste)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# wget pour le HEALTHCHECK (curl absent de node:alpine par défaut)
RUN apk add --no-cache libc6-compat wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# User non-root (security best practice)
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output : Next.js produit un dossier autonome avec server.js +
# node_modules minimisé. On copie .next/standalone à la racine, puis on remet
# .next/static et public à leur emplacement attendu par server.js.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

# server.js est le point d'entrée généré par output:'standalone'
CMD ["node", "server.js"]
