#!/bin/bash

### ---- Call with argumetn merkle trees json
# settlement-json-listing.sh ""$JSON_FILE""
### ----

solsdecimal() {
  N="$@"
  if [ ${#N} -lt 9 ]; then
    echo ".${N}"
  else
    SOLS="${N::-9}"
    echo "${SOLS:-0}.${N:${#SOLS}}"
  fi
}


JSON_FILE="$1"

# 272 bytes
CLAIM_ACCOUNT_DATA_RENT=0.002784

# sum of max total claim from json
echo -n "Sum of max total claim at '$JSON_FILE': "
LAMPORTS=$(jq '.merkle_trees[].max_total_claim_sum' "$JSON_FILE" | paste -s -d+ | bc)
solsdecimal $LAMPORTS
echo -n "Number of all claims in file + expected rent: "
NUMBER_OF_CLAIMS=$(jq '.merkle_trees[].tree_nodes | length'  "$JSON_FILE" |  paste -s -d+ | bc)
RENT=$(echo "scale=4; $NUMBER_OF_CLAIMS * $CLAIM_ACCOUNT_DATA_RENT" | bc)
echo "$NUMBER_OF_CLAIMS, expected rent for newly created: $RENT"

echo 'Data of vote account and max total sum claim:'
grep "$JSON_FILE" -e 'vote_account' -e 'max_total_claim_sum'

# listing data of claims
# jq '.merkle_trees[] | {sum: .max_total_claim_sum, vote_account: .vote_account, claims: [.tree_nodes[].claim]}' "$JSON_FILE"

# number of claims for a vote account
COUNT=$(jq '.merkle_trees | length'  "$JSON_FILE")
echo "Number of merkle trees: $COUNT at $JSON_FILE"
for I in $(seq 0 $((COUNT-1)) ); do
  echo "Index: $I"
  echo -n 'Vote account: '
  jq   ".merkle_trees[$I] | .vote_account" "$JSON_FILE"
  echo -n 'Max claim sum: '
  LAMPORTS=$(jq   ".merkle_trees[$I] | .max_total_claim_sum" "$JSON_FILE")
  solsdecimal $LAMPORTS
  echo -n 'Number of claims: '
  jq   ".merkle_trees[$I] | .tree_nodes | length" "$JSON_FILE"
  echo -n 'Claims sum: '
  LAMPORTS=$(jq ".merkle_trees[$I] | .tree_nodes[].claim" "$JSON_FILE" | paste -s -d+ | bc)
  solsdecimal $LAMPORTS
  echo '----------------'
done

# TODO: utilize nodejs CLI to get the data
# get settlement
# pnpm --silent cli -u$RPC_URL show-settlement --epoch 608 -f json > /tmp/a.json
# get max claiming amount
# jq '.[].account.maxTotalClaim' /tmp/a.json | paste -s -d+ | bc
