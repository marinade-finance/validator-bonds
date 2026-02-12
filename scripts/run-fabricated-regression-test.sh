#!/usr/bin/env bash
#
# End-to-end regression test using fabricated data.
#
# This script:
#   1. Generates fabricated input data for a range of epochs
#   2. Checks out 'main', builds old CLIs, runs them to produce expected/ outputs
#   3. Switches back to the original branch, builds new CLIs
#   4. Runs regression-test-settlements.sh to produce actual/ and compare
#
# Usage:
#   # Single epoch (default 99999):
#   ./scripts/run-fabricated-regression-test.sh
#
#   # 50 epochs:
#   ./scripts/run-fabricated-regression-test.sh --start-epoch 99900 --end-epoch 99950
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

START_EPOCH=99999
END_EPOCH=99999
DATA_DIR="$REPO_ROOT/regression-data-fabricated"
SKIP_GENERATE=false
SKIP_EXPECTED=false
ONLY_GENERATE=false

BID_BONDS_CONFIG="vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU"
INST_BONDS_CONFIG="VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE"

# Fee config values (matching settlement-config.yaml on both branches)
MARINADE_FEE_BPS=950
MARINADE_FEE_STAKE_AUTH="BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x"
MARINADE_FEE_WITHDRAW_AUTH="BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x"
DAO_FEE_SPLIT_SHARE_BPS=10000
DAO_FEE_STAKE_AUTH="mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz"
DAO_FEE_WITHDRAW_AUTH="mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz"
WHITELIST_STAKE_AUTHS="stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq,4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk,ex9CfkBZZd6Nv9XdnoDmmB45ymbu4arXVk7g5pWnt3N"

# Institutional fee authorities
INST_MARINADE_FEE_STAKE_AUTH="BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x"
INST_MARINADE_FEE_WITHDRAW_AUTH="BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x"
INST_DAO_FEE_SPLIT_SHARE_BPS="10000"
INST_DAO_FEE_STAKE_AUTH="mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz"
INST_DAO_FEE_WITHDRAW_AUTH="mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-epoch)     START_EPOCH="$2"; shift 2 ;;
    --end-epoch)       END_EPOCH="$2"; shift 2 ;;
    --data-dir)        DATA_DIR="$2"; shift 2 ;;
    --skip-generate)   SKIP_GENERATE=true; shift ;;
    --skip-expected)   SKIP_EXPECTED=true; shift ;;
    --only-generate)   ONLY_GENERATE=true; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: run-fabricated-regression-test.sh [OPTIONS]

Options:
  --start-epoch N    First epoch to generate/test (default: 99999)
  --end-epoch N      Last epoch to generate/test  (default: 99999)
  --data-dir DIR     Where to store test data (default: ./regression-data-fabricated)
  --skip-generate    Skip input data generation (reuse existing)
  --skip-expected    Skip building/running on main (reuse existing expected/ outputs)
  --only-generate    Generate inputs + expected outputs, then stop

Examples:
  # Single epoch (quick smoke test):
  ./scripts/run-fabricated-regression-test.sh

  # 50 diverse epochs:
  ./scripts/run-fabricated-regression-test.sh --start-epoch 99900 --end-epoch 99950
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
TOTAL_EPOCHS=$(( END_EPOCH - START_EPOCH + 1 ))
echo "Current branch: $CURRENT_BRANCH"
echo "Data directory:  $DATA_DIR"
echo "Epochs:          $START_EPOCH .. $END_EPOCH ($TOTAL_EPOCHS epoch(s))"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Generate fabricated input data
# ---------------------------------------------------------------------------
if [[ "$SKIP_GENERATE" == "true" ]]; then
  echo "=== Skipping input data generation (--skip-generate) ==="
else
  echo "=== Step 1: Generating fabricated input data ==="
  python3 "$SCRIPT_DIR/generate-fabricated-test-data.py" \
    --start-epoch "$START_EPOCH" --end-epoch "$END_EPOCH" \
    --output-root "$DATA_DIR"
  echo ""
fi

# ---------------------------------------------------------------------------
# Step 2: Build and run OLD pipeline on main to produce expected/ outputs
# ---------------------------------------------------------------------------
if [[ "$SKIP_EXPECTED" == "true" ]]; then
  echo "=== Skipping expected output generation (--skip-expected) ==="
else
  echo "=== Step 2: Building and running OLD pipeline on 'main' branch ==="
  echo ""

  # Stash any uncommitted changes
  STASH_NEEDED=false
  if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null; then
    echo "Stashing uncommitted changes..."
    git -C "$REPO_ROOT" stash push -m "fabricated-regression-test-temp"
    STASH_NEEDED=true
  fi

  cleanup_git() {
    echo "Switching back to $CURRENT_BRANCH..."
    git -C "$REPO_ROOT" checkout "$CURRENT_BRANCH" 2>/dev/null || true
    if [[ "$STASH_NEEDED" == "true" ]]; then
      echo "Restoring stashed changes..."
      git -C "$REPO_ROOT" stash pop || true
    fi
  }
  trap cleanup_git EXIT

  echo "Checking out 'main'..."
  git -C "$REPO_ROOT" checkout main

  echo "Building old CLIs on main..."
  (cd "$REPO_ROOT" && cargo build --release \
    --bin bid-distribution-cli \
    --bin bid-psr-distribution-cli \
    --bin institutional-distribution-cli)

  OLD_BID_CLI="$REPO_ROOT/target/release/bid-distribution-cli"
  OLD_PSR_CLI="$REPO_ROOT/target/release/bid-psr-distribution-cli"
  OLD_INST_CLI="$REPO_ROOT/target/release/institutional-distribution-cli"
  OLD_SETTLEMENT_CONFIG="$REPO_ROOT/settlement-config.yaml"

  for (( epoch = START_EPOCH; epoch <= END_EPOCH; epoch++ )); do
    EPOCH_DIR="$DATA_DIR/$epoch"
    INPUTS_DIR="$EPOCH_DIR/inputs"
    EXPECTED_DIR="$EPOCH_DIR/expected"
    mkdir -p "$EXPECTED_DIR"

    echo ""
    echo "--- Epoch $epoch ($((epoch - START_EPOCH + 1))/$TOTAL_EPOCHS) ---"

    # --- Run old bid-distribution-cli (SAM only) ---
    echo "  bid-distribution-cli (SAM)..."
    "$OLD_BID_CLI" \
      --sam-meta-collection "$INPUTS_DIR/sam-scores.json" \
      --stake-meta-collection "$INPUTS_DIR/stakes.json" \
      --rewards-dir "$INPUTS_DIR/rewards" \
      --output-settlement-collection "$EXPECTED_DIR/bid-distribution-settlements.json" \
      --output-merkle-tree-collection "$EXPECTED_DIR/bid-distribution-settlement-merkle-trees.json" \
      --output-config "$EXPECTED_DIR/bid-config.json" \
      --marinade-fee-bps "$MARINADE_FEE_BPS" \
      --marinade-fee-stake-authority "$MARINADE_FEE_STAKE_AUTH" \
      --marinade-fee-withdraw-authority "$MARINADE_FEE_WITHDRAW_AUTH" \
      --dao-fee-split-share-bps "$DAO_FEE_SPLIT_SHARE_BPS" \
      --dao-fee-stake-authority "$DAO_FEE_STAKE_AUTH" \
      --dao-fee-withdraw-authority "$DAO_FEE_WITHDRAW_AUTH" \
      --whitelist-stake-authority "$WHITELIST_STAKE_AUTHS" \
      --validator-bonds-config "$BID_BONDS_CONFIG" \
      2>&1 | tail -1

    # --- Run old bid-psr-distribution-cli (PSR only) ---
    echo "  bid-psr-distribution-cli (PSR)..."
    "$OLD_PSR_CLI" \
      --validator-meta-collection "$INPUTS_DIR/validators.json" \
      --stake-meta-collection "$INPUTS_DIR/stakes.json" \
      --revenue-expectation-collection "$INPUTS_DIR/evaluation.json" \
      --output-protected-event-collection "$EXPECTED_DIR/psr-protected-events.json" \
      --output-settlement-collection "$EXPECTED_DIR/bid-psr-distribution-settlements.json" \
      --output-merkle-tree-collection "$EXPECTED_DIR/bid-psr-distribution-settlement-merkle-trees.json" \
      --output-config "$EXPECTED_DIR/psr-config.json" \
      --whitelist-stake-authority "$WHITELIST_STAKE_AUTHS" \
      --validator-bonds-config "$BID_BONDS_CONFIG" \
      --settlement-config "$OLD_SETTLEMENT_CONFIG" \
      2>&1 | tail -1

    # --- Run old institutional-distribution-cli (if data exists) ---
    if [[ -f "$INPUTS_DIR/institutional/institutional-payouts.json" ]]; then
      echo "  institutional-distribution-cli..."
      "$OLD_INST_CLI" \
        --institutional-payouts "$INPUTS_DIR/institutional/institutional-payouts.json" \
        --stake-meta-collection "$INPUTS_DIR/institutional/stakes.json" \
        --marinade-fee-stake-authority "$INST_MARINADE_FEE_STAKE_AUTH" \
        --marinade-fee-withdraw-authority "$INST_MARINADE_FEE_WITHDRAW_AUTH" \
        --dao-fee-split-share-bps "$INST_DAO_FEE_SPLIT_SHARE_BPS" \
        --dao-fee-stake-authority "$INST_DAO_FEE_STAKE_AUTH" \
        --dao-fee-withdraw-authority "$INST_DAO_FEE_WITHDRAW_AUTH" \
        --validator-bonds-config "$INST_BONDS_CONFIG" \
        --output-settlement-collection "$EXPECTED_DIR/institutional-distribution-settlements.json" \
        --output-merkle-tree-collection "$EXPECTED_DIR/institutional-distribution-settlement-merkle-trees.json" \
        --output-config "$EXPECTED_DIR/institutional-config.json" \
        2>&1 | tail -1
    else
      echo "  (no institutional data for this epoch)"
    fi
  done

  echo ""
  echo "Expected outputs generated for $TOTAL_EPOCHS epoch(s)!"

  # Switch back to original branch
  trap - EXIT
  cleanup_git
fi

if [[ "$ONLY_GENERATE" == "true" ]]; then
  echo ""
  echo "=== Done (--only-generate). Expected outputs are in $DATA_DIR/<epoch>/expected/ ==="
  echo ""
  echo "To run the comparison later:"
  echo "  $SCRIPT_DIR/regression-test-settlements.sh \\"
  echo "    --start-epoch $START_EPOCH --end-epoch $END_EPOCH --data-dir $DATA_DIR"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 3: Build new CLIs on current branch and run regression test
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 3: Building new CLIs on '$CURRENT_BRANCH' and running regression test ==="
echo ""

(cd "$REPO_ROOT" && cargo build --release \
  --bin bid-distribution-cli \
  --bin institutional-distribution-cli \
  --bin merkle-generator-cli)

echo ""
echo "Running regression-test-settlements.sh..."
"$SCRIPT_DIR/regression-test-settlements.sh" \
  --start-epoch "$START_EPOCH" --end-epoch "$END_EPOCH" --data-dir "$DATA_DIR"
