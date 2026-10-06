#!/bin/bash

set -e

# an inherited LC_ALL would override LC_NUMERIC and change the decimal point
unset LC_ALL
export LC_NUMERIC=C

allocation_report_file="$1"
if [[ -z $allocation_report_file ]]
then
    echo "Usage: $0 <allocation report file>" >&2
    exit 1
fi

# ten times settlement-config-direct-staking.yaml's min_settlement_lamports; keep the two in step
tiny_settlement_lamports=100000000

named_validators_limit=3

decimal_format="%0.9f"

join_parts() {
    local separator="$1" running="" joined=""
    shift
    for part in "$@"; do
        joined+="$running$part"
        running="$separator"
    done
    printf '%s' "$joined"
}

epoch="$(<"$allocation_report_file" jq '.epoch' -r)"
slot="$(<"$allocation_report_file" jq '.slot' -r)"
covered="$(<"$allocation_report_file" jq '.routed | length' -r)"

IFS=$'\t' read -r settlements_in claims_in bidding_settlements bidding_amount \
  institutional_settlements institutional_amount dropped_settlements dropped_amount \
  < <(<"$allocation_report_file" jq -r '.totals | [
  (.settlements_in | tostring),
  (.claims_amount_in / 1e9),
  (.bidding_settlements | tostring),
  (.bidding_claims_amount / 1e9),
  (.institutional_settlements | tostring),
  (.institutional_claims_amount / 1e9),
  (.dropped_settlements | tostring),
  (.dropped_claims_amount / 1e9)
] | @tsv')

header="Direct staking PSR in epoch $epoch (slot $slot)"
if (( settlements_in == 0 )); then
    echo "$header: no claims"
else
    echo "$header: $settlements_in settlements, ☉$(printf $decimal_format "$claims_in"), $covered validators"
    breakdown=()
    if (( bidding_settlements > 0 )); then
        breakdown+=("bidding $bidding_settlements ☉$(printf $decimal_format "$bidding_amount")")
    fi
    if (( institutional_settlements > 0 )); then
        breakdown+=("institutional $institutional_settlements ☉$(printf $decimal_format "$institutional_amount")")
    fi
    if (( dropped_settlements > 0 )); then
        breakdown+=("dropped $dropped_settlements ☉$(printf $decimal_format "$dropped_amount")")
    fi
    echo "  $(join_parts ", " "${breakdown[@]}")"
fi

warnings=()

# a drop means the front-end gate let a user stake to a validator with no usable bond
dropped_count=$(<"$allocation_report_file" jq '.dropped_no_usable_bond | length' -r)
if (( dropped_count > 0 )); then
    named=$(<"$allocation_report_file" jq -r --argjson limit "$named_validators_limit" \
      '.dropped_no_usable_bond | sort_by(-.claims_amount) | .[:$limit] | map(.vote_account) | join(", ")')
    if (( dropped_count > named_validators_limit )); then
        named="$named +$(( dropped_count - named_validators_limit ))"
    fi
    warnings+=("UNPROTECTED: $named")
fi

exposure_count=$(<"$allocation_report_file" jq '.exposure_warnings | length' -r)
if (( exposure_count > 0 )); then
    warnings+=("exposure over threshold: $exposure_count")
fi

tiny_count=$(<"$allocation_report_file" jq --argjson limit "$tiny_settlement_lamports" '[.routed[] | select(.claims_amount < $limit)] | length' -r)
if (( tiny_count > 0 )); then
    warnings+=("tiny settlements: $tiny_count")
fi

# the two bond snapshots are collected per bond type, so a skew silently changes routing
bidding_bonds_epoch="$(<"$allocation_report_file" jq '.bidding_bonds_epoch' -r)"
institutional_bonds_epoch="$(<"$allocation_report_file" jq '.institutional_bonds_epoch' -r)"
if [[ "$bidding_bonds_epoch" != "$institutional_bonds_epoch" ]]; then
    warnings+=("bond snapshots disagree: $bidding_bonds_epoch/$institutional_bonds_epoch")
fi

if (( ${#warnings[@]} > 0 )); then
    echo "  WARNING $(join_parts " | " "${warnings[@]}")"
fi
