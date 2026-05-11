#!/usr/bin/env bash
# Print a display-safe version of an RPC URL for build logs / annotations.
# Internal "waypoint" hosts are returned as-is; for any other host the path is
# replaced with "/..." because it can carry secret API tokens.

rpc_url="${1:-$RPC_URL}"

if [ -z "$rpc_url" ]; then
    echo "(unset)"
    exit 0
fi

if [[ "$rpc_url" =~ ^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/?#]*@)?([^/?#]+) ]]; then
    host_part="${BASH_REMATCH[1]}://${BASH_REMATCH[3]}"
else
    echo "(invalid)"
    exit 0
fi

if [[ "$host_part" == *waypoint* ]]; then
    echo "$rpc_url"
elif (( ${#BASH_REMATCH[0]} < ${#rpc_url} )); then
    echo "$host_part/..."
else
    echo "$host_part"
fi
