#!/bin/bash
# when environment variable SLACK_FEED is set, use it; otherwise defined based on claim type

if [[ -n "$SLACK_FEED" ]]; then
    echo "$SLACK_FEED"
    exit 0
fi

claim_type="$1"

if [ -z "$claim_type" ]; then
    echo "Error: claim_type is empty or unknown" >&2
    exit 1
fi

SLACK_FEED_BIDDING="feed-pipeline-sam-psr"
SLACK_FEED_INSTITUTIONAL="feed-institutional-staking"

if [[ "$claim_type" == bid* ]]; then
    echo "$SLACK_FEED_BIDDING"
    exit 0
elif [[ "$claim_type" == institutional* ]]; then
    echo "$SLACK_FEED_INSTITUTIONAL"
    exit 0
else
    echo "Error slack feed: Invalid claim type: $claim_type" >&2
    exit 1
fi