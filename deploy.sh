#!/usr/bin/env bash
# deploy.sh — Déploiement Spordateur Mac → Hetzner (Docker Compose / Coolify).
#
# Usage :
#   ./deploy.sh                     # full deploy : typecheck + rsync + docker rebuild
#   ./deploy.sh --check             # typecheck only, pas de deploy
#   ./deploy.sh --no-typecheck      # skip typecheck (urgence — à éviter)
#   ./deploy.sh --no-build          # rsync uniquement + restart (sans rebuild Docker)
#   ./deploy.sh --help
#
# Remplace l'ancien workflow manuel :
#   tar czf ... && scp ... && ssh ... docker compose up --build
#
# Approche : rsync incrémental des sources → build Docker sur le serveur
# (Hetzner amd64 natif ≈ 2–3 min, vs build local Mac M4 cross-compile QEMU ≈ 5–8 min).

set -euo pipefail

# =====================================================================
# Configuration
# =====================================================================

REMOTE_HOST="178.105.201.62"
REMOTE_USER="root"
REMOTE_PATH="/opt/spordateur"
SSH_KEY="$HOME/.ssh/hetzner_afroboost"
CONTAINER="spordateur"

# =====================================================================
# UI helpers
# =====================================================================

C_GREEN="\033[0;32m"
C_RED="\033[0;31m"
C_YELLOW="\033[1;33m"
C_CYAN="\033[0;36m"
C_DIM="\033[2m"
C_BOLD="\033[1m"
C_NONE="\033[0m"

log()  { printf "${C_CYAN}[deploy]${C_NONE} %s\n" "$*"; }
ok()   { printf "${C_GREEN}✓${C_NONE} %s\n" "$*"; }
err()  { printf "${C_RED}✗ %s${C_NONE}\n" "$*" >&2; exit 1; }
warn() { printf "${C_YELLOW}⚠ %s${C_NONE}\n" "$*"; }
step() { printf "\n${C_BOLD}${C_CYAN}▶ %s${C_NONE}\n" "$*"; }
dim()  { printf "${C_DIM}%s${C_NONE}\n" "$*"; }

# =====================================================================
# Args
# =====================================================================

DO_TYPECHECK=1
DO_BUILD=1
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-typecheck) DO_TYPECHECK=0 ;;
    --no-build)     DO_BUILD=0 ;;
    --check)        CHECK_ONLY=1 ;;
    --help|-h)
      sed -n '1,15p' "$0" | sed 's/^# *//'
      exit 0
      ;;
    *) err "Argument inconnu : $arg (utilise --help)";;
  esac
done

# =====================================================================
# Préchecks
# =====================================================================

# Se placer dans le dossier du script (= racine du projet)
cd "$(dirname "$0")"

[[ -f package.json ]] || err "package.json introuvable — le script doit être à la racine du projet."
command -v rsync > /dev/null || err "rsync n'est pas installé."

START_TS=$(date +%s)

# =====================================================================
# 1. Typecheck local
# =====================================================================

if [[ $DO_TYPECHECK -eq 1 ]]; then
  step "Typecheck TypeScript"
  if ! npm run typecheck > /tmp/spordate-tc.log 2>&1; then
    cat /tmp/spordate-tc.log
    err "Typecheck échoué. Corrige avant de redéployer (ou --no-typecheck pour forcer)."
  fi
  ok "Typecheck OK."
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  ok "Mode --check : pas de déploiement."
  exit 0
fi

# =====================================================================
# 2. SSH connectivity
# =====================================================================

step "Connexion SSH au serveur"
[[ -f "$SSH_KEY" ]] || err "Clé SSH introuvable : $SSH_KEY"
if ! ssh -i "$SSH_KEY" -o ConnectTimeout=5 "$REMOTE_USER@$REMOTE_HOST" "echo OK" > /dev/null 2>&1; then
  err "Impossible de joindre $REMOTE_HOST. VPN/réseau ?"
fi
ok "Serveur joignable."

# =====================================================================
# 3. Rsync code → serveur
# =====================================================================

step "Synchronisation des fichiers (rsync incrémental)"
SYNC_START=$(date +%s)
# Excludes :
#  - node_modules / .next / .git : trop lourd, géré côté Docker build
#  - .env* : on ne touche pas aux env du serveur (gérés via docker-compose)
#  - outputs / *.tar.gz / *.log : artefacts locaux
rsync -az \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='.vscode' \
  --exclude='.idea' \
  --exclude='.DS_Store' \
  --exclude='.env*' \
  --exclude='/outputs' \
  --exclude='/marketing' \
  --exclude='*.tar.gz' \
  --exclude='*.log' \
  -e "ssh -i $SSH_KEY" \
  ./ \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"
SYNC_END=$(date +%s)
ok "Sync terminé en $((SYNC_END - SYNC_START))s."

# =====================================================================
# 4. Build + restart Docker (sauf si --no-build)
# =====================================================================

if [[ $DO_BUILD -eq 0 ]]; then
  step "Restart container (sans rebuild)"
  ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" \
    "cd $REMOTE_PATH && docker compose restart $CONTAINER"
  ok "Container restarté."
else
  step "Build Docker + restart (≈ 2–3 min)"
  BUILD_START=$(date +%s)
  ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" \
    "cd $REMOTE_PATH && DOCKER_BUILDKIT=1 docker compose up -d --force-recreate --build"
  BUILD_END=$(date +%s)
  ok "Build + restart en $((BUILD_END - BUILD_START))s."
fi

# =====================================================================
# 5. Healthcheck container
# =====================================================================

step "Vérification du container"
sleep 3
STATUS=$(ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "docker ps --filter name=$CONTAINER --format '{{.Status}}'" 2>/dev/null || echo "")

if [[ -z "$STATUS" ]]; then
  warn "Container $CONTAINER introuvable. Vérifie : ssh ... 'docker ps -a'"
elif [[ "$STATUS" == *"healthy"* || "$STATUS" == *"Up"* ]]; then
  ok "Container : $STATUS"
else
  warn "Statut inattendu : $STATUS"
  dim "  Logs : ssh -i $SSH_KEY $REMOTE_USER@$REMOTE_HOST 'docker logs --tail 30 $CONTAINER'"
fi

# =====================================================================
# Récap
# =====================================================================

END_TS=$(date +%s)
TOTAL=$((END_TS - START_TS))
echo
ok "Déploiement terminé en ${TOTAL}s ✨"
dim "→ https://spordateur.com  (⌘+Shift+R pour bypass le cache PWA)"
