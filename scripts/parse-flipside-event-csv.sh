#!/bin/bash

# Parsing a Flipside event CSV file and extracting relevant information
# The Query used to generate the CSV file:
# SELECT
#   -- floor(block_id/432000) as epoch,
#   -- tx_id,
#   block_timestamp,
#   block_id,
#   ixs.value:data
# FROM solana.core.fact_events fe
# INNER JOIN
#   solana.core.fact_transactions ft USING(block_timestamp, tx_id, succeeded),
#   LATERAL FLATTEN(input => fe.inner_instruction:instructions) ixs
# WHERE fe.succeeded
# -- and fe.block_id >= 890*432000
# and fe.program_id = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
# -- Type of INSTRUCTION searching for
# -- and array_contains('Program log: Instruction: FundBond'::variant, ft.log_messages)
# and array_contains('Program log: Instruction: FundSettlement'::variant, ft.log_messages)
# -- and array_contains('Program log: Instruction: ClaimWithdrawRequest'::variant, ft.log_messages)
# -- filter instructions by Bond pubkey
# and array_contains('<<Validator Bond Address>>'::variant, fe.instruction:accounts)
# -- from the list of inner instructions getting only those that contains the CPI event data
# -- the CPI PDA call address is always the same for bond program
# and array_contains('j6cZKhHTFuWsiCgPT5wriQpZWqWWUSQqjDJ8S2YDvDL'::variant, ixs.value:accounts)
# order by block_timestamp ASC;


SLOTS_PER_EPOCH=432000
CURRENT_SCRIPT_PATH=$(realpath "$0")
CURRENT_SCRIPT_DIR=$(dirname "$CURRENT_SCRIPT_PATH")

solsdecimal() {
  N="$@"
  if [ "$N" = "null" ]; then
    echo "unknown"
    return 1
  fi
  DECIMALS=9
  [ "x$N" == "x" ] && N=`xsel -p -o`
  [ "x$N" == "x" ] && echo "No input" && return 1
  if [ ${#N} -lt $DECIMALS ]; then
    FILLING_ZEROS=$(printf "%0.s0" $(seq 1 $((9-${#N}))))
    echo "0.${FILLING_ZEROS}${N}"
  else
    SOLS="${N::-$DECIMALS}"
    echo "${SOLS:-0}.${N:${#SOLS}}"
  fi
}

parse_csv_line() {
    local input_file="$(realpath "$1")"
    
    SUM_LAMPORTS=0
    cd "$CURRENT_SCRIPT_DIR/../"
    # set -x
    # expecting a csv file with the following format: timestamp,blockid,data
    while IFS=, read -r timestamp blockid data; do
        # Remove any trailing whitespace
        timestamp=$(echo "$timestamp" | tr -d '[:space:]')
        blockid=$(echo "$blockid" | tr -d '[:space:]')
        data=$(echo "$data" | tr -d '[:space:]')
        
        EVENT=$(pnpm  run --silent -- cli show-event "$data" -f json --announcements-api-url 'DISABLED')
        [[ $? -ne 0 ]] && echo "Skipping event at '$timestamp'" && continue >&2

        LAMPORTS=$(echo "$EVENT" | jq '.data.fundingAmount')
        LAMPORTS_FUNDED=$(echo "$EVENT" | jq '.data.lamportsFunded')
        if [ "$LAMPORTS" = "null" ]; then
          LAMPORTS=$(echo "$EVENT" | jq '.data.depositedAmount')
        fi
        SETTLEMENT=$(echo "$EVENT" | jq '.data.settlement')
        if [ "$LAMPORTS" = "null" ]; then
          echo "ERROR: No lamports amount found in event at '$timestamp'" >&2
          echo "$EVENT"
          break
        fi

        SUM_LAMPORTS=$((SUM_LAMPORTS+LAMPORTS))
        SOLS=$(solsdecimal $LAMPORTS)
        EPOCH=$((blockid/$SLOTS_PER_EPOCH))
        echo -n "$timestamp;$EPOCH;$SOLS"
        # [ "$SETTLEMENT" != "null" ] && echo -n ";settlement: $SETTLEMENT"
        # [ "$LAMPORTS_FUNDED" != "null" ] && echo -n ";sumFunded:$(solsdecimal $LAMPORTS_FUNDED)"
        echo
    done < "$input_file"
    echo "Total lamports: $(solsdecimal $SUM_LAMPORTS)"

    cd -
}

echo "$0: parsing file '$1'"
parse_csv_line "$1"
