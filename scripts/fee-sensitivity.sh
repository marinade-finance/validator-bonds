#!/usr/bin/env bash
#
# Sweep max_fee_bps for one epoch and print post-fee staker pmpe + APY.
# Inputs auto-fetched via regression-test-settlements.sh if missing.
#
# Usage: ./scripts/fee-sensitivity.sh <epoch> [<fees_bps>...] [--data-dir DIR]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="$REPO_ROOT/regression-data"
APY_API_URL="${APY_API_URL:-https://apy.marinade.finance}"
EPOCH=""
FEES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    *) [[ -z "$EPOCH" ]] && EPOCH="$1" || FEES+=("$1"); shift ;;
  esac
done

[[ -z "$EPOCH" ]] && { echo "usage: $0 <epoch> [<fees_bps>...]"; exit 2; }
[[ ${#FEES[@]} -eq 0 ]] && FEES=(200 650 1500)

IN="$DATA_DIR/$EPOCH/inputs"
INPUTS=(stakes.json sam-scores.json validators.json evaluation.json
        rewards/mev.json rewards/validators_mev.json rewards/inflation.json
        rewards/validators_inflation.json rewards/validators_blocks.json
        rewards/jito_priority_fee.json)
have_inputs() { for f in "${INPUTS[@]}"; do [[ -f "$IN/$f" ]] || return 1; done; }

if ! have_inputs; then
  echo "Fetching epoch $EPOCH inputs via regression-test-settlements.sh..." >&2
  "$SCRIPT_DIR/regression-test-settlements.sh" \
    --start-epoch "$EPOCH" --end-epoch "$EPOCH" --data-dir "$DATA_DIR" >&2 || true
  have_inputs || { echo "fetch failed: some inputs still missing under $IN"; exit 1; }
fi

CLI="$REPO_ROOT/target/release/bid-distribution-cli"
[[ -x "$CLI" ]] || cargo build --release --manifest-path "$REPO_ROOT/Cargo.toml" --bin bid-distribution-cli >&2

SSR_JSON=$(curl -fsSL "$APY_API_URL/v1/epoch-pmpe/ssr")
EPOCHS_PER_YEAR=$(jq --argjson e "$EPOCH" '
  [.epochs[] | select(.epoch == $e or .epoch == ($e - 1))] | sort_by(.epoch) as $p
  | if ($p | length) == 2 then (31557600 / ($p[1].time - $p[0].time)) else 182 end
' <<<"$SSR_JSON")
SSR_PMPE=$(jq --argjson e "$EPOCH" '.epochs[] | select(.epoch == $e) | .pmpe' <<<"$SSR_JSON")
apy() { jq -rn --argjson p "$1" --argjson n "$EPOCHS_PER_YEAR" '(pow(1 + $p/1000; $n) - 1) * 100 | . * 100 | round / 100 | tostring + "%"'; }

echo "epoch=$EPOCH  SSR pmpe=$SSR_PMPE  (APY=$(apy "$SSR_PMPE"))  epochs/yr≈${EPOCHS_PER_YEAR%.*}"
printf '%-12s  %-30s  %s\n' "max_fee_bps" "post-fee pmpe" "APY"
cfg=$(mktemp); trap 'rm -f "$cfg"' EXIT
for fee in "${FEES[@]}"; do
  sed -E "s/(max_fee_bps:)[[:space:]]*[0-9]+/\1 $fee/" "$REPO_ROOT/settlement-config.yaml" > "$cfg"
  pmpe=$(RUST_LOG="warn,bid_distribution::generators::bidding=info" "$CLI" \
    --settlement-config "$cfg" \
    --stake-meta-collection "$IN/stakes.json" \
    --sam-meta-collection "$IN/sam-scores.json" \
    --rewards-dir "$IN/rewards" \
    --validator-meta-collection "$IN/validators.json" \
    --revenue-expectation-collection "$IN/evaluation.json" \
    --output-settlement-collection /dev/null \
    --output-protected-event-collection /dev/null \
    --apy-api-url "$APY_API_URL" \
    2>&1 | grep -oE 'post-fee staker pmpe: [0-9.]+' | awk '{print $NF}')
  printf '%-12s  %-30s  %s\n' "$fee" "$pmpe" "$(apy "$pmpe")"
done
