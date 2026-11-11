#!/bin/bash

# Advisory LLM read of the sanity checks; it annotates the build and never unblocks or blocks it

set -eo pipefail

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --epoch) EPOCH="$2"; shift ;;
    --claim-type) CLAIM_TYPE="$2"; shift ;;
    --steps) STEPS_ARG="$2"; shift ;;
    --integrity-steps) INTEGRITY_STEPS_ARG="$2"; shift ;;
    *) echo "Unknown parameter passed: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -z "$EPOCH" || -z "$CLAIM_TYPE" || -z "$STEPS_ARG" || -z "$INTEGRITY_STEPS_ARG" ]]; then
  echo "Usage: $0 --epoch <N> --claim-type <unified|institutional-distribution> --steps <step-key,...>" \
    "--integrity-steps <step-key,...>" >&2
  exit 1
fi

SCRIPT_DIR=$(dirname "${BASH_SOURCE[0]}")
OUT_DIR="./sanity-ai-review"
mkdir -p "$OUT_DIR"
IFS=',' read -ra STEPS <<< "$STEPS_ARG"

case "$CLAIM_TYPE" in
  unified)
    settlements_files="${SETTLEMENTS_FILES:?SETTLEMENTS_FILES must list the unified settlement sources}"
    config_files="settlement-config.yaml,settlement-config-direct-staking.yaml"
    ;;
  institutional*)
    settlements_files="institutional-distribution-settlements.json,institutional-direct-staking-settlements.json"
    config_files="institutional-distribution-config.json"
    ;;
  *) echo "Unknown claim type '$CLAIM_TYPE'" >&2; exit 1 ;;
esac

buildkite-agent artifact download "sanity-check-*.log" "$OUT_DIR" || true
buildkite-agent artifact download "summary.txt" "$OUT_DIR" || true

# the model's level is advisory; these deterministic findings forbid SAFE whatever it says
GUARDS=()
OUTCOMES=()
all_passed=true
for step in "${STEPS[@]}"; do
  outcome=$(buildkite-agent step get "outcome" --step "$step" || echo unknown)
  OUTCOMES+=("- $step: $outcome")
  [[ "$outcome" == "passed" ]] || all_passed=false
  if [[ "$outcome" != "passed" && "$outcome" != "soft_failed" ]]; then
    GUARDS+=("step $step has outcome '$outcome'")
  elif [[ "$outcome" == "soft_failed" && ! -f "$OUT_DIR/$step.log" ]]; then
    GUARDS+=("step $step failed but its log is missing")
  fi
  if [[ ",$INTEGRITY_STEPS_ARG," == *",$step,"* && "$outcome" != "passed" ]]; then
    GUARDS+=("data integrity step $step did not pass")
  fi
done
if grep -qsE 'CEILING EXCEEDED|internal inconsistencies|skipping the cross-validation|Skipping historical comparison|check did not run|\[⛔\] Field: (institutionalValidatorsCount|zeroApyInstitutionalValidators|nonInstitutionalDeactivationPayout)' \
  "$OUT_DIR"/sanity-check-*.log; then
  GUARDS+=("a check log reports a skipped check, an exceeded ceiling, inconsistent merkle trees or an institutional data anomaly")
fi

# an auto-approved build blocks only on a soft-failed check, so with all passed nobody reads the review
if [[ "$PIPELINES_AUTO_APPROVAL" == "true" && "$all_passed" == "true" ]]; then
  echo "All sanity checks passed and the build is auto-approved, skipping the AI review"
  exit 0
fi

REVIEW_DONE=false
annotate_without_review() {
  [[ "$REVIEW_DONE" == "true" ]] && return
  local guards="none"
  [[ ${#GUARDS[@]} -gt 0 ]] && printf -v guards '%s; ' "${GUARDS[@]}"
  {
    echo "### AI review of sanity checks ($CLAIM_TYPE / $EPOCH)"
    echo
    echo "**⚠️ Recommendation: MORE VERIFICATION NEEDED, NOT CLEAR** _(the AI review did not finish, see the step log)_"
    echo
    echo "Deterministic guards: ${guards%; }"
    if [[ -s "$OUT_DIR/context.md" ]]; then
      echo
      echo "<details><summary>Digest</summary>"
      echo
      cat "$OUT_DIR/context.md"
      echo
      echo "</details>"
    fi
  } | buildkite-agent annotate --style warning --context "sanity-ai-review" || true
}
trap annotate_without_review EXIT

pnpm --dir "$SCRIPT_DIR/.." install
pnpm --dir "$SCRIPT_DIR/.." -r build

"$SCRIPT_DIR/sanity-review-context.sh" \
  --gs-bucket "${gs_bucket:?gs_bucket must name the bonds GCS bucket}" \
  --epoch "$EPOCH" \
  --settlements-files "$settlements_files" \
  --config-files "$config_files" \
  --bonds-config "$("$SCRIPT_DIR/bonds-config-pubkey.sh" "$CLAIM_TYPE")" \
  --rpc-url "$RPC_URL" > "$OUT_DIR/context.md"
if grep -q "is missing for epoch" "$OUT_DIR/context.md"; then
  GUARDS+=("a settlements file is missing in GCS for epoch $EPOCH or $((EPOCH - 1))")
fi

INPUT="$OUT_DIR/review-input.md"
{
  echo "# Sanity check outcomes"
  echo
  printf '%s\n' "${OUTCOMES[@]}"
  echo
  cat "$OUT_DIR/context.md"
  for log in "$OUT_DIR"/sanity-check-*.log "$OUT_DIR"/summary.txt; do
    [[ -f "$log" ]] || continue
    trim=tail part=last
    [[ "$log" == */summary.txt ]] && trim=head part=first
    echo "# Log $(basename "$log") ($part 40000 bytes, table separator lines dropped)"
    echo '```'
    # alternation, not a bracket expression: in a C locale [├┌└] also matches the lead byte of │
    grep -avE '^(├|┌|└)' "$log" | "$trim" -c 40000 | { iconv -c -f UTF-8 -t UTF-8 || cat; } || true
    echo
    echo '```'
  done
} > "$INPUT"

cat <<PROMPT | "$SCRIPT_DIR/gemini.bash" "$INPUT" > "$OUT_DIR/gemini-response.json"
You review the sanity checks of Marinade validator-bonds settlements before they are initialized on chain.
Claim type: $CLAIM_TYPE. Epoch: $EPOCH.
A person decides whether to unblock the pipeline. Your answer is guidance for that person, not a decision.

The attached file holds: each sanity check step outcome (passed or soft_failed), a digest of how the
settlements changed from the previous epoch (totals per reason, the bid split between stakers and fees,
the validators whose claims moved most, on-chain bond funding now, config changes), and the check logs.

What the checks mean:
- Internal consistency, cross-validation of totals against settlement sources, the total claims ceiling,
  the fee revenue ceiling and the institutional payout count/sum checks are data integrity checks.
  A failure of any of them is a real defect and is never safe to unblock.
- The historical comparison (z-score anomaly and the epoch-over-epoch hop guardrail) is a heuristic.
  It fails whenever totals move a lot, which also happens for legitimate reasons, for example lower or higher
  auction bids, a Marinade stake shift between validators, a new settlement reason, or a large downtime event.

Your task:
- Name each failed check and the exact metric that tripped it, with its numbers.
- Explain the change using the digest: which reasons, which validators, and the driver (bid, stake, new
  or dropped validators, protected events, config change). Use numbers from the input only.
- Say what is not explained by the input.
- List validators whose claim exceeds their active bond only as information: partial funding is normal.

Set "level" strictly:
- "info" only when every failed check is a heuristic one AND the digest fully explains the movement by a
  consistent driver AND no data integrity check failed. When all checks passed and the digest shows nothing
  odd, the level is also "info".
- "warning" when the movement is only partly explained, input data is missing, or anything looks inconsistent.
- "error" when a data integrity check failed or the numbers contradict each other.

Format "response" in markdown: first line one decisive sentence, then short bullet lists.
Do not repeat the recommendation wording, it is added from the level.
PROMPT

LEVEL=$(jq -r '.level' "$OUT_DIR/gemini-response.json")
RESPONSE=$(jq -r '.response' "$OUT_DIR/gemini-response.json")
GUARD_NOTE=""
if [[ ${#GUARDS[@]} -gt 0 ]]; then
  [[ "$LEVEL" == "info" ]] && LEVEL="warning"
  printf -v GUARD_LIST '%s; ' "${GUARDS[@]}"
  GUARD_NOTE="Not safe regardless of the model: ${GUARD_LIST%; }."
fi
if [[ "$LEVEL" == "info" ]]; then
  RECOMMENDATION="✅ Recommendation: SAFE TO UNBLOCK"
else
  RECOMMENDATION="⚠️ Recommendation: MORE VERIFICATION NEEDED, NOT CLEAR"
fi

buildkite-agent annotate --style "${LEVEL/null/error}" --context "sanity-ai-review" <<EOF
### AI review of sanity checks ($CLAIM_TYPE / $EPOCH)

**$RECOMMENDATION** _(advisory only, the unblock decision stays with you)_

$GUARD_NOTE

$RESPONSE

<details><summary>Digest the review was based on</summary>

$(cat "$OUT_DIR/context.md")

</details>
EOF
REVIEW_DONE=true

if [[ "$LEVEL" != "info" ]]; then
  echo "Soft failing the step due to review level: $LEVEL"
  exit 75
fi
