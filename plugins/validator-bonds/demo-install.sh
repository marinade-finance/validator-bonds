#!/usr/bin/env bash
# Runs INSIDE a fresh debian:bookworm container.
# Invoked by: docker run ... bash -s < demo-install.sh
# Records: installing Claude Code from scratch, then the validator-bonds plugin.

export DEBIAN_FRONTEND=noninteractive
RESET='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'
GREEN='\033[32m'; CYAN='\033[36m'; YELLOW='\033[33m'; BLUE='\033[34m'

type_out() {
    printf "${CYAN}❯ ${RESET}"
    local s="$1" i
    for ((i=0; i<${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.028; done
    printf '\n'
}
run() { type_out "$1"; shift; "$@"; }
step() { printf "\n${BOLD}${YELLOW}  ── $1 ──${RESET}\n\n"; sleep 0.4; }
ok()   { printf "\n${GREEN}${BOLD}  ✓ $1${RESET}\n"; }

clear
printf "${BOLD}${BLUE}"
cat << 'BANNER'

  ╔═══════════════════════════════════════════════════════╗
  ║       Marinade Validator Bonds  ·  Claude Plugin      ║
  ║              install from GitHub in 60 s              ║
  ╚═══════════════════════════════════════════════════════╝

BANNER
printf "${RESET}"
sleep 1

# ── 1. install Node.js ───────────────────────────────────────────────────────
step "1 / 4  Install Node.js"
run "apt-get update -qq && apt-get install -yqq nodejs npm" \
    bash -c "apt-get update -qq && apt-get install -yqq nodejs npm 2>&1 | tail -2"
ok "node $(node --version)"
sleep 0.8

# ── 2. install Claude Code ───────────────────────────────────────────────────
step "2 / 4  Install Claude Code"
run "npm install -g @anthropic-ai/claude-code" \
    bash -c "npm install -g @anthropic-ai/claude-code 2>&1 | tail -4"
ok "claude $(claude --version 2>/dev/null || echo 'installed')"
sleep 0.8

# ── 3. add marketplace ───────────────────────────────────────────────────────
step "3 / 4  Add the Marinade marketplace"
run "claude plugins marketplace add marinade-finance/validator-bonds" \
    claude plugins marketplace add marinade-finance/validator-bonds
sleep 0.8

# ── 4. install plugin ────────────────────────────────────────────────────────
step "4 / 4  Install the plugin"
run "claude plugins install validator-bonds" \
    claude plugins install validator-bonds
sleep 0.5

run "claude plugins list" \
    claude plugins list

printf "\n${GREEN}${BOLD}  ✓  Plugin installed. Restart Claude Code — skills load automatically.${RESET}\n\n"
sleep 2
