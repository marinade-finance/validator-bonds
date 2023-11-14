#!/bin/bash

gstorage_items=$(gcloud storage ls gs://mainnet-beta-ledger-us-ny5 || exit 1)
gstorage_snapshot_items=$(<<<"$gstorage_items" awk -F / '$(NF - 1) ~ /^[0-9]+$/' || exit 1)
gstorage_snapshot_latest_items=$(<<<"$gstorage_snapshot_items" sort -t / -k4 -n -r | head -3 || exit 1)

<<<"$gstorage_snapshot_latest_items" xargs -I@ gcloud storage cat --display-url @bounds.txt
