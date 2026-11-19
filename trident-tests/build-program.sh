#!/usr/bin/env bash
# Builds the program as SBPF v0 into target/deploy/validator_bonds.so (the file Trident.toml points to).
# Needs `cargo-build-sbf` (Agave/Solana 3.1.12) on PATH.
set -euo pipefail
cd "$(dirname "$0")"
GIT_REV="${GIT_REV:-fuzz}" GIT_REV_NAME="${GIT_REV_NAME:-fuzz}" \
CARGO_TARGET_DIR="${SBF_TARGET_DIR:-$PWD/target/sbf}" \
  cargo build-sbf --arch v0 \
    --manifest-path ../programs/validator-bonds/Cargo.toml \
    --sbf-out-dir target/deploy
ls -l target/deploy/validator_bonds.so
