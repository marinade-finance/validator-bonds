#!/bin/bash

### ---- Call with argumetn merkle trees json
# settlement-json-listing.sh ""$JSON_FILE""
### ----

JSON_FILE="$1"

# sum of max total claim from json
echo -n "Sum of max total claim at '$JSON_FILE': "
jq '.merkle_trees[].max_total_claim_sum' "$JSON_FILE" | paste -s -d+ | bc

echo 'Data of vote account and max total sum claim:'
grep "$JSON_FILE" -e 'vote_account' -e 'max_total_claim_sum'

# listing data of claims
# jq '.merkle_trees[] | {sum: .max_total_claim_sum, vote_account: .vote_account, claims: [.tree_nodes[].claim]}' "$JSON_FILE"

# number of claims for a vote account
FILE="./$JSON_FILE"
COUNT=$(jq '.merkle_trees | length'  "$FILE")
echo "Number of merkle trees: $COUNT at $FILE"
for I in $(seq 0 $((COUNT-1)) ); do
  echo "Index: $I"
  echo -n 'Vote account: '
  jq   ".merkle_trees[$I] | .vote_account" "$FILE"
  echo -n 'Max claim sum: '
  jq   ".merkle_trees[$I] | .max_total_claim_sum" "$FILE"
  echo -n '# of claims: '
  jq   ".merkle_trees[$I] | .tree_nodes | length" "$FILE"
  echo -n 'Claims sum: '
  jq ".merkle_trees[$I] | .tree_nodes[].claim" "$FILE" | paste -s -d+ | bc
  echo
done

# TODO: utilize nodejs CLI to get the data
# get settlement
# pnpm --silent cli -u$RPC_URL show-settlement --epoch 608 -f json > /tmp/a.json
# get max claiming amount
# jq '.[].account.maxTotalClaim' /tmp/a.json | paste -s -d+ | bc