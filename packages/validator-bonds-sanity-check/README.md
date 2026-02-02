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
  gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${one_epoch}/*settlements.json" "$DIR/tmp/"
  for I in "$DIR/tmp/"*; do
    mv "$I" "$DIR/${one_epoch}-$(basename $I)"
  done
  rm -rf "$DIR/tmp"
done
```

### 2) Running the sanity check

Verification of settlement file of the upcoming calculated epoch against
past epochs settlement files to detect anomalies in number of claims,
distribution amounts and claimed amounts per validator.

```bash
pnpm cli:check check -c "${DIR}/${epoch}-bid-distribution-settlements.json" \
  -p "${DIR}"/!(${epoch})-bid-distribution-settlements.json \
  --correlation-threshold 0.15 --score-threshold 2.0 --min-absolute-deviation 0.05 \
  --verbose --type bid

pnpm cli:check check -c "$DIR"/857-bid-psr-distribution-settlements.json \
  -p $(seq -f "$DIR"/%g-bid-psr-distribution-settlements.json 845 856) \
  --min-absolute-deviation 0.05 --type psr
```

### 3) Verification of settlements and merkle tree consistency

Load settlement and merkle tree files for a given epoch and run consistency check
that involves base verification that number of settlements and claimed amounts
match those recorded in the merkle tree file.

```bash
epoch=857
DIR="${PWD}/data-${epoch}"
mkdir -p "$DIR"
gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${epoch}/*settlement*.json" "$DIR"

pnpm cli:check check-settlement -s "${DIR}/bid-distribution-settlements.json" \
  -m "${DIR}/bid-distribution-settlement-merkle-trees.json"
```

## CLI Options

- `--correlation-threshold <ratio>` (default: 0.15)
  - Maximum allowed deviation ratio for consistency checks, expressed as a value between 0 and 1.
  - Used to determine if current value is "close enough" to recent history
  - Lower values (e.g., 0.10): More sensitive, more human interventions required

* `--score-threshold <threshold>` (default: 2.0)
  - Z-score threshold for individual field anomaly detection. Determines how many standard deviations from the historical mean triggers an anomaly.
  - Calculates z-score: `(current - mean) / stdDev`
  - Lower values (e.g., 1.5): More sensitive, catches ~87% of normal data

* `--min-absolute-deviation <ratio>` (default: 0.05)
  - Minimum absolute deviation from historical mean (as ratio) required to flag anomalies.
  - Even if z-score exceeds threshold, anomaly is only flagged if the absolute deviation also exceeds this minimum
  - Higher than institutional (1%) because settlement data is more volatile
  - Lower values (e.g., 0.01): More sensitive to small changes

* `--type <type>` (default: bid)
  - Type of processing: `bid` or `psr`

## How Anomaly Detection Works

### 0) Current Data Validation

Ensures at least one settlement exists in the current epoch data.

### 1) Individual Field Anomalies

Checks specific metrics using z-score analysis. The fields checked depend on `--type`:

- **BID**: `totalSettlements`, `totalSettlementClaimAmount`
- **PSR**: `avgSettlementClaimAmountPerValidator` only (settlement counts are too volatile)

Each check requires ALL of the following to flag an anomaly:

1. Z-score > `score-threshold` (statistical significance)
2. Absolute deviation > `min-absolute-deviation` (practical significance)
3. NOT similar to all of the 2 most recent epochs (see below)

### 2) Consistency with Recent History

To avoid cascading failures after legitimate regime changes, values are checked against recent history:

- Current value must be similar (within `correlation-threshold`) to BOTH of the 2 most recent epochs

Then the value is considered consistent with recent history and NOT flagged, even if it deviates from the historical mean.

**Why this matters:**

- When a legitimate change occurs (e.g., validator set changes), the first epoch with the new value requires human review
- The second similar epoch also requires review (defensive: 2 checkpoints per regime change)
- Only after 2 consecutive similar epochs are approved do subsequent similar epochs auto-pass
- This prevents a single accidental approval from immediately propagating errors

### Example Scenarios

#### Scenario: Regime Change (Subsequent Epochs)

```
Epoch 910: totalSettlementClaimAmount = 180B (regime change from ~168B)
- Z-score: 2.5 > 2.0 threshold
- Recent epochs 908, 909 have values ~168B (not similar)
Result: FAIL - requires manual approval (1st checkpoint)

Epoch 911: totalSettlementClaimAmount = 181B
- Z-score: 2.3 > 2.0 threshold
- Recent epoch 910 is similar, but 909 (~168B) is not
Result: FAIL - requires manual approval (2nd checkpoint)

Epoch 912: totalSettlementClaimAmount = 182B
- Z-score: 2.1 > 2.0 threshold
- BUT: similar to BOTH recent epochs 910 and 911
Result: PASS - consistent with 2 consecutive approved epochs
```

#### Scenario: Claim Amount Spike

```
Epoch 912: avgSettlementClaimAmountPerValidator = 255657016
- Historical mean: 47184021
- Z-score: 8.6 > 2.0 threshold
- Absolute deviation: 442% > 5% minimum
- Not similar to recent epochs
Result: FAIL - genuine outlier requiring review
```
