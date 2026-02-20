#!/bin/bash

### ---- Call with json file arguments
# settlement-json-listing.sh --merkle-trees 1_settlement-merkle-trees.json --claim-type <unified|institutional>
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
        --merkle-trees) MERKLE_TREES_JSON_FILE="$2"; shift ;;
        --claim-type) CLAIM_TYPE="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$MERKLE_TREES_JSON_FILE" ] || [ -z "$CLAIM_TYPE" ]; then
    echo "Parameters --merkle-trees <path> and --claim-type <unified*|institutional*> are required"
    exit 1
fi

SCRIPT_DIR=$(dirname "${BASH_SOURCE[0]}")
CONFIG_PUBKEY=$("$SCRIPT_DIR"/bonds-config-pubkey.sh "$CLAIM_TYPE")
[[ -z "$CONFIG_PUBKEY" ]] && echo "Error: Bond config pubkey was not defined" && exit 2

MERKLE_TREES_EPOCH=$(jq '.epoch' "$MERKLE_TREES_JSON_FILE")
echo "EPOCH: $MERKLE_TREES_EPOCH"

# stake account minimal size
CONFIG_MIN_STAKE=$(config_min_stake "$CONFIG_PUBKEY")
STAKE_ACCOUNT_MINIMAL_SIZE=$(($CONFIG_MIN_STAKE + 2282880))
echo "  (minimal delegated stake account lamports: ${STAKE_ACCOUNT_MINIMAL_SIZE})"

# Preload the JSON data into a variable to avoid reading from the file multiple times
number_of_merkle_trees=$(jq '.merkle_trees | length' "$MERKLE_TREES_JSON_FILE")
echo "Number of merkle trees: ${number_of_merkle_trees}"
if [[ $number_of_merkle_trees -eq 0 ]]; then
    echo "    No merkle trees found. Exiting..."
    exit 0
fi

merkle_trees=$(jq -c '.merkle_trees[]' "$MERKLE_TREES_JSON_FILE")

# sum of max total claim from json
NUMBER_OF_CLAIMS=$(echo "$merkle_trees" | jq -r '.tree_nodes | length' |  paste -s -d+ | bc)
echo "Number of all claims: $NUMBER_OF_CLAIMS"
echo -n "Sum of max total claim at '$(basename "$MERKLE_TREES_JSON_FILE")': "
LAMPORTS=$(echo "$merkle_trees" | jq -r '.max_total_claim_sum' | paste -s -d+ | bc)
solsdecimal $LAMPORTS
echo '----------------'

echo "Num.  | Vote Account                                 | Max Claim Sum | Claims Sum    | Claims"
echo "------+----------------------------------------------+---------------+---------------+-------"

counter=1
total_claims_amount=0
total_claims_count=0
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

  printf "%5d | %-44s | %13s | %13s | %6s\n" \
    "$counter" \
    "$VOTE_ACCOUNT" \
    "$MAX_CLAIM_SUM" \
    "$CLAIMS_SUM" \
    "$CLAIMS_COUNT"

  total_claims_amount=$(($total_claims_amount + $LAMPORTS_MAX))
  total_claims_count=$(($total_claims_count + 1))

  counter=$((counter + 1))
done <<< "$merkle_trees"

echo '========================='
echo 'Summary of claims:'
STAKE_ACCOUNT_RENT=$(echo "scale=4; ${total_claims_count} * $STAKE_ACCOUNT_MINIMAL_SIZE" | bc)
STAKE_ACCOUNT_RENT=$(solsdecimal $STAKE_ACCOUNT_RENT)
echo -n "Total ${total_claims_count} claims (+/- stake account 'rent': ${STAKE_ACCOUNT_RENT}): "
solsdecimal ${total_claims_amount}
echo '========================='


# To utilize nodejs CLI to get the data when has been created
# -- get settlement
# pnpm --silent cli -u$RPC_URL show-settlement --epoch 608 -f json > /tmp/a.json
# -- get max claiming amount
# jq '.[].account.maxTotalClaim' /tmp/a.json | paste -s -d+ | bc
