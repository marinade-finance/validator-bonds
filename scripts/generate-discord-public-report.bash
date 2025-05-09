#!/bin/bash

set -e

settlement_collection_file="$1"
settlement_type="$2"
ignore_marinade_fee_active_stake="$3"
marinade_fee_stake_authority="${MARINADE_FEE_STAKE_AUTHORITY:-}"
marinade_fee_withdraw_authority="${MARINADE_FEE_WITHDRAW_AUTHORITY:-}"

if [[ -z $settlement_collection_file ]]
then
    echo "Usage: $0 <settlement collection file> [settlement type] [ignore marinade fee active stake]" >&2
    exit 1
fi

if [[ $ignore_marinade_fee_active_stake == "true" ]]; then
  if [[ -z $marinade_fee_stake_authority || -z $marinade_fee_withdraw_authority ]]; then
    echo "Error: When ignore_marinade_fee_active_stake is set to true, both MARINADE_FEE_STAKE_AUTHORITY and MARINADE_FEE_WITHDRAW_AUTHORITY must be provided." >&2
    exit 1
  fi
fi

epoch="$(<"$settlement_collection_file" jq '.epoch' -r)"
if (( $(<"$settlement_collection_file" jq '.settlements | length' -r) == 0 ))
then
    echo "No settlements in epoch $epoch."
    exit
fi

decimal_format="%0.9f"

function fmt_human_number {
    integer_part=$(echo "$@" | cut -d. -f1)
    numfmt -d. --to si "$integer_part"
}
export -f fmt_human_number

if [[ $settlement_type ]]; then
  settlement_type=" $settlement_type"
fi

echo "Total settlements${settlement_type} in epoch $epoch: ☉$(<"$settlement_collection_file" jq '[.settlements[].claims_amount / 1e9] | add' | xargs printf $decimal_format)"
echo
echo "                                vote account    settlement                        reason   stake     funded by"
echo "--------------------------------------------+-------------+-----------------------------+-------+-------------"
while read -r settlement
do
    vote_account=$(<<<"$settlement" jq '.vote_account' -r)
    claims_amount=$(<<<"$settlement" jq '.claims_amount / 1e9' -r | xargs printf $decimal_format)
     
    if [[ $ignore_marinade_fee_active_stake == "true" ]]; then
        protected_stake=$(<<<"$settlement" jq "[.claims[] | select(.withdraw_authority != \"$marinade_fee_withdraw_authority\" and .stake_authority != \"$marinade_fee_stake_authority\") | .active_stake] | add // 0 | . / 1e9" -r | xargs -I{} bash -c 'fmt_human_number "$@"' _ {})
    else
        protected_stake=$(<<<"$settlement" jq '[.claims[].active_stake] | add / 1e9' -r | xargs -I{} bash -c 'fmt_human_number "$@"' _ {})
    fi
    
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

    if [[ $reason_code == "Bidding" ]]; then
      reason="Bidding"
    fi
    if [[ $reason_code == "BidTooLowPenalty" ]]; then
      reason="BidTooLowPenalty"
    fi
    if [[ $reason_code == "InstitutionalPayout" ]]; then
      reason="Institutional"
    fi

    if [[ -z $reason ]]; then
      echo "Unexpected reason code: '$reason_code'" >&2
      reason=$reason_code
    fi

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

    echo -e "$(printf "%44s" "$vote_account") $(printf "%15s" "☉$claims_amount") $(printf "%28s" "$reason") $(printf "%9s" "☉$protected_stake") $(printf "%13s" "$funder_info")"
done < <(<"$settlement_collection_file" jq '.settlements | sort_by((-.claims_amount)) | .[]' -c)
