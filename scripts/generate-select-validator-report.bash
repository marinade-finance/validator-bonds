#!/bin/bash

set -e

# Set locale to ensure consistent number formatting
export LC_NUMERIC=C

json_file="$1"

if [[ -z $json_file ]]
then
    echo "Usage: $0 <json file>" >&2
    exit 1
fi

if [[ ! -f $json_file ]]; then
    echo "Error: File '$json_file' not found." >&2
    exit 1
fi

function format_percentage {
    local value="$1"
    # Handle empty or invalid values
    if [[ -z "$value" || "$value" == "null" ]]; then
        echo "0.00%"
        return
    fi
    # Convert decimal to percentage and format to 2 decimal places
    local percentage=$(LC_NUMERIC=C awk "BEGIN {printf \"%.2f\", $value * 100}")
    echo "${percentage}%"
}

function format_sol_amount {
    local lamports="$1"
    if [[ -z "$lamports" || "$lamports" == "null" ]]; then
        echo "0.0000"
        return
    fi
    # Convert lamports to SOL (divide by 1e9) and format to 4 decimal places
    LC_NUMERIC=C awk "BEGIN {printf \"%.4f\", $lamports / 1000000000}"
}

function format_commission {
    local value="$1"
    if [[ -z "$value" || "$value" == "null" ]]; then
        echo "0%"
        return
    fi
    local percentage=$(LC_NUMERIC=C awk "BEGIN {printf \"%.0f\", $value}")
    echo "${percentage}%"
}

function format_commission_bps {
    local value="$1"
    if [[ -z "$value" || "$value" == "null" ]]; then
        echo "0%"
        return
    fi
    local percentage=$(LC_NUMERIC=C awk "BEGIN {printf \"%.0f\", $value / 100}")
    echo "${percentage}%"
}

echo "Payouts data for epoch: $(<"$json_file" jq -r '.epoch')"

# Get institutional validator vote accounts as associative array
declare -A institutional_validators
while IFS='|' read -r vote_account name; do
    institutional_validators["$vote_account"]="$name"
done < <(<"$json_file" jq -r '.institutionalValidators.validators[] | "\(.vote_pubkey)|\(.name // "")"')

# Information about PSR fee
declare -A validator_payouts
while IFS='|' read -r vote_account psr_fee; do
    validator_payouts["$vote_account"]="$psr_fee"
done < <(<"$json_file" jq -r '.validatorPayoutInfo[] | "\(.voteAccount)|\(.psrFeeLamports // "0")"')

# Calculate staker payouts per validator
declare -A staker_payouts
while IFS='|' read -r vote_account payout_lamports; do
    if [[ -n "$vote_account" && "$vote_account" != "null" ]]; then
        current_total="${staker_payouts[$vote_account]:-0}"
        staker_payout=$(LC_NUMERIC=C awk "BEGIN {printf \"%.0f\", $current_total + $payout_lamports}")
        staker_payouts["$vote_account"]="$staker_payout"
    fi
done < <(<"$json_file" jq -r '.payoutStakers[] | "\(.voteAccount)|\(.payoutLamports // "0")"')

# Calculate distributor payouts per validator
declare -A distributor_payouts
while IFS='|' read -r vote_account payout_lamports; do
    if [[ -n "$vote_account" && "$vote_account" != "null" ]]; then
        distributor_payouts["$vote_account"]="$payout_lamports"
    fi
done < <(<"$json_file" jq -r '.payoutDistributors[] | "\(.voteAccount)|\(.payoutLamports // "0")"')

# Calculate deactivating payouts per validator
declare -A deactivating_payouts
while IFS='|' read -r vote_account deactivating_payout_lamports; do
    if [[ -n "$vote_account" && "$vote_account" != "null" ]]; then
        current_total="${deactivating_payouts[$vote_account]:-0}"
        deactivating_payouts["$vote_account"]=$((current_total + deactivating_payout_lamports))
    fi
done < <(<"$json_file" jq -r '.payoutStakers[] | "\(.voteAccount)|\(.deactivatingPayoutLamports // "0")"')


declare -a select_validators
declare -a non_select_validators

while IFS='|' read -r vote_account apy total_rewards total_effective validator_rewards institutional_effective institutional_deactivating commission mev_commission deactivating_payout; do
    staker_payout="${staker_payouts[$vote_account]:-0}"
    distributor_payout="${distributor_payouts[$vote_account]:-0}"
    psr_penalty="${validator_payouts[$vote_account]:-0}"

    infl_comm=$(format_commission "$commission")
    mev_comm=$(format_commission_bps "$mev_commission")
    commission_display="${infl_comm}/${mev_comm}"

    if [[ -n "${institutional_validators[$vote_account]}" ]]; then
        # This is a select validator
        name="${institutional_validators[$vote_account]}"
        display_name="${name:0:15}"
        select_validators+=("$vote_account|$display_name|$apy|$total_rewards|$total_effective|$validator_rewards|$institutional_effective|$psr_penalty|$staker_payout|$distributor_payout|$commission_display")
    else
        # This is a non-select validator / skip if no institutional stake
        if [[ "$institutional_effective" == "0" ]]; then
            continue
        fi
        deactivating_payout="${deactivating_payouts[$vote_account]:-0}"
        non_select_validators+=("$vote_account|$apy|$total_rewards|$institutional_effective|$institutional_deactivating|$psr_penalty|$staker_payout|$distributor_payout|$commission_display|$deactivating_payout")
    fi
done < <(<"$json_file" jq -r '.validators[] | "\(.voteAccount)|\(.apy // "0")|\(.totalRewards // "0")|\(.stakedAmounts.totalEffective // "0")|\(.validatorRewards // "0")|\(.stakedAmounts.institutionalEffective // "0")|\(.stakedAmounts.institutionalDeactivating // "0")|\(.commission // "0")|\(.mevCommission // "null")|\(.deactivatingPayoutLamports // "0")"')

# --- Print Select Validators ---
select_count=${#select_validators[@]}
if [[ $select_count -gt 0 ]]; then
    echo "Select Vote Account ($select_count)                     | Name            |       APY | Infl./MEV | Total Rewards | Total Effective | Validator Rewards | Select Effective |  PSR Penalty | Staker Payout | Distributor Payout"
            DIVIDER="---------------------------------------------+-----------------+-----------+-----------+---------------+-----------------+-------------------+------------------+--------------+---------------+--------------------+"
            PRINTER_FORMAT="%-44s | %-15s | %9s | %9s | %13s | %15s | %17s | %16s | %12s | %13s | %18s"
    echo "$DIVIDER"

    total_total_rewards=0
    total_total_effective=0
    total_validator_rewards=0
    total_institutional_effective=0
    total_psr_penalty=0
    total_staker_payout=0
    total_distributor_payout=0

    for validator_data in "${select_validators[@]}"; do
        IFS='|' read -r vote_account name apy total_rewards total_effective validator_rewards institutional_effective psr_penalty staker_payout distributor_payout commission_display <<< "$validator_data"

        formatted_apy=$(format_percentage "$apy")
        formatted_total_rewards=$(format_sol_amount "$total_rewards")
        formatted_total_effective=$(format_sol_amount "$total_effective")
        formatted_validator_rewards=$(format_sol_amount "$validator_rewards")
        formatted_institutional_effective=$(format_sol_amount "$institutional_effective")
        formatted_penalty=$(format_sol_amount "$psr_penalty")
        formatted_staker_payout=$(format_sol_amount "$staker_payout")
        formatted_distributor_payout=$(format_sol_amount "$distributor_payout")

        printf "${PRINTER_FORMAT} |\n" \
            "$vote_account" \
            "$name" \
            "$formatted_apy" \
            "$commission_display" \
            "$formatted_total_rewards" \
            "$formatted_total_effective" \
            "$formatted_validator_rewards" \
            "$formatted_institutional_effective" \
            "$formatted_penalty" \
            "$formatted_staker_payout" \
            "$formatted_distributor_payout"

        total_total_rewards=$((total_total_rewards + total_rewards))
        total_total_effective=$((total_total_effective + total_effective))
        total_validator_rewards=$((total_validator_rewards + validator_rewards))
        total_institutional_effective=$((total_institutional_effective + institutional_effective))
        total_psr_penalty=$((total_psr_penalty + psr_penalty))
        total_staker_payout=$((total_staker_payout + staker_payout))
        total_distributor_payout=$((total_distributor_payout + distributor_payout))
    done

    echo "$DIVIDER"
    printf "${PRINTER_FORMAT} | %12s \n" \
        "TOTAL" \
        "" \
        "" \
        "" \
        "$(format_sol_amount "$total_total_rewards")" \
        "$(format_sol_amount "$total_total_effective")" \
        "$(format_sol_amount "$total_validator_rewards")" \
        "$(format_sol_amount "$total_institutional_effective")" \
        "$(format_sol_amount "$total_psr_penalty")" \
        "$(format_sol_amount "$total_staker_payout")" \
        "$(format_sol_amount "$total_distributor_payout")" \
        "$(format_sol_amount "$(($total_distributor_payout + $total_staker_payout))")"

fi

echo ""

# --- Print Non-Select Validators ---
non_select_count=${#non_select_validators[@]}
if [[ $non_select_count -gt 0 ]]; then
    echo "Non-Select Vote Account ($non_select_count)                  |          APY | Infl./MEV |   Total Rewards |   Select Effective | Select Deactiv. |  PSR Penalty |  Deactiv. Payout  | Staker Payout | Distributor Payout"
                 DIVIDER="---------------------------------------------+--------------+-----------+-----------------+--------------------+-----------------+--------------+-------------------+---------------+--------------------+"
                 PRINTER_FORMAT="%-44s | %12s | %9s | %15s | %18s | %15s | %12s | %17s | %13s | %18s"
    echo "$DIVIDER"

    total_total_rewards=0
    total_institutional_effective=0
    total_psr_penalty=0
    total_staker_payout=0
    total_distributor_payout=0
    total_deactivating_payout=0

    for validator_data in "${non_select_validators[@]}"; do
        IFS='|' read -r vote_account apy total_rewards institutional_effective institutional_deactivating psr_penalty staker_payout distributor_payout commission_display deactivating_payout <<< "$validator_data"
        formatted_apy=$(format_percentage "$apy")
        formatted_total_rewards=$(format_sol_amount "$total_rewards")
        formatted_effective=$(format_sol_amount "$institutional_effective")
        formatted_deactivating=$(format_sol_amount "$institutional_deactivating")
        formatted_penalty=$(format_sol_amount "$psr_penalty")
        formatted_staker_payout=$(format_sol_amount "$staker_payout")
        formatted_distributor_payout=$(format_sol_amount "$distributor_payout")
        formatted_deactivating_payout=$(format_sol_amount "$deactivating_payout")

        printf "${PRINTER_FORMAT} |\n" \
            "$vote_account" \
            "$formatted_apy" \
            "$commission_display" \
            "$formatted_total_rewards" \
            "$formatted_effective" \
            "$formatted_deactivating" \
            "$formatted_penalty" \
            "$formatted_deactivating_payout" \
            "$formatted_staker_payout" \
            "$formatted_distributor_payout"

        total_total_rewards=$((total_total_rewards + total_rewards))
        total_institutional_effective=$((total_institutional_effective + institutional_effective))
        total_deactivating=$((total_deactivating + institutional_deactivating))
        total_psr_penalty=$((total_psr_penalty + psr_penalty))
        total_staker_payout=$((total_staker_payout + staker_payout))
        total_distributor_payout=$((total_distributor_payout + distributor_payout))
        total_deactivating_payout=$((total_deactivating_payout + deactivating_payout))
    done

    echo "$DIVIDER"
    printf "${PRINTER_FORMAT} | %12s \n" \
        "TOTAL" \
        "" \
        "" \
        "$(format_sol_amount "$total_total_rewards")" \
        "$(format_sol_amount "$total_institutional_effective")" \
        "$(format_sol_amount "$total_deactivating")" \
        "$(format_sol_amount "$total_psr_penalty")" \
        "$(format_sol_amount "$total_deactivating_payout")" \
        "$(format_sol_amount "$total_staker_payout")" \
        "$(format_sol_amount "$total_distributor_payout")" \
        "$(format_sol_amount "$(($total_distributor_payout + $total_staker_payout))")"
fi