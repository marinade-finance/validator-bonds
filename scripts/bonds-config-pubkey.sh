#!/bin/bash

claim_type="$1"

if [ -z "$claim_type" ]; then
    echo "Error: claim_type is empty or unknown" >&2
    exit 1
fi

UNIFIED_BIDDING="vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU"
CONFIG_INSTITUTIONAL="VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE"

if [[ "$claim_type" == bid* ]] || [[ "$claim_type" == unified* ]]; then
    echo "$UNIFIED_BIDDING"
    exit 0
elif [[ "$claim_type" == institutional* ]]; then
    echo "$CONFIG_INSTITUTIONAL"
    exit 0
else
    echo "Error config pubkey: Invalid claim type: $claim_type" >&2
    exit 1
fi