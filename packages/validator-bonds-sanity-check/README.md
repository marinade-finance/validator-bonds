# Validator Bonds - Pipeline Sanity Check

CLI to check sanity of past and current epoch validator bonds program data.

## Usage

### 1) Getting input data

```bash
DIR="${PWD}/data"
mkdir -p "$DIR"
epoch=857
past_epochs_to_check=10
for one_epoch in $(seq $((epoch - past_epochs_to_check)) $epoch); do
  echo $one_epoch
  mkdir "$DIR/tmp"
  gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${one_epoch}/*merkle-trees.json" "$DIR/tmp/"
  gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${one_epoch}/*settlements.json" "$DIR/tmp/"
  for I in "$DIR/tmp/"*; do
    mv "$I" "$DIR/${one_epoch}-$(basename $I)"
  done
  rm -rf "$DIR/tmp"
done
```

### 2) Running the merkle tree check

Verification of merkle tree file: internal consistency, cross-validation
against settlement sources, and anomaly detection against past epochs.

```bash
pnpm cli check-merkle-tree \
  -m "${DIR}/${epoch}-unified-merkle-trees.json" \
  -s "${DIR}/${epoch}-bid-distribution-settlements.json" \
  -p "${DIR}"/!(${epoch})-*-merkle-trees.json \
  --correlation-threshold 0.15 --score-threshold 2.0 --min-absolute-deviation 0.05

# See all CLI options
pnpm cli check-merkle-tree --help
```

## How sanity check works

### 0) Current Data Validation

Ensures at least one settlement exists in the current epoch data.

### 1) Individual Field Anomalies

Checks specific metrics using z-score analysis. The fields checked are:
`totalValidators`, `totalClaims`, `totalClaimAmount`, `avgClaimAmountPerValidator`, `avgClaimsPerValidator`.

Each check requires ALL of the following to flag an anomaly:

1. Z-score > `score-threshold` (statistical significance)
2. Absolute deviation > `min-absolute-deviation` (practical significance)
3. NOT similar to all of the 2 most recent epochs (see below)

### 2) Consistency with Recent History

To avoid cascading failures after legitimate regime changes, values are checked against recent history:

- Current value must be similar (within `correlation-threshold`) to the 2 most recent epochs

Then the value is considered consistent with recent history and NOT flagged, even if it deviates from the historical mean.

**Why this matters:**

- When a legitimate change occurs (e.g., validator set changes), the first epoch with the new value requires human review
- The second similar epoch also requires review (defensive: 2 checkpoints per regime change)
- Only after 2 consecutive similar epochs are approved do subsequent similar epochs auto-pass
- This prevents a single accidental approval from immediately propagating errors

### Example Scenarios

#### Scenario: Regime Change (Subsequent Epochs)

```
Epoch 910: totalClaimAmount = 180B (regime change from ~168B)
- Z-score: 2.5 > 2.0 threshold
- Recent epochs 908, 909 have values ~168B (not similar)
Result: FAIL - requires manual approval (1st checkpoint)

Epoch 911: totalClaimAmount = 181B
- Z-score: 2.3 > 2.0 threshold
- Recent epoch 910 is similar, but 909 (~168B) is not
Result: FAIL - requires manual approval (2nd checkpoint)

Epoch 912: totalClaimAmount = 182B
- Z-score: 2.1 > 2.0 threshold
- BUT: similar to BOTH recent epochs 910 and 911
Result: PASS - consistent with 2 consecutive approved epochs
```

#### Scenario: Claim Amount Spike

```
Epoch 912: avgClaimAmountPerValidator = 255657016
- Historical mean: 47184021
- Z-score: 8.6 > 2.0 threshold
- Absolute deviation: 442% > 5% minimum
- Not similar to recent epochs
Result: FAIL - genuine outlier requiring review
```
