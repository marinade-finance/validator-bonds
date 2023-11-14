#!/bin/bash

set -e

target_dir="$1"
if [[ -z $target_dir ]]
then
    echo "Usage: $0 <target-dir>" >&2
    exit 1
fi

if ! [[ -d $target_dir ]]
then
    echo "Directory ($target_dir) does not exist!" >&2
    exit 1
fi

script_dir=$(dirname "$0")

epoch=$(solana epoch || exit 1)
previous_epoch=$((epoch - 1))
snapshot_dir=$(mktemp --directory -p "$target_dir" "snapshot-$previous_epoch-XXXXXX")

echo "Snapshot directory: $snapshot_dir" >&2
echo "Current epoch: $epoch" >&2
echo "Previous epoch: $previous_epoch" >&2

"$script_dir/fetch-genesis.bash" "$snapshot_dir"
"$script_dir/fetch-jito-data.bash" "$previous_epoch" "$snapshot_dir"
