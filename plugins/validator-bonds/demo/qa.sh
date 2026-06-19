#!/usr/bin/env bash
# Runs INSIDE a fresh debian:bookworm container (plugin already installed via demo-install).
# Shows: asking the skill a genuinely hard question about bond strategy.

export DEBIAN_FRONTEND=noninteractive
mkdir -p ~/.claude
printf '{"theme":"dark","sandbox":{"enabled":false}}\n' > ~/.claude/settings.json

RESET='\033[0m'; BOLD='\033[1m'
GREEN='\033[32m'; CYAN='\033[36m'; YELLOW='\033[33m'; BLUE='\033[34m'

type_out() {
    printf "${CYAN}❯ ${RESET}"
    local s="$1" i
    for ((i=0; i<${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.028; done
    printf '\n'
}
step() { printf "\n${BOLD}${YELLOW}  ── $1 ──${RESET}\n\n"; sleep 0.4; }

clear
printf "${BOLD}${BLUE}"
cat << 'BANNER'

  ╔═══════════════════════════════════════════════════════╗
  ║       Marinade Validator Bonds  ·  Claude Plugin      ║
  ║         "I want 1 million SOL. What's the plan?"      ║
  ╚═══════════════════════════════════════════════════════╝

BANNER
printf "${RESET}"
sleep 1

# ── 1. install Node.js + Claude Code (fast, quiet) ───────────────────────────
step "setup  ·  installing Claude Code"
bash -c "apt-get update -qq && apt-get install -yqq nodejs npm 2>&1 | tail -1"
bash -c "npm install -g @anthropic-ai/claude-code 2>&1 | tail -2"
bash -c "claude plugins marketplace add marinade-finance/validator-bonds 2>&1 | tail -1"
bash -c "claude plugins install validator-bonds 2>&1 | tail -1"
printf "${GREEN}  ✓ ready${RESET}\n"
sleep 0.8

# ── 2. the question ──────────────────────────────────────────────────────────
step "the question"

QUESTION="I want 1,000,000 SOL of Marinade stake on my validator.
Walk me through:
(a) what totalPmpe I need to win the auction,
(b) what minimum bond balance I need to hold at all times,
(c) what my bid costs me per epoch in absolute SOL,
(d) whether I can stay profitable — i.e., does the extra stake revenue
    outweigh the bid + bond opportunity cost?
Be specific. Show the formulas. Assume relaxedTotalPmpe = 140, bidPmpe = 50,
typical Solana epoch rewards ~0.00001 SOL per SOL staked."

type_out "claude -p \"\$QUESTION\""
printf '\n'
sleep 0.5

claude --output-format text -p "$QUESTION"

printf "\n${GREEN}${BOLD}  ✓  marinade-sam-bond plugin — psr.marinade.finance${RESET}\n\n"
sleep 2
