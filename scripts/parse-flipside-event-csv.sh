#!/bin/bash

SLOTS_PER_EPOCH=432000

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
    cd ~/marinade/validator-bonds/
    # set -x
    # expecting a csv file with the following format: timestamp,blockid,data
    while IFS=, read -r timestamp blockid data; do
        # Remove any trailing whitespace
        timestamp=$(echo "$timestamp" | tr -d '[:space:]')
        blockid=$(echo "$blockid" | tr -d '[:space:]')
        data=$(echo "$data" | tr -d '[:space:]')
        
        EVENT=$(pnpm  run --silent -- cli show-event "$data" -f json)
        [[ $? -ne 0 ]] && echo "Skipping '$timestamp'" && continue >&2

        LAMPORTS=$(echo "$EVENT" | jq '.data.fundingAmount')
        LAMPORTS_FUNDED=$(echo "$EVENT" | jq '.data.lamportsFunded')
        if [ "$LAMPORTS" = "null" ]; then
          LAMPORTS=$(echo "$EVENT" | jq '.data.depositedAmount')
        fi
        SETTLEMENT=$(echo "$EVENT" | jq '.data.settlement')
        if [ "$LAMPORTS" = "null" ]; then
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
