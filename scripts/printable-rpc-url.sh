#!/bin/bash
# Print a display-safe version of an RPC URL for build logs / annotations.
# Internal "waypoint" hosts are returned as-is; for any other host the path is
# replaced with "/..." because it can carry secret API tokens.

rpc_url="${1:-$RPC_URL}"

if [ -z "$rpc_url" ]; then
    echo "(unset)"
    exit 0
fi

host_part=$(echo "$rpc_url" | sed -E 's#^([a-zA-Z][a-zA-Z0-9+.-]*://[^/]+).*#\1#')

if [[ "$host_part" == *waypoint* ]]; then
    echo "$rpc_url"
else
    echo "$host_part/..."
fi
