#!/bin/bash
set -euo pipefail

# Parse settlement verification alerts from JSON report of 'verify-settlement' command
# Usage: parse-verify-alerts.sh -f <verify-report.json> [-n <non-funded-items-to-report>] [-e <non-existing-items-to-report>] [-m <max-display-items>]


# Detect if being sourced
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    _EXIT_CMD="return"
else
    _EXIT_CMD="exit"
fi

# Default values
REPORT_FILE=""
NON_FUNDED_TO_REPORT=0
NON_EXISTING_TO_REPORT=0
MAX_DISPLAY=20

# Parse command-line arguments
while getopts "f:n:e:m:h" opt; do
    case $opt in
        f)
            REPORT_FILE="$OPTARG"
            [ -f "$REPORT_FILE" ] || { echo "Error: Report file not found: $REPORT_FILE" >&2; $_EXIT_CMD 1; }
            ;;
        n)
            [[ "$OPTARG" =~ ^[0-9]+$ ]] && [ "$OPTARG" -ge 0 ] || { echo "Error: -n must be a non-negative integer" >&2; $_EXIT_CMD 1; }
            NON_FUNDED_TO_REPORT="$OPTARG"
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
Usage: $0 -f <report-file> [-n <non-funded-items-to-report>] [-e <non-existing-items-to-report>] [-m <max-display-items>]

Options:
  -f <file>                 Path to the verify-report.json file (required)
  -n <non-funded-items>     Minimum non-funded items to trigger alert (default: 0)
  -e <non-existing-items>   Minimum non-existing items to trigger alert (default: 0)
  -m <max-display-items>    Maximum items to display per alert section (default: 20)
  -h                        Show this help message
EOF
            $_EXIT_CMD 0
            ;;
        \?) echo "Invalid option: -$OPTARG. Use -h for help" >&2; $_EXIT_CMD 1 ;;
        :) echo "Option -$OPTARG requires an argument" >&2; $_EXIT_CMD 1 ;;
    esac
done

[ -n "$REPORT_FILE" ] || { echo "Error: -f <report-file> is required. Use -h for help" >&2; $_EXIT_CMD 1; }

echo "Parsing report: $REPORT_FILE (non-funded threshold: $NON_FUNDED_TO_REPORT, non-existing threshold: $NON_EXISTING_TO_REPORT, max display: $MAX_DISPLAY)" >&2


# Count alerts by category
unknown_count=$(jq '.unknown_settlements | length' "$REPORT_FILE")
non_verified_count=$(jq '.non_verified_epochs | length' "$REPORT_FILE")
non_existing_count=$(jq '.non_existing_settlements | length' "$REPORT_FILE")
non_funded_count=$(jq '.non_funded_settlements | length' "$REPORT_FILE")

# Determine if any alerts to report
is_to_alert=false

# Build alert sections JSON
alert_sections=""

# Unknown settlements (on-chain but not in JSON)
if [ "$unknown_count" -gt 0 ]; then
    is_to_alert=true
    echo " => $unknown_count unknown settlements found (CRITICAL)" >&2
    unknown_list=$(jq -r '.unknown_settlements[] | "Epoch \(.epoch): \(.address)"' "$REPORT_FILE" | head -n "$MAX_DISPLAY")
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

# Non-verified epochs (no settlements in JSON for epoch)
if [ "$non_verified_count" -gt 0 ]; then
    is_to_alert=true
    echo " => $non_verified_count non-verified epochs found" >&2
    non_verified_list=$(jq -r '.non_verified_epochs | join(", ")' "$REPORT_FILE")
    alert_sections="$alert_sections"'
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*⚠️  Non-Verified Epochs ('"$non_verified_count"'):*\n_Missing settlements in JSON_\n```Epochs: '"$non_verified_list"'```"
                  }
                },'
fi

# Non-existing settlements (in JSON but not on-chain)
if [ "$non_existing_count" -gt 0 ]; then
    [ "$non_existing_count" -ge "$NON_EXISTING_TO_REPORT" ] && is_to_alert=true
    echo " => $non_existing_count non-existing settlements found" >&2
    non_existing_list=$(jq -r '.non_existing_settlements[] | "Epoch \(.epoch): \(.address)"' "$REPORT_FILE" | head -n "$MAX_DISPLAY")
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

# Non-funded settlements (on-chain but not funded)
if [ "$non_funded_count" -gt 0 ]; then
    [ "$non_funded_count" -ge "$NON_FUNDED_TO_REPORT" ] && is_to_alert=true
    echo " => $non_funded_count non-funded settlements found" >&2
    non_funded_list=$(jq -r '.non_funded_settlements[] | "Epoch \(.epoch): \(.address)"' "$REPORT_FILE" | head -n "$MAX_DISPLAY")
    if [ "$non_funded_count" -gt "$MAX_DISPLAY" ]; then
        non_funded_list="$non_funded_list"$'\n'"... and $((non_funded_count - MAX_DISPLAY)) more"
    fi
    alert_sections="$alert_sections"'
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*🟠 Non-Funded Settlements ('"$non_funded_count"'):*\n_On-chain but not funded_\n```'"$non_funded_list"'```"
                  }
                },'
fi

total_alerts=$((unknown_count + non_verified_count + non_existing_count + non_funded_count))
echo "Total alerts: $total_alerts" >&2

export unknown_count
export non_verified_count
export non_existing_count
export non_funded_count
export total_alerts
# Remove trailing comma from last section
export alert_sections="${alert_sections%,}"

if [ "$is_to_alert" = 'true' ]; then
    echo "❌ Some settlements verification failure" >&2
    # Return with error code if alerts exist
    $_EXIT_CMD 2
else
    echo "✅ All settlements verified successfully" >&2
    # If no alerts, return with success
    $_EXIT_CMD 0
fi
