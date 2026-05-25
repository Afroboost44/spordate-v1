#!/usr/bin/env bash
# deploy.sh — Déploiement Spordateur via Coolify auto-deploy (depuis #131).
#
# Usage :
#   ./deploy.sh                       # commit auto + push (message: "deploy YYYY-MM-DD HH:MM")
#   ./deploy.sh "mon message"         # commit avec message custom + push
#   ./deploy.sh --skip-typecheck      # skip le typecheck local (urgence)
#   ./deploy.sh --check               # typecheck only, pas de push
#
# Workflow :
#   1. Nettoie .git/index.lock résiduel
#   2. Switch gh auth vers Afroboost44 si drift (cf. CLAUDE.md §10)
#   3. Lance typecheck local (catch les erreurs avant push)
#   4. git add -A → commit → push origin main
#   5. Coolify détecte le push, build le Docker, déploie automatiquement
#
# Remplace l'ancien workflow rsync → Hetzner manuel. Pour l'historique :
# voir git log avant 2026-05-22 (commit 3ccaeb1 Phase 1 Coolify).

set -euo pipefail

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

# =====================================================================
# Args
# =====================================================================

SKIP_TYPECHECK=false
CHECK_ONLY=false
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-typecheck) SKIP_TYPECHECK=true; shift ;;
    --check) CHECK_ONLY=true; shift ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    -*) err "Unknown option: $1" ;;
    *) COMMIT_MSG="$1"; shift ;;
  esac
done

# Default message si rien fourni
if [[ -z "$COMMIT_MSG" ]]; then
  COMMIT_MSG="deploy $(date '+%Y-%m-%d %H:%M')"
fi

# =====================================================================
# 1. Cleanup git index lock
# =====================================================================

step "Cleanup git lock"
if [[ -f .git/index.lock ]]; then
  warn ".git/index.lock présent — suppression"
  rm -f .git/index.lock
fi
ok "git prêt"

# =====================================================================
# 2. Typecheck local (catch erreurs avant push)
# =====================================================================

if [[ "$SKIP_TYPECHECK" == false ]]; then
  step "TypeScript check"
  if npx tsc --noEmit 2>&1 | tee /tmp/spordate-tsc.log | grep -q "error TS"; then
    err "TypeScript errors détectés — fix avant push (cf. /tmp/spordate-tsc.log)"
  fi
  ok "TypeScript clean"
else
  warn "Typecheck skippé (--skip-typecheck)"
fi

if [[ "$CHECK_ONLY" == true ]]; then
  ok "Check only — pas de push (--check)"
  exit 0
fi

# =====================================================================
# 3. Vérification compte gh (cf. CLAUDE.md §10)
# =====================================================================

step "Vérification compte gh"
if command -v gh &>/dev/null; then
  ACTIVE=$(gh auth status 2>&1 | grep -E "Active account: true" -B 3 | grep "account" | awk '{print $NF}' | tr -d '\n' || true)
  if [[ "$ACTIVE" != "Afroboost44" ]]; then
    warn "Compte gh actif drift ($ACTIVE) → switch vers Afroboost44"
    gh auth switch -u Afroboost44 || err "Échec gh auth switch — vérifier que Afroboost44 est dans le keyring"
  fi
  ok "gh sur Afroboost44"
else
  warn "gh CLI absent — push pourrait échouer avec 403 si drift account"
fi

# =====================================================================
# 4. git add + commit + push
# =====================================================================

step "Stage des changements"
git add -A

# Vérifie s'il y a vraiment des changements à commiter
if git diff --cached --quiet; then
  warn "Aucun changement à commiter — push direct au cas où des commits locaux attendent"
else
  log "Commit message : \"$COMMIT_MSG\""
  git commit -m "$COMMIT_MSG"
  ok "Commit créé"
fi

step "Push origin main"
git push origin main || err "Échec push — vérifier gh auth status + connexion"
ok "Push réussi"

# =====================================================================
# 5. Confirmation Coolify
# =====================================================================

step "Déploiement Coolify"
log "Coolify va détecter le push et build automatiquement."
log "Build attendu : ~2-3 min sur Hetzner amd64."
log "Suivre le build : https://coolify.spordateur.com (dashboard)"
ok "Deploy lancé"

printf "\n${C_GREEN}${C_BOLD}🚀 Spordateur deploy en cours.${C_NONE}\n"
printf "${C_DIM}Site : https://spordateur.com${C_NONE}\n\n"
