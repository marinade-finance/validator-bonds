#!/usr/bin/env bash
#
# Sweep max_fee_bps over an epoch range and print post-fee staker pmpe + APY.
# Inputs auto-fetched via regression-test-settlements.sh if missing.
#
# Usage: ./scripts/fee-sensitivity.sh <epoch|start-end> <fees_bps>... [--data-dir DIR]
# e.g.   ./scripts/fee-sensitivity.sh 973 500 700
#        ./scripts/fee-sensitivity.sh 970-973 500 700
# Must be run from repo root.

set -Eeuo pipefail

[[ -f Cargo.toml ]] || { echo "run from repo root"; exit 1; }

usage() {
  echo "usage: ./scripts/fee-sensitivity.sh [-r] <epoch|start-end> <fees_bps>... [--data-dir DIR]"
  exit 2
}

DATA_DIR="./regression-data"
APY_API_URL="${APY_API_URL:-https://apy.marinade.finance}"
RELEASE=""
EPOCH_ARG=""
FEES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    -r) RELEASE=1; shift ;;
    *) [[ -z "$EPOCH_ARG" ]] && EPOCH_ARG="$1" || FEES+=("$1"); shift ;;
  esac
done

[[ -z "$EPOCH_ARG" ]] && usage
[[ ${#FEES[@]} -eq 0 ]] && usage

if [[ "$EPOCH_ARG" == *-* ]]; then
  EPOCH_START="${EPOCH_ARG%-*}"
  EPOCH_END="${EPOCH_ARG#*-}"
  [[ "$EPOCH_START" -le "$EPOCH_END" ]] || { echo "invalid range: $EPOCH_ARG"; exit 2; }
else
  EPOCH_START="$EPOCH_ARG"
  EPOCH_END="$EPOCH_ARG"
fi

if [[ -n "$RELEASE" ]]; then
  CLI="./target/release/bid-distribution-cli"
  [[ -x "$CLI" ]] || cargo build --release --bin bid-distribution-cli >&2
else
  CLI="./target/debug/bid-distribution-cli"
  [[ -x "$CLI" ]] || cargo build --bin bid-distribution-cli >&2
fi

SSR_JSON=$(curl -fsSL "$APY_API_URL/v1/epoch-pmpe/ssr")
apy() {
  jq -rn --argjson p "$1" --argjson n "$2" \
    '(pow(1 + $p/1000; $n) - 1) * 100 | . * 100 | round / 100 | tostring + "%"'
}

cfg=$(mktemp)
trap 'rm -f "$cfg"' EXIT

have_inputs() {
  local IN="$DATA_DIR/$1/inputs"
  for f in stakes.json sam-scores.json validators.json evaluation.json \
            rewards/mev.json rewards/validators_mev.json rewards/inflation.json \
            rewards/validators_inflation.json rewards/validators_blocks.json \
            rewards/jito_priority_fee.json
  do [[ -f "$IN/$f" ]] || return 1; done
}

echo "epochs:"
for epoch in $(seq "$EPOCH_START" "$EPOCH_END"); do
  IN="$DATA_DIR/$epoch/inputs"

  if ! have_inputs "$epoch"; then
    echo "  # fetching $epoch..." >&2
    ./scripts/regression-test-settlements.sh \
      --start-epoch "$epoch" --end-epoch "$epoch" --data-dir "$DATA_DIR" >&2 || true
    have_inputs "$epoch" || { echo "  # fetch failed for $epoch, skipping" >&2; continue; }
  fi

  EPY=$(jq --argjson e "$epoch" '
    [.epochs[] | select(.epoch == $e or .epoch == ($e - 1))] | sort_by(.epoch) as $p
    | if ($p | length) == 2 then (31557600 / ($p[1].time - $p[0].time)) else 182 end
  ' <<<"$SSR_JSON")
  SSR=$(jq --argjson e "$epoch" '.epochs[] | select(.epoch == $e) | .pmpe' <<<"$SSR_JSON")

  echo "- epoch: $epoch"
  echo "  ssr_pmpe: $SSR"
  echo "  ssr_apy: $(apy "$SSR" "$EPY")"
  echo "  epochs_per_year: ${EPY%.*}"
  echo "  fees:"

  for fee in "${FEES[@]}"; do
    sed -E "s/(max_fee_bps:)[[:space:]]*[0-9]+/\1 $fee/" ./settlement-config.yaml > "$cfg"
    grep -q "max_fee_bps: $fee" "$cfg" || { echo "Failed to patch max_fee_bps=$fee" >&2; exit 1; }
    log=$(mktemp)
    RUST_LOG="warn,bid_distribution::generators::bidding=info" "$CLI" \
      --settlement-config "$cfg" \
      --stake-meta-collection "$IN/stakes.json" \
      --sam-meta-collection "$IN/sam-scores.json" \
      --rewards-dir "$IN/rewards" \
      --validator-meta-collection "$IN/validators.json" \
      --revenue-expectation-collection "$IN/evaluation.json" \
      --output-settlement-collection /dev/null \
      --output-protected-event-collection /dev/null \
      --apy-api-url "$APY_API_URL" \
      2>"$log"
    grep -E ' ERROR |Network-wide|SSR cap' "$log" >&2 || true
    pmpe=$(grep -oE 'post-fee staker pmpe: adj: [0-9.]+' "$log" | awk '{print $NF}')
    rm -f "$log"
    [[ -n "$pmpe" ]] || { echo "  # no pmpe output for fee=$fee epoch=$epoch" >&2; continue; }
    echo "  - max_fee_bps: $fee"
    echo "    post_fee_pmpe: $pmpe"
    echo "    apy: $(apy "$pmpe" "$EPY")"
  done
done
