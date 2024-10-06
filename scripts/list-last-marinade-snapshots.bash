#!/bin/bash#!/bin/bash

gstorage_items=$(gcloud storage ls --recursive gs://marinade-solana-snapshot-mainnet || exit 1)
