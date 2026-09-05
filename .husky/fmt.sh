#!/usr/bin/env sh
set -e

CHANGED_RS_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep '\.rs$' || true)

if [ -z "$CHANGED_RS_FILES" ]; then
  echo "No Rust files changed, skipping fmt check"
  exit 0
fi

cargo fmt -- --check $CHANGED_RS_FILES
