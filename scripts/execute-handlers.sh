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
    set -o pipefail
    local execution_report_file="./execution-report.${command_name}.${BUILDKITE_RETRY_COUNT}"
    echo "#ATTEMPT ${BUILDKITE_RETRY_COUNT}" | tee -a "$execution_report_file"
    "$@" | tee -a "$execution_report_file"
    local exit_code=$?

    buildkite-agent meta-data set --redacted-vars="" "${command_name}_status" "$exit_code"

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

# Annotates a Buildkite build with the latest execution report
# Usage: annotate_execution_report <command_name> [lines] [style]
#   command_name: Name of the command (used for artifact naming)
#   lines: Number of lines to show (default: 50)
#   style: Buildkite annotation style - info|warning|error|success (default: info)
annotate_execution_report() {
  local command_name="${1:?Error: command_name is required}"
  local lines="${2:-50}"
  local style="${3:-info}"
  local latest_report

  # Download artifacts (don't fail if none exist)
  buildkite-agent artifact download --include-retried-jobs "execution-report.${command_name}.*" . || true
  # Find the latest numbered report file
  latest_report=$(ls -v "execution-report.${command_name}."[0-9]* 2>/dev/null | tail -n 1)

  if [[ -z "$latest_report" || ! -f "$latest_report" ]]; then
    echo 'No attempt report found' > "./latest-report.txt"
  else
    cp "$latest_report" "./latest-report.txt"
  fi

  {
    echo "### Report ${command_name} (first ${lines} lines)"
    echo '```'
    head -n "$lines" "./latest-report.txt"
    if [[ $(wc -l < "./latest-report.txt") -gt $lines ]]; then
      echo "..."
    fi
    echo '```'
  } | buildkite-agent annotate --style "$style" --context "${command_name}-report"
}