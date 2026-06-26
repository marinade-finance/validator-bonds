#!/bin/bash

set -e

# Deterministic decimal-point formatting regardless of the caller's locale
export LC_NUMERIC=C

settlement_collection_file="$1"
settlement_type="$2"
if [[ -z $settlement_collection_file ]]
then
    echo "Usage: $0 <settlement collection file> [settlement type label]" >&2
    exit 1
fi

epoch="$(<"$settlement_collection_file" jq '.epoch' -r)"
settlements_count=$(<"$settlement_collection_file" jq '.settlements | length' -r)
if (( settlements_count == 0 ))
then
    echo "No settlements in epoch '$epoch'."
    exit
fi

# Stake sums below rely on the claim 'kind' tag; legacy (pre-kind) JSON would silently report 0
untagged_claims=$(<"$settlement_collection_file" jq '[.settlements[].claims[] | select(has("kind") | not)] | length' -r)
if (( untagged_claims > 0 ))
then
    echo "Error: $untagged_claims claims without 'kind' field — '$settlement_collection_file' is a legacy (pre-kind) settlement collection; regenerate it or use the pre-refactor script version." >&2
    exit 1
fi

decimal_format="%0.9f"

function fmt_human_number {
    integer_part=$(echo "$@" | cut -d. -f1)
    numfmt -d. --to si "$integer_part" | tr 'K' 'k'
}
export -f fmt_human_number

total_amount=$(<"$settlement_collection_file" jq '[.settlements[].claims_amount / 1e9] | add' | xargs printf $decimal_format)
label=""
if [[ -n $settlement_type ]]; then
  label=" $settlement_type"
fi
echo "Settlements${label} in epoch $epoch: $settlements_count total, ☉$total_amount"

# Per-reason breakdown: count and total amount
while IFS=$'\t' read -r reason_key count amount; do
  echo "  $reason_key: $count settlements, ☉$(printf $decimal_format "$amount")"
done < <(<"$settlement_collection_file" jq -r '
  [.settlements[] | {
    reason_key: (
      if .reason | type == "object" then
        (.reason | keys[0]) as $k |
        if $k == "ProtectedEvent" then
          "ProtectedEvent/" + (.reason.ProtectedEvent | keys[0])
        else $k end
      else .reason end
    ),
    amount: (.claims_amount / 1e9)
  }]
  | group_by(.reason_key)
  | map({reason_key: .[0].reason_key, count: length, amount: (map(.amount) | add)})
  | sort_by(.reason_key)
  | .[]
  | [.reason_key, (.count | tostring), .amount] | @tsv
')
echo
echo "                                vote account    settlement                        reason  stake       funded by"
echo "--------------------------------------------+-------------+-----------------------------+--------+-------------"
while read -r settlement
do
    reason=""
    vote_account=$(<<<"$settlement" jq '.vote_account' -r)
    claims_amount=$(<<<"$settlement" jq '.claims_amount / 1e9' -r | xargs printf $decimal_format)

    # Marinade stake the settlement charges the validator for, read from settlement details.
    # Claim-level active_stake is 0 when the whole bid is captured as fee; ProtectedEvent has no details, so fall back to the claim sum.
    active_basis=$(<<<"$settlement" jq -r '(.details // {}) as $d | ($d.total_marinade_active_stake // 0) as $a | (if $a > 0 then $a else ([.claims[].active_stake] | add // 0) end) / 1e9' | xargs -I{} bash -c 'fmt_human_number "$@"' _ {})
    activating_basis=$(<<<"$settlement" jq -r '(.details // {}) as $d | ($d.total_marinade_activating_stake // 0) as $g | (if $g > 0 then $g else ([.claims[].activating_stake // 0] | add // 0) end) / 1e9' | xargs -I{} bash -c 'fmt_human_number "$@"' _ {})
    if [ "$activating_basis" != "0" ]; then
        # Activating-stake settlement (PriorityFee): "+" sign before ☉ marks activating
        stake_sign="+"
        stake_value="$activating_basis"
    else
        stake_sign=" "
        stake_value="$active_basis"
    fi
    # Right-align integer part of value, left-align trailing (decimal/unit) so
    # units digits line up under each other regardless of suffix or fraction.
    if [[ "$stake_value" == *.* ]]; then
        stake_int="${stake_value%%.*}"
        stake_tail=".${stake_value#*.}"
    else
        stake_unit_char="${stake_value: -1}"
        if [[ "$stake_unit_char" =~ [kMGT] ]]; then
            stake_int="${stake_value:0:-1}"
            stake_tail="$stake_unit_char"
        else
            stake_int="$stake_value"
            stake_tail=""
        fi
    fi
    stake_display=$(printf "%s☉%3s%-3s" "$stake_sign" "$stake_int" "$stake_tail")
    
    reason_code=$(<<<"$settlement" jq '.reason | keys[0]' -r 2> /dev/null || <<<"$settlement" jq '.reason' -r)

    if  [[ $reason_code == "ProtectedEvent" ]]; then
      protected_event_code=$(<<<"$settlement" jq '.reason.ProtectedEvent | keys[0]' -r)
      protected_event_attributes=$(<<<"$settlement" jq '.reason.ProtectedEvent | to_entries[0].value' -r)

      case $protected_event_code in
          # ---- V2 SAM events ----
          CommissionSamIncrease)
            # last epoch inflation commission
            past_inflation_commission=$(<<<"$protected_event_attributes" jq '.past_inflation_commission')
            # inflation when SAM was run
            expected_inflation_commission=$(<<<"$protected_event_attributes" jq '.expected_inflation_commission')
            # inflation after SAM auction was run
            actual_inflation_commission=$(<<<"$protected_event_attributes" jq '.actual_inflation_commission')
            reason="Commission $(bc <<<"scale=1; $past_inflation_commission*100/1")%/$(bc <<<"scale=1; $expected_inflation_commission*100/1")% -> $(bc <<<"scale=1; $actual_inflation_commission*100/1")%"
            ;;

          DowntimeRevenueImpact)
            actual_credits=$(<<<"$protected_event_attributes" jq '.actual_credits')
            expected_credits=$(<<<"$protected_event_attributes" jq '.expected_credits')
            reason="Uptime $(bc <<<"scale=2; 100 * $actual_credits / $expected_credits")%"
            ;;

          # ---- V1 events ----
          LowCredits)
            actual_credits=$(<<<"$protected_event_attributes" jq '.actual_credits')
            expected_credits=$(<<<"$protected_event_attributes" jq '.expected_credits')
            reason="Uptime $(bc <<<"scale=2; 100 * $actual_credits / $expected_credits")%"
            ;;

          CommissionIncrease)
            reason="Commission $(<<<"$protected_event_attributes" jq '.previous_commission')% -> $(<<<"$protected_event_attributes" jq '.current_commission')%"
            ;;

          *)
            echo "Unexpected protected event code: '$protected_event_code'" >&2
            exit 1
            ;;
      esac
    fi

    case $reason_code in
        Bidding)
            reason="Bidding"
            ;;
        PriorityFee)
            reason="PriorityFee"
            ;;
        BidTooLowPenalty)
            reason="BidTooLow"
            ;;
        BlacklistPenalty)
            reason="Blacklist"
            ;;
        BondRiskFee)
            reason="BondRisk"
            ;;
        InstitutionalPayout)
            reason="Institutional"
            ;;
    esac

    if [[ -z $reason ]]; then
      echo "Unexpected reason code: '$reason_code'" >&2
      continue
    fi

    funder=$(<<<"$settlement" jq '.funder // .meta.funder' -r)
    case $funder in
        Marinade)
          funder_info="Marinade DAO"
          ;;

        ValidatorBond)
          funder_info="Validator"
          ;;

        *)
          echo "Unexpected funder: '$funder'" >&2
          exit 1
          ;;
    esac

    echo -e "$(printf "%44s" "$vote_account") $(printf "%15s" "☉$claims_amount") $(printf "%28s" "$reason") $(printf "%-8s" "$stake_display") $(printf "%13s" "$funder_info")"
done < <(<"$settlement_collection_file" jq '.settlements | sort_by(.vote_account, -.claims_amount) | .[]' -c)
