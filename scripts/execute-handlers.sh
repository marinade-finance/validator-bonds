#!/bin/bash

# Function to handle command execution and exit codes
# Where we define exit error codes:
# 0: Success
# 1: Non-retryable error
# 2: Warning failure
# 100: Retryable failure
# Error code is stored in Buildkite metadata set as compound of variables
# ${command_name}_status and ${command_name}_warning.
handle_command_execution() {
    set +e
    local command_name="$1"
    shift
    set -o pipefail
    "$@" | tee -a "./execution-report.${BUILDKITE_RETRY_COUNT}"
    local exit_code=$?

    set -x # TODO: DELETE ME
    buildkite-agent meta-data set "${command_name}_status" "$exit_code"

    # Handle different exit codes
    case $exit_code in
        0)
            echo "${command_name}: completed successfully"
            ;;
        99)
            echo "${command_name}: completed with warnings"
            # Store warning state for next step
            buildkite-agent meta-data set "${command_name}_warning" "true"
            # Exit with 0 to continue pipeline but with warning flag
            exit 0
            ;;
        100)
            echo "${command_name}: completed with retryable errors"
            exit 100
            ;;
        *)
            echo "${command_name}: completed with critical errors"
            exit 1
            ;;
    esac
}

# COLORS
readonly SUCCESS_COLOR="52224"      # Green
readonly WARNING_COLOR="16355909"   # Orange/Yellow
readonly ERROR_COLOR="14431557"     # Red

# Function to set global variables for notification details
set_notification_details() {
    notification_result="$1"
    notification_color="$2"
}

check_command_execution_status() {
    set -x # TODO: DELETE ME
    local command_name="$1"
    local command_status
    local warning_state

    set_notification_details 'UNKNOWN FAIL' "${ERROR_COLOR}"
    command_status=$(buildkite-agent meta-data get "${command_name}_status" || echo '-1')
    warning_state=$(buildkite-agent meta-data get "${command_name}_warning" || echo 'false')

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
