#!/usr/bin/env bash
# Computes gross / actual / full-fee pmpe + APY from bid-distribution-settlements.json
# and prints a markdown table suitable for buildkite-agent annotate.
# All values derived from existing data — no CLI re-run needed.
set -euo pipefail

settlements_file="${1:?Usage: $0 <settlements.json> [settlement-config.yaml]}"
config_file="${2:-./settlement-config.yaml}"
apy_url="${APY_API_URL:-https://apy.marinade.finance}"

max_fee_bps=$(yq -r '.fee_config.max_fee_bps' "$config_file")
min_fee_bps=$(yq -r '.fee_config.min_fee_bps' "$config_file")

# Extract epoch, stake/gross/fees (lamports), ncap, nbidding in one jq pass.
# - stake/gross: from Bidding settlements with non-null details
# - fees: marinade_fee_claim + dao_fee_claim summed across ALL settlements
# - ncap: validators where actual fees < theoretical full fee * 0.9999 (SSR-capped)
IFS=$'\t' read -r epoch stake gross fees ncap nbidding < <(
  jq -r --argjson fee "$max_fee_bps" '
    (.settlements | map(select(.reason == "Bidding" and .details != null))) as $bids |
    [
      .epoch,
      ($bids | map(.details.total_marinade_active_stake) | add // 0),
      ($bids | map(.details.total_marinade_stakers_rewards | tonumber) | add // 0),
      (.settlements | map((.details.marinade_fee_claim // 0) + (.details.dao_fee_claim // 0)) | add // 0),
      ($bids | map(select(
        (.details.total_marinade_stakers_rewards | tonumber) > 0 and
        (.details.marinade_fee_claim + .details.dao_fee_claim) <
          (.details.total_marinade_stakers_rewards | tonumber) * $fee / 10000 * 0.9999
      )) | length),
      ($bids | length)
    ] | @tsv
  ' "$settlements_file"
)

if [[ "$nbidding" -eq 0 || "$stake" = "0" ]]; then
  printf '### Fee Analysis — Epoch %s\nNo Bidding settlements found.\n' "$epoch"
  exit 0
fi

# Epochs per year from SSR timing; fallback 182 if API unavailable or epoch missing.
ssr_json=$(curl -fsSL --max-time 15 "${apy_url}/v1/epoch-pmpe/ssr" 2>/dev/null || echo '{"epochs":[]}')
epy=$(jq --argjson e "$epoch" '
  (.epochs | map(select(.epoch == $e))     | first) as $cur |
  (.epochs | map(select(.epoch == ($e-1))) | first) as $prev |
  if $cur == null or $prev == null then 182
  else 31557600 / ($cur.time - $prev.time)
  end
' <<< "$ssr_json")

# All math via awk (handles floats; exp/log for APY compound formula)
read -r pmpe_gross pmpe_adj pmpe_max fees_actual fees_full apy_gross apy_adj apy_max delta_adj delta_max < <(
  awk -v gross="$gross" -v stake="$stake" -v fees="$fees" \
      -v fee_bps="$max_fee_bps" -v epy="$epy" 'BEGIN {
    pmpe_gross = gross / stake * 1000
    pmpe_adj   = (gross - fees) / stake * 1000
    pmpe_max   = gross * (1 - fee_bps / 10000) / stake * 1000
    fees_sol   = fees / 1e9
    fees_full  = gross * fee_bps / 10000 / 1e9
    apy_gross  = (exp(epy * log(1 + pmpe_gross / 1000)) - 1) * 100
    apy_adj    = (exp(epy * log(1 + pmpe_adj   / 1000)) - 1) * 100
    apy_max    = (exp(epy * log(1 + pmpe_max   / 1000)) - 1) * 100
    printf "%.6f\t%.6f\t%.6f\t%.3f\t%.3f\t%.2f\t%.2f\t%.2f\t%+.2f\t%+.2f\n",
      pmpe_gross, pmpe_adj, pmpe_max, fees_sol, fees_full,
      apy_gross, apy_adj, apy_max,
      apy_adj - apy_gross, apy_max - apy_gross
  }'
)

cat <<EOF
### Fee Analysis — Epoch ${epoch}   (max_fee_bps: ${max_fee_bps}, min_fee_bps: ${min_fee_bps})

| scenario  | fee ◎        | pmpe         | APY     | vs gross  |
|-----------|--------------|--------------|---------|-----------|
| gross     | 0.000        | ${pmpe_gross} | ${apy_gross}%  | —         |
| actual    | ${fees_actual} | ${pmpe_adj} | ${apy_adj}%  | ${delta_adj}pp |
| full fee  | ${fees_full} | ${pmpe_max} | ${apy_max}%  | ${delta_max}pp |

${ncap} of ${nbidding} Bidding validators were SSR-capped (paid less than full fee)
EOF
