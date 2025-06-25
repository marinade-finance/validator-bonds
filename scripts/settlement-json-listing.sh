#!/bin/bash

### ---- Call with json file arguments
# settlement-json-listing.sh --settlements 1_settlements.json --merkle-trees 1_settlement-merkle-trees.json --claim-type <bid|institutional>
### ----

solsdecimal() {
  DECIMALS=9
  N="$@"
  if [ ${#N} -lt $DECIMALS ]; then
    FILLING_ZEROS=$(printf "%0.s0" $(seq 1 $((9-${#N}))))
    echo "0.${FILLING_ZEROS}${N}"
  else
    SOLS="${N::-$DECIMALS}"
    echo "${SOLS:-0}.${N:${#SOLS}}"
  fi
}

# finding value of amount of delegated stake to be locked when funding
# https://github.com/marinade-finance/validator-bonds/blob/contract-v2.0.0/programs/validator-bonds/src/state/config.rs#L19
config_min_stake() {
  CONFIG_PUBKEY="$1"
  [[ -z "$CONFIG_PUBKEY" ]] && echo "config_min_stake: Bond config pubkey was not defined" && exit 2
  # create a temporary file and then delete it
  TMP_FILE=$(mktemp)
  # marinade config account 'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU' for program 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
  # value 'minimum_stake_lamports' is at index 88 (89th byte) and it's u64 (8 bytes)
  MINIMUM_STAKE_LAMPORTS_BYTE=89
  curl https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -s -d '
    {
      "jsonrpc": "2.0",
      "id": 1,
      "method": "getAccountInfo",
      "params": [
        "'$CONFIG_PUBKEY'",
        {
          "encoding": "base64"
        }
      ]
    }
  ' | jq -r '.result.value.data[0]' | base64 -d | tail -c+${MINIMUM_STAKE_LAMPORTS_BYTE} | head -c8 > "$TMP_FILE"
  hex=$(xxd -p -l 8 -c 8 "$TMP_FILE" | sed 's/\(..\)/\\x\1/g')
  decimal=$(printf "$hex" | od -An -tu8 | tr -d ' ')
  echo $decimal
  rm -f "$TMP_FILE"
}


while [[ "$#" -gt 0 ]]; do
    case $1 in
        --settlements) SETTLEMENTS_JSON_FILE="$2"; shift ;;
        --merkle-trees) MERKLE_TREES_JSON_FILE="$2"; shift ;;
        --claim-type) CLAIM_TYPE="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$SETTLEMENTS_JSON_FILE" ] || [ -z "$MERKLE_TREES_JSON_FILE" ] || [ -z "$CLAIM_TYPE" ]; then
    echo "Parameters --settlements <path> and --merkle-trees <path> and --claim-type <bid*|institutional*> are required"
    exit 1
fi

SCRIPT_DIR=$(dirname "${BASH_SOURCE[0]}")
CONFIG_PUBKEY=$("$SCRIPT_DIR"/bonds-config-pubkey.sh "$CLAIM_TYPE")
[[ -z "$CONFIG_PUBKEY" ]] && echo "Error: Bond config pubkey was not defined" && exit 2

# stake account minimal size
CONFIG_MIN_STAKE=$(config_min_stake "$CONFIG_PUBKEY")
STAKE_ACCOUNT_MINIMAL_SIZE=$(($CONFIG_MIN_STAKE + 2282880))
echo "Minimal delegated stake accout lamports: ${STAKE_ACCOUNT_MINIMAL_SIZE}"

SETTLEMENTS_EPOCH=$(jq '.epoch' "$SETTLEMENTS_JSON_FILE")
MERKLE_TREES_EPOCH=$(jq '.epoch' "$MERKLE_TREES_JSON_FILE")
if [ "$SETTLEMENTS_EPOCH" != "$MERKLE_TREES_EPOCH" ]; then
    echo "Epochs of files '$SETTLEMENTS_JSON_FILE' and '$MERKLE_TREES_JSON_FILE' are not matching: Settlements epoch: $SETTLEMENTS_EPOCH, Merkle trees epoch: $MERKLE_TREES_EPOCH"
    exit 1
fi
echo "EPOCH: $SETTLEMENTS_EPOCH"

# Preload the JSON data into a variable to avoid reading from the file multiple times
merkle_trees=$(jq -c '.merkle_trees[]' "$MERKLE_TREES_JSON_FILE")

# sum of max total claim from json
echo -n "Sum of max total claim at '$MERKLE_TREES_JSON_FILE': "
LAMPORTS=$(echo "$merkle_trees" | jq -r '.max_total_claim_sum' | paste -s -d+ | bc)
solsdecimal $LAMPORTS
NUMBER_OF_CLAIMS=$(echo "$merkle_trees" | jq -r '.tree_nodes | length' |  paste -s -d+ | bc)
echo "Number of all claims: $NUMBER_OF_CLAIMS"
COUNT=$(echo "$merkle_trees" | wc -l)
echo "Number of merkle trees: $COUNT"
echo '----------------'

# listing data of claims
# echo 'Data of vote account and max total sum claim:'
# grep "$MERKLE_TREES_JSON_FILE" -e 'vote_account' -e 'max_total_claim_sum'
# jq '.merkle_trees[] | {sum: .max_total_claim_sum, vote_account: .vote_account, claims: [.tree_nodes[].claim]}' "$MERKLE_TREES_JSON_FILE"

settlements=$(jq -c '.settlements[]' "$SETTLEMENTS_JSON_FILE")

declare -A claims_amounts
declare -A claims_number
declare -A unique_funders

declare -A funder_map
SELECTED_FUNDER=""
get_next_funder() {
    SELECTED_FUNDER="<UNKNOWN>"
    local vote_account="$1"
    local amount="$2"
    local funder_data="$3"
   
    local preset_key="${vote_account}_${amount}"
   
    # Check if funder_data contains multiple funders (separated by newlines)
    if [[ -n "$funder_data" ]]; then
        # Convert funder_data to array, splitting by newlines
        local funder_array
        readarray -t funder_array <<< "$funder_data"
       
        local cleaned_funders=()
        local funder
        for funder in "${funder_array[@]}"; do
            local clean_funder # Remove quotes and trim whitespace
            clean_funder=$(echo "$funder" | sed 's/^"//; s/"$//' | xargs)
            if [[ -n "$clean_funder" ]]; then
                cleaned_funders+=("$clean_funder")
            fi
        done
        if [[ ${#cleaned_funders[@]} -gt 0 ]]; then
            local count=0
            local map_key
            for map_key in "${!funder_map[@]}"; do
                if [[ "$map_key" == "${preset_key}_"* ]]; then
                    count=$((count + 1))
                fi
            done
            # Calculate index based on count (cycling through available funders)
            local current_index=$((count % ${#cleaned_funders[@]}))
            # Get the funder at current index
            local selected_funder="${cleaned_funders[$current_index]}"           
            # Store in map with unique suffix to track multiple entries
            funder_map["${preset_key}_${count}"]="$selected_funder"
           
            SELECTED_FUNDER="$selected_funder"
        fi
    fi
}

echo "Num.  | Vote Account                                 | Max Claim Sum | Claims Sum    | Claims | Active Stake      | Reason                     | Funder"
echo "------+----------------------------------------------+---------------+---------------+--------+-------------------+----------------------------+-------------"

counter=1
while IFS= read -r tree; do
  VOTE_ACCOUNT=$(echo "$tree" | jq -r '.vote_account')
  LAMPORTS_MAX=$(echo "$tree" | jq -r '.max_total_claim_sum')
  TOTAL_CLAIMS=$(echo "$tree" | jq -r '.max_total_claims')
  LAMPORTS_SUM=$(echo "$tree" | jq '.tree_nodes[].claim' | paste -s -d+ | bc)
  CLAIMS_SUM=$(solsdecimal "$LAMPORTS_SUM")
  MAX_CLAIM_SUM=$(solsdecimal "$LAMPORTS_MAX")
  CLAIMS_COUNT=$(echo "$tree" | jq '.tree_nodes | length')
  if [[ $CLAIMS_COUNT -ne $TOTAL_CLAIMS ]]; then
    echo "Data inconsistency: $VOTE_ACCOUNT mismatch number of merkle trees $CLAIMS_COUNT and defined number of claims $TOTAL_CLAIMS"
  fi
 
  # Query the settlement data once per loop - now getting funder, reason, and active stake sum
  SETTLEMENT_DATA=$(echo "$settlements" | jq -c 'select((.vote_account == "'$VOTE_ACCOUNT'") and (.claims_amount == '$LAMPORTS_MAX') and (.claims_count == '$TOTAL_CLAIMS'))')
  FUNDER_PARSED=$(echo "$SETTLEMENT_DATA" | jq -r '.meta.funder')
 
  get_next_funder "$VOTE_ACCOUNT" "$LAMPORTS_MAX" "$FUNDER_PARSED"
  FUNDER="$SELECTED_FUNDER"

  SETTLEMENT_DATA_FUNDER_FILTERED=$(echo "$settlements" | jq -c 'select((.meta.funder == "'$FUNDER'") and (.vote_account == "'$VOTE_ACCOUNT'") and (.claims_amount == '$LAMPORTS_MAX') and (.claims_count == '$TOTAL_CLAIMS'))')

  ACTIVE_STAKE_SUM=$(echo "$SETTLEMENT_DATA_FUNDER_FILTERED" | jq '[.claims[].active_stake] | add // 0')
  ACTIVE_STAKE_SUM_FORMATTED=$(solsdecimal "$ACTIVE_STAKE_SUM")
  REASON=$(echo "$SETTLEMENT_DATA_FUNDER_FILTERED" | jq -r '
  if (.reason | type) == "string" then
      .reason
  else
      .reason | to_entries[0] | .key + "/" + (.value | keys[0])
  end')

  printf "%5d | %-44s | %13s | %13s | %6s | %17s | %-26s | %s\n" \
    "$counter" \
    "$VOTE_ACCOUNT" \
    "$MAX_CLAIM_SUM" \
    "$CLAIMS_SUM" \
    "$CLAIMS_COUNT" \
    "$ACTIVE_STAKE_SUM_FORMATTED" \
    "$REASON" \
    "$FUNDER"

  current_sum=${claims_amounts[$FUNDER]}
  claims_amounts[$FUNDER]=$(($current_sum+$LAMPORTS_MAX))
  current_number=${claims_number[$FUNDER]}
  claims_number[$FUNDER]=$((current_number+1))

  counter=$((counter + 1))
done <<< "$merkle_trees"

echo '========================='
echo 'Summary of claims:'
for FUNDER in "${!claims_amounts[@]}"; do
  STAKE_ACCOUNT_RENT=$(echo "scale=4; ${claims_number[$FUNDER]} * $STAKE_ACCOUNT_MINIMAL_SIZE" | bc)
  STAKE_ACCOUNT_RENT=$(solsdecimal $STAKE_ACCOUNT_RENT)
  echo -n "Funder $FUNDER, sum of ${claims_number[$FUNDER]} claims (+/- stake account 'rent': ${STAKE_ACCOUNT_RENT}): "
  solsdecimal ${claims_amounts[$FUNDER]}
done
echo '========================='


# To utilize nodejs CLI to get the data when has been created
# -- get settlement
# pnpm --silent cli -u$RPC_URL show-settlement --epoch 608 -f json > /tmp/a.json
# -- get max claiming amount
# jq '.[].account.maxTotalClaim' /tmp/a.json | paste -s -d+ | bc