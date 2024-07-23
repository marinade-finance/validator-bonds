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

# stake account minimal size (1 SOL is hardcoded here but can be dfferent based on Config)
STAKE_ACCOUNT_MINIMAL_SIZE=$((1000000000 + 2282880))


SETTLEMENTS_EPOCH=$(jq '.epoch' "$SETTLEMENTS_JSON_FILE")
MERKLE_TREES_EPOCH=$(jq '.epoch' "$MERKLE_TREES_JSON_FILE")
if [ "$SETTLEMENTS_EPOCH" != "$MERKLE_TREES_EPOCH" ]; then
    echo "Epochs of files '$SETTLEMENTS_JSON_FILE' and '$MERKLE_TREES_JSON_FILE' are not matching: Settlements epoch: $SETTLEMENTS_EPOCH, Merkle trees epoch: $MERKLE_TREES_EPOCH"
    exit 1
fi

# sum of max total claim from json
echo "EPOCH: $SETTLEMENTS_EPOCH"
echo -n "Sum of max total claim at '$MERKLE_TREES_JSON_FILE': "
LAMPORTS=$(jq '.merkle_trees[].max_total_claim_sum' "$MERKLE_TREES_JSON_FILE" | paste -s -d+ | bc)
solsdecimal $LAMPORTS
NUMBER_OF_CLAIMS=$(jq '.merkle_trees[].tree_nodes | length'  "$MERKLE_TREES_JSON_FILE" |  paste -s -d+ | bc)
echo "Number of all claims: $NUMBER_OF_CLAIMS"
COUNT=$(jq '.merkle_trees | length'  "$MERKLE_TREES_JSON_FILE")
echo "Number of merkle trees: $COUNT"
echo '----------------'

# listing data of claims
# echo 'Data of vote account and max total sum claim:'
# grep "$MERKLE_TREES_JSON_FILE" -e 'vote_account' -e 'max_total_claim_sum'
# jq '.merkle_trees[] | {sum: .max_total_claim_sum, vote_account: .vote_account, claims: [.tree_nodes[].claim]}' "$MERKLE_TREES_JSON_FILE"

declare -A claims_amounts
declare -A claims_number

for I in $(seq 0 $((COUNT-1)) ); do
  echo "Index: $I"
  VOTE_ACCOUNT=$(jq   ".merkle_trees[$I] | .vote_account" "$MERKLE_TREES_JSON_FILE")
  echo "Vote account: $VOTE_ACCOUNT"
  LAMPORTS_MAX=$(jq   ".merkle_trees[$I] | .max_total_claim_sum" "$MERKLE_TREES_JSON_FILE")
  MAX_CLAIM_SUM=$(solsdecimal $LAMPORTS_MAX)
  LAMPORTS_SUM=$(jq ".merkle_trees[$I] | .tree_nodes[].claim" "$MERKLE_TREES_JSON_FILE" | paste -s -d+ | bc)
  CLAIMS_SUM=$(solsdecimal $LAMPORTS_SUM)
  echo "Max claim sum/Claims sum: ${MAX_CLAIM_SUM}/${CLAIMS_SUM}"
  echo -n 'Number of claims: '
  jq ".merkle_trees[$I] | .tree_nodes | length" "$MERKLE_TREES_JSON_FILE"
  FUNDER=$(jq -c '.settlements[] | select ((.vote_account == '$VOTE_ACCOUNT') and (.claims_amount == '$LAMPORTS_MAX')) | .meta.funder' "$SETTLEMENTS_JSON_FILE")
  echo "Funder: ${FUNDER:-<UNKNOWN>}"

  current_sum=${claims_amounts[$FUNDER]}
  claims_amounts[$FUNDER]=$(($current_sum+$LAMPORTS_MAX))
  current_number=${claims_number[$FUNDER]}
  claims_number[$FUNDER]=$((current_number+1))
  echo '----------------'
done

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
