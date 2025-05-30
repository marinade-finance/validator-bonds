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
    echo "Target directory ($target_dir) does not exist." >&2
    exit 1
fi

wget --retry-connrefused --waitretry=1 --tries=10 --timeout=30 -P "$target_dir" http://api.mainnet-beta.solana.com/genesis.tar.bz2

pv "$target_dir"/genesis.tar.bz2 | tar -xj -C "$target_dir"
