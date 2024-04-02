#!/bin/bash

set -e

settlement_collection_file="$1"

if [[ -z $settlement_collection_file ]]
then
    echo "Usage: $0 <settlement collection file>" >&2
    exit 1
fi

epoch="$(<"$settlement_collection_file" jq '.epoch' -r)"
if (( $(<"$settlement_collection_file" jq '.settlements | length' -r) == 0 ))
then
    echo "No settlements in epoch $epoch."
    exit
fi

decimal_format="%0.9f"

function fmt_human_number {
    numfmt --to si $@
}
export -f fmt_human_number

echo "Total settlements in epoch $epoch: ☉$(<"$settlement_collection_file" jq '[.settlements[].claims_amount / 1e9] | add' | xargs printf $decimal_format)"
echo
echo "                                vote account    settlement                   reason   stake     funded by"
echo "--------------------------------------------+-------------+------------------------+-------+-------------"
while read -r settlement
do
    vote_account=$(<<<"$settlement" jq '.vote_account' -r)
    claims_amount=$(<<<"$settlement" jq '.claims_amount / 1e9' -r | xargs printf $decimal_format)
    protected_stake=$(<<<"$settlement" jq '[.claims[].active_stake] | add / 1e9' -r | xargs -I{} bash -c 'fmt_human_number "$@"' _ {})
    reason_code=$(<<<"$settlement" jq '.reason | keys[0]' -r)

    if ! [[ $reason_code == "ProtectedEvent" ]]
    then
        continue
    fi

    protected_event_code=$(<<<"$settlement" jq '.reason.ProtectedEvent | keys[0]' -r)
    protected_event_attributes=$(<<<"$settlement" jq '.reason.ProtectedEvent | to_entries[0].value' -r)

    case $protected_event_code in
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

    funder=$(<<<"$settlement" jq '.meta.funder' -r)
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

    

    echo -e "$(printf "%44s" "$vote_account") $(printf "%15s" "☉$claims_amount") $(printf "%24s" "$reason") $(printf "%9s" "☉$protected_stake") $(printf "%13s" "$funder_info")"
done < <(<"$settlement_collection_file" jq '.settlements | sort_by((.reason.ProtectedEvent | to_entries[0].value.actual_epr), (-.claims_amount)) | .[]' -c)
