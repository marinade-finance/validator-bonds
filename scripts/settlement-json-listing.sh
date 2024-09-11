#!/bin/bash

### ---- Call with json file arguments
# settlement-json-listing.sh --settlements 1_settlements.json --merkle-trees 1_settlement-merkle-trees.json
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
  # create a temporary file and then delete it
  TMP_FILE=$(mktemp)
  # marinade config account 'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU' for program 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
  # value 'minimum_stake_lamports' is at index 88 (89th byte) and it's u64 (8 bytes)
  MIMIMUM_STAKE_LAMPORTS_BYTE=89
  curl https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -s -d '
    {
      "jsonrpc": "2.0",
      "id": 1,
      "method": "getAccountInfo",
      "params": [
        "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU",
        {
          "encoding": "base64"
        }
      ]
    }
  ' | jq -r '.result.value.data[0]' | base64 -d | tail -c+${MIMIMUM_STAKE_LAMPORTS_BYTE} | head -c8 > "$TMP_FILE"
  hex=$(xxd -p -l 8 -c 8 "$TMP_FILE" | sed 's/\(..\)/\\x\1/g')
  decimal=$(printf "$hex" | od -An -tu8 | tr -d ' ')
  echo $decimal
  rm -f "$TMP_FILE"
}


while [[ "$#" -gt 0 ]]; do
    case $1 in
        --settlements) SETTLEMENTS_JSON_FILE="$2"; shift ;;
        --merkle-trees) MERKLE_TREES_JSON_FILE="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$SETTLEMENTS_JSON_FILE" ] || [ -z "$MERKLE_TREES_JSON_FILE" ]; then
    echo "Both --settlements and --merkle-trees parameters are required"
    exit 1
fi

# stake account minimal size
CONFIG_MIN_STAKE=$(config_min_stake)
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

index=0
while IFS= read -r tree; do
  echo "Index: $index"
  VOTE_ACCOUNT=$(echo "$tree" | jq -r '.vote_account')
  LAMPORTS_MAX=$(echo "$tree" | jq -r '.max_total_claim_sum')
  LAMPORTS_SUM=$(echo "$tree" | jq '.tree_nodes[].claim' | paste -s -d+ | bc)
  CLAIMS_SUM=$(solsdecimal "$LAMPORTS_SUM")
  MAX_CLAIM_SUM=$(solsdecimal "$LAMPORTS_MAX")

  echo "Vote account: $VOTE_ACCOUNT"
  echo "Max claim sum/Claims sum: ${MAX_CLAIM_SUM}/${CLAIMS_SUM}"

  echo -n 'Number of claims: '
  echo "$tree" | jq '.tree_nodes | length'

  # Query the settlement data once per loop
  FUNDER=$(echo "$settlements" | jq -c 'select((.vote_account == "'$VOTE_ACCOUNT'") and (.claims_amount == '$LAMPORTS_MAX')) | .meta.funder')
  echo "Funder: ${FUNDER:-<UNKNOWN>}"

  current_sum=${claims_amounts[$FUNDER]}
  claims_amounts[$FUNDER]=$(($current_sum+$LAMPORTS_MAX))
  current_number=${claims_number[$FUNDER]}
  claims_number[$FUNDER]=$((current_number+1))
  echo '----------------'
  index=$((index + 1))
done <<< "$merkle_trees"

echo
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
