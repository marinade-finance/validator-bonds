#!/bin/bash
set -euo pipefail

# Parse settlement verification alerts from JSON report of 'verify-settlement' command.
# Non-funded settlements are classified per epoch; any epoch crossing a threshold
# raises an alert that is posted to Slack and fails the build:
#   * count >= -x   --> alert (Slack + build fail)
#   * sol   >= -s   --> alert (Slack + build fail)
# Unknown/non-verified settlements always alert; non-existing uses -e threshold.

# Detect if being sourced
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    _EXIT_CMD="return"
else
    _EXIT_CMD="exit"
fi

# Defaults
REPORT_FILE=""
NON_FUNDED_PER_EPOCH=30
NON_FUNDED_SOL_PER_EPOCH=10
NON_EXISTING_TO_REPORT=0
MAX_DISPLAY=20

while getopts "f:x:s:e:m:h" opt; do
    case $opt in
        f)
            REPORT_FILE="$OPTARG"
            [ -f "$REPORT_FILE" ] || { echo "Error: Report file not found: $REPORT_FILE" >&2; $_EXIT_CMD 1; }
            ;;
        x)
            [[ "$OPTARG" =~ ^[0-9]+$ ]] && [ "$OPTARG" -ge 0 ] || { echo "Error: -x must be a non-negative integer" >&2; $_EXIT_CMD 1; }
            NON_FUNDED_PER_EPOCH="$OPTARG"
            ;;
        s)
            [[ "$OPTARG" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "Error: -s must be a non-negative number" >&2; $_EXIT_CMD 1; }
            NON_FUNDED_SOL_PER_EPOCH="$OPTARG"
            ;;
        e)
            [[ "$OPTARG" =~ ^[0-9]+$ ]] && [ "$OPTARG" -ge 0 ] || { echo "Error: -e must be a non-negative integer" >&2; $_EXIT_CMD 1; }
            NON_EXISTING_TO_REPORT="$OPTARG"
            ;;
        m)
            [[ "$OPTARG" =~ ^[0-9]+$ ]] && [ "$OPTARG" -gt 0 ] || { echo "Error: -m must be a positive integer" >&2; $_EXIT_CMD 1; }
            MAX_DISPLAY="$OPTARG"
            ;;
        h)
            cat >&2 <<EOF
Usage: $0 -f <report-file> [-x <count-threshold>] [-s <sol-threshold>] [-e <non-existing-min>] [-m <max-display>]

Options:
  -f <file>          Path to the verify-report.json file (required)
  -x <int>           Non-funded count threshold per epoch (default: 30) - Slack + fail
  -s <number>        Non-funded SOL threshold per epoch  (default: 10) - Slack + fail
  -e <int>           Non-existing settlements threshold to alert on (default: 0)
  -m <int>           Max items to display in unknown/non-existing sections (default: 20)
  -h                 Show this help message

Exit codes:
  0  no alerts
  2  alert raised (Slack + build fail)
EOF
            $_EXIT_CMD 0
            ;;
        \?) echo "Invalid option: -$OPTARG. Use -h for help" >&2; $_EXIT_CMD 1 ;;
        :) echo "Option -$OPTARG requires an argument" >&2; $_EXIT_CMD 1 ;;
    esac
done

[ -n "$REPORT_FILE" ] || { echo "Error: -f <report-file> is required. Use -h for help" >&2; $_EXIT_CMD 1; }

# SOL threshold in lamports (integer math is easier in bash)
sol_threshold_lamports=$(awk -v sol="$NON_FUNDED_SOL_PER_EPOCH" 'BEGIN { printf "%.0f", sol * 1e9 }')

echo "Parsing report: $REPORT_FILE" >&2
echo "  non-funded thresholds (per epoch): count >= $NON_FUNDED_PER_EPOCH or SOL >= ${NON_FUNDED_SOL_PER_EPOCH}" >&2
echo "  non-existing threshold: $NON_EXISTING_TO_REPORT, max display: $MAX_DISPLAY" >&2

unknown_count=$(jq '.summary.unknown_settlements | length' "$REPORT_FILE")
non_verified_count=$(jq '.summary.non_verified_epochs | length' "$REPORT_FILE")
non_existing_count=$(jq '.summary.non_existing_settlements | length' "$REPORT_FILE")
non_funded_count=$(jq '.summary.non_funded_settlements | length' "$REPORT_FILE")

# Stale-report detection: pre-claims_lamports reports lose the SOL threshold silently.
if [ "$non_funded_count" -gt 0 ]; then
    non_funded_with_lamports=$(jq '[.summary.non_funded_settlements[] | select(has("claims_lamports") and .claims_lamports != null)] | length' "$REPORT_FILE")
    if [ "$non_funded_with_lamports" -eq 0 ]; then
        echo "⚠️  Warning: non-funded settlements carry no 'claims_lamports' field; SOL threshold (-s) is inactive for this report (likely produced by a pre-SOL-threshold binary)." >&2
    fi
fi

is_to_alert=false
non_existing_in_alert=0
non_funded_settlements_alerting=0
alert_sections=""

# Unknown settlements (on-chain but not in JSON) - always critical
if [ "$unknown_count" -gt 0 ]; then
    is_to_alert=true
    echo " => $unknown_count unknown settlements found (CRITICAL)" >&2
    unknown_list=$(jq -r '.summary.unknown_settlements[] | "Epoch \(.epoch): \(.address)"' "$REPORT_FILE" | head -n "$MAX_DISPLAY")
    if [ "$unknown_count" -gt "$MAX_DISPLAY" ]; then
        unknown_list="$unknown_list"$'\n'"... and $((unknown_count - MAX_DISPLAY)) more"
    fi
    alert_sections="$alert_sections"'
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*🔴 Unknown Settlements ('"$unknown_count"'):*\n_On-chain but not in JSON - possible unauthorized activity!_\n```'"$unknown_list"'```"
                  }
                },'
fi

# Non-verified epochs (no settlements in JSON for epoch) - always critical
if [ "$non_verified_count" -gt 0 ]; then
    is_to_alert=true
    echo " => $non_verified_count non-verified epochs found" >&2
    non_verified_list=$(jq -r '.summary.non_verified_epochs | join(", ")' "$REPORT_FILE")
    alert_sections="$alert_sections"'
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*⚠️  Non-Verified Epochs ('"$non_verified_count"'):*\n_Missing settlements in JSON_\n```Epochs: '"$non_verified_list"'```"
                  }
                },'
fi

# Non-existing settlements (in JSON but not on-chain) - alert only if at/above threshold
if [ "$non_existing_count" -gt 0 ]; then
    echo " => $non_existing_count non-existing settlements found" >&2
    if [ "$non_existing_count" -ge "$NON_EXISTING_TO_REPORT" ]; then
        is_to_alert=true
        non_existing_in_alert=$non_existing_count
        non_existing_list=$(jq -r '.summary.non_existing_settlements[] | "Epoch \(.epoch): \(.address)"' "$REPORT_FILE" | head -n "$MAX_DISPLAY")
        if [ "$non_existing_count" -gt "$MAX_DISPLAY" ]; then
            non_existing_list="$non_existing_list"$'\n'"... and $((non_existing_count - MAX_DISPLAY)) more"
        fi
        alert_sections="$alert_sections"'
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*🟡 Non-Existing Settlements ('"$non_existing_count"'):*\n_In JSON but not found on-chain_\n```'"$non_existing_list"'```"
                  }
                },'
    fi
fi

# Non-funded settlements: aggregate per epoch, alert when any epoch crosses
non_funded_epochs_total=0
non_funded_epochs_alert=0
non_funded_summary=""
if [ "$non_funded_count" -gt 0 ]; then
    echo " => $non_funded_count non-funded settlements found; classifying per epoch" >&2

    # Per-epoch aggregation: "<epoch> <count> <lamports>" lines, sorted by epoch
    per_epoch=$(jq -r '
        .summary.non_funded_settlements
        | group_by(.epoch)
        | map({
            epoch: .[0].epoch,
            count: length,
            lamports: (map(.claims_lamports // 0) | add)
        })
        | sort_by(.epoch)
        | .[]
        | "\(.epoch) \(.count) \(.lamports)"
    ' "$REPORT_FILE")

    while IFS=' ' read -r epoch count lamports; do
        [ -z "$epoch" ] && continue
        non_funded_epochs_total=$((non_funded_epochs_total + 1))

        sol=$(awk -v l="$lamports" 'BEGIN { printf "%.4f", l / 1e9 }')

        if [ "$count" -ge "$NON_FUNDED_PER_EPOCH" ] || [ "$lamports" -ge "$sol_threshold_lamports" ]; then
            non_funded_epochs_alert=$((non_funded_epochs_alert + 1))
            non_funded_settlements_alerting=$((non_funded_settlements_alerting + count))
            is_to_alert=true
            echo "    epoch=$epoch count=$count sol=$sol ALERT" >&2
            non_funded_summary="${non_funded_summary}Epoch ${epoch}: ${count} settlements / ${sol} SOL"$'\n'
        else
            echo "    epoch=$epoch count=$count sol=$sol (below threshold)" >&2
        fi
    done <<< "$per_epoch"

    if [ -n "$non_funded_summary" ]; then
        non_funded_summary="${non_funded_summary%$'\n'}"
        alert_sections="$alert_sections"'
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*🟠 Non-Funded Settlements per Epoch:*\n_thresholds: ≥ '"$NON_FUNDED_PER_EPOCH"'/epoch or ≥ '"$NON_FUNDED_SOL_PER_EPOCH"' SOL/epoch_\n```'"$non_funded_summary"'```"
                  }
                },'
    fi
fi

total_alerts=$((unknown_count + non_verified_count + non_existing_in_alert + non_funded_settlements_alerting))
echo "Totals: unknown=$unknown_count non-verified=$non_verified_count non-existing=$non_existing_count (in-alert=$non_existing_in_alert) non-funded=$non_funded_count (alerting=$non_funded_settlements_alerting across $non_funded_epochs_alert of $non_funded_epochs_total epoch(s))" >&2

export unknown_count
export non_verified_count
export non_existing_count
export non_existing_in_alert
export non_funded_count
export non_funded_epochs_alert
export non_funded_settlements_alerting
export total_alerts
# Remove trailing comma from last section
export alert_sections="${alert_sections%,}"

if [ "$is_to_alert" = 'true' ]; then
    echo "⛔ Settlement verification failure" >&2
    $_EXIT_CMD 2
else
    echo "✅ All settlements verified successfully" >&2
    $_EXIT_CMD 0
fi
