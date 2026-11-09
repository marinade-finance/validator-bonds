#!/bin/bash

# Markdown digest of how settlements changed from epoch N-1 to N, for a person or an LLM to judge

set -eo pipefail

TOP=15
RPC_URL_ARG=""
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --epoch) EPOCH="$2"; shift ;;
    --settlements-files) SETTLEMENTS_FILES_ARG="$2"; shift ;;
    --config-files) CONFIG_FILES_ARG="$2"; shift ;;
    --bonds-config) BONDS_CONFIG="$2"; shift ;;
    --rpc-url) RPC_URL_ARG="$2"; shift ;;
    --gs-bucket) GS_BUCKET="$2"; shift ;;
    --top) TOP="$2"; shift ;;
    *) echo "Unknown parameter passed: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -z "$EPOCH" || -z "$SETTLEMENTS_FILES_ARG" || -z "$BONDS_CONFIG" || -z "$GS_BUCKET" ]]; then
  echo "Usage: $0 --epoch <N> --settlements-files <a.json,b.json> --bonds-config <pubkey> --gs-bucket <gs://...>" \
    "[--config-files <c.yaml,...>] [--rpc-url <url>] [--top <count>]" >&2
  exit 1
fi

JQ_LIB='def sol: . / 1e9 * 1000 | round / 1000; def amount: sub(" SOLs?$"; "") | tonumber | if . < 0 then 0 else . end;'

PREV_EPOCH=$((EPOCH - 1))
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
IFS=',' read -ra SETTLEMENTS_FILES <<< "$SETTLEMENTS_FILES_ARG"
IFS=',' read -ra CONFIG_FILES <<< "${CONFIG_FILES_ARG:-}"

# one row per settlement; a ProtectedEvent reason is an object keyed by its event kind
ROWS_JQ='.settlements[] | {
  file: $file,
  vote: .vote_account,
  reason: (.reason | if type == "string" then . else (keys[0] + "/" + (.[keys[0]] | keys[0])) end),
  funder,
  lamports: .claims_amount,
  claims: .claims_count,
  marinade_stake: (.details.total_marinade_active_stake? // null),
  effective_bid: (.details.auction_effective_static_bid? // null),
  stakers_claim: (.details.stakers_total_claim? // null),
  marinade_fee: (.details.marinade_fee_claim? // null),
  dao_fee: (.details.dao_fee_claim? // null)
}'

for e in "$PREV_EPOCH" "$EPOCH"; do
  mkdir -p "$WORK_DIR/$e"
  : > "$WORK_DIR/$e/rows.jsonl"
  for f in "${SETTLEMENTS_FILES[@]}"; do
    if gcloud storage cp -q "$GS_BUCKET/$e/$f" "$WORK_DIR/$e/$f" 2>/dev/null; then
      jq -c --arg file "$f" "$ROWS_JQ" "$WORK_DIR/$e/$f" >> "$WORK_DIR/$e/rows.jsonl"
    else
      echo "> WARNING: '$f' is missing for epoch $e" >> "$WORK_DIR/missing.md"
    fi
  done
  jq -s '.' "$WORK_DIR/$e/rows.jsonl" > "$WORK_DIR/$e/rows.json"
done

echo "#### Settlements context: epoch $EPOCH compared to epoch $PREV_EPOCH"
echo
echo "Amounts in SOL. Settlement files: ${SETTLEMENTS_FILES[*]}"
[[ -f "$WORK_DIR/missing.md" ]] && cat "$WORK_DIR/missing.md"
echo

echo "##### Totals per source file, reason and funder"
echo
jq -r -n --slurpfile prev "$WORK_DIR/$PREV_EPOCH/rows.json" --slurpfile cur "$WORK_DIR/$EPOCH/rows.json" "$JQ_LIB"'
  def totals: group_by([.file, .reason, .funder]) | map({key: ([.[0].file, .[0].reason, .[0].funder] | join(" | ")),
    value: {n: length, claims: (map(.claims) | add), lamports: (map(.lamports) | add)}}) | from_entries;
  ($prev[0] | totals) as $p | ($cur[0] | totals) as $c
  | "| file | reason | funder | settlements prev → now | claims prev → now | SOL prev → now | change |",
    "|---|---|---|---|---|---|---|",
    (($p + $c) | keys[] as $k
      | ($p[$k] // {n: 0, claims: 0, lamports: 0}) as $a | ($c[$k] // {n: 0, claims: 0, lamports: 0}) as $b
      | "| \($k) | \($a.n) → \($b.n) | \($a.claims) → \($b.claims) | \($a.lamports | sol) → \($b.lamports | sol) | "
        + (if $a.lamports == 0 then "new" else "\(($b.lamports - $a.lamports) / $a.lamports * 100 | round)%" end) + " |")
'
echo

echo "##### Bidding split (where the bid revenue goes)"
echo
jq -r -n --slurpfile prev "$WORK_DIR/$PREV_EPOCH/rows.json" --slurpfile cur "$WORK_DIR/$EPOCH/rows.json" "$JQ_LIB"'
  def split: map(select(.reason == "Bidding")) | {
    stakers: (map(.stakers_claim // 0) | add // 0), marinade_fee: (map(.marinade_fee // 0) | add // 0),
    dao_fee: (map(.dao_fee // 0) | add // 0), marinade_stake: (map(.marinade_stake // 0) | add // 0),
    max_effective_bid: (map(.effective_bid // "0" | tonumber) | max // 0)};
  ($prev[0] | split) as $a | ($cur[0] | split) as $b
  | if ($a.stakers + $a.marinade_fee + $a.dao_fee + $b.stakers + $b.marinade_fee + $b.dao_fee) == 0 then "No Bidding settlements."
    else "| metric | prev | now |", "|---|---|---|",
      "| stakers claims SOL | \($a.stakers | sol) | \($b.stakers | sol) |",
      "| marinade fee SOL | \($a.marinade_fee | sol) | \($b.marinade_fee | sol) |",
      "| dao fee SOL | \($a.dao_fee | sol) | \($b.dao_fee | sol) |",
      "| marinade active stake SOL | \($a.marinade_stake | sol) | \($b.marinade_stake | sol) |",
      "| max effective static bid (PMPE) | \($a.max_effective_bid) | \($b.max_effective_bid) |"
    end
'
echo

BONDS_JSON="$WORK_DIR/bonds.json"
echo '[]' > "$BONDS_JSON"
if [[ -n "$RPC_URL_ARG" ]]; then
  SCRIPT_DIR=$(dirname "${BASH_SOURCE[0]}")
  if ! pnpm --dir "$SCRIPT_DIR/.." --silent cli -u "$RPC_URL_ARG" show-bond --config "$BONDS_CONFIG" --with-funding -f json > "$BONDS_JSON"; then
    echo '[]' > "$BONDS_JSON"
    echo "> WARNING: on-chain bond funding could not be loaded"
    echo
  fi
fi

echo "##### Top $TOP validators by change of claimed amount"
echo
echo "Bond columns are the on-chain state now; 'active' is what a settlement can be funded from (0 when a withdraw request covers it all)."
echo
jq -r -n --argjson top "$TOP" --slurpfile prev "$WORK_DIR/$PREV_EPOCH/rows.json" --slurpfile cur "$WORK_DIR/$EPOCH/rows.json" \
  --slurpfile bonds "$BONDS_JSON" "$JQ_LIB"'
  def per_vote: group_by(.vote) | map({key: .[0].vote, value: {lamports: (map(.lamports) | add),
    reasons: (map(.reason) | unique | join(",")), marinade_stake: (map(.marinade_stake // empty) | first // null),
    effective_bid: (map(.effective_bid // empty) | first // null)}}) | from_entries;
  ($prev[0] | per_vote) as $p | ($cur[0] | per_vote) as $c
  | ($bonds[0] | map({key: .account.voteAccount, value: .}) | from_entries) as $b
  | [($p + $c) | keys[] | {vote: ., a: ($p[.] // {lamports: 0}), c: ($c[.] // {lamports: 0})}
      | . + {delta: (.c.lamports - .a.lamports)}] as $all
  | "Validators prev → now: \($p | length) → \($c | length); new: \([$all[] | select(.a.lamports == 0)] | length), dropped: \([$all[] | select(.c.lamports == 0)] | length)",
    "",
    "| vote account | reasons now | SOL prev → now | marinade stake SOL prev → now | effective bid prev → now | bond active SOL | bond at settlements SOL | bond to withdraw SOL | bond bid (lamports per 1000 SOL) |",
    "|---|---|---|---|---|---|---|---|---|",
    ($all | sort_by(-(.delta | if . < 0 then -. else . end)) | .[:$top][]
      | ($b[.vote] // null) as $bond
      | "| \(.vote) | \(.c.reasons // "-") | \(.a.lamports | sol) → \(.c.lamports | sol) | \(.a.marinade_stake // 0 | sol) → \(.c.marinade_stake // 0 | sol) | \(.a.effective_bid // "-") → \(.c.effective_bid // "-") | "
        + (if $bond == null then "no bond data | - | - | - |"
           else "\($bond.amountActive | amount) | \($bond.amountAtSettlements | amount) | \($bond.amountToWithdraw | amount) | \($bond.account.costPerMillePerEpoch | sub(" lamports$"; "")) |" end))
'
echo

if [[ $(jq 'length' "$BONDS_JSON") -gt 0 ]]; then
  echo "##### Validators whose claim now exceeds the active bond amount"
  echo
  echo "Such a settlement is funded only partially."
  echo
  jq -r -n --slurpfile cur "$WORK_DIR/$EPOCH/rows.json" --slurpfile bonds "$BONDS_JSON" "$JQ_LIB"'
    ($bonds[0] | map({key: .account.voteAccount, value: (.amountActive | amount * 1e9 | round)}) | from_entries) as $active
    | [$cur[0] | group_by(.vote)[] | {vote: .[0].vote, claim: (map(.lamports) | add)}
        | . + {active: ($active[.vote] // 0)} | select(.claim > .active)] | sort_by(-.claim) as $short
    | if ($short | length) == 0 then "None."
      else "| vote account | claim SOL | bond active SOL |", "|---|---|---|",
        ($short[] | "| \(.vote) | \(.claim | sol) | \(.active / 1e9) |") end
  '
  echo
fi

for f in "${CONFIG_FILES[@]}"; do
  echo "##### Config '$f' change from epoch $PREV_EPOCH"
  echo
  if gcloud storage cp -q "$GS_BUCKET/$PREV_EPOCH/$f" "$WORK_DIR/prev-$f" 2>/dev/null \
    && gcloud storage cp -q "$GS_BUCKET/$EPOCH/$f" "$WORK_DIR/cur-$f" 2>/dev/null; then
    if diff -u --label "epoch $PREV_EPOCH" --label "epoch $EPOCH" "$WORK_DIR/prev-$f" "$WORK_DIR/cur-$f" > "$WORK_DIR/config.diff"; then
      echo "Identical."
    else
      echo '```diff'
      cat "$WORK_DIR/config.diff"
      echo '```'
    fi
  else
    echo "Not available for both epochs."
  fi
  echo
done
