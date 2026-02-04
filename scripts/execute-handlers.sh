#!/bin/bash

# Function to handle command execution and exit codes
# Where we define exit error codes:
# 0: Success
# 1: Error, standard linux error status code
# 2: Failure emitted by CLI
# 99: Warning
# 100: Retryable failure
# Error codes are stored in Buildkite metadata: ${command_name}_status and ${command_name}_warning.
handle_command_execution() {
    set +e
    local command_name="$1"
    shift
    local json_report_file="./report.${command_name}.${BUILDKITE_RETRY_COUNT}.json"

    echo "#ATTEMPT ${BUILDKITE_RETRY_COUNT}"
    "$@" --report-file "$json_report_file" --report-format json
    local exit_code=$?

    buildkite-agent meta-data set --redacted-vars="" "${command_name}_status" "$exit_code"

    # Upload JSON report as artifact if it exists
    if [[ -f "$json_report_file" ]]; then
        buildkite-agent artifact upload "$json_report_file" || true
    fi

    # Handle different exit codes
    case $exit_code in
        0)
            echo "${command_name}: completed successfully"
            ;;
        99)
            echo "${command_name}: completed with warnings"
            # Store warning state for next step
            buildkite-agent meta-data set --redacted-vars="" "${command_name}_warning" "true"
            # Exit with 0 to continue pipeline but with warning flag
            exit 0
            ;;
        100)
            echo "${command_name}: completed with retry-able errors"
            exit 100
            ;;
        *)
            echo "${command_name}: completed with critical errors"
            exit 1
            ;;
    esac
}

# COLORS
readonly SUCCESS_COLOR="#00CC00"    # Green
readonly WARNING_COLOR="#F99A15"    # Orange/Yellow
readonly ERROR_COLOR="#DC3545"      # Red

# Function to set global variables for notification details
set_notification_details() {
    notification_result="$1"
    notification_color="$2"
}

check_command_execution_status() {
    local command_name="$1"
    local command_status
    local warning_state

    set_notification_details 'UNKNOWN FAIL' "${ERROR_COLOR}"
    command_status=$(buildkite-agent meta-data get "${command_name}_status" 2> /dev/null || echo '-1')
    warning_state=$(buildkite-agent meta-data get "${command_name}_warning" 2> /dev/null || echo 'false')

    if [[ $warning_state == "true" ]]; then
        set_notification_details 'finished with WARNINGS' "${WARNING_COLOR}"
        echo "Step ${command_name} completed with warnings"
        return 99
    elif [[ $command_status -eq 0 ]]; then
        set_notification_details 'SUCCEEDED' "${SUCCESS_COLOR}"
        echo "Step ${command_name} completed successfully"
        return 0
    else
        set_notification_details 'FAILED' "${ERROR_COLOR}"
        echo "Step ${command_name} failed with an error exit code ${command_status}"
        return 1
    fi
}

# Annotates a Buildkite build from JSON report
# Usage: annotate_from_json <command_name> <json_file> <style>
#   command_name: Name of the command (used for context)
#   json_file: Path to the JSON report file
#   style: Buildkite annotation style - info|warning|error|success
annotate_from_json() {
  local command_name="${1:?Error: command_name is required}"
  local json_file="${2:?Error: json_file is required}"
  local style="${3:-info}"

  if [[ ! -f "$json_file" ]]; then
    echo "JSON report file not found: $json_file"
    return 1
  fi

  # Check if jq is available
  if ! command -v jq &> /dev/null; then
    echo "jq is not available, falling back to text annotation"
    return 1
  fi

  local command timestamp success error_count warning_count retryable_count
  command=$(jq -r '.command // "unknown"' "$json_file")
  timestamp=$(jq -r '.timestamp // "unknown"' "$json_file")
  success=$(jq -r '.status.success // false' "$json_file")
  error_count=$(jq -r '.status.error_count // 0' "$json_file")
  warning_count=$(jq -r '.status.warning_count // 0' "$json_file")
  retryable_count=$(jq -r '.status.retryable_error_count // 0' "$json_file")

  {
    echo "### Report: ${command}"
    echo ""
    echo "**Timestamp:** ${timestamp}"
    echo ""
    echo "**success:** ${success}, **errors:** ${error_count}, **warnings:** ${warning_count}, **retryable:** ${retryable_count}"
    echo ""

    # Extract and display summary as a table
    echo "#### Summary"
    echo ""

    # Format summary based on command type
    case "$command" in
      fund-settlement)
        if jq -e '.summary.epochs | type == "array"' "$json_file" > /dev/null 2>&1; then
          echo "| **Epoch** | **Type** | **Settlements Funded/Total** | **SOL Funded/Total** |"
          echo "|-----------|----------|------------------------------|----------------------|"
          jq -r '.summary.epochs[] | "| **\(.epoch)** | _Total_ | \(.funded_settlements) / \(.total_settlements) | \(.funded_amount_sol | tostring | .[0:10]? // .) / \(.total_amount_sol | tostring | .[0:10]? // .) |", (.reasons[] | "| | \(.reason) | \(.funded_settlements) / \(.total_settlements) | \(.funded_amount_sol | tostring | .[0:10]? // .) / \(.total_amount_sol | tostring | .[0:10]? // .) |")' "$json_file" 2>/dev/null
        else
          echo '```json'
          jq '.summary' "$json_file"
          echo '```'
        fi
        ;;
      claim-settlement)
        if jq -e '.summary.epochs | type == "array"' "$json_file" > /dev/null 2>&1; then
          echo "| **Epoch** | **Type** | **Nodes Claimed/Total** | **SOL Claimed/Total** |"
          echo "|-----------|----------|-------------------------|------------------------|"
          jq -r '.summary.epochs[] | "| **\(.epoch)** | _Total_ | \(.claimed_nodes) / \(.total_nodes) | \(.claimed_amount_sol | tostring | .[0:10]? // .) / \(.total_amount_sol | tostring | .[0:10]? // .) |", (.reasons[] | "| | \(.reason) | \(.claimed_nodes) / \(.total_nodes) | \(.claimed_amount_sol | tostring | .[0:10]? // .) / \(.total_amount_sol | tostring | .[0:10]? // .) |")' "$json_file" 2>/dev/null
        else
          echo '```json'
          jq '.summary' "$json_file"
          echo '```'
        fi
        ;;
      close-settlement)
        local closed reset_accounts reset_sol withdrawn_accounts withdrawn_sol
        closed=$(jq -r '.summary.closed_settlements // 0' "$json_file")
        reset_accounts=$(jq -r '.summary.reset_stake_accounts // 0' "$json_file")
        reset_sol=$(jq -r '.summary.reset_stake_sol // 0' "$json_file")
        withdrawn_accounts=$(jq -r '.summary.withdrawn_stake_accounts // 0' "$json_file")
        withdrawn_sol=$(jq -r '.summary.withdrawn_stake_sol // 0' "$json_file")
        echo "| **Metric** | **Value** |"
        echo "|------------|-----------|"
        echo "| Closed settlements | ${closed} |"
        echo "| Reset stake accounts | ${reset_accounts} |"
        echo "| Reset stake SOL | ${reset_sol} |"
        echo "| Withdrawn stake accounts | ${withdrawn_accounts} |"
        echo "| Withdrawn stake SOL | ${withdrawn_sol} |"
        ;;
      init-settlement)
        local epoch created existing nodes max_claim_sol upsized
        epoch=$(jq -r '.summary.epoch // "unknown"' "$json_file")
        created=$(jq -r '.summary.created_settlements // 0' "$json_file")
        existing=$(jq -r '.summary.existing_settlements // 0' "$json_file")
        nodes=$(jq -r '.summary.total_merkle_nodes // 0' "$json_file")
        max_claim_sol=$(jq -r '.summary.total_max_claim_sol // 0' "$json_file")
        upsized=$(jq -r '.summary.upsized_settlements // 0' "$json_file")
        echo "| **Metric** | **Value** |"
        echo "|------------|-----------|"
        echo "| Epoch | ${epoch} |"
        echo "| Created settlements | ${created} |"
        echo "| Existing settlements | ${existing} |"
        echo "| Upsized settlements | ${upsized} |"
        echo "| Total merkle nodes | ${nodes} |"
        echo "| Total max claim SOL | ${max_claim_sol} |"
        ;;
      *)
        # Fallback to JSON for unknown commands
        echo '```json'
        jq '.summary' "$json_file"
        echo '```'
        ;;
    esac

    # Show errors if any
    if [[ "$error_count" -gt 0 || "$retryable_count" -gt 0 ]]; then
      echo ""
      echo "<details>"
      echo "<summary>Errors (${error_count} + ${retryable_count} retryable)</summary>"
      echo ""
      echo '```'
      jq -r '.errors[] | "[\(.severity)] \(.message)"' "$json_file" 2>/dev/null | head -20
      echo '```'
      echo "</details>"
    fi

    # Show warnings if any
    if [[ "$warning_count" -gt 0 ]]; then
      echo ""
      echo "<details>"
      echo "<summary>Warnings (${warning_count})</summary>"
      echo ""
      echo '```'
      jq -r '.warnings[] | "[\(.severity)] \(.message)"' "$json_file" 2>/dev/null | head -20
      echo '```'
      echo "</details>"
    fi
  } | buildkite-agent annotate --style "$style" --context "${command_name}-report"
}

# Annotates a Buildkite build with the JSON report
# Usage: annotate_execution_report <command_name> [style]
#   command_name: Name of the command (used for artifact naming)
#   style: Buildkite annotation style - info|warning|error|success (default: info)
annotate_execution_report() {
  local command_name="${1:?Error: command_name is required}"
  local style="${2:-info}"
  local latest_json_report

  # Download JSON report artifacts (don't fail if none exist)
  buildkite-agent artifact download --include-retried-jobs "report.${command_name}.*.json" . || true

  # Find the latest JSON report file
  latest_json_report=$(ls -v "report.${command_name}."[0-9]*.json 2>/dev/null | tail -n 1)

  if [[ -n "$latest_json_report" && -f "$latest_json_report" ]]; then
    annotate_from_json "$command_name" "$latest_json_report" "$style"
  else
    echo "No JSON report found for ${command_name}"
    {
      echo "### Report ${command_name}"
      echo "No JSON report file found."
    } | buildkite-agent annotate --style "$style" --context "${command_name}-report"
  fi
}
