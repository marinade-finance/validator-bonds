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

decimal_format="%0.9f"

epoch="$(<"$allocation_report_file" jq '.epoch' -r)"
slot="$(<"$allocation_report_file" jq '.slot' -r)"

echo "Direct staking PSR in epoch $epoch (slot $slot)"

# the two bond snapshots are collected per bond type, so a skew silently changes routing
bidding_bonds_epoch="$(<"$allocation_report_file" jq '.bidding_bonds_epoch' -r)"
institutional_bonds_epoch="$(<"$allocation_report_file" jq '.institutional_bonds_epoch' -r)"
if [[ "$bidding_bonds_epoch" != "$institutional_bonds_epoch" ]]; then
    echo "  WARNING bond snapshots disagree: bidding epoch $bidding_bonds_epoch, institutional epoch $institutional_bonds_epoch"
fi

while IFS=$'\t' read -r settlements_in claims_in bidding_settlements bidding_amount institutional_settlements institutional_amount dropped_settlements dropped_amount; do
  echo "  generated: $settlements_in settlements, ☉$(printf $decimal_format "$claims_in")"
  echo "  bidding config: $bidding_settlements settlements, ☉$(printf $decimal_format "$bidding_amount")"
  echo "  institutional config: $institutional_settlements settlements, ☉$(printf $decimal_format "$institutional_amount")"
  echo "  dropped: $dropped_settlements settlements, ☉$(printf $decimal_format "$dropped_amount")"
done < <(<"$allocation_report_file" jq -r '.totals | [
  (.settlements_in | tostring),
  (.claims_amount_in / 1e9),
  (.bidding_settlements | tostring),
  (.bidding_claims_amount / 1e9),
  (.institutional_settlements | tostring),
  (.institutional_claims_amount / 1e9),
  (.dropped_settlements | tostring),
  (.dropped_claims_amount / 1e9)
] | @tsv')

covered=$(<"$allocation_report_file" jq '.routed | length' -r)
echo "  covered validators: $covered"

# a drop means the front-end gate let a user stake to a validator with no usable bond
dropped_count=$(<"$allocation_report_file" jq '.dropped_no_usable_bond | length' -r)
if (( dropped_count > 0 )); then
    echo
    echo "  UNPROTECTED — no usable bond ($dropped_count):"
    while IFS=$'\t' read -r vote_account settlements amount; do
      echo "    $vote_account: $settlements settlements, ☉$(printf $decimal_format "$amount")"
    done < <(<"$allocation_report_file" jq -r '.dropped_no_usable_bond | sort_by(-.claims_amount) | .[]
      | [.vote_account, (.settlements | tostring), (.claims_amount / 1e9)] | @tsv')
fi

exposure_count=$(<"$allocation_report_file" jq '.exposure_warnings | length' -r)
if (( exposure_count > 0 )); then
    echo
    echo "  EXPOSURE above threshold, direct staking claims only ($exposure_count):"
    while IFS=$'\t' read -r vote_account bond_type exposure_bps threshold_bps amount; do
      echo "    $vote_account ($bond_type): $exposure_bps bps of bond, threshold $threshold_bps bps, ☉$(printf $decimal_format "$amount")"
    done < <(<"$allocation_report_file" jq -r '.exposure_warnings | sort_by(-.exposure_bps) | .[]
      | [.vote_account, .bond_type, (.exposure_bps | tostring), (.threshold_bps | tostring), (.claims_amount / 1e9)] | @tsv')
fi

tiny_count=$(<"$allocation_report_file" jq --argjson limit "$tiny_settlement_lamports" '[.routed[] | select(.claims_amount < $limit)] | length' -r)
if (( tiny_count > 0 )); then
    echo
    echo "  tiny settlements — candidates for raising min_settlement_lamports ($tiny_count):"
    while IFS=$'\t' read -r vote_account bond_type settlements amount; do
      echo "    $vote_account ($bond_type): $settlements settlements, ☉$(printf $decimal_format "$amount")"
    done < <(<"$allocation_report_file" jq -r --argjson limit "$tiny_settlement_lamports" '
      .routed | map(select(.claims_amount < $limit)) | sort_by(.claims_amount) | .[]
      | [.vote_account, .bond_type, (.settlements | tostring), (.claims_amount / 1e9)] | @tsv')
fi
