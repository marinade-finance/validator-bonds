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

echo "Current epoch: $epoch" >&2
echo "Previous epoch: $previous_epoch" >&2

"$script_dir/fetch-genesis.bash" "$target_dir"
"$script_dir/fetch-jito-data.bash" "$previous_epoch" "$target_dir"
