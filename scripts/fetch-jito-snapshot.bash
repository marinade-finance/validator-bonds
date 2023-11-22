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

jito_gs_bucket="gs://jito-mainnet"

gs_files=$(gcloud storage ls "$jito_gs_bucket/$epoch/**/*.tar.zst" || exit 1)
echo "Available objects:" >&2
echo "$gs_files" >&2

gs_path_snapshot=$(<<<"$gs_files" head -1)

if [[ -z $gs_path_snapshot ]]
then
    echo "No snapshot found for the specified epoch." >&2
    exit 1
fi

echo "Snapshot path: $gs_path_snapshot" >&2

gcloud storage cp "$gs_path_snapshot" "$target_dir_absolute"

pv -F "Written: %b Elapsed: %t ETA: %e Speed: %a" -f -i 10 "$target_dir_absolute"/snapshot-*.tar.zst | tar --use-compress-program=unzstd -xf - -C "$target_dir_absolute"
