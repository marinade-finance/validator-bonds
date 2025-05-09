# Engine to generate protected event Settlements for Institutional Staking

## Usage

### 1. Gathering input data

```bash
epoch=753
bucket=marinade-institutional-staking-mainnet
# generated by @marinade.finance/institutional-staking-cli NPM package
gcloud storage cp "gs://$bucket/$epoch/institutional-payouts.json" "institutional-payouts.json"
```

### 2. Define stake account for payouts for stake distributor

```bash
MARINADE_FEE_STAKE_AUTHORITY: 89SrbjbuNyqSqAALKBsKBqMSh463eLvzS4iVWCeArBgB
MARINADE_FEE_WITHDRAW_AUTHORITY: 89SrbjbuNyqSqAALKBsKBqMSh463eLvzS4iVWCeArBgB
```

### 3. Generating protected events

```bash
# Build & run
cargo run --release --bin institutional-distribution-cli -- \
    --institutional-payouts institutional-payouts.json \
    --marinade-fee-stake-authority ${MARINADE_FEE_STAKE_AUTHORITY} \
    --marinade-fee-withdraw-authority ${MARINADE_FEE_WITHDRAW_AUTHORITY} \
    --output-settlement-collection "./institutional-settlements.json" \
    --output-merkle-tree-collection "./institutional-merkle-trees.json"
```

## Testing

To check if data generated by institutional staking
CLI fits with the structure expected by this
merkle tree generation CLI you can do:

1. Clone, build and get test data of [instititutional-staking project](https://github.com/marinade-finance/institutional-staking)
   ```sh
   pnpm test:download-institutional
   INSTITUTIONAL_DATA_PATH="./settlement-distributions/institutional-distribution/tests/fixtures/output-prime-payouts.json"
   ```
2. Execute Merkle Tree Bonds CLI
   ```bash
   TARGET=`mktemp -d`
   cargo run --bin institutional-distribution-cli -- \
    --institutional-payouts "$INSTITUTIONAL_DATA_PATH" \
    --marinade-fee-stake-authority $(solana-keygen pubkey) \
    --marinade-fee-withdraw-authority $(solana-keygen pubkey) \
    --output-settlement-collection "$TARGET/institutional-settlements.json" \
    --output-merkle-tree-collection "$TARGET/institutional-merkle-trees.json"
   echo "Generated data in '$TARGET'"
   ```

3. Generate discord report
   ```bash
   export MARINADE_FEE_STAKE_AUTHORITY=$(solana-keygen pubkey)
   export MARINADE_FEE_WITHDRAW_AUTHORITY=$(solana-keygen pubkey)
   ./scripts/generate-discord-public-report.bash "$TARGET"/institutional-settlements.json "Institutional"
   ```
