#!/bin/bash

set -e

epoch="$1"
target_dir="$2"

if [[ -z $epoch ]] || [[ -z $target_dir ]]
then
    echo "Usage: $0 <epoch> <target-dir>" >&2
    exit 1
fi

if ! [[ -d $target_dir ]]
then
    echo "Target directory ($target_dir) does not exist." >&2
    exit 1
fi

target_dir_absolute="$(realpath $target_dir)"
echo "Target path: $target_dir_absolute" >&2

marinade_gs_bucket="gs://marinade-solana-snapshot-mainnet"

gs_files=$(gcloud storage ls "$marinade_gs_bucket/$epoch/**" || exit 1)
echo "Available objects:" >&2
echo "$gs_files" >&2

<<<"$gs_files" xargs -I{} gcloud storage cp {} "$target_dir_absolute"
