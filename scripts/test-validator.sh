#!/usr/bin/env bash
# Runs the test-validator integration suites, each spec file on a fresh solana-test-validator.
#
# Why not `anchor test`: it runs every suite on one validator. The suites create vote accounts
# of validators that never run and delegate stake to them; once that stake activates, those
# identities get leader slots. With 32-slot epochs the skipped slots push the root more than an
# epoch behind, the validator cannot compute the next leader schedule and stops producing blocks
# (~slot 1087); with longer epochs `getAnchorValidatorInfo` (anchor-common) rejects the setup
# ("expected only test validator being run and scheduled as leader"). Suites assume a fresh chain.
#
# The validator is configured from Test.toml ([test.validator] slots_per_epoch, [[test.genesis]],
# [[test.validator.account_dir]]) plus the program from Anchor.toml, deployed upgradeable with the
# wallet as upgrade authority, ledger in .anchor/test-ledger (tests read the validator identity
# from .anchor/test-ledger/validator-keypair.json).
#
# Usage:
#   scripts/test-validator.sh [spec-file...]   # default: all __tests__/test-validator/*.spec.ts
#   FILE=path/to/spec.ts scripts/test-validator.sh
# The program must be built first (target/deploy/validator_bonds.so), e.g. `pnpm anchor:build`.
# Env: ANCHOR_WALLET (default ~/.config/solana/id.json), RPC_PORT (default 8899),
#      VALIDATOR_START_TIMEOUT seconds (default 60), LOG_DIR (default .anchor/test-validator-logs).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
WALLET="${WALLET/#\~/$HOME}"
RPC_PORT="${RPC_PORT:-8899}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
START_TIMEOUT="${VALIDATOR_START_TIMEOUT:-60}"
LEDGER_DIR=".anchor/test-ledger"
LOG_DIR="${LOG_DIR:-.anchor/test-validator-logs}"
PROGRAM_SO="target/deploy/validator_bonds.so"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

command -v solana-test-validator > /dev/null || die "solana-test-validator not found on PATH"
command -v solana-keygen > /dev/null || die "solana-keygen not found on PATH"
[[ -f "$WALLET" ]] || die "wallet keypair not found at $WALLET (set ANCHOR_WALLET)"
[[ -f "$PROGRAM_SO" ]] || die "$PROGRAM_SO not found, build the program first (pnpm anchor:build)"

PROGRAM_ID=$(sed -n '/^\[programs.localnet\]/,/^\[/{s/^validator_bonds *= *"\(.*\)"/\1/p}' Anchor.toml)
[[ -n "$PROGRAM_ID" ]] || die "cannot read [programs.localnet] validator_bonds from Anchor.toml"
WALLET_PUBKEY=$(solana-keygen pubkey "$WALLET")

# Test.toml -> solana-test-validator arguments
VALIDATOR_ARGS=()
while IFS=$'\t' read -r kind a b; do
  case "$kind" in
    slots) VALIDATOR_ARGS+=(--slots-per-epoch "$a") ;;
    genesis) VALIDATOR_ARGS+=(--bpf-program "$a" "$b") ;;
    accountdir) VALIDATOR_ARGS+=(--account-dir "$a") ;;
  esac
done < <(awk '
  function val(line) { sub(/^[^=]*= */, "", line); gsub(/^"|"[ \t]*$/, "", line); return line }
  /^\[/ { section = $0; gsub(/[ \t]+$/, "", section); next }
  section == "[test.validator]" && /^slots_per_epoch/ { print "slots\t" val($0) }
  section == "[[test.genesis]]" && /^address/ { addr = val($0) }
  section == "[[test.genesis]]" && /^program/ { print "genesis\t" addr "\t" val($0) }
  section == "[[test.validator.account_dir]]" && /^directory/ { print "accountdir\t" val($0) }
' Test.toml)

if [[ $# -gt 0 ]]; then
  SPECS=("$@")
elif [[ -n "${FILE:-}" ]]; then
  SPECS=("$FILE")
else
  SPECS=()
  while IFS= read -r spec; do SPECS+=("$spec"); done < <(find packages settlement-pipelines \
    -path '*/node_modules' -prune -o -path '*/__tests__/test-validator/*.spec.ts' -print | sort)
fi
[[ ${#SPECS[@]} -gt 0 ]] || die "no spec files found"

VALIDATOR_PID=""
stop_validator() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2> /dev/null; then
    kill "$VALIDATOR_PID" 2> /dev/null || true
    wait "$VALIDATOR_PID" 2> /dev/null || true
  fi
  VALIDATOR_PID=""
}
trap stop_validator EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rpc_up() {
  curl -fsS -m 2 -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL" 2> /dev/null | grep -q '"ok"'
}

if rpc_up; then
  die "something already serves RPC at $RPC_URL, stop it first (another solana-test-validator?)"
fi

start_failed() {
  echo "ERROR: $1" >&2
  echo "--- solana-test-validator output" >&2
  tail -n 40 "$LOG_DIR/validator-start.out" >&2 2> /dev/null || true
  echo "--- $LEDGER_DIR/validator.log (tail)" >&2
  tail -n 40 "$LEDGER_DIR/validator.log" >&2 2> /dev/null || true
  cp "$LOG_DIR/validator-start.out" "$LOG_DIR/$2.validator-start.out" 2> /dev/null || true
  cp "$LEDGER_DIR/validator.log" "$LOG_DIR/$2.validator-start.log" 2> /dev/null || true
  return 1
}

# returns non-zero (after printing the reason) when the validator does not come up;
# $1 names the spec file the logs are kept for
start_validator() {
  local log_name=$1
  mkdir -p .anchor
  solana-test-validator --reset --quiet \
    --ledger "$LEDGER_DIR" \
    --rpc-port "$RPC_PORT" \
    --mint "$WALLET_PUBKEY" \
    --upgradeable-program "$PROGRAM_ID" "$PROGRAM_SO" "$WALLET_PUBKEY" \
    "${VALIDATOR_ARGS[@]}" > "$LOG_DIR/validator-start.out" 2>&1 &
  VALIDATOR_PID=$!
  local waited=0
  until rpc_up; do
    kill -0 "$VALIDATOR_PID" 2> /dev/null || {
      start_failed "solana-test-validator exited on start" "$log_name"
      return 1
    }
    ((waited++ < START_TIMEOUT)) || {
      start_failed "solana-test-validator not healthy after ${START_TIMEOUT}s" "$log_name"
      return 1
    }
    sleep 1
  done
}

mkdir -p "$LOG_DIR"
FAILED=()
START_ALL=$(date +%s)
for spec in "${SPECS[@]}"; do
  echo "=== $spec"
  log_name=$(echo "$spec" | tr '/' '_')
  if ! start_validator "$log_name"; then
    FAILED+=("$spec (validator did not start)")
    stop_validator
    continue
  fi
  if ANCHOR_PROVIDER_URL="$RPC_URL" ANCHOR_WALLET="$WALLET" FILE="$spec" pnpm _test; then
    :
  else
    FAILED+=("$spec")
    cp "$LEDGER_DIR/validator.log" "$LOG_DIR/$log_name.validator.log" 2> /dev/null || true
  fi
  stop_validator
done

echo
echo "=== ${#SPECS[@]} spec files in $(($(date +%s) - START_ALL))s, ${#FAILED[@]} failed"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf '  FAILED: %s\n' "${FAILED[@]}"
  echo "  validator logs of failed files: $LOG_DIR"
  exit 1
fi
